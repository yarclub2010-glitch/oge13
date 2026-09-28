// Проверка презентации (задание 13.1) по критериям ФИПИ.
//
// Ошибки делятся на группы «Структура», «Шрифт», «Изображения». Однотипные ошибки
// (одинаковый type) считаются за одну систематическую, как в критериях.
//   2 балла — ровно три слайда, ошибок нет;
//   1 балл  — три слайда, на 2-м и 3-м есть иллюстрации и текст, не более одной ошибки,
//             или два слайда по теме без ошибок;
//   0 баллов — всё остальное или файл не в формате .odp.

import { SLIDE_SPEC } from './tasks.js';
import { fontType, FONT_TYPE_NAMES, contrast, round } from './office.js';
import { plural } from './check132.js';

const GROUPS = { structure: 'Структура', font: 'Шрифт', images: 'Изображения' };
const TOL = 0.5; // допуск по размеру шрифта, пт

export function checkPresentation(model, topic) {
  const errors = []; // { type, group, text, slide, shapes }
  const notes = [];
  const add = (type, group, text, extra = {}) => errors.push({ type, group, text, ...extra });

  const slides = model.slides;
  const visible = slides.filter((s) => !s.hidden);
  if (visible.length < slides.length) notes.push(`Скрытых слайдов: ${slides.length - visible.length}. В показе их не видно, но эксперт их увидит в файле — лучше удалить.`);
  const n = slides.length;

  // ---------- Слайды ----------
  if (n > 3) add('count', 'structure', `В презентации ${plural(n, 'слайд', 'слайда', 'слайдов')}, а нужно ровно три.`);
  const ratio = model.width / model.height;
  if (model.width < model.height) add('page', 'structure', 'Ориентация слайдов книжная, а нужна альбомная.');
  else if (Math.abs(ratio - 16 / 9) > 0.03) {
    add('page', 'structure', `Формат слайдов ${round(model.width, 2)} × ${round(model.height, 2)} см — это не «Экран 16:9». Выберите Слайд → Свойства слайда → Формат: «Экран 16:9».`);
  }
  const anim = slides.filter((s) => s.animations > 0);
  if (anim.length) add('anim', 'structure', `На слайде ${anim.map((s) => s.number).join(', ')} есть анимация объектов, а слайды должны быть без анимации.`, { slides: anim.map((s) => s.number) });
  const trans = slides.filter((s) => s.transition);
  if (trans.length) add('anim', 'structure', `У слайда ${trans.map((s) => s.number).join(', ')} задан эффект смены слайдов. Это тоже анимация — уберите его (панель «Смена слайда» → «Нет»).`, { slides: trans.map((s) => s.number) });

  // ---------- Объекты на слайдах ----------
  const parsed = slides.map((s, i) => analyseSlide(s, i === 0 ? 1 : n === 2 ? guessKind(s) : Math.min(i + 1, 3)));

  // Титульный слайд
  const s1 = parsed[0];
  if (!s1) return finish();
  if (!s1.title) add('title-slide', 'structure', 'На первом слайде нет названия презентации.', { slide: 1 });
  else {
    if (topic && !mentions(s1.title.text, topic)) notes.push(`Название «${short(s1.title.text)}» не похоже на тему «${topic.title}». Эксперт проверит, что название отвечает теме.`);
  }
  if (!s1.subtitle) add('title-slide', 'structure', 'На титульном слайде нет подзаголовка с информацией об авторе (на экзамене — идентификационный номер участника).', { slide: 1 });
  if (s1.images.length) notes.push('На титульном слайде есть изображения. По макету там только название и подзаголовок; небольшое оформление обычно не считается ошибкой, но не перегружайте слайд.');
  if (s1.texts.length) add('layout', 'structure', `На титульном слайде лишние текстовые блоки (${s1.texts.length}) — по макету только название и информация об авторе.`, { slide: 1, shapes: s1.texts });

  // Слайды 2 и 3
  let contentOk = true;
  for (const ps of parsed.slice(1, 3)) {
    const kind = ps.kind;
    const want = SLIDE_SPEC.layouts[kind];
    const needT = want.join('').split('').filter((c) => c === 'T').length;
    const needI = want.join('').split('').filter((c) => c === 'I').length;
    const num = ps.slide.number;
    if (!ps.title) add('slide-title', 'structure', `У слайда ${num} нет заголовка — каждый слайд должен быть озаглавлен.`, { slide: num });
    if (!ps.images.length || !ps.texts.length) contentOk = false;
    const counts = [];
    if (ps.images.length !== needI) counts.push(`изображений ${ps.images.length} вместо ${needI}`);
    if (ps.texts.length !== needT) counts.push(`текстовых блоков ${ps.texts.length} вместо ${needT}`);
    if (counts.length) {
      add('layout', 'structure', `Слайд ${num}: ${counts.join(', ')}. По макету ${kind}-го слайда нужны заголовок, ${needI === 2 ? 'два изображения и два блока текста' : 'три изображения и три блока текста'}.`, { slide: num });
    } else {
      const got = rowsPattern([...ps.images, ...ps.texts]);
      const mirror = want.map((r) => r.split('').map((c) => (c === 'T' ? 'I' : 'T')).join(''));
      if (same(got, want)) {
        // как на макете
      } else if (same(got, mirror)) {
        notes.push(`Слайд ${num}: изображения и текст расположены зеркально по сравнению с макетом (${got.join(' / ')} вместо ${want.join(' / ')}, где I — изображение, T — текст). Надёжнее повторить макет точно.`);
      } else {
        add('layout', 'structure', `Слайд ${num}: объекты расположены не по макету. Получилось ${describeRows(got)}, а нужно ${describeRows(want)}.`, { slide: num });
      }
    }
    if (ps.title && [...ps.images, ...ps.texts].some((o) => o.y + 0.1 < ps.title.y)) {
      add('layout', 'structure', `Слайд ${num}: заголовок должен быть над остальными объектами слайда.`, { slide: num, shapes: [ps.title] });
    }
    const empty = ps.texts.filter((t) => words(t.text) < 3);
    if (empty.length) notes.push(`Слайд ${num}: в ${empty.length === 1 ? 'одном текстовом блоке' : 'некоторых текстовых блоках'} совсем мало текста. Блоки должны содержать сведения по теме.`);
  }
  if (parsed[1] && parsed[2] && parsed[1].title && parsed[2].title && norm(parsed[1].title.text) === norm(parsed[2].title.text)) {
    notes.push('У слайдов 2 и 3 одинаковые заголовки. Заголовок должен отвечать содержанию конкретного слайда.');
  }

  // ---------- Шрифт ----------
  const runsAll = [];
  for (const ps of parsed) {
    for (const sh of [ps.title, ps.subtitle, ...ps.texts].filter(Boolean)) {
      for (const p of sh.paragraphs) for (const r of p.runs) if (r.text.trim()) runsAll.push({ r, sh, slide: ps.slide.number });
    }
  }
  const types = new Map();
  for (const { r, slide } of runsAll) {
    const t = fontType(r.font) ?? `name:${r.font ?? '?'}`;
    if (!types.has(t)) types.set(t, { fonts: new Set(), slides: new Set() });
    types.get(t).fonts.add(r.font ?? 'не указан');
    types.get(t).slides.add(slide);
  }
  if (types.size > 1) {
    const list = [...types.entries()].map(([t, v]) => `${[...v.fonts].join(', ')} (${t.startsWith('name:') ? 'тип не определён' : FONT_TYPE_NAMES[t]}, слайды ${[...v.slides].join(', ')})`);
    add('font-type', 'font', `Используются шрифты разных типов: ${list.join('; ')}. Нужен единый тип шрифта.`);
  } else if (types.size === 1 && [...types.keys()][0] === 'decor') {
    notes.push('Используется декоративный шрифт. В задании требуется рубленый, с засечками или моноширинный — выберите обычный шрифт, например Liberation Sans или Arial.');
  }

  const sizeIssues = [];
  const checkSize = (sh, want, what, slide) => {
    if (!sh) return;
    const bad = new Set();
    for (const p of sh.paragraphs) {
      for (const r of p.runs) {
        if (!r.text.trim()) continue;
        const eff = r.size * (sh.fontScale ?? 1);
        if (Math.abs(r.size - want) > TOL) bad.add(fmtPt(r.size));
        else if (sh.fontScale !== null && Math.abs(eff - want) > TOL) bad.add(`${fmtPt(r.size)}, уменьшенный автоподбором до ${fmtPt(eff)}`);
      }
    }
    if (bad.size) sizeIssues.push({ text: `слайд ${slide}, ${what}: ${[...bad].join(', ')} вместо ${want} пт`, sh, slide });
    else if (sh.shrink && sh.fontScale === null) notes.push(`Слайд ${slide}, ${what}: включён автоподбор размера текста. Если текст не помещается в рамку, LibreOffice уменьшает шрифт — тогда он будет меньше ${want} пт. Отключите «Автоподбор текста» (правый щелчок по рамке) или увеличьте рамку.`);
  };
  if (s1) {
    checkSize(s1.title, SLIDE_SPEC.titleSize, 'название презентации', 1);
    checkSize(s1.subtitle, SLIDE_SPEC.headSize, 'подзаголовок', 1);
  }
  for (const ps of parsed.slice(1)) {
    checkSize(ps.title, SLIDE_SPEC.headSize, 'заголовок', ps.slide.number);
    ps.texts.forEach((t, k) => checkSize(t, SLIDE_SPEC.textSize, ps.texts.length > 1 ? `текстовый блок ${k + 1}` : 'текст', ps.slide.number));
  }
  if (sizeIssues.length) {
    add('font-size', 'font', `Неверный размер шрифта: ${sizeIssues.map((s) => s.text).join('; ')}. Нужно: название презентации — 40 пт, подзаголовок титульного слайда и заголовки слайдов — 24 пт, остальной текст — 20 пт.`, { shapes: sizeIssues.map((s) => s.sh) });
  }

  // Текст поверх изображений и слияние с фоном
  const overlapsText = [];
  const lowContrast = [];
  for (const ps of parsed) {
    const textShapes = [ps.title, ps.subtitle, ...ps.texts].filter(Boolean);
    for (const t of textShapes) {
      for (const im of ps.images) if (overlap(t, im) > 0.08) overlapsText.push({ slide: ps.slide.number, t, im });
      const bg = t.fill ?? (ps.slide.background.kind === 'solid' ? ps.slide.background.color : null);
      if (!bg) continue;
      for (const p of t.paragraphs) {
        const r = p.runs.find((x) => x.text.trim() && x.color);
        if (r && contrast(r.color, bg) !== null && contrast(r.color, bg) < 2) {
          lowContrast.push({ slide: ps.slide.number, t });
          break;
        }
      }
    }
    for (let a = 0; a < ps.texts.length; a++) {
      for (let b = a + 1; b < ps.texts.length; b++) if (overlap(ps.texts[a], ps.texts[b]) > 0.15) overlapsText.push({ slide: ps.slide.number, t: ps.texts[a], im: ps.texts[b], texts: true });
    }
  }
  if (overlapsText.length) {
    const sl = [...new Set(overlapsText.map((o) => o.slide))];
    add('text-overlap', 'font', `Текст перекрывает изображения или другой текст (слайд ${sl.join(', ')}). Раздвиньте объекты.`, { shapes: overlapsText.flatMap((o) => [o.t, o.im]) });
  }
  if (lowContrast.length) {
    add('contrast', 'font', `Текст сливается с фоном (слайд ${[...new Set(lowContrast.map((o) => o.slide))].join(', ')}): цвет текста слишком близок к цвету фона.`, { shapes: lowContrast.map((o) => o.t) });
  }
  const complexBg = slides.filter((s) => s.background.kind !== 'solid' || s.masterObjects > 0);
  if (complexBg.length) notes.push('Фон слайдов — рисунок, градиент или содержит фигуры. Убедитесь сами, что текст хорошо читается на фоне: этот пункт тренажёр проверяет только для однотонного фона.');

  // ---------- Изображения ----------
  const distorted = [];
  const imgOverlap = [];
  const outside = [];
  for (const ps of parsed) {
    for (const im of ps.images) {
      const d = distortion(im);
      if (d !== null && d > 0.05) distorted.push({ slide: ps.slide.number, im, d });
      if (outsideShare(im, model) > 0.1) outside.push({ slide: ps.slide.number, im });
      if (ps.title && overlap(ps.title, im) > 0.05) imgOverlap.push({ slide: ps.slide.number, a: im, b: ps.title });
    }
    for (let a = 0; a < ps.images.length; a++) {
      for (let b = a + 1; b < ps.images.length; b++) if (overlap(ps.images[a], ps.images[b]) > 0.02) imgOverlap.push({ slide: ps.slide.number, a: ps.images[a], b: ps.images[b] });
    }
  }
  if (distorted.length) {
    add('aspect', 'images', `Изображения искажены — нарушены пропорции (слайд ${[...new Set(distorted.map((x) => x.slide))].join(', ')}, до ${Math.round(Math.max(...distorted.map((x) => x.d)) * 100)} %). Меняйте размер картинки, потянув за угол с нажатой клавишей Shift, или верните исходный размер (правый щелчок → «Исходный размер»).`, { shapes: distorted.map((x) => x.im) });
  }
  if (imgOverlap.length) {
    add('img-overlap', 'images', `Изображения накладываются друг на друга или на заголовок (слайд ${[...new Set(imgOverlap.map((x) => x.slide))].join(', ')}).`, { shapes: imgOverlap.flatMap((x) => [x.a, x.b]) });
  }
  if (outside.length) {
    add('img-outside', 'images', `Изображение выходит за край слайда (слайд ${[...new Set(outside.map((x) => x.slide))].join(', ')}).`, { shapes: outside.map((x) => x.im) });
  }

  // Соответствие теме
  if (topic) {
    const off = [];
    for (const ps of parsed.slice(1)) for (const t of ps.texts) if (!mentions(t.text, topic) && words(t.text) >= 3) off.push(ps.slide.number);
    if (off.length) notes.push(`В некоторых текстовых блоках (слайд ${[...new Set(off)].join(', ')}) не нашлось слов по теме «${topic.title}». Эксперт проверяет, что текст и изображения соответствуют теме.`);
  }

  return finish();

  function finish() {
    // Однотипные ошибки — одна систематическая
    const byType = new Map();
    for (const e of errors) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }
    const distinct = byType.size;
    let score = 0;
    let why;
    if (n === 3) {
      if (distinct === 0) {
        score = 2;
        why = 'Три слайда, структура, шрифты и изображения соответствуют требованиям.';
      } else if (distinct === 1 && contentOk) {
        score = 1;
        why = 'Три слайда с иллюстрациями и текстом, но есть одна ошибка (однотипные ошибки считаются за одну).';
      } else {
        why = !contentOk
          ? 'На втором и третьем слайдах должны быть и иллюстрации, и текстовые блоки.'
          : `Ошибок разного вида: ${distinct}. На 1 балл допускается не более одной.`;
      }
    } else if (n === 2) {
      if (distinct === 0 && parsed[1] && parsed[1].images.length && parsed[1].texts.length) {
        score = 1;
        why = 'Презентация из двух слайдов без ошибок — это 1 балл. За 2 балла нужны ровно три слайда.';
      } else why = 'Презентация из двух слайдов получает 1 балл, только если в ней нет ошибок.';
    } else if (n > 3) {
      if (distinct === 1 && contentOk) {
        score = 1;
        why = 'Слайдов больше трёх — это ошибка в структуре. Других ошибок нет.';
      } else why = 'Слайдов больше трёх, и есть другие ошибки.';
    } else {
      why = n === 0 ? 'В файле нет слайдов.' : 'В презентации только один слайд.';
    }
    return {
      score,
      max: 2,
      why,
      slidesCount: n,
      errors: [...byType.values()].map((list) => ({ ...list[0], text: list.map((e) => e.text).join(' '), group: GROUPS[list[0].group], shapes: list.flatMap((e) => e.shapes || []) })),
      notes,
      parsed,
    };
  }
}

