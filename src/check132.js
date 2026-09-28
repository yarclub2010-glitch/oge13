// Проверка текстового документа (задание 13.2) по критериям ФИПИ.
//
// Два элемента — основной текст (с заголовком) и таблица. Для каждого — список требований.
//   2 балла — всё выполнено (в тексте не более 5 ошибок набора, в таблице — не более 3);
//   1 балл  — в каждом элементе не более трёх нарушений, или один элемент полностью верен,
//             а другого нет или в нём больше трёх нарушений; а также если всё верно,
//             но столбцы таблицы явно непропорциональны;
//   0 баллов — всё остальное или файл не в формате .odt.

import { parseMarks, plain } from './tasks.js';
import { tokenize, compareText, describeMarks } from './textdiff.js';
import { round } from './office.js';

const SIZE = 14;
const GAP_MIN = 13.9; // 5 мм = 14,17 пт (небольшой допуск на округление)
const GAP_MAX = 24.3; // 8,5 мм = 24,1 пт
const SEP = ' ‖ '; // разделитель ячеек при сравнении текста таблицы

export function checkDocument(model, sample) {
  const text = []; // нарушения требований к основному тексту: { key, title, text }
  const table = []; // нарушения требований к таблице
  const notes = [];
  const body = model.body;
  const isText = (b) => b.type === 'p' && b.text.trim() !== '';

  // ---------- Что где в документе ----------
  const others = body.filter((b) => b.type === 'other' || (b.type === 'p' && b.objects));
  if (others.length) notes.push('В документе есть рисунки или надписи — в образце их нет.');
  const tables = body.filter((b) => b.type === 'table');
  if (tables.length > 1) notes.push(`В документе ${tables.length} таблицы — проверяется первая.`);
  const tbl = tables[0] ?? null;
  const tblIndex = tbl ? body.indexOf(tbl) : -1;

  const headingPlain = plain(sample.heading);
  const paras = body.map((b, i) => ({ b, i })).filter(({ b }) => isText(b));
  let heading = null;
  if (paras.length) {
    const first = paras[0];
    if (similar(first.b.text, headingPlain)) heading = first;
  }
  const mainParas = paras.filter((p) => p !== heading);
  const mainText = mainParas.map((p) => p.b.text).join('\n');
  const samplePlain = sample.text.map(plain).join('\n');

  // Заголовок и основной текст сравниваем с образцом вместе
  const sampleRuns = [...parseMarks(sample.heading), { text: '\n' }, ...sample.text.flatMap((t, k) => [...(k ? [{ text: '\n' }] : []), ...parseMarks(t)])];
  const sampleTokens = tokenize(sampleRuns.map((r) => r.text).join(''), sampleRuns);
  const headTokensCount = tokenize(headingPlain).length;
  const studRuns = [...(heading ? heading.b.runs : []), { text: '\n' }, ...mainParas.flatMap((p, k) => [...(k ? [{ text: '\n' }] : []), ...p.b.runs])];
  const studTokens = tokenize(studRuns.map((r) => r.text).join(''), studRuns);
  const cmp = compareText(sampleTokens, studTokens);
  // В заголовке строчные вместо прописных — отдельное требование, а не орфографические ошибки
  cmp.errors = cmp.errors.filter((e) => !(e.kind === 'case' && tokenIndexA(cmp.pairs, e.pair) < headTokensCount));

  const sampleMainCount = tokenize(samplePlain).filter((t) => t.word).length;
  const matchedMain = cmp.pairs.filter((p) => p.a && p.b && p.a.t === p.b.t && p.a.word).length;
  const textPresent = mainParas.length > 0 && matchedMain >= 0.5 * (sampleMainCount + tokenize(headingPlain).filter((t) => t.word).length);
  const tablePresent = !!tbl;

  // ---------- Основной текст ----------
  const allText = [...(heading ? [heading.b] : []), ...mainParas.map((p) => p.b)];
  const tableParas = tbl ? tbl.rows.flatMap((r) => r.flatMap((c) => c.paras)) : [];

  // Размер шрифта 14 пт — во всём тексте, включая заголовок и таблицу
  const badSizes = new Map();
  for (const [where, list] of [['в заголовке', heading ? [heading.b] : []], ['в основном тексте', mainParas.map((p) => p.b)], ['в таблице', tableParas]]) {
    for (const p of list) {
      for (const r of p.runs) {
        if (!r.text.trim() || Math.abs(r.size - SIZE) < 0.1) continue;
        const k = `${fmt(r.size)} пт ${where}`;
        badSizes.set(k, true);
      }
    }
  }
  if (badSizes.size) text.push({ key: 'size', title: 'Размер шрифта', text: `Встречается шрифт ${[...badSizes.keys()].join(', ')}. Весь текст должен быть набран шрифтом 14 пт.` });

  if (!heading) {
    text.push({ key: 'heading', title: 'Заголовок', text: `Не найден заголовок «${headingPlain}» — он должен быть первым абзацем документа.` });
  } else {
    const letters = heading.b.text.replace(/[^\p{L}]/gu, '');
    const upper = letters === letters.toUpperCase();
    const capsAttr = heading.b.runs.filter((r) => r.text.trim()).every((r) => r.caps);
    if (!upper && !capsAttr) text.push({ key: 'heading', title: 'Заголовок', text: 'Заголовок должен быть набран прописными (заглавными) буквами.' });
    else if (!upper && capsAttr) notes.push('Заголовок набран строчными буквами, а прописными он только отображается (эффект «Прописные»). Надёжнее набрать его прописными буквами — клавиша Caps Lock.');
  }

  // Выделение слов
  const markErr = cmp.marks;
  if (markErr.length) {
    const list = markErr.slice(0, 8).map((m) => `«${m.word}» — ${describeMarks(m.got)}, нужно ${describeMarks(m.want)}`);
    text.push({ key: 'marks', title: 'Выделение слов', text: `Неверно выделены слова: ${list.join('; ')}${markErr.length > 8 ? ` и ещё ${markErr.length - 8}` : ''}.` });
  }

  // Междустрочный интервал
  const badLine = allText.filter((p) => !lineOk(p.line));
  if (badLine.length) text.push({ key: 'line', title: 'Междустрочный интервал', text: `Междустрочный интервал ${describeLine(badLine[0].line)}${badLine.length > 1 ? ' (и в других абзацах)' : ''}. Нужен не меньше одинарного и не больше полуторного.` });

  // Интервалы до и после таблицы, пустые абзацы
  const gapIssues = [];
  let emptyUsed = false;
  if (tbl) {
    const before = neighbour(body, tblIndex, -1);
    const after = neighbour(body, tblIndex, 1);
    if (before.empty || after.empty) emptyUsed = true;
    if (before.block && before.block.type === 'p') {
      const gap = before.block.after + tbl.before + firstCellBefore(tbl);
      if (!before.empty && (gap < GAP_MIN || gap > GAP_MAX)) gapIssues.push(`между ${before.block === heading?.b ? 'заголовком' : 'текстом'} и таблицей ${fmtGap(gap)}`);
    }
    if (after.block && after.block.type === 'p') {
      const gap = tbl.after + after.block.before;
      if (!after.empty && (gap < GAP_MIN || gap > GAP_MAX)) gapIssues.push(`между таблицей и ${after.block === heading?.b ? 'заголовком' : 'текстом'} ${fmtGap(gap)}`);
    }
  }
  // Пустые абзацы между заголовком и остальным текстом тоже считаются «пустым абзацем» для интервала
  const lastContent = Math.max(...paras.map((p) => p.i), tblIndex);
  const firstContent = paras.length ? paras[0].i : 0;
  for (let i = firstContent; i < lastContent; i++) if (body[i].type === 'p' && !body[i].text.trim()) emptyUsed = true;
  if (gapIssues.length || emptyUsed) {
    const parts = [];
    if (gapIssues.length) parts.push(`Интервал ${gapIssues.join(', ')}; нужно от 14 до 24 пт (от 5 до 8,5 мм).`);
    if (emptyUsed) parts.push('Для интервала использован пустой абзац — так делать нельзя: задайте интервал перед абзацем или после него (Формат → Абзац → Отступы и интервалы).');
    text.push({ key: 'gap', title: 'Интервалы до и после таблицы', text: parts.join(' ') });
  }

  // Выравнивание заголовка и текста
  const alignIssues = [];
  if (heading && heading.b.align !== 'center') alignIssues.push(`заголовок выровнен ${alignName(heading.b.align)}, а нужно по центру`);
  const badMain = mainParas.filter((p) => p.b.align !== 'justify');
  if (badMain.length) alignIssues.push(`основной текст выровнен ${alignName(badMain[0].b.align)}, а нужно по ширине`);
  if (alignIssues.length) text.push({ key: 'align', title: 'Выравнивание', text: cap(alignIssues.join('; ')) + '.' });

  // Отступ первой строки
  const indentIssues = [];
  mainParas.forEach((p, k) => {
    const lead = /^[ \t ]+/.exec(p.b.text);
    if (lead) indentIssues.push(`${k === 0 ? 'в первом абзаце' : `в абзаце ${k + 1}`} отступ сделан ${/\t/.test(lead[0]) ? 'табуляцией' : 'пробелами'}`);
    else if (k === 0 || sample.text.length > 1) {
      if (Math.abs(p.b.indent - 1) > 0.05) indentIssues.push(`${k === 0 ? 'у первого абзаца' : `у абзаца ${k + 1}`} отступ первой строки ${fmt(p.b.indent)} см`);
    }
  });
  if (indentIssues.length) text.push({ key: 'indent', title: 'Отступ первой строки', text: `${cap(indentIssues.join('; '))}. Нужен отступ первой строки 1 см, заданный в свойствах абзаца (Формат → Абзац → Отступы и интервалы → «Первая строка»).` });
  if (heading && Math.abs(heading.b.indent) > 0.05 && heading.b.align === 'center') notes.push('У заголовка задан отступ первой строки — из-за этого он смещён от центра. Отступ нужен только основному тексту.');

  // Разбиение на строки
  const breakIssues = [];
  const withBreaks = allText.filter((p) => p.breaks > 0);
  if (withBreaks.length) breakIssues.push(`внутри абзаца использованы разрывы строк (Shift+Enter): ${withBreaks.reduce((s, p) => s + p.breaks, 0)}`);
  if (mainParas.length > sample.text.length) breakIssues.push(`основной текст разбит на ${plural(mainParas.length, 'абзац', 'абзаца', 'абзацев')}, а в образце ${sample.text.length === 1 ? 'один абзац' : sample.text.length} — похоже, строки заканчивались клавишей Enter`);
  if (breakIssues.length) text.push({ key: 'breaks', title: 'Разбиение на строки', text: `${cap(breakIssues.join('; '))}. Переход на новую строку внутри абзаца делает сам текстовый редактор.` });

  // Ошибки набора
  const typos = cmp.errors;
  if (typos.length > 5) text.push({ key: 'typos', title: 'Ошибки в тексте', text: `Ошибок в тексте: ${typos.length}, допускается не более пяти.` });

  // Порядок элементов
  if (tbl && heading && mainParas.length) {
    const tableFirst = tblIndex < mainParas[0].i;
    if (tableFirst !== (sample.order === 'table-first')) {
      notes.push(sample.order === 'table-first' ? 'В образце таблица идёт сразу после заголовка, а текст — после таблицы.' : 'В образце таблица идёт после основного текста.');
      text.push({ key: 'order', title: 'Расположение таблицы', text: 'Таблица расположена не так, как в образце.' });
    }
  }

  // ---------- Таблица ----------
  let tcmp = null;
  let cap1 = null;
  if (tbl) {
    const want = sample.table;
    const rows = tbl.rows.filter((r) => r.length);
    const cols = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.span, 0)), 0);
    const wantCols = want[0].length;
    const merged = rows.some((r) => r.some((c) => c.span > 1 || c.rowSpan > 1));
    if (rows.length !== want.length || cols !== wantCols || merged) {
      table.push({ key: 't-shape', title: 'Строки и столбцы', text: `В таблице ${plural(rows.length, 'строка', 'строки', 'строк')} и ${plural(cols, 'столбец', 'столбца', 'столбцов')}${merged ? ', есть объединённые ячейки' : ''}, а нужно ${plural(want.length, 'строка', 'строки', 'строк')} и ${plural(wantCols, 'столбец', 'столбца', 'столбцов')}.` });
    }

    // Текст и выделение в таблице
    const sRuns = [];
    want.forEach((row, ri) => row.forEach((cell, ci) => {
      if (ri || ci) sRuns.push({ text: SEP });
      sRuns.push(...parseMarks(cell));
    }));
    const uRuns = [];
    rows.forEach((row, ri) => row.forEach((cell, ci) => {
      if (ri || ci) uRuns.push({ text: SEP });
      cell.paras.forEach((p, k) => uRuns.push(...(k ? [{ text: ' ' }] : []), ...p.runs));
    }));
    tcmp = compareText(tokenize(sRuns.map((r) => r.text).join(''), sRuns), tokenize(uRuns.map((r) => r.text).join(''), uRuns));
    tcmp.errors = tcmp.errors.filter((e) => !/‖/.test(e.text));
    if (tcmp.marks.length) {
      const list = tcmp.marks.slice(0, 6).map((m) => `«${m.word}» — ${describeMarks(m.got)}, нужно ${describeMarks(m.want)}`);
      table.push({ key: 't-marks', title: 'Выделение в таблице', text: `${list.join('; ')}${tcmp.marks.length > 6 ? ` и ещё ${tcmp.marks.length - 6}` : ''}.` });
    }

    // Выравнивание в ячейках
    const center = [];
    const left = [];
    rows.forEach((row, ri) => {
      let col = 0;
      for (const cell of row) {
        const ps = cell.paras.filter((p) => p.text.trim());
        const al = ps.length ? ps[0].align : null;
        if (al) {
          if (ri === 0 || col > 0) {
            if (al !== 'center') center.push(ri === 0 ? `заголовок «${short(cell.text)}»` : `«${short(cell.text)}»`);
          } else if (al !== 'left') left.push(`«${short(cell.text)}» (${alignName(al)})`);
        }
        col += cell.span;
      }
    });
    if (center.length) table.push({ key: 't-center', title: 'Выравнивание по центру', text: `Не выровнены по центру: ${center.slice(0, 5).join(', ')}${center.length > 5 ? ' и другие' : ''}. Текст в ячейках заголовка и ${wantCols > 2 ? 'остальных столбцов' : 'второго столбца'} выравнивается по центру.` });
    if (left.length) table.push({ key: 't-left', title: 'Выравнивание по левому краю', text: `Текст в первом столбце (кроме заголовка) должен быть выровнен по левому краю: ${left.slice(0, 4).join(', ')}${left.length > 4 ? ' и другие' : ''}.` });

    // Ширина и положение таблицы
    const width = tableWidth(tbl, model.textWidth);
    if (width !== null && width > model.textWidth - 0.1) {
      table.push({ key: 't-width', title: 'Ширина таблицы', text: `Таблица шириной ${fmt(width)} см занимает всю ширину текста (${fmt(model.textWidth)} см). Ширина таблицы должна быть меньше ширины основного текста (Таблица → Свойства → Таблица → Ширина).` });
    }
    const centered = tbl.align === 'center' || (Math.abs(tbl.marginLeft - tbl.marginRight) < 0.2 && tbl.marginLeft > 0.1 && tbl.align === 'margins');
    if (!centered && !(width !== null && width > model.textWidth - 0.1)) {
      table.push({ key: 't-align', title: 'Положение таблицы', text: `Таблица выровнена ${tbl.align === 'right' ? 'по правому краю' : tbl.align === 'left' ? 'по левому краю' : 'не по центру'}, а должна быть выровнена по центру страницы (Таблица → Свойства → Таблица → Выравнивание «По центру»).` });
    }

    if (tcmp.errors.length > 3) table.push({ key: 't-typos', title: 'Ошибки в таблице', text: `Ошибок в тексте таблицы: ${tcmp.errors.length}, допускается не более трёх.` });

    // Явно непропорциональные столбцы
    const cw = tbl.cols.filter((w) => w);
    if (cw.length === wantCols && cw.length > 1) {
      const sum = cw.reduce((a, b) => a + b, 0);
      if (Math.min(...cw) < sum * 0.12) cap1 = 'Столбцы таблицы явно непропорциональны — за такое снижают оценку до 1 балла.';
    }
    if (rows.some((r) => r.some((c) => c.paras.filter((p) => p.text.trim()).length > 1))) notes.push('В некоторых ячейках текст разбит на несколько абзацев (Enter внутри ячейки).');
  }

  // ---------- Баллы ----------
  const tV = text.length;
  const bV = table.length;
  let score;
  let why;
  if (textPresent && tablePresent && tV === 0 && bV === 0) {
    score = cap1 ? 1 : 2;
    why = cap1 ?? 'Основной текст и таблица выполнены по образцу.';
  } else if (textPresent && tablePresent && tV <= 3 && bV <= 3) {
    score = 1;
    why = `Нарушений: в основном тексте — ${tV}, в таблице — ${bV}. Если в каждом элементе не больше трёх нарушений, ставится 1 балл.`;
  } else if (textPresent && tV === 0) {
    score = 1;
    why = tablePresent ? `Основной текст выполнен верно, но в таблице нарушений больше трёх (${bV}).` : 'Основной текст выполнен верно, но таблицы нет.';
  } else if (tablePresent && bV === 0) {
    score = 1;
    why = textPresent ? `Таблица выполнена верно, но в основном тексте нарушений больше трёх (${tV}).` : 'Таблица выполнена верно, но основного текста нет.';
  } else {
    score = 0;
    why = !textPresent && !tablePresent ? 'В документе нет ни текста образца, ни таблицы.' : `Нарушений: в основном тексте — ${tV}, в таблице — ${bV}. На 1 балл нужно не более трёх в каждом.`;
  }

  return {
    score,
    max: 2,
    why,
    textPresent,
    tablePresent,
    text,
    table,
    notes,
    typos: cmp.errors,
    tableTypos: tcmp ? tcmp.errors : [],
    cmp,
    tcmp,
    heading: heading?.b ?? null,
  };
}

