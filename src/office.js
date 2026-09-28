// Общее для чтения офисных файлов: единицы измерения, стили OpenDocument,
// связи между частями Office Open XML, размеры картинок и типы шрифтов.

import { NS, parseXML, attr, kid, kids, findAll, textOf } from './xml.js';

export class OfficeError extends Error {}

// ---------- Единицы ----------

const UNIT_CM = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 };

export function toCm(v) {
  const m = /^\s*(-?[\d.]+)\s*(cm|mm|in|pt|pc|px)?\s*$/.exec(v ?? '');
  return m ? Number(m[1]) * UNIT_CM[m[2] || 'cm'] : null;
}

export function toPt(v) {
  const cm = toCm(v);
  return cm === null ? null : (cm * 72) / 2.54;
}

export const cmToPt = (cm) => (cm * 72) / 2.54;
export const ptToCm = (pt) => (pt * 2.54) / 72;
export const EMU_CM = 360000; // .pptx: 1 см = 360 000 EMU
export const TWIP_CM = 1440 / 2.54; // .docx: 1 дюйм = 1440 twip

export const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- Стили OpenDocument ----------
// Стили берутся из styles.xml и content.xml. Свойство ищется в самом стиле,
// затем в родителях и, наконец, в стиле по умолчанию для семейства.

export class OdfStyles {
  constructor(stylesDoc, contentDoc) {
    this.byName = new Map(); // 'семейство/имя' → узел style:style
    this.defaults = new Map(); // семейство → узел style:default-style
    this.fonts = new Map(); // имя шрифта → название семейства шрифтов
    this.pageLayouts = new Map();
    this.masters = new Map();
    // Порядок важен: автоматические стили content.xml главнее одноимённых из styles.xml
    const docs = [stylesDoc, contentDoc].filter(Boolean);
    for (const doc of docs) {
      for (const f of findAll(doc, NS.style, 'font-face')) {
        const fam = attr(f, NS.svg, 'font-family') || attr(f, NS.style, 'name');
        this.fonts.set(attr(f, NS.style, 'name'), cleanFontName(fam));
      }
      for (const s of findAll(doc, NS.style, 'style')) {
        this.byName.set(`${attr(s, NS.style, 'family')}/${attr(s, NS.style, 'name')}`, s);
      }
      for (const s of findAll(doc, NS.style, 'default-style')) this.defaults.set(attr(s, NS.style, 'family'), s);
      for (const l of findAll(doc, NS.style, 'page-layout')) this.pageLayouts.set(attr(l, NS.style, 'name'), l);
      for (const m of findAll(doc, NS.style, 'master-page')) this.masters.set(attr(m, NS.style, 'name'), m);
    }
  }

  get(family, name) {
    return name ? this.byName.get(`${family}/${name}`) ?? null : null;
  }

  // Цепочка стилей: сам стиль, его родители, стиль по умолчанию
  chain(family, name) {
    const out = [];
    const seen = new Set();
    let s = this.get(family, name);
    while (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      s = this.get(family, attr(s, NS.style, 'parent-style-name'));
    }
    return out;
  }

  // Первое найденное значение свойства в списке цепочек
  // chains: [[узлы стилей]], kind: 'text-properties' | 'paragraph-properties' | …
  static pick(chains, kind, ns, local) {
    for (const chain of chains) {
      for (const s of chain) {
        if (!s) continue;
        for (const p of [kid(s, NS.style, kind), kid(s, NS.loext, kind)]) {
          const v = p && attr(p, ns, local);
          if (v !== null && v !== undefined) return v;
        }
      }
    }
    return null;
  }

  // Название шрифта: style:font-name ссылается на объявление шрифта, fo:font-family — само название
  fontFamily(chains) {
    for (const chain of chains) {
      for (const s of chain) {
        const p = s && kid(s, NS.style, 'text-properties');
        if (!p) continue;
        const n = attr(p, NS.style, 'font-name');
        if (n !== null) return this.fonts.get(n) ?? cleanFontName(n);
        const f = attr(p, NS.fo, 'font-family');
        if (f !== null) return cleanFontName(f);
      }
    }
    return null;
  }
}

