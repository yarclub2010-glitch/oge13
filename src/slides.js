// Чтение презентации (.odp из LibreOffice Impress или .pptx) в простую модель.
//
// {
//   format: 'odp' | 'pptx',
//   width, height,                      — размер слайда, см
//   slides: [{
//     number, hidden,
//     animations,                       — число эффектов анимации объектов
//     transition,                       — есть эффект смены слайда
//     background: { kind: 'solid' | 'image' | 'gradient' | 'pattern', color },
//     masterObjects,                    — число картинок и фигур на фоне (из мастер-слайда)
//     shapes: [{
//       kind: 'text' | 'image' | 'other',
//       role: 'title' | 'subtitle' | 'body' | null,  — заполнитель макета
//       x, y, w, h,                     — см от левого верхнего угла слайда
//       text, paragraphs: [{ text, level, runs: [{ text, size, font, bold, italic, underline, color }] }],
//       fill,                           — цвет заливки рамки или null
//       fontScale,                      — уменьшение шрифта при автоподборе (1 — нет) или null, если неизвестно
//       shrink,                         — включён автоподбор размера текста
//       image: { path, px: { w, h } | null, crop },
//     }],
//   }],
//   images: Map(путь → Uint8Array),
// }

import { readZip } from './zip.js';
import { NS, parseXML, attr, kid, kids, find, findAll } from './xml.js';
import {
  OfficeError, OdfStyles, odfTextProps, toCm, EMU_CM, readRels, readXmlPart, readTheme,
  imageSize, cleanFontName,
} from './office.js';

export async function readPresentation(bytes, fileName = '') {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new OfficeError('Это файл старого формата .ppt. Сохраните презентацию в формате .odp (Файл → Сохранить как → Презентация ODF) и загрузите ещё раз.');
  }
  let zip;
  try {
    zip = readZip(bytes);
  } catch {
    throw new OfficeError(`Файл «${fileName}» не похож на презентацию. Нужен файл .odp из LibreOffice Impress.`);
  }
  if (zip.has('content.xml')) {
    const mime = zip.has('mimetype') ? (await zip.get('mimetype').text()).trim() : '';
    if (mime && !mime.includes('presentation')) {
      const what = mime.includes('text') ? 'текстовый документ (.odt)' : mime.includes('spreadsheet') ? 'электронная таблица (.ods)' : 'не презентация';
      throw new OfficeError(`Это ${what}, а для задания 13.1 нужна презентация .odp из LibreOffice Impress.`);
    }
    return readOdp(zip);
  }
  if (zip.has('ppt/presentation.xml')) return readPptx(zip);
  if (zip.has('word/document.xml')) throw new OfficeError('Это документ Word (.docx), а для задания 13.1 нужна презентация .odp.');
  throw new OfficeError(`Файл «${fileName}» не похож на презентацию. Нужен файл .odp из LibreOffice Impress.`);
}

// =====================================================================
// .odp
// =====================================================================

async function readOdp(zip) {
  const content = parseXML(await zip.get('content.xml').text());
  const stylesDoc = zip.has('styles.xml') ? parseXML(await zip.get('styles.xml').text()) : null;
  const styles = new OdfStyles(stylesDoc, content);
  const images = new Map();
  const pres = find(content, NS.office, 'presentation');
  const pages = pres ? kids(pres, NS.draw, 'page') : [];

  const model = { format: 'odp', width: 28, height: 15.75, slides: [], images };
  const firstMaster = styles.masters.get(pages[0] && attr(pages[0], NS.draw, 'master-page-name')) ?? [...styles.masters.values()][0];
  const layout = firstMaster && styles.pageLayouts.get(attr(firstMaster, NS.style, 'page-layout-name'));
  const lp = layout && kid(layout, NS.style, 'page-layout-properties');
  if (lp) {
    model.width = toCm(attr(lp, NS.fo, 'page-width')) ?? model.width;
    model.height = toCm(attr(lp, NS.fo, 'page-height')) ?? model.height;
  }

  for (const [i, page] of pages.entries()) {
    const masterName = attr(page, NS.draw, 'master-page-name');
    const master = styles.masters.get(masterName);
    const pageStyle = styles.get('drawing-page', attr(page, NS.draw, 'style-name'));
    const pageProps = pageStyle && kid(pageStyle, NS.style, 'drawing-page-properties');
    const slide = {
      number: i + 1,
      hidden: attr(pageProps ?? page, NS.presentation, 'visibility') === 'hidden',
      animations: findAll(page, NS.anim, 'par').filter((n) => attr(n, NS.presentation, 'preset-class')).length,
      transition: !!(pageProps && ((attr(pageProps, NS.smil, 'type') ?? 'none') !== 'none' || (attr(pageProps, NS.presentation, 'transition-style') ?? 'none') !== 'none')) ||
        findAll(page, NS.anim, 'transitionFilter').length > 0,
      background: odpBackground(styles, pageProps, master),
      masterObjects: master ? kids(master, NS.draw, 'frame').filter((f) => !attr(f, NS.presentation, 'class')).length +
        kids(master, NS.draw, 'custom-shape').length : 0,
      shapes: [],
    };
    const ctx = { styles, zip, images, masterName, slide };
    for (const node of page.children) await odpShape(node, ctx);
    model.slides.push(slide);
  }
  return model;
}

