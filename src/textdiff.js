// Сравнение набранного текста с образцом: опечатки, пропущенные и лишние слова,
// ошибки в пробелах и выделении слов.
//
// Текст разбивается на слова и знаки препинания. Для каждого слова запоминается,
// стоит ли перед ним пробел и как оно выделено. Последовательности выравниваются
// по наименьшему числу правок (как в diff).

// Приводим то, что на экзамене не считается ошибкой: ё/е, виды тире и кавычек,
// неразрывные пробелы, разбивку чисел пробелами (12 104 = 12104)
function normalize(s) {
  return s
    .replace(/ | | | /g, ' ')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[«»„“”"]/g, '"')
    .replace(/[‘’`']/g, "'")
    .replace(/…/g, '...')
    .replace(/(\d) (\d{3})(?!\d)/g, '$1$2');
}

const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;

// text + runs (с признаками bold/italic/underline) → токены
// [{ t (для сравнения), raw, space (пробел перед), spaces (сколько), marks: 'b', 'i', 'u' }]
export function tokenize(text, runs = null) {
  const src = normalize(text);
  // Выделение каждого символа — по участкам текста
  const marks = [];
  if (runs) {
    for (const r of runs) {
      const n = normalize(r.text).length;
      const m = (r.bold ? 'b' : '') + (r.italic ? 'i' : '') + (r.underline ? 'u' : '');
      for (let k = 0; k < n; k++) marks.push(m);
    }
  }
  const out = [];
  let m;
  WORD.lastIndex = 0;
  let prevEnd = 0;
  while ((m = WORD.exec(src))) {
    const gap = src.slice(prevEnd, m.index);
    const spaces = (gap.match(/ /g) || []).length;
    const tok = m[0];
    const tokMarks = marks.length ? majority(marks.slice(m.index, m.index + tok.length)) : '';
    out.push({ t: tok.toLowerCase(), raw: tok, case: tok, space: gap.length > 0, spaces, start: !out.length || gap.includes('\n'), marks: tokMarks, word: /[\p{L}\p{N}]/u.test(tok), at: m.index });
    prevEnd = m.index + tok.length;
  }
  return out;
}

function majority(list) {
  if (!list.length) return '';
  const count = { b: 0, i: 0, u: 0 };
  for (const m of list) for (const c of m) count[c]++;
  return ['b', 'i', 'u'].filter((c) => count[c] * 2 > list.length).join('');
}

// Выравнивание двух последовательностей токенов по Левенштейну
// → [{ a: токен образца | null, b: токен ученика | null }]
export function align(A, B) {
  const n = A.length;
  const m = B.length;
  const d = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = A[i - 1].t === B[j - 1].t ? 0 : A[i - 1].word === B[j - 1].word ? 1 : 2;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    }
  }
  const out = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const sub = A[i - 1].t === B[j - 1].t ? 0 : A[i - 1].word === B[j - 1].word ? 1 : 2;
      if (d[i][j] === d[i - 1][j - 1] + sub) {
        out.push({ a: A[i - 1], b: B[j - 1] });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ a: A[i - 1], b: null });
      i--;
    } else {
      out.push({ a: null, b: B[j - 1] });
      j--;
    }
  }
  return out.reverse();
}

// Сравнение: ошибки в тексте и в выделении
// → { errors: [{ kind, text }], marks: [{ word, want, got }], pairs }
export function compareText(sampleTokens, studentTokens) {
  const pairs = align(sampleTokens, studentTokens);
  const errors = [];
  const marks = [];
  for (let k = 0; k < pairs.length; k++) {
    const { a, b } = pairs[k];
    if (a && b) {
      if (a.t !== b.t) {
        errors.push({ kind: 'typo', text: `«${b.raw}» вместо «${a.raw}»`, pair: k });
      } else if (a.case !== b.case) {
        errors.push({ kind: 'case', text: `«${b.raw}» вместо «${a.raw}» (строчные и прописные буквы)`, pair: k });
      }
      // Пробелы в начале абзаца — это отступ, он проверяется отдельно
      if (!b.start && !a.start) {
        const wantSpace = a.space;
        if (wantSpace && !b.space) errors.push({ kind: 'space', text: `нет пробела перед «${b.raw}»`, pair: k });
        else if (!wantSpace && b.space) errors.push({ kind: 'space', text: `лишний пробел перед «${b.raw}»`, pair: k });
        else if (b.spaces > 1) errors.push({ kind: 'space', text: `несколько пробелов подряд перед «${b.raw}»`, pair: k });
      }
      if (a.word && a.marks !== b.marks) marks.push({ word: b.raw, want: a.marks, got: b.marks, pair: k });
    } else if (a) {
      errors.push({ kind: 'missing', text: `пропущено «${a.raw}»`, pair: k });
    } else {
      errors.push({ kind: 'extra', text: `лишнее «${b.raw}»`, pair: k });
    }
  }
  // Слово, разбитое пробелом («по мощь»), или два слова без пробела — одна ошибка, а не две
  const merged = [];
  for (const e of errors) {
    const prev = merged[merged.length - 1];
    if (prev && e.pair === prev.pair + 1 && ((prev.kind === 'typo' && e.kind === 'extra') || (prev.kind === 'typo' && e.kind === 'missing') || (prev.kind === 'extra' && e.kind === 'typo') || (prev.kind === 'missing' && e.kind === 'typo'))) {
      const pa = pairs[prev.pair];
      const pb = pairs[e.pair];
      const joinedA = ((pa.a?.t ?? '') + (pb.a?.t ?? ''));
      const joinedB = ((pa.b?.t ?? '') + (pb.b?.t ?? ''));
      if (joinedA === joinedB) {
        prev.kind = 'space';
        prev.text = `неверный пробел в «${(pa.b?.raw ?? '') + (pb.b?.raw ? (pb.b.space ? ' ' : '') + pb.b.raw : '')}»`;
        prev.pair = e.pair;
        continue;
      }
    }
    merged.push(e);
  }
  return { errors: merged, marks, pairs };
}

export const MARK_NAMES = { b: 'полужирный', i: 'курсив', u: 'подчёркнутый' };

export function describeMarks(m) {
  return m ? m.split('').map((c) => MARK_NAMES[c]).join(' + ') : 'обычный';
}