// Свойства текста по цепочкам стилей OpenDocument
export function odfTextProps(styles, chains, baseSize = 12) {
  const pick = (ns, local) => OdfStyles.pick(chains, 'text-properties', ns, local);
  let size = null;
  // Размер может быть задан в процентах от размера в родительском стиле
  const sizes = [];
  for (const chain of chains) {
    for (const s of chain) {
      const p = s && kid(s, NS.style, 'text-properties');
      const v = p && attr(p, NS.fo, 'font-size');
      if (v) sizes.push(v);
    }
  }
  let factor = 1;
  for (const v of sizes) {
    if (v.endsWith('%')) factor *= Number.parseFloat(v) / 100;
    else {
      size = toPt(v) * factor;
      break;
    }
  }
  if (size === null) size = baseSize * factor;
  const weight = pick(NS.fo, 'font-weight');
  const style = pick(NS.fo, 'font-style');
  const underline = pick(NS.style, 'text-underline-style');
  const transform = pick(NS.fo, 'text-transform');
  const variant = pick(NS.fo, 'font-variant');
  const windowColor = pick(NS.style, 'use-window-font-color');
  return {
    size: round(size, 2),
    font: styles.fontFamily(chains),
    bold: weight === 'bold' || Number(weight) >= 600,
    italic: style === 'italic' || style === 'oblique',
    underline: !!underline && underline !== 'none',
    caps: transform === 'uppercase' || variant === 'small-caps',
    color: windowColor === 'true' ? null : pick(NS.fo, 'color'),
  };
}

