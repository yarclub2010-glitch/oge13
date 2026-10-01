// Чтение текстового документа (.odt из LibreOffice Writer или .docx) в простую модель.
//
// {
//   format: 'odt' | 'docx',
//   textWidth,                          — ширина области текста (страница без полей), см
//   body: [абзац | таблица | { type: 'other', what }],
// }
// Абзац: { type: 'p', text, runs: [{ text, size, font, bold, italic, underline, caps }],
//          align: 'left' | 'center' | 'right' | 'justify', indent (первая строка, см),
//          left, right (отступы абзаца, см), before, after (интервалы, пт),
//          line: { rule: 'prop' | 'exact' | 'atLeast', value } — доля одинарного или пункты,
//          breaks (разрывы строк внутри абзаца), heading (абзац-заголовок в стиле «Заголовок»),
//          context (интервал не добавляется между абзацами одного стиля) }
// Таблица: { type: 'table', width (см или null), align: 'left' | 'center' | 'right' | 'margins',
//            marginLeft, marginRight, before, after (пт), cols: [ширины, см],
//            rows: [[{ paras: [абзац], span, text }]] }

import { readZip } from './zip.js';
import { NS, parseXML, attr, kid, kids, find, findAll } from './xml.js';
import { OfficeError, OdfStyles, odfTextProps, toCm, toPt, round, TWIP_CM, readRels, readXmlPart, readTheme, onOff, cleanFontName } from './office.js';

export async function readDocument(bytes, fileName = '') {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new OfficeError('Это файл старого формата .doc. Сохраните документ в формате .odt (Файл → Сохранить как → Текстовый документ ODF) и загрузите ещё раз.');
  }
  let zip;
  try {
    zip = readZip(bytes);
  } catch {
    if (/\.rtf$/i.test(fileName) || (bytes[0] === 0x7b && bytes[1] === 0x5c)) {
      throw new OfficeError('Это файл .rtf. Сохраните документ в формате .odt и загрузите ещё раз.');
    }
    throw new OfficeError(`Файл «${fileName}» не похож на текстовый документ. Нужен файл .odt из LibreOffice Writer.`);
  }
  if (zip.has('content.xml')) {
    const mime = zip.has('mimetype') ? (await zip.get('mimetype').text()).trim() : '';
    if (mime && !mime.includes('opendocument.text')) {
      const what = mime.includes('presentation') ? 'презентация (.odp)' : mime.includes('spreadsheet') ? 'электронная таблица (.ods)' : 'не текстовый документ';
      throw new OfficeError(`Это ${what}, а для задания 13.2 нужен текстовый документ .odt из LibreOffice Writer.`);
    }
    return readOdt(zip);
  }
  if (zip.has('word/document.xml')) return readDocx(zip);
  if (zip.has('ppt/presentation.xml')) throw new OfficeError('Это презентация PowerPoint, а для задания 13.2 нужен текстовый документ .odt.');
  throw new OfficeError(`Файл «${fileName}» не похож на текстовый документ. Нужен файл .odt из LibreOffice Writer.`);
}

const ALIGN = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify', both: 'justify', distribute: 'justify' };

// =====================================================================
// .odt
// =====================================================================