function odpBackground(styles, pageProps, master) {
  const fromProps = (p) => {
    if (!p) return null;
    const fill = attr(p, NS.draw, 'fill');
    if (!fill) return null;
    if (fill === 'solid') return { kind: 'solid', color: attr(p, NS.draw, 'fill-color') ?? '#ffffff' };
    if (fill === 'none') return { kind: 'solid', color: '#ffffff' };
    if (fill === 'bitmap') return { kind: 'image', color: null };
    return { kind: fill === 'gradient' ? 'gradient' : 'pattern', color: attr(p, NS.draw, 'fill-color') };
  };
  const mStyle = master && styles.get('drawing-page', attr(master, NS.draw, 'style-name'));
  return fromProps(pageProps) ?? fromProps(mStyle && kid(mStyle, NS.style, 'drawing-page-properties')) ?? { kind: 'solid', color: '#ffffff' };
}

function odpGeometry(node) {
  let x = toCm(attr(node, NS.svg, 'x'));
  let y = toCm(attr(node, NS.svg, 'y'));
  const w = toCm(attr(node, NS.svg, 'width')) ?? 0;
  const h = toCm(attr(node, NS.svg, 'height')) ?? 0;
  const tr = attr(node, NS.draw, 'transform');
  let rotation = 0;
  if (tr) {
    const t = /translate\s*\(\s*([-\d.]+\w*)[\s,]+([-\d.]+\w*)\s*\)/.exec(tr);
    if (t) {
      x = toCm(t[1]);
      y = toCm(t[2]);
    }
    const r = /rotate\s*\(\s*([-\d.e]+)\s*\)/.exec(tr);
    if (r) rotation = Number(r[1]);
    // При повороте translate задаёт положение повёрнутого угла — берём описанный прямоугольник
    if (rotation) {
      const c = Math.cos(rotation);
      const s = Math.sin(rotation);
      const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([px, py]) => [x + px * c + py * s, y - px * s + py * c]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rotation };
    }
  }
  return { x: x ?? 0, y: y ?? 0, w, h, rotation };
}

const TEXT_SHAPES = new Set(['custom-shape', 'rect', 'ellipse', 'polygon', 'polyline', 'path', 'circle', 'regular-polygon', 'caption', 'measure', 'line', 'connector']);

