// Каталог с материалами для задания 13.1: текст по теме в файле .odt и иллюстрации.
//
// Текст специально набран шрифтом Times New Roman 14 пт, как в материалах на экзамене:
// при копировании в презентацию шрифт и размер нужно поменять на требуемые по заданию.

import { makeZip } from './zip.js';
import { escapeXML } from './xml.js';

const FONT = 'Times New Roman';

export function makeOdt(topic) {
  const ns = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"';
  const fonts = `<office:font-face-decls><style:font-face style:name="${FONT}" svg:font-family="'${FONT}'" style:font-family-generic="roman" style:font-pitch="variable"/></office:font-face-decls>`;
  const text = (extra = '') => `<style:text-properties style:font-name="${FONT}" fo:font-size="14pt" style:font-name-complex="${FONT}" style:font-size-complex="14pt"${extra}/>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${ns}>${fonts}<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="100%"/>${text(' fo:language="ru" fo:country="RU"')}</style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text">${text()}</style:style>
<style:style style:name="Title" style:display-name="Название" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="0.42cm"/>${text(' fo:font-weight="bold" style:font-weight-complex="bold"')}</style:style>
<style:style style:name="Heading" style:display-name="Заголовок раздела" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Body"><style:paragraph-properties fo:margin-top="0.42cm" fo:margin-bottom="0.21cm" fo:keep-with-next="always"/>${text(' fo:font-weight="bold" style:font-weight-complex="bold"')}</style:style>
<style:style style:name="Body" style:display-name="Текст" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="justify" fo:text-indent="1.25cm"/>${text()}</style:style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2.5cm" fo:margin-right="1.5cm"/></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;

  const body = [`<text:p text:style-name="Title">${escapeXML(topic.title)}</text:p>`];
  for (const [head, par] of topic.text) {
    body.push(`<text:h text:style-name="Heading" text:outline-level="2">${escapeXML(head)}</text:h>`);
    body.push(`<text:p text:style-name="Body">${escapeXML(par)}</text:p>`);
  }
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${ns}>${fonts}<office:body><office:text>
${body.join('\n')}
</office:text></office:body></office:document-content>`;

  const meta = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta ${ns}><office:meta><meta:generator>Тренажёр задания 13 ОГЭ</meta:generator><dc:title>${escapeXML(topic.title)}</dc:title></office:meta></office:document-meta>`;

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;

  return makeZip([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text', store: true }, // первым и без сжатия — так требует формат
    { name: 'content.xml', data: content },
    { name: 'styles.xml', data: styles },
    { name: 'meta.xml', data: meta },
    { name: 'META-INF/manifest.xml', data: manifest },
  ]);
}
