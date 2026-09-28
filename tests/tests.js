// Автотесты: чтение файлов и проверка по критериям.
// Открыть tests/index.html через локальный сервер.
//
// Файлы в tests/fixtures сохранены настоящим LibreOffice (tools/make_fixtures.py):
// __ok — верное решение, остальные — типичные ошибки.

import { TOPICS, SAMPLES, topicById, sampleById, parseMarks, plain } from '../src/tasks.js';
import { readPresentation } from '../src/slides.js';
import { readDocument } from '../src/document.js';
import { checkPresentation, rowsPattern, distortion } from '../src/check131.js';
import { checkDocument } from '../src/check132.js';
import { tokenize, compareText } from '../src/textdiff.js';
import { fontType, imageSize, contrast } from '../src/office.js';
import { makeZip, readZip } from '../src/zip.js';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'условие не выполнено');
}
async function fixture(name) {
  const r = await fetch(`fixtures/${name}`);
  if (!r.ok) throw new Error(`нет файла ${name}`);
  return new Uint8Array(await r.arrayBuffer());
}
const types = (res) => res.errors.map((e) => e.type).sort().join(',');
const keys = (list) => list.map((e) => e.key).sort().join(',');

// ---------- Задания ----------

await test('Темы 13.1: у каждой текст, шесть картинок, ключевые слова', () => {
  const ids = new Set();
  for (const t of TOPICS) {
    assert(!ids.has(t.id), `повтор id ${t.id}`);
    ids.add(t.id);
    assert(/^[a-z-]+$/.test(t.id), `id ${t.id}`);
    assert(t.text.length >= 4, `${t.id}: мало текста`);
    assert(t.pictures.length === 6, `${t.id}: картинок ${t.pictures.length}`);
    assert(t.keywords.length >= 3, `${t.id}: ключевые слова`);
    for (const [, body] of t.text) assert(t.keywords.some((k) => body.toLowerCase().includes(k)), `${t.id}: в разделе нет ключевых слов: ${body.slice(0, 30)}`);
  }
});

await test('Образцы 13.2: разметка закрыта, таблица прямоугольная', () => {
  for (const s of SAMPLES) {
    for (const src of [s.heading, ...s.text, ...s.table.flat()]) {
      const runs = parseMarks(src + 'X');
      const last = runs[runs.length - 1];
      assert(!last.bold && !last.italic && !last.underline, `${s.id}: не закрыто выделение в «${src}»`);
    }
    assert(plain(s.heading) === plain(s.heading).toUpperCase(), `${s.id}: заголовок не прописными`);
    assert(s.table.every((r) => r.length === s.table[0].length), `${s.id}: строки таблицы разной длины`);
    assert(['table-first', 'text-first'].includes(s.order), `${s.id}: order`);
  }
});

await test('Разбор выделения **, *, __', () => {
  const r = parseMarks('a **b** *c* __d__ ***e*** **__f__**');
  const f = (t) => r.find((x) => x.text === t);
  assert(f('b').bold && !f('b').italic, 'b');
  assert(f('c').italic && !f('c').bold, 'c');
  assert(f('d').underline, 'd');
  assert(f('e').bold && f('e').italic, 'e');
  assert(f('f').bold && f('f').underline, 'f');
});

// ---------- Сравнение текста ----------

await test('Сравнение текста: опечатки, пропуски, пробелы, выделение', () => {
  const sampleRuns = parseMarks('Мама **мыла** раму, а папа — *пол*.');
  const a = tokenize(sampleRuns.map((r) => r.text).join(''), sampleRuns);
  const same = compareText(a, tokenize('Мама мыла раму, а папа - пол.', [{ text: 'Мама ' }, { text: 'мыла', bold: true }, { text: ' раму, а папа - ' }, { text: 'пол', italic: true }, { text: '.' }]));
  assert(same.errors.length === 0, 'тире и дефис не различаются: ' + same.errors.map((e) => e.text).join('; '));
  assert(same.marks.length === 0, 'выделение совпадает');
  const bad = compareText(a, tokenize('Мама мыла  раму ,папа — пол.'));
  const kinds = bad.errors.map((e) => e.kind).sort().join(',');
  assert(kinds === 'missing,space,space,space', `ошибки: ${bad.errors.map((e) => e.text).join('; ')}`);
  assert(bad.marks.length === 2, 'выделение «мыла» и «пол»');
  const nums = compareText(tokenize('Венера 12 104 км, «кило»'), tokenize('Венера 12104 км, "кило"'));
  assert(nums.errors.length === 0, 'разбивка чисел и кавычки: ' + nums.errors.map((e) => e.text).join('; '));
  const split = compareText(tokenize('помощь рядом'), tokenize('по мощь рядом'));
  assert(split.errors.length === 1, 'разорванное слово — одна ошибка: ' + split.errors.map((e) => e.text).join('; '));
});