async function odpShape(node, ctx) {
  if (typeof node === 'string' || node.ns !== NS.draw) return;
  const { styles, slide } = ctx;
  if (node.local === 'g') {
    for (const c of node.children) await odpShape(c, ctx);
    return;
  }
  if (node.local !== 'frame' && !TEXT_SHAPES.has(node.local)) return;

  const cls = attr(node, NS.presentation, 'class');
  if (attr(node, NS.presentation, 'placeholder') === 'true') return; // пустой заполнитель в показе не виден
  if (['header', 'footer', 'date-time', 'page-number', 'notes', 'page', 'handout'].includes(cls)) return;

  const geom = node.local === 'line' || node.local === 'connector'
    ? lineGeometry(node)
    : odpGeometry(node);
  const frameChain = attr(node, NS.presentation, 'style-name')
    ? styles.chain('presentation', attr(node, NS.presentation, 'style-name'))
    : styles.chain('graphic', attr(node, NS.draw, 'style-name'));
  const graphicDefault = [styles.defaults.get('graphic')];
  const gp = (local, ns = NS.draw) => OdfStyles.pick([frameChain, graphicDefault], 'graphic-properties', ns, local);

  const shape = {
    kind: 'other',
    role: cls === 'title' ? 'title' : cls === 'subtitle' ? 'subtitle' : cls === 'outline' || cls === 'text' ? 'body' : null,
    ...geom,
    text: '',
    paragraphs: [],
    fill: gp('fill') === 'solid' ? gp('fill-color') ?? '#729fcf' : null,
    shrink: gp('shrink-to-fit', NS.style) === 'true' || /shrink/.test(gp('fit-to-size') ?? ''),
    fontScale: null,
    image: null,
    tag: node.local,
  };
  const scale = gp('font-scale', NS.loext) ?? gp('font-scale', NS.draw);
  if (scale) shape.fontScale = Number.parseFloat(scale) / 100;
  else if (!shape.shrink) shape.fontScale = 1;

  const image = node.local === 'frame' && kid(node, NS.draw, 'image');
  const textBox = node.local === 'frame' ? kid(node, NS.draw, 'text-box') : node;
  if (image) {
    const href = (attr(image, NS.xlink, 'href') || '').replace(/^\.\//, '');
    const entry = href && ctx.zip.get(href);
    let px = null;
    if (entry) {
      const bytes = await entry.read();
      ctx.images.set(href, bytes);
      px = imageSize(bytes);
    }
    const clip = gp('clip', NS.fo);
    const crop = clip && /rect\(([^)]*)\)/.exec(clip) ? /rect\(([^)]*)\)/.exec(clip)[1].split(/[\s,]+/).filter(Boolean).map(toCm) : null;
    shape.kind = 'image';
    shape.image = { path: href, px, crop: crop && crop.some((v) => Math.abs(v) > 0.01) ? crop : null };
    slide.shapes.push(shape);
    return;
  }
  if (node.local === 'frame' && (kid(node, NS.draw, 'object') || kid(node, NS.draw, 'object-ole') || kid(node, NS.draw, 'plugin'))) {
    slide.shapes.push(shape);
    return;
  }
  if (textBox) {
    const frameParaChain = styles.chain('paragraph', attr(node, NS.draw, 'text-style-name'));
    shape.paragraphs = odpParagraphs(textBox, ctx, { frameChain, frameParaChain, graphicDefault, cls });
    shape.text = shape.paragraphs.map((p) => p.text).join('\n').trim();
  }
  if (shape.text) shape.kind = 'text';
  else if (node.local === 'frame' && !shape.fill) return; // пустая текстовая рамка не видна
  slide.shapes.push(shape);
}

function lineGeometry(node) {
  const xs = [attr(node, NS.svg, 'x1'), attr(node, NS.svg, 'x2')].map(toCm);
  const ys = [attr(node, NS.svg, 'y1'), attr(node, NS.svg, 'y2')].map(toCm);
  if (xs.some((v) => v === null) || ys.some((v) => v === null)) return odpGeometry(node);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[1] - xs[0]), h: Math.abs(ys[1] - ys[0]), rotation: 0 };
}