async function readOdt(zip) {
  const content = parseXML(await zip.get('content.xml').text());
  const stylesDoc = zip.has('styles.xml') ? parseXML(await zip.get('styles.xml').text()) : null;
  const styles = new OdfStyles(stylesDoc, content);
  const text = find(content, NS.office, 'text');
  const model = { format: 'odt', textWidth: 17, body: [] };

  // Ширина области текста — по стилю первой страницы (обычно «Обычный» / Standard)
  let master = styles.masters.get('Standard') ?? [...styles.masters.values()][0];
  const firstP = text && text.children.find((c) => typeof c !== 'string' && (c.local === 'p' || c.local === 'h'));
  if (firstP) {
    const ps = styles.chain('paragraph', attr(firstP, NS.text, 'style-name'));
    const mp = ps.map((s) => attr(s, NS.style, 'master-page-name')).find(Boolean);
    if (mp && styles.masters.get(mp)) master = styles.masters.get(mp);
  }
  const layout = master && styles.pageLayouts.get(attr(master, NS.style, 'page-layout-name'));
  const lp = layout && kid(layout, NS.style, 'page-layout-properties');
  if (lp) {
    const w = toCm(attr(lp, NS.fo, 'page-width')) ?? 21;
    model.textWidth = round(w - (toCm(attr(lp, NS.fo, 'margin-left')) ?? 2) - (toCm(attr(lp, NS.fo, 'margin-right')) ?? 1.5), 3);
  }

  if (text) odtBlocks(text, styles, model.body);
  return model;
}

function odtBlocks(node, styles, out) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.ns === NS.text && (c.local === 'p' || c.local === 'h')) out.push(odtPara(c, styles));
    else if (c.ns === NS.text && (c.local === 'list' || c.local === 'list-item' || c.local === 'list-header' || c.local === 'section')) {
      const start = out.length;
      odtBlocks(c, styles, out);
      if (c.local === 'list') for (let i = start; i < out.length; i++) if (out[i].type === 'p') out[i].list = true;
    } else if (c.ns === NS.table && c.local === 'table') out.push(odtTable(c, styles));
    else if (c.ns === NS.text && ['sequence-decls', 'variable-decls', 'user-field-decls', 'tracked-changes', 'soft-page-break', 'bookmark'].includes(c.local)) continue;
    else if (c.ns === NS.office && c.local === 'forms') continue;
    else if (c.ns === NS.draw) out.push({ type: 'other', what: 'рисунок или надпись' });
  }
}

function odtPara(p, styles) {
  const chain = styles.chain('paragraph', attr(p, NS.text, 'style-name'));
  const chains = [chain, [styles.defaults.get('paragraph')]];
  const pp = (local, ns = NS.fo) => OdfStyles.pick(chains, 'paragraph-properties', ns, local);
  const runs = [];
  let breaks = 0;
  let pageBreak = false;
  let objects = 0;
  const collect = (node, spanChains) => {
    for (const ch of node.children) {
      if (typeof ch === 'string') {
        addRun(runs, ch, spanChains);
        continue;
      }
      if (ch.ns === NS.draw) {
        objects++;
        continue;
      }
      if (ch.ns !== NS.text) continue;
      if (ch.local === 'span' || ch.local === 'a') collect(ch, [styles.chain('text', attr(ch, NS.text, 'style-name')), ...spanChains]);
      else if (ch.local === 's') addRun(runs, ' '.repeat(Math.min(Number(attr(ch, NS.text, 'c')) || 1, 1000)), spanChains);
      else if (ch.local === 'tab') addRun(runs, '\t', spanChains);
      else if (ch.local === 'line-break') {
        breaks++;
        addRun(runs, '\n', spanChains);
      } else if (['note', 'bookmark', 'bookmark-start', 'bookmark-end', 'soft-page-break', 'reference-mark', 'change', 'change-start', 'change-end', 'annotation', 'annotation-end'].includes(ch.local)) continue;
      else collect(ch, spanChains);
    }
  };
  collect(p, []);
  const finalRuns = runs.map((r) => ({ text: r.text, ...odfTextProps(styles, [...r.chains, ...chains], 12) }));
  const lh = pp('line-height');
  const least = pp('line-height-at-least', NS.style);
  const spacing = pp('line-spacing', NS.style);
  let line = { rule: 'prop', value: 1 };
  if (lh && lh.endsWith('%')) line = { rule: 'prop', value: Number.parseFloat(lh) / 100 };
  else if (lh && lh !== 'normal') line = { rule: 'exact', value: toPt(lh) };
  else if (least) line = { rule: 'atLeast', value: toPt(least) };
  else if (spacing) line = { rule: 'leading', value: toPt(spacing) };
  const breakBefore = pp('break-before');
  if (breakBefore === 'page') pageBreak = true;
  return {
    type: 'p',
    text: finalRuns.map((r) => r.text).join(''),
    runs: finalRuns,
    align: ALIGN[pp('text-align') ?? 'start'] ?? 'left',
    lastLineAlign: pp('text-align-last'),
    indent: toCm(pp('text-indent')) ?? 0,
    left: toCm(pp('margin-left')) ?? 0,
    right: toCm(pp('margin-right')) ?? 0,
    before: toPt(pp('margin-top')) ?? 0,
    after: toPt(pp('margin-bottom')) ?? 0,
    context: pp('contextual-spacing', NS.style) === 'true',
    styleName: chain[0] ? attr(chain[chain.length - 1], NS.style, 'name') : null,
    line,
    breaks,
    pageBreak,
    objects,
    heading: p.local === 'h' || chain.some((s) => /^Heading/.test(attr(s, NS.style, 'name') || '')),
  };
}