// ---------- Помощники ----------

await test('Типы шрифтов', () => {
  assert(fontType('Liberation Sans') === 'sans' && fontType('Arial') === 'sans' && fontType('Calibri') === 'sans', 'рубленые');
  assert(fontType('Times New Roman') === 'serif' && fontType('Liberation Serif') === 'serif', 'с засечками');
  assert(fontType('Courier New') === 'mono' && fontType('DejaVu Sans Mono') === 'mono', 'моноширинные');
  assert(fontType('Comic Sans MS') === 'decor', 'декоративный');
  assert(fontType('Какой-то шрифт') === null, 'неизвестный');
});

await test('Размер картинки по заголовку и контраст', async () => {
  const b = await fixture('bear__ok.pptx');
  const zip = readZip(b);
  const media = [...zip.keys()].find((k) => k.startsWith('ppt/media/'));
  const size = imageSize(await zip.get(media).read());
  assert(size && size.w === 1200 && size.h === 900, JSON.stringify(size));
  assert(contrast('#000000', '#ffffff') > 20 && contrast('#ffff00', '#ffffff') < 1.2, 'контраст');
});

await test('ZIP: запись и чтение', async () => {
  const bytes = await makeZip([{ name: 'Тема/текст.txt', data: 'привет' }, { name: 'a.bin', data: new Uint8Array([1, 2, 3]), store: true }]);
  const zip = readZip(bytes);
  assert((await zip.get('Тема/текст.txt').text()) === 'привет', 'текст');
  assert((await zip.get('a.bin').read()).length === 3, 'двоичный');
});

await test('Раскладка объектов по рядам', () => {
  const T = (x, y) => ({ kind: 'text', x, y, w: 8, h: 3 });
  const I = (x, y) => ({ kind: 'image', x, y, w: 7, h: 5 });
  assert(rowsPattern([I(1, 4), T(10, 5), T(1, 11), I(19, 10)]).join('/') === 'IT/TI', 'слайд 2');
  assert(rowsPattern([T(1, 4), I(10, 3.6), T(19, 4), I(1, 10), T(10, 11), I(20, 10)]).join('/') === 'TIT/ITI', 'слайд 3');
  assert(distortion({ w: 8, h: 6, image: { px: { w: 1200, h: 900 } } }) < 0.001, 'пропорции сохранены');
  assert(distortion({ w: 8, h: 8, image: { px: { w: 1200, h: 900 } } }) > 0.2, 'искажение');
});

// ---------- 13.1: файлы LibreOffice ----------

const bear = topicById('bear');
const P = [
  // файл, баллы, типы ошибок
  ['bear__ok.odp', 2, ''],
  ['bear__ok.pptx', 2, ''], // формат проверяется отдельно, в интерфейсе
  ['bear__distorted.odp', 1, 'aspect'],
  ['bear__sizes.odp', 1, 'font-size'],
  ['bear__fonts.odp', 1, 'font-type'],
  ['bear__two.odp', 1, ''],
  ['bear__layout.odp', 1, 'layout'],
  ['bear__overlap.odp', 1, 'text-overlap'],
  ['bear__four.odp', 1, 'count'],
  ['bear__transition.odp', 1, 'anim'],
  ['bear__defaults.odp', 0, 'font-size,layout'],
];
for (const [file, score, errs] of P) {
  await test(`13.1: ${file} — ${score} балл(а)`, async () => {
    const model = await readPresentation(await fixture(file), file);
    const res = checkPresentation(model, bear);
    assert(res.score === score, `баллы ${res.score}, ожидалось ${score}: ${res.errors.map((e) => e.text).join(' | ')}`);
    assert(types(res) === errs, `ошибки «${types(res)}», ожидалось «${errs}»`);
  });
}