function odpParagraphs(box, ctx, c) {
  const { styles, masterName } = ctx;
  const out = [];
  const walk = (node, level) => {
    for (const ch of node.children) {
      if (typeof ch === 'string' || ch.ns !== NS.text) continue;
      if (ch.local === 'p' || ch.local === 'h') out.push(para(ch, level));
      else if (ch.local === 'list') walk(ch, level + 1);
      else if (ch.local === 'list-item' || ch.local === 'list-header') walk(ch, level);
    }
  };
  const para = (p, level) => {
    const pChain = styles.chain('paragraph', attr(p, NS.text, 'style-name'));
    const levelChain = c.cls === 'outline' && level > 1 ? styles.chain('presentation', `${masterName}-outline${level}`) : [];
    const runs = [];
    const collect = (node, spanChains) => {
      for (const ch of node.children) {
        if (typeof ch === 'string') {
          addRun(runs, ch, spanChains);
          continue;
        }
        if (ch.ns !== NS.text) continue;
        if (ch.local === 'span' || ch.local === 'a') collect(ch, [styles.chain('text', attr(ch, NS.text, 'style-name')), ...spanChains]);
        else if (ch.local === 's') addRun(runs, ' '.repeat(Math.min(Number(attr(ch, NS.text, 'c')) || 1, 1000)), spanChains);
        else if (ch.local === 'tab') addRun(runs, '\t', spanChains);
        else if (ch.local === 'line-break') addRun(runs, '\n', spanChains);
        else if (!['note', 'bookmark', 'bookmark-start', 'bookmark-end', 'soft-page-break'].includes(ch.local)) collect(ch, spanChains);
      }
    };
    collect(p, []);
    const chainsFor = (spanChains) => [...spanChains, pChain, c.frameParaChain, levelChain, c.frameChain, c.graphicDefault];
    const finalRuns = runs.map((r) => ({ text: r.text, ...odfTextProps(styles, chainsFor(r.chains), 18) }));
    return { text: finalRuns.map((r) => r.text).join(''), level, runs: finalRuns };
  };
  walk(box, 0);
  return out;
}

function addRun(runs, text, chains) {
  const last = runs[runs.length - 1];
  if (last && last.chains === chains) last.text += text;
  else runs.push({ text, chains });
}

// =====================================================================
// .pptx
// =====================================================================

const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const SKIP_PH = new Set(['dt', 'ftr', 'sldNum', 'hdr', 'sldImg']);

async function readPptx(zip) {
  const presPath = 'ppt/presentation.xml';
  const pres = parseXML(await zip.get(presPath).text());
  const presRels = await readRels(zip, presPath);
  const sz = find(pres, NS.p, 'sldSz');
  const model = {
    format: 'pptx',
    width: sz ? Number(attr(sz, null, 'cx')) / EMU_CM : 25.4,
    height: sz ? Number(attr(sz, null, 'cy')) / EMU_CM : 14.2875,
    slides: [],
    images: new Map(),
  };
  const defaultTextStyle = find(pres, NS.p, 'defaultTextStyle');
  const cache = new Map();
  const part = async (path) => {
    if (!cache.has(path)) cache.set(path, { doc: await readXmlPart(zip, path), rels: await readRels(zip, path) });
    return cache.get(path);
  };

  const ids = find(pres, NS.p, 'sldIdLst');
  const slidePaths = ids ? kids(ids, NS.p, 'sldId').map((n) => presRels.get(attr(n, NS.r, 'id'))?.target).filter(Boolean) : [];
  for (const [i, path] of slidePaths.entries()) {
    const sl = await part(path);
    if (!sl.doc) continue;
    const layoutPath = [...sl.rels.values()].find((r) => r.type === 'slideLayout')?.target;
    const lay = layoutPath ? await part(layoutPath) : { doc: null, rels: new Map() };
    const masterPath = [...lay.rels.values()].find((r) => r.type === 'slideMaster')?.target;
    const mas = masterPath ? await part(masterPath) : { doc: null, rels: new Map() };
    const themePath = [...mas.rels.values()].find((r) => r.type === 'theme')?.target;
    const theme = readTheme(themePath ? (await part(themePath)).doc : null);
    const clrMapNode = mas.doc && find(mas.doc, NS.p, 'clrMap');
    const clrMap = {};
    if (clrMapNode) for (const a of clrMapNode.attrs) clrMap[a.local] = a.value;

    const root = find(sl.doc, NS.p, 'sld');
    const timing = find(sl.doc, NS.p, 'timing');
    const ctx = {
      zip, model, rels: sl.rels, theme, clrMap, defaultTextStyle,
      layout: lay.doc, master: mas.doc,
      txStyles: mas.doc && find(mas.doc, NS.p, 'txStyles'),
    };
    const slide = {
      number: i + 1,
      hidden: attr(root, null, 'show') === '0' || attr(root, null, 'show') === 'false',
      animations: timing ? findAll(timing, NS.p, 'cTn').filter((n) => attr(n, null, 'presetClass')).length : 0,
      transition: findAll(sl.doc, NS.p, 'transition').some((t) => t.children.some((c) => typeof c !== 'string')),
      background: pptxBackground([sl.doc, lay.doc, mas.doc], ctx),
      masterObjects: countDecor(lay.doc) + countDecor(mas.doc),
      shapes: [],
    };
    const tree = find(sl.doc, NS.p, 'spTree');
    if (tree) await pptxTree(tree, ctx, slide, null);
    model.slides.push(slide);
  }
  return model;
}