// ---------- Разбор слайда ----------

// Какой макет у слайда презентации из двух слайдов: по числу картинок
function guessKind(slide) {
  return slide.shapes.filter((s) => s.kind === 'image').length >= 3 ? 3 : 2;
}

function analyseSlide(slide, kind) {
  const texts = slide.shapes.filter((s) => s.kind === 'text');
  const images = slide.shapes.filter((s) => s.kind === 'image');
  let title = texts.find((s) => s.role === 'title') ?? null;
  let subtitle = kind === 1 ? texts.find((s) => s.role === 'subtitle') ?? null : null;
  // Заголовок, набранный в обычной надписи: самый верхний текст над остальными объектами
  if (!title && texts.length) {
    const top = [...texts].sort((a, b) => a.y - b.y)[0];
    const others = [...texts, ...images].filter((s) => s !== top);
    if (kind === 1 || others.every((o) => top.y + top.h * 0.5 <= o.y + 0.2)) title = top;
  }
  if (kind === 1 && !subtitle) {
    const rest = texts.filter((s) => s !== title);
    if (rest.length) subtitle = [...rest].sort((a, b) => a.y - b.y)[0];
  }
  return {
    slide,
    kind,
    title,
    subtitle,
    texts: texts.filter((s) => s !== title && s !== subtitle),
    images,
  };
}