function addRun(runs, text, chains) {
  const last = runs[runs.length - 1];
  if (last && last.chains === chains) last.text += text;
  else runs.push({ text, chains });
}

function odtTable(t, styles) {
  const st = styles.get('table', attr(t, NS.table, 'style-name'));
  const tp = st && kid(st, NS.style, 'table-properties');
  const get = (ns, local) => (tp ? attr(tp, ns, local) : null);
  const table = {
    type: 'table',
    width: toCm(get(NS.style, 'width')),
    relWidth: get(NS.style, 'rel-width'),
    align: get(NS.table, 'align') ?? 'margins',
    marginLeft: toCm(get(NS.fo, 'margin-left')) ?? 0,
    marginRight: toCm(get(NS.fo, 'margin-right')) ?? 0,
    before: toPt(get(NS.fo, 'margin-top')) ?? 0,
    after: toPt(get(NS.fo, 'margin-bottom')) ?? 0,
    cols: [],
    rows: [],
  };
  for (const col of findAll(t, NS.table, 'table-column')) {
    const cs = styles.get('table-column', attr(col, NS.table, 'style-name'));
    const w = cs && toCm(attr(kid(cs, NS.style, 'table-column-properties') ?? cs, NS.style, 'column-width'));
    const rep = Math.min(Number(attr(col, NS.table, 'number-columns-repeated') || 1), 64);
    for (let k = 0; k < rep; k++) table.cols.push(w ?? null);
  }
  const rows = [];
  const walk = (node) => {
    for (const c of node.children) {
      if (typeof c === 'string' || c.ns !== NS.table) continue;
      if (c.local === 'table-row') rows.push(c);
      else if (/^table-(header-rows|rows|row-group)$/.test(c.local)) walk(c);
    }
  };
  walk(t);
  for (const r of rows) {
    const cells = [];
    for (const c of r.children) {
      if (typeof c === 'string' || c.ns !== NS.table) continue;
      if (c.local === 'covered-table-cell') continue;
      if (c.local !== 'table-cell') continue;
      const paras = [];
      odtBlocks(c, styles, paras);
      const ps = paras.filter((x) => x.type === 'p');
      cells.push({
        paras: ps,
        span: Number(attr(c, NS.table, 'number-columns-spanned') || 1),
        rowSpan: Number(attr(c, NS.table, 'number-rows-spanned') || 1),
        nested: paras.some((x) => x.type === 'table'),
        text: ps.map((x) => x.text).join('\n'),
      });
    }
    table.rows.push(cells);
  }
  if (table.width === null && table.cols.length && table.cols.every((w) => w !== null)) table.width = table.cols.reduce((a, b) => a + b, 0);
  return table;
}

// =====================================================================
// .docx
// =====================================================================