function countDecor(doc) {
  const tree = doc && find(doc, NS.p, 'spTree');
  if (!tree) return 0;
  return kids(tree, NS.p, 'pic').length + kids(tree, NS.p, 'sp').filter((s) => !find(s, NS.p, 'ph')).length;
}

function pptxBackground(docs, ctx) {
  for (const doc of docs) {
    const bg = doc && find(doc, NS.p, 'bg');
    if (!bg) continue;
    const pr = kid(bg, NS.p, 'bgPr');
    if (pr) {
      const f = fillOf(pr, ctx);
      if (f) return f;
    }
    const ref = kid(bg, NS.p, 'bgRef');
    if (ref) {
      const color = colorOf(ref, ctx);
      const idx = Number(attr(ref, null, 'idx'));
      return idx === 1001 && color ? { kind: 'solid', color } : { kind: 'gradient', color };
    }
  }
  return { kind: 'solid', color: ctx.theme.colors[ctx.clrMap.bg1 || 'lt1'] || '#ffffff' };
}

function fillOf(node, ctx) {
  for (const c of node.children) {
    if (typeof c === 'string' || c.ns !== NS.a) continue;
    if (c.local === 'solidFill') return { kind: 'solid', color: colorOf(c, ctx) };
    if (c.local === 'noFill') return { kind: 'none', color: null };
    if (c.local === 'gradFill') return { kind: 'gradient', color: null };
    if (c.local === 'blipFill') return { kind: 'image', color: null };
    if (c.local === 'pattFill') return { kind: 'pattern', color: null };
  }
  return null;
}

const PRESET_COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080' };

// Цвет из <a:solidFill> и подобных: srgbClr, schemeClr (через тему), sysClr, prstClr
function colorOf(node, ctx) {
  const c = node.children.find((x) => typeof x !== 'string' && x.ns === NS.a && /Clr$/.test(x.local));
  if (!c) return null;
  let hex = null;
  if (c.local === 'srgbClr') hex = '#' + attr(c, null, 'val');
  else if (c.local === 'sysClr') hex = '#' + (attr(c, null, 'lastClr') || '000000');
  else if (c.local === 'prstClr') hex = PRESET_COLORS[attr(c, null, 'val')] ?? null;
  else if (c.local === 'schemeClr') {
    const v = attr(c, null, 'val');
    const mapped = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v] ? ctx.clrMap[v] || { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v] : v;
    hex = ctx.theme.colors[mapped] ?? null;
  }
  if (!hex) return null;
  const mod = (name) => {
    const n = kid(c, NS.a, name);
    return n ? Number(attr(n, null, 'val')) / 100000 : null;
  };
  const lumMod = mod('lumMod');
  const lumOff = mod('lumOff');
  const tint = mod('tint');
  const shade = mod('shade');
  if (lumMod !== null || lumOff !== null || tint !== null || shade !== null) {
    let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    if (shade !== null) [r, g, b] = [r, g, b].map((v) => v * shade);
    if (tint !== null) [r, g, b] = [r, g, b].map((v) => v + (1 - v) * (1 - tint));
    if (lumMod !== null || lumOff !== null) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let l = (max + min) / 2;
      const d = max - min;
      const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
      }
      l = Math.min(1, Math.max(0, l * (lumMod ?? 1) + (lumOff ?? 0)));
      const C = (1 - Math.abs(2 * l - 1)) * s;
      const X = C * (1 - Math.abs((h % 2) - 1));
      const m = l - C / 2;
      const hh = ((h % 6) + 6) % 6;
      [r, g, b] = hh < 1 ? [C, X, 0] : hh < 2 ? [X, C, 0] : hh < 3 ? [0, C, X] : hh < 4 ? [0, X, C] : hh < 5 ? [X, 0, C] : [C, 0, X];
      [r, g, b] = [r + m, g + m, b + m];
    }
    hex = '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  }
  return hex.toLowerCase();
}