// Раскладка объектов по строкам: ['IT', 'TI'] — сверху вниз, в строке слева направо
export function rowsPattern(objs) {
  const items = objs.map((o) => ({ o, t: o.kind === 'image' ? 'I' : 'T', cy: o.y + o.h / 2, cx: o.x + o.w / 2 }));
  items.sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const it of items) {
    const row = rows.find((r) => r.some((x) => vOverlap(x.o, it.o) > 0.4));
    if (row) row.push(it);
    else rows.push([it]);
  }
  rows.sort((a, b) => avg(a.map((x) => x.cy)) - avg(b.map((x) => x.cy)));
  return rows.map((r) => r.sort((a, b) => a.cx - b.cx).map((x) => x.t).join(''));
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function vOverlap(a, b) {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, bottom - top) / Math.max(0.01, Math.min(a.h, b.h));
}

function describeRows(rows) {
  const name = { I: 'изображение', T: 'текст' };
  return rows.map((r, i) => `в ${i === 0 ? 'верхнем' : i === rows.length - 1 ? 'нижнем' : `${i + 1}-м`} ряду ${r.split('').map((c) => name[c]).join(' — ')}`).join(', ');
}

// Доля площади меньшего из прямоугольников, которую занимает пересечение
export function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(0.01, Math.min(a.w * a.h, b.w * b.h));
}