async function readDocx(zip) {
  const docPath = 'word/document.xml';
  const doc = parseXML(await zip.get(docPath).text());
  const rels = await readRels(zip, docPath);
  const stylesPath = [...rels.values()].find((r) => r.type === 'styles')?.target ?? 'word/styles.xml';
  const themePath = [...rels.values()].find((r) => r.type === 'theme')?.target;
  const stylesDoc = await readXmlPart(zip, stylesPath);
  const theme = readTheme(themePath ? await readXmlPart(zip, themePath) : null);
  const st = new DocxStyles(stylesDoc, theme);
  const body = find(doc, NS.w, 'body');
  const model = { format: 'docx', textWidth: 16.5, body: [] };
  const sect = body && [...findAll(body, NS.w, 'sectPr')].pop();
  if (sect) {
    const pg = kid(sect, NS.w, 'pgSz');
    const mar = kid(sect, NS.w, 'pgMar');
    const tw = (n, a, def) => (n && attr(n, NS.w, a) !== null ? Number(attr(n, NS.w, a)) : def);
    model.textWidth = round((tw(pg, 'w', 11906) - tw(mar, 'left', 1701) - tw(mar, 'right', 850)) / TWIP_CM, 3);
  }
  if (body) docxBlocks(body, st, model.body, null);
  return model;
}

class DocxStyles {
  constructor(doc, theme) {
    this.theme = theme;
    this.byId = new Map();
    this.defaultPara = null;
    this.defaultTable = null;
    this.docRPr = null;
    this.docPPr = null;
    if (!doc) return;
    const defs = find(doc, NS.w, 'docDefaults');
    if (defs) {
      this.docRPr = find(defs, NS.w, 'rPr');
      this.docPPr = find(defs, NS.w, 'pPr');
    }
    for (const s of findAll(doc, NS.w, 'style')) {
      const id = attr(s, NS.w, 'styleId');
      this.byId.set(id, s);
      if (/^(1|true|on)$/.test(attr(s, NS.w, 'default') ?? '')) {
        const type = attr(s, NS.w, 'type');
        if (type === 'paragraph') this.defaultPara = id;
        if (type === 'table') this.defaultTable = id;
      }
    }
  }

  chain(id) {
    const out = [];
    const seen = new Set();
    let s = id ? this.byId.get(id) : null;
    while (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      const b = kid(s, NS.w, 'basedOn');
      s = b ? this.byId.get(attr(b, NS.w, 'val')) : null;
    }
    return out;
  }
}

function docxBlocks(node, st, out, tableStyle) {
  for (const c of node.children) {
    if (typeof c === 'string' || c.ns !== NS.w) {
      if (typeof c !== 'string' && c.ns === NS.mc && c.local === 'AlternateContent') out.push({ type: 'other', what: 'рисунок или надпись' });
      continue;
    }
    if (c.local === 'p') out.push(docxPara(c, st, tableStyle));
    else if (c.local === 'tbl') out.push(docxTable(c, st));
    else if (c.local === 'sdt') {
      const content = kid(c, NS.w, 'sdtContent');
      if (content) docxBlocks(content, st, out, tableStyle);
    }
  }
}