// Заменяем mc:AlternateContent на запасной вариант (его понимают все программы)
function realChildren(node) {
  const out = [];
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.ns === NS.mc && c.local === 'AlternateContent') {
      const alt = kid(c, NS.mc, 'Fallback') ?? kid(c, NS.mc, 'Choice');
      if (alt) out.push(...realChildren(alt));
    } else out.push(c);
  }
  return out;
}

function xfrmOf(spPr) {
  const x = spPr && kid(spPr, NS.a, 'xfrm');
  if (!x) return null;
  const off = kid(x, NS.a, 'off');
  const ext = kid(x, NS.a, 'ext');
  if (!off || !ext) return null;
  return {
    x: Number(attr(off, null, 'x')),
    y: Number(attr(off, null, 'y')),
    w: Number(attr(ext, null, 'cx')),
    h: Number(attr(ext, null, 'cy')),
    rot: Number(attr(x, null, 'rot') || 0) / 60000,
    x_: x,
  };
}

// Заполнитель с тем же индексом или типом в макете и в мастер-слайде
function findPlaceholder(doc, type, idx) {
  const tree = doc && find(doc, NS.p, 'spTree');
  if (!tree) return null;
  const all = [...findAll(tree, NS.p, 'sp'), ...findAll(tree, NS.p, 'pic')];
  const phOf = (s) => find(s, NS.p, 'ph');
  const t = (ph) => attr(ph, null, 'type') || 'body';
  if (idx !== null) {
    const byIdx = all.find((s) => phOf(s) && attr(phOf(s), null, 'idx') === idx);
    if (byIdx) return byIdx;
  }
  const want = type === 'ctrTitle' ? ['ctrTitle', 'title'] : type === 'subTitle' ? ['subTitle', 'body'] : [type];
  for (const w of want) {
    const s = all.find((x) => phOf(x) && t(phOf(x)) === w);
    if (s) return s;
  }
  return null;
}