// ---------- Помощники ----------

function tokenIndexA(pairs, k) {
  let n = 0;
  for (let i = 0; i < k; i++) if (pairs[i].a) n++;
  return n;
}

function similar(a, b) {
  const x = tokenize(a.toLowerCase()).filter((t) => t.word).map((t) => t.t);
  const y = tokenize(b.toLowerCase()).filter((t) => t.word).map((t) => t.t);
  if (!x.length || !y.length) return false;
  const common = x.filter((w) => y.includes(w)).length;
  return common >= Math.max(1, Math.ceil(y.length * 0.5)) && x.length <= y.length + 3;
}

// Соседний непустой блок и были ли между ними пустые абзацы
function neighbour(body, i, dir) {
  let empty = false;
  for (let k = i + dir; k >= 0 && k < body.length; k += dir) {
    const b = body[k];
    if (b.type === 'p' && !b.text.trim() && !b.objects) {
      empty = true;
      continue;
    }
    return { block: b, empty };
  }
  // Пустой абзац после таблицы в конце документа LibreOffice добавляет сам — это не ошибка
  return { block: null, empty: false };
}

function firstCellBefore(tbl) {
  const p = tbl.rows[0]?.[0]?.paras?.[0];
  return p ? p.before : 0;
}

function tableWidth(tbl, textWidth) {
  if (typeof tbl.width === 'number' && tbl.width > 0) {
    if (tbl.align === 'margins') return Math.max(0, textWidth - tbl.marginLeft - tbl.marginRight);
    return tbl.width;
  }
  if (tbl.width && tbl.width.pct) return (textWidth * tbl.width.pct) / 100;
  if (tbl.align === 'margins') return textWidth - tbl.marginLeft - tbl.marginRight;
  return null;
}

function lineOk(line) {
  if (line.rule === 'prop') return line.value >= 0.995 && line.value <= 1.505;
  if (line.rule === 'exact') return line.value >= 15.9 && line.value <= 24.2;
  if (line.rule === 'atLeast') return line.value <= 24.2;
  if (line.rule === 'leading') return line.value <= 8.1;
  return true;
}

function describeLine(line) {
  if (line.rule === 'prop') return `${fmt(line.value)} (${Math.round(line.value * 100)} %)`;
  if (line.rule === 'exact') return `точно ${fmt(line.value)} пт`;
  if (line.rule === 'atLeast') return `не менее ${fmt(line.value)} пт`;
  return `с дополнительным интервалом ${fmt(line.value)} пт`;
}

function alignName(a) {
  return { left: 'по левому краю', right: 'по правому краю', center: 'по центру', justify: 'по ширине' }[a] ?? a;
}

const fmt = (x) => String(round(x, 2)).replace('.', ',');
const fmtGap = (pt) => `${fmt(pt)} пт (${fmt((pt * 25.4) / 72)} мм)`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (s) => (s.length > 24 ? s.slice(0, 24) + '…' : s).replace(/\n/g, ' ');
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  return `${n} ${w}`;
}