await test('13.1: модель .odp — размер слайда, роли, шрифты', async () => {
  const m = await readPresentation(await fixture('bear__ok.odp'), 'ok.odp');
  assert(m.format === 'odp' && Math.abs(m.width - 28) < 0.01 && Math.abs(m.height - 15.75) < 0.01, `${m.width}×${m.height}`);
  assert(m.slides.length === 3, 'три слайда');
  const s1 = m.slides[0].shapes;
  assert(s1.find((s) => s.role === 'title').paragraphs[0].runs[0].size === 40, 'название 40 пт');
  const s3 = m.slides[2].shapes;
  assert(s3.filter((s) => s.kind === 'image').length === 3 && s3.filter((s) => s.kind === 'text').length === 4, 'слайд 3: 3 картинки и 4 текста');
  assert(s3.filter((s) => s.kind === 'text').every((s) => s.paragraphs[0].runs[0].font === 'Liberation Sans'), 'шрифт');
});

await test('13.1: .odt вместо презентации — понятная ошибка', async () => {
  try {
    await readPresentation(await fixture('demo__ok.odt'), 'demo.odt');
    throw new Error('ошибки нет');
  } catch (e) {
    assert(/текстовый документ/.test(e.message), e.message);
  }
});

// ---------- 13.2: файлы LibreOffice ----------

const demo = sampleById('demo');
const D = [
  ['demo__ok.odt', 2, '', ''],
  ['demo__ok.docx', 2, '', ''],
  ['demo__empty.odt', 1, 'gap', ''],
  ['demo__spaces.odt', 1, 'indent', ''],
  ['demo__fullwidth.odt', 1, '', 't-marks,t-width'],
  ['demo__enter.odt', 1, 'breaks,marks', ''],
  ['demo__12pt.odt', 1, 'size', ''],
];
for (const [file, score, textErr, tableErr] of D) {
  await test(`13.2: ${file} — ${score} балл(а)`, async () => {
    const model = await readDocument(await fixture(file), file);
    const res = checkDocument(model, demo);
    assert(res.score === score, `баллы ${res.score}, ожидалось ${score}: ${[...res.text, ...res.table].map((e) => e.text).join(' | ')}`);
    assert(keys(res.text) === textErr, `текст: «${keys(res.text)}», ожидалось «${textErr}»`);
    assert(keys(res.table) === tableErr, `таблица: «${keys(res.table)}», ожидалось «${tableErr}»`);
  });
}

await test('13.2: опечатки и пробелы в начале абзаца считаются отдельно', async () => {
  const res = checkDocument(await readDocument(await fixture('demo__spaces.odt'), 'x'), demo);
  assert(res.typos.length === 2, `ошибок набора ${res.typos.length}: ${res.typos.map((e) => e.text).join('; ')}`);
});

await test('13.2: другой образец — 0 баллов', async () => {
  const res = checkDocument(await readDocument(await fixture('demo__ok.odt'), 'x'), sampleById('planets'));
  assert(res.score === 0, `баллы ${res.score}`);
});

await test('13.2: модель .odt — интервалы, отступ, таблица', async () => {
  const m = await readDocument(await fixture('demo__ok.odt'), 'ok.odt');
  const [h, t, p] = m.body.filter((b) => b.type !== 'p' || b.text.trim());
  assert(h.align === 'center' && Math.abs(h.after - 14.17) < 0.1, 'заголовок');
  assert(t.type === 'table' && t.align === 'center' && Math.abs(t.width - 11) < 0.01, 'таблица');
  assert(p.align === 'justify' && Math.abs(p.indent - 1) < 0.01 && Math.abs(p.line.value - 1.15) < 0.001, 'абзац');
  assert(Math.abs(m.textWidth - 17) < 0.01, `ширина текста ${m.textWidth}`);
});

// ---------- Вывод ----------

const failed = results.filter((r) => !r.ok);
document.getElementById('results').innerHTML =
  `<h1 class="${failed.length ? 'fail' : 'ok'}">${failed.length ? `Не пройдено: ${failed.length} из ${results.length}` : `Все тесты пройдены: ${results.length}`}</h1>` +
  results.map((r) => `<div class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `<pre>${r.message}</pre>`}</div>`).join('');