async function pptxTree(tree, ctx, slide, group) {
  for (const node of realChildren(tree)) {
    if (node.ns !== NS.p) continue;
    if (node.local === 'grpSp') {
      const gx = xfrmOf(kid(node, NS.p, 'grpSpPr'));
      let tr = group;
      if (gx) {
        const chOff = kid(gx.x_, NS.a, 'chOff');
        const chExt = kid(gx.x_, NS.a, 'chExt');
        const cx = chOff ? Number(attr(chOff, null, 'x')) : gx.x;
        const cy = chOff ? Number(attr(chOff, null, 'y')) : gx.y;
        const sx = chExt && Number(attr(chExt, null, 'cx')) ? gx.w / Number(attr(chExt, null, 'cx')) : 1;
        const sy = chExt && Number(attr(chExt, null, 'cy')) ? gx.h / Number(attr(chExt, null, 'cy')) : 1;
        const inner = { ox: gx.x, oy: gx.y, cx, cy, sx, sy };
        tr = group ? { chain: [inner, ...(group.chain ?? [group])] } : inner;
      }
      await pptxTree(node, ctx, slide, tr);
    } else if (['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(node.local)) {
      const shape = await pptxShape(node, ctx);
      if (!shape) continue;
      if (group) applyGroup(shape, group);
      slide.shapes.push(shape);
    }
  }
}

function applyGroup(shape, group) {
  const chain = group.chain ?? [group];
  for (const g of chain) {
    shape.x = (g.ox + (shape.x * EMU_CM - g.cx) * g.sx) / EMU_CM;
    shape.y = (g.oy + (shape.y * EMU_CM - g.cy) * g.sy) / EMU_CM;
    shape.w *= g.sx;
    shape.h *= g.sy;
  }
}

async function pptxShape(node, ctx) {
  const nv = realChildren(node).find((c) => /^nv/.test(c.local));
  const ph = nv && find(nv, NS.p, 'ph');
  const phType = ph ? attr(ph, null, 'type') || 'obj' : null;
  const phIdx = ph ? attr(ph, null, 'idx') : null;
  if (ph && SKIP_PH.has(phType)) return null;

  const spPr = kid(node, NS.p, 'spPr') ?? kid(node, NS.p, 'xfrm');
  let xf = node.local === 'graphicFrame' ? xfrmFrame(node) : xfrmOf(spPr);
  const layoutPh = ph ? findPlaceholder(ctx.layout, phType, phIdx) : null;
  const masterPh = ph ? findPlaceholder(ctx.master, layoutPh ? attr(find(layoutPh, NS.p, 'ph'), null, 'type') || phType : phType, null) : null;
  if (!xf) xf = xfrmOf(layoutPh && kid(layoutPh, NS.p, 'spPr')) ?? xfrmOf(masterPh && kid(masterPh, NS.p, 'spPr'));
  if (!xf) xf = { x: 0, y: 0, w: 0, h: 0, rot: 0 };

  const shape = {
    kind: 'other',
    role: phType === null ? null : TITLE_TYPES.has(phType) ? 'title' : phType === 'subTitle' ? 'subtitle' : ['body', 'obj'].includes(phType) ? 'body' : null,
    x: xf.x / EMU_CM,
    y: xf.y / EMU_CM,
    w: xf.w / EMU_CM,
    h: xf.h / EMU_CM,
    rotation: xf.rot,
    text: '',
    paragraphs: [],
    fill: null,
    shrink: false,
    fontScale: 1,
    image: null,
    tag: node.local,
  };
  if (Math.abs(xf.rot % 180) > 45 && Math.abs(xf.rot % 180) < 135) {
    const cx = shape.x + shape.w / 2;
    const cy = shape.y + shape.h / 2;
    [shape.w, shape.h] = [shape.h, shape.w];
    shape.x = cx - shape.w / 2;
    shape.y = cy - shape.h / 2;
  }

  if (node.local === 'pic') {
    const blip = find(node, NS.a, 'blip');
    const rel = blip && ctx.rels.get(attr(blip, NS.r, 'embed'));
    let px = null;
    if (rel && !rel.external && ctx.zip.get(rel.target)) {
      const bytes = await ctx.zip.get(rel.target).read();
      ctx.model.images.set(rel.target, bytes);
      px = imageSize(bytes);
    }
    const src = find(node, NS.a, 'srcRect');
    const crop = src ? ['l', 't', 'r', 'b'].map((k) => Number(attr(src, null, k) || 0) / 100000) : null;
    shape.kind = 'image';
    shape.image = { path: rel?.target ?? '', px, crop: crop && crop.some((v) => Math.abs(v) > 0.001) ? crop : null, cropFractions: true };
    return shape;
  }
  if (node.local !== 'sp') return shape; // таблица, диаграмма, соединительная линия

  const fill = spPr && fillOf(spPr, ctx);
  if (fill?.kind === 'solid') shape.fill = fill.color;
  else if (!fill) {
    const style = kid(node, NS.p, 'style');
    const fillRef = style && kid(style, NS.a, 'fillRef');
    if (fillRef && Number(attr(fillRef, null, 'idx')) > 0) shape.fill = colorOf(fillRef, ctx);
  }

  const body = kid(node, NS.p, 'txBody');
  if (!body) return shape.fill ? shape : null;
  const bodyPr = kid(body, NS.a, 'bodyPr');
  const auto = bodyPr && kid(bodyPr, NS.a, 'normAutofit');
  if (auto) {
    shape.shrink = true;
    shape.fontScale = attr(auto, null, 'fontScale') ? Number(attr(auto, null, 'fontScale')) / 100000 : 1;
  }

  // Откуда брать свойства текста, по старшинству
  const lists = [kid(body, NS.a, 'lstStyle')];
  for (const phNode of [layoutPh, masterPh]) {
    const tb = phNode && kid(phNode, NS.p, 'txBody');
    if (tb) lists.push(kid(tb, NS.a, 'lstStyle'));
  }
  const tx = ctx.txStyles;
  if (ph) lists.push(tx && kid(tx, NS.p, TITLE_TYPES.has(phType) ? 'titleStyle' : 'bodyStyle'));
  else lists.push(ctx.defaultTextStyle, tx && kid(tx, NS.p, 'otherStyle'));
  const fontRef = kid(node, NS.p, 'style') && kid(kid(node, NS.p, 'style'), NS.a, 'fontRef');

  for (const p of kids(body, NS.a, 'p')) {
    const pPr = kid(p, NS.a, 'pPr');
    const level = Number(pPr && attr(pPr, null, 'lvl') || 0);
    const defs = lists.filter(Boolean).map((l) => kid(l, NS.a, `lvl${level + 1}pPr`)).filter(Boolean).map((n) => kid(n, NS.a, 'defRPr')).filter(Boolean);
    const runs = [];
    for (const r of p.children) {
      if (typeof r === 'string' || r.ns !== NS.a) continue;
      if (r.local === 'r' || r.local === 'fld') {
        const t = kid(r, NS.a, 't');
        runs.push({ text: t ? t.children.filter((x) => typeof x === 'string').join('') : '', ...pptxRunProps([kid(r, NS.a, 'rPr'), ...defs], ctx, fontRef, phType) });
      } else if (r.local === 'br') {
        runs.push({ text: '\n', ...pptxRunProps([kid(r, NS.a, 'rPr'), ...defs], ctx, fontRef, phType) });
      }
    }
    shape.paragraphs.push({ text: runs.map((r) => r.text).join(''), level: level + 1, runs });
  }
  shape.text = shape.paragraphs.map((p) => p.text).join('\n').trim();
  if (shape.text) shape.kind = 'text';
  else if (!shape.fill) return null;
  return shape;
}

function xfrmFrame(node) {
  const x = kid(node, NS.p, 'xfrm');
  if (!x) return null;
  const off = kid(x, NS.a, 'off');
  const ext = kid(x, NS.a, 'ext');
  return off && ext ? { x: Number(attr(off, null, 'x')), y: Number(attr(off, null, 'y')), w: Number(attr(ext, null, 'cx')), h: Number(attr(ext, null, 'cy')), rot: 0 } : null;
}

function pptxRunProps(nodes, ctx, fontRef, phType) {
  const pick = (fn) => {
    for (const n of nodes) {
      if (!n) continue;
      const v = fn(n);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };
  const sz = pick((n) => attr(n, null, 'sz'));
  const face = pick((n) => {
    const l = kid(n, NS.a, 'latin') ?? kid(n, NS.a, 'cs');
    return l ? attr(l, null, 'typeface') : null;
  });
  const theme = ctx.theme;
  const resolveFace = (f) => {
    if (!f) return null;
    if (/^\+mj/.test(f)) return theme.major;
    if (/^\+mn/.test(f)) return theme.minor;
    return cleanFontName(f);
  };
  let font = resolveFace(face);
  if (!font && fontRef) font = attr(fontRef, null, 'idx') === 'major' ? theme.major : theme.minor;
  if (!font) font = TITLE_TYPES.has(phType) ? theme.major : theme.minor;
  const color = pick((n) => {
    const f = kid(n, NS.a, 'solidFill');
    return f ? colorOf(f, ctx) : null;
  }) ?? (fontRef ? colorOf(fontRef, ctx) : null);
  const u = pick((n) => attr(n, null, 'u'));
  return {
    size: sz ? Number(sz) / 100 : 18,
    font,
    bold: pick((n) => attr(n, null, 'b')) === '1' || pick((n) => attr(n, null, 'b')) === 'true',
    italic: pick((n) => attr(n, null, 'i')) === '1' || pick((n) => attr(n, null, 'i')) === 'true',
    underline: !!u && u !== 'none',
    caps: pick((n) => attr(n, null, 'cap')) === 'all',
    color: color ?? ctx.theme.colors[ctx.clrMap.tx1 || 'dk1'] ?? '#000000',
  };
}