function docxPara(p, st, tableStyle) {
  const pPr = kid(p, NS.w, 'pPr');
  const pStyleNode = pPr && kid(pPr, NS.w, 'pStyle');
  const pStyleId = pStyleNode ? attr(pStyleNode, NS.w, 'val') : st.defaultPara;
  const pChain = st.chain(pStyleId);
  const tChain = tableStyle ? st.chain(tableStyle) : [];
  // Свойства абзаца: сам абзац → стиль абзаца → стиль таблицы → умолчания документа
  const pPrs = [pPr, ...pChain.map((s) => kid(s, NS.w, 'pPr')), ...tChain.map((s) => kid(s, NS.w, 'pPr')), st.docPPr].filter(Boolean);
  const pget = (local, a) => {
    for (const n of pPrs) {
      const k = kid(n, NS.w, local);
      if (k && attr(k, NS.w, a) !== null) return attr(k, NS.w, a);
    }
    return null;
  };
  const pflag = (local) => {
    for (const n of pPrs) {
      const k = kid(n, NS.w, local);
      if (k) return onOff(k, NS.w);
    }
    return false;
  };
  const styleRPrs = [...pChain.map((s) => kid(s, NS.w, 'rPr')), ...tChain.map((s) => kid(s, NS.w, 'rPr')), st.docRPr].filter(Boolean);

  const runs = [];
  let breaks = 0;
  let pageBreak = false;
  let objects = 0;
  const addText = (text, props) => {
    const last = runs[runs.length - 1];
    if (last && sameProps(last, props)) last.text += text;
    else runs.push({ text, ...props });
  };
  const walk = (node) => {
    for (const c of node.children) {
      if (typeof c === 'string' || c.ns !== NS.w) {
        if (typeof c !== 'string' && c.ns === NS.mc) objects++;
        continue;
      }
      if (c.local === 'r') {
        const rPr = kid(c, NS.w, 'rPr');
        const rs = rPr && kid(rPr, NS.w, 'rStyle');
        const cChain = rs ? st.chain(attr(rs, NS.w, 'val')).map((s) => kid(s, NS.w, 'rPr')) : [];
        const props = docxRunProps([rPr, ...cChain, ...styleRPrs].filter(Boolean), st);
        for (const t of c.children) {
          if (typeof t === 'string' || t.ns !== NS.w) continue;
          if (t.local === 't') addText(t.children.filter((x) => typeof x === 'string').join(''), props);
          else if (t.local === 'tab') addText('\t', props);
          else if (t.local === 'br' || t.local === 'cr') {
            if (attr(t, NS.w, 'type') === 'page') pageBreak = true;
            else {
              breaks++;
              addText('\n', props);
            }
          } else if (t.local === 'drawing' || t.local === 'pict' || t.local === 'object') objects++;
          else if (t.local === 'noBreakHyphen') addText('-', props);
        }
      } else if (['hyperlink', 'ins', 'smartTag', 'fldSimple', 'customXml', 'sdt', 'sdtContent'].includes(c.local)) walk(c);
    }
  };
  walk(p);

  const ind = (a) => {
    const v = pget('ind', a);
    return v === null ? null : Number(v) / TWIP_CM;
  };
  const firstLine = ind('firstLine');
  const hanging = ind('hanging');
  const lineVal = pget('spacing', 'line');
  const lineRule = pget('spacing', 'lineRule') ?? 'auto';
  let line = { rule: 'prop', value: 1 };
  if (lineVal !== null) {
    if (lineRule === 'auto') line = { rule: 'prop', value: Number(lineVal) / 240 };
    else line = { rule: lineRule === 'exact' ? 'exact' : 'atLeast', value: Number(lineVal) / 20 };
  }
  const before = pflag('beforeAutospacing') ? 14 : Number(pget('spacing', 'before') ?? 0) / 20;
  const after = pflag('afterAutospacing') ? 14 : Number(pget('spacing', 'after') ?? 0) / 20;
  const jc = pget('jc', 'val');
  if (pflag('pageBreakBefore')) pageBreak = true;
  const styleName = pChain[0] ? attr(kid(pChain[0], NS.w, 'name') ?? pChain[0], NS.w, 'val') : null;
  return {
    type: 'p',
    text: runs.map((r) => r.text).join(''),
    runs,
    align: ALIGN[jc ?? 'left'] ?? 'left',
    indent: firstLine ?? (hanging !== null ? -hanging : 0),
    left: ind('left') ?? ind('start') ?? 0,
    right: ind('right') ?? ind('end') ?? 0,
    before,
    after,
    context: pflag('contextualSpacing'),
    styleName,
    line,
    breaks,
    pageBreak,
    objects,
    heading: pChain.some((s) => kid(kid(s, NS.w, 'pPr') ?? s, NS.w, 'outlineLvl')) || /^heading/i.test(styleName || ''),
  };
}