function outsideShare(s, model) {
  const w = Math.max(0, Math.min(s.x + s.w, model.width) - Math.max(s.x, 0));
  const h = Math.max(0, Math.min(s.y + s.h, model.height) - Math.max(s.y, 0));
  return 1 - (w * h) / Math.max(0.01, s.w * s.h);
}

// Насколько отношение сторон картинки на слайде отличается от исходного
export function distortion(im) {
  const px = im.image?.px;
  if (!px || !px.w || !px.h || !im.w || !im.h) return null;
  if (im.image.crop && !im.image.cropFractions) return null; // обрезка в .odp — пропорции исходника неизвестны
  let pw = px.w;
  let ph = px.h;
  if (im.image.crop) {
    const [l, t, r, b] = im.image.crop;
    pw *= 1 - l - r;
    ph *= 1 - t - b;
  }
  const want = pw / ph;
  const got = im.w / im.h;
  return Math.abs(got / want - 1);
}

// ---------- Текст ----------

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const words = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length;
const short = (s) => (s.length > 40 ? s.slice(0, 40) + '…' : s);
const fmtPt = (x) => `${round(x, 1)} пт`.replace('.', ',');

function mentions(text, topic) {
  const t = norm(text);
  if (topic.title.toLowerCase().split(/\s+/).every((w) => t.includes(w.slice(0, Math.max(4, w.length - 2)).replace(/ё/g, 'е')))) return true;
  return topic.keywords.some((k) => t.includes(k.replace(/ё/g, 'е')));
}
