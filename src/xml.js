// Небольшой разборщик XML (из тренажёра задания 14) с учётом пространств имён.
// Не зависит от DOMParser, поэтому одинаково работает в браузере и в тестах.
// Узел: { ns, local, attrs: [{ ns, local, value }], children: [узел | строка] }

export const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  chart: 'urn:oasis:names:tc:opendocument:xmlns:chart:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  manifest: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  anim: 'urn:oasis:names:tc:opendocument:xmlns:animation:1.0',
  smil: 'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0',
  // Office Open XML (.pptx, .docx)
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  cp: 'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties',
  vt: 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes',
};

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}

function splitName(qname) {
  const i = qname.indexOf(':');
  return i < 0 ? ['', qname] : [qname.slice(0, i), qname.slice(i + 1)];
}

export function parseXML(src) {
  const root = { ns: '', local: '#document', attrs: [], children: [] };
  const stack = [root];
  const scopes = [{ xml: 'http://www.w3.org/XML/1998/namespace' }];
  const tagRe = /<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (lt > i) {
      const txt = src.slice(i, lt);
      if (stack.length > 1) stack[stack.length - 1].children.push(decode(txt));
    }
    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt);
      stack[stack.length - 1].children.push(src.slice(lt + 9, e));
      i = e + 3;
      continue;
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      i = src.indexOf('>', lt) + 1;
      continue;
    }
    tagRe.lastIndex = lt;
    const m = tagRe.exec(src);
    if (!m) throw new Error('bad-xml');
    i = tagRe.lastIndex;
    const [, closing, qname, attrText, selfClose] = m;

    if (closing) {
      stack.pop();
      scopes.pop();
      continue;
    }

    const scope = Object.create(scopes[scopes.length - 1]);
    const rawAttrs = [];
    attrRe.lastIndex = 0;
    let a;
    while ((a = attrRe.exec(attrText))) {
      const name = a[1];
      const value = decode(a[2] ?? a[3]);
      if (name === 'xmlns') scope[''] = value;
      else if (name.startsWith('xmlns:')) scope[name.slice(6)] = value;
      else rawAttrs.push([name, value]);
    }
    const [prefix, local] = splitName(qname);
    const node = {
      ns: scope[prefix] ?? '',
      local,
      attrs: rawAttrs.map(([name, value]) => {
        const [p, l] = splitName(name);
        return { ns: p ? scope[p] ?? '' : '', local: l, value };
      }),
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) {
      stack.push(node);
      scopes.push(scope);
    }
  }
  return root;
}

// ---------- Поиск по дереву ----------

export function attr(node, ns, local) {
  for (const a of node.attrs) if (a.local === local && (ns === null || a.ns === ns)) return a.value;
  return null;
}

export function kids(node, ns, local) {
  return node.children.filter((c) => typeof c !== 'string' && c.ns === ns && (!local || c.local === local));
}

export function kid(node, ns, local) {
  for (const c of node.children) if (typeof c !== 'string' && c.ns === ns && c.local === local) return c;
  return null;
}

// Все потомки с данным именем (в порядке документа)
export function findAll(node, ns, local, out = []) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.ns === ns && c.local === local) out.push(c);
    findAll(c, ns, local, out);
  }
  return out;
}

export function find(node, ns, local) {
  for (const c of node.children) {
    if (typeof c === 'string') continue;
    if (c.ns === ns && c.local === local) return c;
    const r = find(c, ns, local);
    if (r) return r;
  }
  return null;
}

export function textOf(node) {
  let s = '';
  for (const c of node.children) s += typeof c === 'string' ? c : textOf(c);
  return s;
}

export function escapeXML(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