function sameProps(a, b) {
  return a.size === b.size && a.font === b.font && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.caps === b.caps;
}

function docxRunProps(rPrs, st) {
  const flag = (local) => {
    for (const n of rPrs) {
      const k = kid(n, NS.w, local);
      if (k) return onOff(k, NS.w);
    }
    return false;
  };
  const val = (local, a = 'val') => {
    for (const n of rPrs) {
      const k = kid(n, NS.w, local);
      if (k && attr(k, NS.w, a) !== null) return attr(k, NS.w, a);
    }
    return null;
  };
  const sz = val('sz');
  let font = val('rFonts', 'ascii') ?? val('rFonts', 'hAnsi');
  if (!font) {
    const th = val('rFonts', 'asciiTheme') ?? val('rFonts', 'hAnsiTheme');
    if (th) font = /major/.test(th) ? st.theme.major : st.theme.minor;
  }
  const u = val('u');
  return {
    size: sz ? Number(sz) / 2 : 10,
    font: font ? cleanFontName(font) : null,
    bold: flag('b'),
    italic: flag('i'),
    underline: !!u && u !== 'none',
    caps: flag('caps') || flag('smallCaps'),
  };
}

function docxTable(tbl, st) {
  const tblPr = kid(tbl, NS.w, 'tblPr');
  const styleNode = tblPr && kid(tblPr, NS.w, 'tblStyle');
  const styleId = styleNode ? attr(styleNode, NS.w, 'val') : st.defaultTable;
  const tPrs = [tblPr, ...st.chain(styleId).map((s) => kid(s, NS.w, 'tblPr'))].filter(Boolean);
  const tget = (local, a) => {
    for (const n of tPrs) {
      const k = kid(n, NS.w, local);
      if (k && attr(k, NS.w, a) !== null) return attr(k, NS.w, a);
    }
    return null;
  };
  const grid = kid(tbl, NS.w, 'tblGrid');
  const cols = grid ? kids(grid, NS.w, 'gridCol').map((g) => Number(attr(g, NS.w, 'w') || 0) / TWIP_CM) : [];
  const wType = tget('tblW', 'type');
  const wVal = tget('tblW', 'w');
  let width = null;
  if (wType === 'dxa' && wVal) width = Number(wVal) / TWIP_CM;
  else if (wType === 'pct' && wVal) width = { pct: String(wVal).endsWith('%') ? Number.parseFloat(wVal) : Number(wVal) / 50 };
  if ((width === null || (typeof width === 'number' && width === 0)) && cols.length) width = cols.reduce((a, b) => a + b, 0);
  const jc = tget('jc', 'val');
  const tblInd = tget('tblInd', 'w');
  const table = {
    type: 'table',
    width,
    align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : 'left',
    marginLeft: tblInd ? Number(tblInd) / TWIP_CM : 0,
    marginRight: 0,
    before: 0,
    after: 0,
    cols,
    rows: [],
  };
  for (const tr of kids(tbl, NS.w, 'tr')) {
    const cells = [];
    for (const tc of kids(tr, NS.w, 'tc')) {
      const tcPr = kid(tc, NS.w, 'tcPr');
      const vm = tcPr && kid(tcPr, NS.w, 'vMerge');
      if (vm && attr(vm, NS.w, 'val') !== 'restart') continue; // продолжение объединённой по вертикали ячейки
      const gs = tcPr && kid(tcPr, NS.w, 'gridSpan');
      const paras = [];
      docxBlocks(tc, st, paras, styleId);
      const ps = paras.filter((x) => x.type === 'p');
      cells.push({ paras: ps, span: gs ? Number(attr(gs, NS.w, 'val')) : 1, nested: paras.some((x) => x.type === 'table'), text: ps.map((x) => x.text).join('\n') });
    }
    table.rows.push(cells);
  }
  return table;
}