export function cleanFontName(s) {
  return String(s ?? '').replace(/^['"]|['"]$/g, '').replace(/&apos;/g, '').trim();
}

// ---------- Office Open XML: связи между частями ----------

export function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// Связи части part → Map(rId → { target (путь в архиве), type })
export async function readRels(zip, part) {
  const i = part.lastIndexOf('/');
  const relsPath = `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
  const map = new Map();
  const entry = zip.get(relsPath);
  if (!entry) return map;
  const doc = parseXML(await entry.text());
  for (const r of findAll(doc, NS.rel, 'Relationship')) {
    const external = attr(r, null, 'TargetMode') === 'External';
    const target = attr(r, null, 'Target');
    map.set(attr(r, null, 'Id'), {
      target: external ? target : resolvePath(part, target),
      type: (attr(r, null, 'Type') || '').split('/').pop(),
      external,
    });
  }
  return map;
}

export async function readXmlPart(zip, path) {
  const e = zip.get(path);
  return e ? parseXML(await e.text()) : null;
}

// Тема оформления .pptx/.docx: шрифты и цвета
export function readTheme(doc) {
  const theme = { major: null, minor: null, colors: {} };
  if (!doc) return theme;
  const major = findAll(doc, NS.a, 'majorFont')[0];
  const minor = findAll(doc, NS.a, 'minorFont')[0];
  const latin = (n) => {
    const l = n && kid(n, NS.a, 'latin');
    return l ? attr(l, null, 'typeface') : null;
  };
  theme.major = latin(major);
  theme.minor = latin(minor);
  const scheme = findAll(doc, NS.a, 'clrScheme')[0];
  if (scheme) {
    for (const c of scheme.children) {
      if (typeof c === 'string') continue;
      const v = c.children.find((x) => typeof x !== 'string');
      if (!v) continue;
      theme.colors[c.local] = v.local === 'srgbClr' ? '#' + attr(v, null, 'val') : v.local === 'sysClr' ? '#' + (attr(v, null, 'lastClr') || '000000') : null;
    }
  }
  return theme;
}

// Включено ли свойство-переключатель .docx/.pptx (<w:b/>, <w:b w:val="0"/>)
export function onOff(node, ns) {
  if (!node) return null;
  const v = attr(node, ns, 'val');
  return v === null || !/^(0|false|off|none)$/i.test(v);
}

// ---------- Картинки ----------

// Размер картинки в пикселях по её заголовку (PNG, JPEG, GIF, BMP, WebP)
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const u16 = (i) => (b[i] << 8) | b[i + 1];
  const le16 = (i) => b[i] | (b[i + 1] << 8);
  const le32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50) return { w: u32(16), h: u32(20), type: 'png' };
  if (b[0] === 0x47 && b[1] === 0x49) return { w: le16(6), h: le16(8), type: 'gif' };
  if (b[0] === 0x42 && b[1] === 0x4d) return { w: le32(18), h: Math.abs(le32(22) | 0), type: 'bmp' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff, type: 'webp' };
    if (kind === 'VP8L') {
      const n = le32(21);
      return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1, type: 'webp' };
    }
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)), type: 'webp' };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { w: u16(i + 7), h: u16(i + 5), type: 'jpeg' };
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2;
        continue;
      }
      i += 2 + u16(i + 2);
    }
  }
  return null;
}

export function mimeOf(path) {
  const ext = path.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' }[ext] ?? 'application/octet-stream';
}

// ---------- Шрифты ----------
// В задании 13.1 нужен «единый тип шрифта (рубленый, с засечками или моноширинный)»,
// поэтому сравниваются не названия шрифтов, а их типы.

const FONT_TYPES = {
  sans: ['arial', 'liberation sans', 'dejavu sans', 'noto sans', 'open sans', 'roboto', 'verdana', 'tahoma', 'calibri', 'calibri light', 'segoe ui', 'helvetica', 'pt sans', 'carlito', 'trebuchet ms', 'century gothic', 'candara', 'corbel', 'franklin gothic', 'franklin gothic medium', 'gill sans', 'gill sans mt', 'lucida sans', 'lucida sans unicode', 'lucida grande', 'montserrat', 'ubuntu', 'source sans pro', 'source sans 3', 'ibm plex sans', 'inter', 'lato', 'fira sans', 'myriad pro', 'futura', 'arial narrow', 'arial black', 'liberation sans narrow', 'bahnschrift', 'aptos', 'microsoft sans serif', 'ms sans serif', 'arimo', 'noto sans display', 'raleway', 'nunito', 'pt sans caption', 'pt sans narrow', 'yu gothic', 'ms gothic', 'microsoft yahei', 'segoe ui light', 'segoe ui semibold', 'dejavu sans condensed', 'dejavu sans light', 'opensymbol', 'golos text', 'manrope', 'rubik', 'play', 'exo 2', 'm plus 1p', 'geologica', 'cantarell', 'overpass'],
  serif: ['times new roman', 'liberation serif', 'dejavu serif', 'noto serif', 'pt serif', 'georgia', 'cambria', 'caladea', 'garamond', 'book antiqua', 'palatino', 'palatino linotype', 'bookman old style', 'century schoolbook', 'constantia', 'linux libertine g', 'linux libertine o', 'libertinus serif', 'gelasio', 'source serif pro', 'source serif 4', 'ibm plex serif', 'tinos', 'times', 'baskerville', 'baskerville old face', 'century', 'sylfaen', 'minion pro', 'noto serif display', 'pt serif caption', 'dejavu serif condensed', 'bitter', 'merriweather', 'lora', 'playfair display', 'cormorant garamond', 'eb garamond', 'literata', 'charter', 'bodoni mt', 'rockwell', 'courier prime'],
  mono: ['courier new', 'liberation mono', 'dejavu sans mono', 'consolas', 'lucida console', 'noto sans mono', 'noto mono', 'pt mono', 'cousine', 'source code pro', 'fira mono', 'fira code', 'jetbrains mono', 'ubuntu mono', 'cascadia code', 'cascadia mono', 'courier', 'ibm plex mono', 'roboto mono', 'menlo', 'monaco', 'sf mono', 'andale mono', 'ocr a extended', 'lucida sans typewriter', 'ms gothic'],
  decor: ['comic sans ms', 'impact', 'segoe script', 'segoe print', 'monotype corsiva', 'gabriola', 'lobster', 'bradley hand itc', 'brush script mt', 'script mt bold', 'kristen itc', 'jokerman', 'papyrus', 'curlz mt', 'chiller', 'vivaldi', 'old english text mt', 'freestyle script', 'mistral', 'pristina', 'showcard gothic', 'stencil', 'algerian', 'ink free', 'caveat', 'pacifico', 'amatic sc', 'marck script', 'poiret one', 'kurale', 'ruslan display', 'underdog'],
};

export const FONT_TYPE_NAMES = { sans: 'рубленый', serif: 'с засечками', mono: 'моноширинный', decor: 'декоративный' };

export function fontType(name) {
  if (!name) return null;
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (FONT_TYPES.mono.includes(n)) return 'mono';
  for (const t of ['decor', 'serif', 'sans']) if (FONT_TYPES[t].includes(n)) return t;
  if (/mono|courier|console|typewriter|code\b/.test(n)) return 'mono';
  if (/sans|gothic|grotesk|grotesque|narrow/.test(n)) return 'sans';
  if (/serif|roman|antiqua|times|garamond/.test(n)) return 'serif';
  if (/script|hand|brush|comic/.test(n)) return 'decor';
  return null; // неизвестный шрифт — сравниваем по названию
}

// Отношение контрастности двух цветов (#rrggbb) по WCAG: 1 — одинаковые, 21 — чёрный на белом
export function contrast(c1, c2) {
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const a = lum(c1);
  const b = lum(c2);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function isDark(hex) {
  const c = contrast(hex, '#000000');
  return c !== null && c < 7;
}

export { textOf, kids };
