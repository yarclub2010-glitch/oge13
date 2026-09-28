// Тренажёр задания 13 ОГЭ: 13.1 — презентация, 13.2 — текстовый документ.
// Ученик скачивает материалы (или смотрит образец), делает работу в LibreOffice
// и загружает файл — он проверяется прямо в браузере по критериям ФИПИ.

import { TOPICS, topicById, SAMPLES, sampleById, SLIDE_SPEC, parseMarks, plain } from './tasks.js';
import { readPresentation } from './slides.js';
import { readDocument } from './document.js';
import { checkPresentation } from './check131.js';
import { checkDocument } from './check132.js';
import { OfficeError, mimeOf } from './office.js';
import { readZip, makeZip } from './zip.js';
import { makeOdt } from './materials.js';
import { describeMarks } from './textdiff.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- Хранилище (может быть недоступно, например в приватном режиме) ----------

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem('oge13:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('oge13:' + key, JSON.stringify(value));
    } catch {
      // нет доступа к хранилищу — просто не сохраняем
    }
  },
};

const state = {
  mode: '13.1',
  topic: TOPICS[0],
  sample: SAMPLES[0],
  scores: store.get('scores', {}),
  urls: [], // ссылки на картинки в превью слайдов — освобождаем при новой проверке
};

const scoreClass = (s) => (s === 2 ? 'full' : s === 1 ? 'part' : 'none');
const SCORE_WORDS = ['0 баллов', '1 балл', '2 балла'];

// ---------- Режимы и адрес страницы ----------

function setMode(mode, pushHash = true) {
  state.mode = mode;
  $('#view-131').hidden = mode !== '13.1';
  $('#view-132').hidden = mode !== '13.2';
  $('#mode-131').setAttribute('aria-selected', String(mode === '13.1'));
  $('#mode-132').setAttribute('aria-selected', String(mode === '13.2'));
  store.set('mode', mode);
  if (pushHash) setHash(currentHash());
}

function currentHash() {
  return state.mode === '13.1' ? `13.1/${state.topic.id}` : `13.2/${state.sample.id}`;
}

function setHash(h) {
  if (location.hash !== '#' + h) history.replaceState(null, '', '#' + h);
}

$('#mode-131').addEventListener('click', () => setMode('13.1'));
$('#mode-132').addEventListener('click', () => setMode('13.2'));

function scoreBadge(key) {
  const s = state.scores[key];
  return s === undefined ? '' : s === 2 ? ' ✓' : ` (${s} из 2)`;
}

function updateStatus(key, el) {
  const s = state.scores[key];
  el.hidden = s === undefined;
  if (s !== undefined) {
    el.textContent = `Лучший результат: ${s} из 2`;
    el.className = `chip chip-score ${scoreClass(s)}`;
  }
}

function saveScore(key, score) {
  const best = state.scores[key];
  if (best === undefined || score > best) {
    state.scores[key] = score;
    store.set('scores', state.scores);
  }
  fillTopicSelect();
  fillSampleSelect();
  updateStatus(`13.1/${state.topic.id}`, $('#status-131'));
  updateStatus(`13.2/${state.sample.id}`, $('#status-132'));
}

function togglePanel(panelSel, btnSel, show) {
  const panel = $(panelSel);
  const btn = $(btnSel);
  const open = show ?? panel.hidden;
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  return open;
}

$('#btn-howto-131').addEventListener('click', () => togglePanel('#howto-131', '#btn-howto-131'));
$('#btn-mistakes-131').addEventListener('click', () => togglePanel('#mistakes-131', '#btn-mistakes-131'));
$('#btn-howto-132').addEventListener('click', () => togglePanel('#howto-132', '#btn-howto-132'));
$('#btn-mistakes-132').addEventListener('click', () => togglePanel('#mistakes-132', '#btn-mistakes-132'));

// =====================================================================
// 13.1 — презентация
// =====================================================================

function fillTopicSelect() {
  const sel = $('#topic-select');
  sel.innerHTML = '';
  TOPICS.forEach((t, i) => sel.append(new Option(`${i + 1}. ${t.title}${scoreBadge('13.1/' + t.id)}`, t.id)));
  sel.value = state.topic.id;
}

function openTopic(t, pushHash = true) {
  state.topic = t;
  store.set('topic', t.id);
  $('#topic-select').value = t.id;
  $('#title-131').textContent = `Презентация «${t.title}»`;
  $('#source-131').textContent = t.source;
  $('#materials-name').textContent = `«${t.folder}»`;
  updateStatus(`13.1/${t.id}`, $('#status-131'));
  $('#text-131').innerHTML = `
    <p>Используя информацию и иллюстративный материал, содержащийся в каталоге <b>«${esc(t.folder)}»</b>, создайте презентацию из трёх слайдов на тему <b>«${esc(t.title)}»</b>. В презентации должны содержаться краткие иллюстрированные сведения ${esc(t.about)}. Все слайды должны быть выполнены в едином стиле, каждый слайд должен быть озаглавлен.</p>
    <p>Файл ответа необходимо сохранить в формате <b>*.odp</b>.</p>
    <h3>Требования к оформлению работы</h3>
    <ol>
      <li>Ровно три слайда без анимации. Параметры страницы (слайда): экран (16:9), ориентация альбомная.</li>
      <li>Содержание, структура, форматирование шрифта и размещение изображений на слайдах:
        <ul>
          <li>первый слайд — титульный слайд с названием презентации, в подзаголовке титульного слайда в качестве информации об авторе презентации указывается идентификационный номер участника экзамена;</li>
          <li>второй слайд — основная информация в соответствии с заданием, размещённая по образцу на рисунке макета слайда 2: заголовок слайда; два изображения; два блока текста;</li>
          <li>третий слайд — дополнительная информация по теме презентации, размещённая по образцу на рисунке макета слайда 3: заголовок слайда; три изображения; три блока текста.</li>
        </ul>
      </li>
    </ol>
    ${mockupsHTML()}
    <p>На макетах слайдов существенным является наличие всех объектов, включая заголовки, их взаимное расположение. Выравнивание объектов, ориентация изображений выполняются произвольно в соответствии с замыслом автора работы и служат наилучшему раскрытию темы.</p>
    <p>В презентации должен использоваться единый тип шрифта (рубленый, с засечками или моноширинный).</p>
    <p>Размер шрифта для названия презентации на титульном слайде — ${SLIDE_SPEC.titleSize} пунктов, для подзаголовка на титульном слайде и заголовков слайдов — ${SLIDE_SPEC.headSize} пункта, для подзаголовков на втором и третьем слайдах и для основного текста — ${SLIDE_SPEC.textSize} пунктов.</p>
    <p>Текст не должен перекрывать основные изображения и сливаться с фоном.</p>`;
  renderPics(t);
  $('#result-131').hidden = true;
  if (pushHash && state.mode === '13.1') setHash(currentHash());
}

// Макеты слайдов, как в демоверсии
function mockupsHTML() {
  const slide = (inner) => `<svg viewBox="0 0 64 36" aria-hidden="true"><rect class="mk-slide" x="0.3" y="0.3" width="63.4" height="35.4" rx="0.8"/>${inner}</svg>`;
  const img = (x, y, w, h) => `<rect class="mk-img" x="${x}" y="${y}" width="${w}" height="${h}"/><circle class="mk-img-sun" cx="${x + w * 0.75}" cy="${y + h * 0.3}" r="${h * 0.14}"/><path class="mk-img-hill" d="M${x} ${y + h}L${x + w * 0.35} ${y + h * 0.45}L${x + w * 0.6} ${y + h * 0.75}L${x + w * 0.8} ${y + h * 0.55}L${x + w} ${y + h}Z"/>`;
  const box = (x, y, w, h, label) => `<rect class="mk-box" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="mk-text" x="${x + 1.2}" y="${y + 4}">${label}</text>`;
  const head = '<line class="mk-line" x1="12" y1="4" x2="52" y2="4"/><line class="mk-line" x1="14" y1="6.5" x2="50" y2="6.5"/>';
  const s1 = slide(`${box(8, 8, 48, 8, 'Название презентации')}${box(12, 21, 40, 6, 'Информация об авторе')}`);
  const s2 = slide(`${head}${img(5, 10, 16, 10)}${box(25, 11, 34, 8, 'Текстовый блок')}${box(5, 24, 34, 8, 'Текстовый блок')}${img(43, 23, 16, 10)}`);
  const s3 = slide(`${head}${box(4, 11, 15, 8, 'Текст')}${img(24.5, 10.5, 15, 9)}${box(45, 11, 15, 8, 'Текст')}${img(4, 23, 15, 9)}${box(24.5, 23.5, 15, 8, 'Текст')}${img(45, 23, 15, 9)}`);
  return `<div class="mockups">
    <figure class="mockup">${s1}<figcaption>Макет 1-го слайда<br>Тема презентации</figcaption></figure>
    <figure class="mockup">${s2}<figcaption>Макет 2-го слайда<br>Основная информация</figcaption></figure>
    <figure class="mockup">${s3}<figcaption>Макет 3-го слайда<br>Дополнительная информация</figcaption></figure>
  </div>`;
}

const picUrl = (t, name) => `materials/${t.id}/${name}.jpg`;

function renderPics(t) {
  $('#pics').innerHTML = t.pictures.map((name) => `<img src="${picUrl(t, name)}" alt="${name}" title="${name}.jpg" loading="lazy">`).join('');
}

$('#topic-select').addEventListener('change', (e) => openTopic(topicById(e.target.value)));
function stepTopic(d) {
  const i = (TOPICS.indexOf(state.topic) + d + TOPICS.length) % TOPICS.length;
  openTopic(TOPICS[i]);
}
$('#btn-prev-131').addEventListener('click', () => stepTopic(-1));
$('#btn-next-131').addEventListener('click', () => stepTopic(1));

// Каталог с материалами: текст и картинки в zip-архиве
$('#btn-materials').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const t = state.topic;
  btn.disabled = true;
  try {
    const dir = t.folder + '/';
    const files = [];
    files.push({ name: dir + `${t.folder}.odt`, data: await makeOdt(t), store: true });
    for (const name of t.pictures) {
      const r = await fetch(picUrl(t, name));
      if (!r.ok) throw new Error(`нет файла ${name}.jpg`);
      files.push({ name: dir + `${name}.jpg`, data: new Uint8Array(await r.arrayBuffer()), store: true });
    }
    const bytes = await makeZip(files);
    download(new Blob([bytes], { type: 'application/zip' }), `13.1_${t.folder}.zip`);
  } catch (err) {
    console.error(err);
    alert('Не удалось собрать каталог: проверьте подключение к интернету и попробуйте ещё раз.');
  } finally {
    btn.disabled = false;
  }
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// =====================================================================
// 13.2 — текстовый документ
// =====================================================================

function fillSampleSelect() {
  const sel = $('#sample-select');
  sel.innerHTML = '';
  SAMPLES.forEach((s, i) => sel.append(new Option(`${i + 1}. ${s.title}${scoreBadge('13.2/' + s.id)}`, s.id)));
  sel.value = state.sample.id;
}

function marksHTML(src) {
  return parseMarks(src).map((r) => {
    let h = esc(r.text);
    if (r.underline) h = `<u>${h}</u>`;
    if (r.italic) h = `<i>${h}</i>`;
    if (r.bold) h = `<b>${h}</b>`;
    return h;
  }).join('');
}

function openSample(s, pushHash = true) {
  state.sample = s;
  store.set('sample', s.id);
  $('#sample-select').value = s.id;
  $('#title-132').textContent = `Образец «${s.title}»`;
  $('#source-132').textContent = s.source;
  updateStatus(`13.2/${s.id}`, $('#status-132'));
  const cols = s.table[0].length;
  const gapText = s.order === 'table-first' ? 'между заголовком текста и таблицей, текстом и таблицей' : 'между текстом и таблицей';
  $('#text-132').innerHTML = `
    <p>Создайте в текстовом редакторе документ и напишите в нём следующий текст, точно воспроизведя всё оформление текста, имеющееся в образце.</p>
    <p>Данный текст должен быть набран шрифтом размером 14 пунктов обычного начертания. Отступ первой строки первого абзаца основного текста — 1 см. Расстояние между строками текста не менее высоты одинарного, но не более полуторного междустрочного интервала. Основной текст выровнен по ширине; заголовок текста, текст в ячейках заголовка и ${cols > 2 ? 'остальных столбцов' : 'второго столбца'} таблицы — по центру. Текст в ячейках первого столбца таблицы, кроме заголовка, выровнен по левому краю. В основном тексте и таблице есть слова, выделенные полужирным шрифтом, курсивом или подчёркиванием. Ширина таблицы меньше ширины основного текста. Таблица выровнена на странице по центру горизонтали.</p>
    <p>При этом допустимо, чтобы ширина Вашего текста отличалась от ширины текста в примере, поскольку ширина текста зависит от размеров страницы и полей. В этом случае разбиение текста на строки должно соответствовать стандартной ширине абзаца.</p>
    <p>Интервал (расстояние) ${gapText} не менее 14 пунктов (5 мм), но не более 24 пунктов (8,5 мм). Для установки интервала не допускается использование «пустого абзаца».</p>
    <p>Файл ответа необходимо сохранить в формате <b>*.odt</b>.</p>`;

  const table = `<table>${s.table.map((row) => `<tr>${row.map((c) => `<td>${marksHTML(c)}</td>`).join('')}</tr>`).join('')}</table>`;
  const texts = s.text.map((t) => `<p class="d-text">${marksHTML(t)}</p>`);
  const head = `<p class="d-head">${marksHTML(s.heading)}</p>`;
  $('#doc-sample').innerHTML = s.order === 'table-first'
    ? `${head}<div class="gap-after">${table}</div>${texts.join('')}`
    : `${head.replace('d-head', 'd-head')}${texts.join('')}<div class="gap-before">${table}</div>`;
  $('#result-132').hidden = true;
  if (pushHash && state.mode === '13.2') setHash(currentHash());
}

$('#sample-select').addEventListener('change', (e) => openSample(sampleById(e.target.value)));
function stepSample(d) {
  const i = (SAMPLES.indexOf(state.sample) + d + SAMPLES.length) % SAMPLES.length;
  openSample(SAMPLES[i]);
}
$('#btn-prev-132').addEventListener('click', () => stepSample(-1));
$('#btn-next-132').addEventListener('click', () => stepSample(1));

// На экзамене текст набирают вручную — не даём скопировать образец
$('#doc-sample').addEventListener('copy', (e) => {
  e.preventDefault();
  alert('Текст образца нужно набрать самостоятельно — на экзамене скопировать его неоткуда.');
});

// =====================================================================
// Загрузка файла
// =====================================================================

function setupDrop(dropSel, inputSel) {
  const drop = $(dropSel);
  const input = $(inputSel);
  input.addEventListener('change', () => {
    if (input.files[0]) checkFile(input.files[0]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
}
setupDrop('#drop-131', '#file-131');
setupDrop('#drop-132', '#file-132');
// Файл, брошенный в любое место страницы, тоже проверяем
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) checkFile(e.dataTransfer.files[0]);
});

// Что за файл: презентация (13.1) или текстовый документ (13.2)
async function kindOf(bytes, name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['odp', 'pptx', 'ppt'].includes(ext)) return '13.1';
  if (['odt', 'docx', 'doc', 'rtf'].includes(ext)) return '13.2';
  try {
    const zip = readZip(bytes);
    if (zip.has('mimetype')) {
      const mime = await zip.get('mimetype').text();
      if (mime.includes('presentation')) return '13.1';
      if (mime.includes('text')) return '13.2';
    }
    if (zip.has('ppt/presentation.xml')) return '13.1';
    if (zip.has('word/document.xml')) return '13.2';
  } catch {
    // не архив — пусть разберётся проверка текущего задания
  }
  return state.mode;
}

function show(where, html) {
  const box = $(where);
  box.hidden = false;
  box.innerHTML = html;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function checkFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = await kindOf(bytes, file.name);
  let switched = '';
  if (kind !== state.mode) {
    setMode(kind);
    switched = kind === '13.1' ? 'Это презентация — открыл задание 13.1.' : 'Это текстовый документ — открыл задание 13.2.';
  }
  const where = kind === '13.1' ? '#result-131' : '#result-132';
  show(where, '<p class="muted">Проверяю файл…</p>');
  try {
    if (kind === '13.1') await checkPresentationFile(bytes, file.name, switched);
    else await checkDocumentFile(bytes, file.name, switched);
  } catch (e) {
    console.error(e);
    const msg = e instanceof OfficeError ? e.message : `Не удалось прочитать файл «${file.name}». Сохраните его заново в формате ${kind === '13.1' ? '.odp' : '.odt'} и попробуйте ещё раз.`;
    show(where, `${switched ? `<p class="muted small">${esc(switched)}</p>` : ''}<div class="alert">${esc(msg)}</div>`);
  }
}

function scoreBox(score, fileName, why, formatNote) {
  return `<div class="score ${scoreClass(score)}">
      <div class="score-num">${score}<small> из 2</small></div>
      <div><p><b>${SCORE_WORDS[score]}</b> — ${esc(fileName)}</p><p class="score-note">${esc(why)}</p></div>
    </div>${formatNote}`;
}

function formatNoteHTML(format, need, would) {
  return `<div class="alert format-alert">Файл сохранён в формате <b>.${format}</b>, а на экзамене ответ принимается только в формате <b>.${need}</b> — такой файл получил бы <b>0 баллов</b>. ${would !== null ? `Если сохранить эту же работу в .${need}, она получит <b>${SCORE_WORDS[would]}</b>. ` : ''}Выберите Файл → Сохранить как → тип «${need === 'odp' ? 'Презентация ODF (.odp)' : 'Текстовый документ ODF (.odt)'}».</div>`;
}

// ---------- 13.1 ----------

async function checkPresentationFile(bytes, name, switched) {
  const model = await readPresentation(bytes, name);
  // Какая тема: по названию на титульном слайде
  let note = switched;
  const titleText = (model.slides[0]?.shapes.filter((s) => s.kind === 'text').map((s) => s.text).join(' ') ?? '').toLowerCase().replace(/ё/g, 'е');
  const byTitle = TOPICS.filter((t) => titleText.includes(t.title.toLowerCase().replace(/ё/g, 'е')) || titleText.includes(t.folder.toLowerCase().replace(/ё/g, 'е')));
  if (byTitle.length === 1 && byTitle[0] !== state.topic) {
    openTopic(byTitle[0]);
    note += `${note ? ' ' : ''}Презентация на тему «${byTitle[0].title}» — открыл эту тему.`;
  }
  const res = checkPresentation(model, state.topic);
  const wrongFormat = model.format !== 'odp';
  const score = wrongFormat ? 0 : res.score;
  saveScore(`13.1/${state.topic.id}`, score);

  const groups = ['Структура', 'Шрифт', 'Изображения'].map((g) => {
    const errs = res.errors.filter((e) => e.group === g);
    const hint = { Структура: 'три слайда, макеты, заголовки, формат 16:9, без анимации', Шрифт: 'единый тип, размеры 40/24/20 пт, текст не перекрывает изображения и не сливается с фоном', Изображения: 'пропорции сохранены, не накладываются друг на друга и на текст' }[g];
    return `<li class="${errs.length ? 'bad' : 'ok'}">
      <h3>${errs.length ? '✗' : '✓'} ${g} <span class="count">${errs.length ? `ошибок: ${errs.length}` : 'ошибок нет'}</span></h3>
      ${errs.length ? `<ul class="tight">${errs.map((e) => `<li>${esc(e.text)}</li>`).join('')}</ul>` : `<p class="muted small" style="margin:0">${hint}</p>`}
    </li>`;
  }).join('');

  const html = `
    ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    ${scoreBox(score, name, wrongFormat ? 'Неверный формат файла.' : res.why, wrongFormat ? formatNoteHTML(model.format, 'odp', res.score) : '')}
    <p class="small muted">Слайдов: ${res.slidesCount}. Однотипные ошибки считаются за одну.</p>
    <ul class="groups">${groups}</ul>
    ${res.notes.length ? `<div class="notes">${res.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}
    ${slidesPreview(model, res)}`;
  show('#result-131', html);
}

function slidesPreview(model, res) {
  state.urls.forEach((u) => URL.revokeObjectURL(u));
  state.urls = [];
  const urlOf = new Map();
  for (const [path, bytes] of model.images) {
    const u = URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
    state.urls.push(u);
    urlOf.set(path, u);
  }
  const bad = new Set(res.errors.flatMap((e) => e.shapes || []));
  // 1 см = K единиц схемы: при слишком мелких единицах браузеры не рисуют текст
  const K = 40;
  const W = model.width * K;
  const H = model.height * K;
  const box = (sh) => `x="${sh.x * K}" y="${sh.y * K}" width="${Math.max(sh.w * K, 1)}" height="${Math.max(sh.h * K, 1)}"`;
  const cards = model.slides.map((s) => {
    const bg = s.background.kind === 'solid' ? s.background.color : s.background.kind === 'image' ? '#e8e8e8' : '#f0f0f0';
    const items = s.shapes.map((sh) => {
      let out = '';
      if (sh.kind === 'image') {
        const u = urlOf.get(sh.image.path);
        out += u ? `<image href="${u}" ${box(sh)} preserveAspectRatio="none"/>` : `<rect ${box(sh)} fill="#cfe3f5"/>`;
      } else if (sh.kind === 'text') {
        if (sh.fill) out += `<rect ${box(sh)} fill="${esc(sh.fill)}"/>`;
        const centered = sh.role === 'title' || sh.role === 'subtitle';
        const paras = sh.paragraphs.map((p) => `<p style="text-align:${centered ? 'center' : 'left'}">${p.runs.map((r) => `<span style="font-size:${((r.size * (sh.fontScale ?? 1) * 2.54 * K) / 72).toFixed(2)}px;font-family:'${esc(r.font ?? 'sans-serif')}',sans-serif;${r.bold ? 'font-weight:700;' : ''}${r.italic ? 'font-style:italic;' : ''}${r.underline ? 'text-decoration:underline;' : ''}color:${esc(r.color ?? '#000')}">${esc(r.text)}</span>`).join('') || '&nbsp;'}</p>`).join('');
        out += `<foreignObject ${box(sh)}><div xmlns="http://www.w3.org/1999/xhtml" class="sp-text" style="padding:${0.125 * K}px ${0.25 * K}px;${centered ? 'display:flex;flex-direction:column;justify-content:center;height:100%;' : ''}">${paras}</div></foreignObject>`;
        out += `<rect class="sp-frame" ${box(sh)}/>`;
      } else {
        out += `<rect ${box(sh)} fill="${esc(sh.fill ?? 'rgba(0,0,0,0.06)')}"/>`;
      }
      if (bad.has(sh)) out += `<rect class="sp-bad" ${box(sh)}/>`;
      return out;
    }).join('');
    return `<figure class="slide-card"><figcaption>Слайд ${s.number}${s.hidden ? ' (скрытый)' : ''}${s.animations ? ` · анимация: ${s.animations}` : ''}${s.transition ? ' · эффект смены слайда' : ''}</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Слайд ${s.number}"><rect width="${W}" height="${H}" fill="${esc(bg)}"/>${items}</svg></figure>`;
  }).join('');
  return `<details class="slides-preview" open><summary>Как тренажёр прочитал ваши слайды</summary>
    <div class="slide-list">${cards}</div>
    <p class="small muted">Схема, а не точная копия: шрифты и переносы строк могут отличаться. Красной рамкой обведены объекты, к которым есть замечания.</p></details>`;
}

// ---------- 13.2 ----------

const TEXT_ITEMS = [
  ['size', 'Шрифт 14 пт во всём тексте и таблице'],
  ['heading', 'Заголовок набран прописными буквами'],
  ['marks', 'Нужные слова выделены полужирным, курсивом, подчёркиванием'],
  ['line', 'Междустрочный интервал от одинарного до полуторного'],
  ['gap', 'Интервал до и после таблицы 14–24 пт, без пустых абзацев'],
  ['align', 'Заголовок по центру, основной текст по ширине'],
  ['indent', 'Отступ первой строки 1 см (не пробелами)'],
  ['breaks', 'Разбиение на строки делает редактор'],
  ['typos', 'Не более пяти ошибок набора'],
  ['order', 'Таблица расположена как в образце'],
];
const TABLE_ITEMS = [
  ['t-shape', 'Нужное число строк и столбцов'],
  ['t-marks', 'Нужные слова в таблице выделены'],
  ['t-center', 'Заголовок и столбцы, кроме первого, — по центру'],
  ['t-left', 'Первый столбец (кроме заголовка) — по левому краю'],
  ['t-width', 'Таблица уже основного текста'],
  ['t-align', 'Таблица выровнена по центру страницы'],
  ['t-typos', 'Не более трёх ошибок набора в таблице'],
];

function reqList(items, issues) {
  const shown = items.filter(([key]) => key !== 'order' || issues.some((i) => i.key === 'order'));
  return `<ul class="req">${shown.map(([key, title]) => {
    const issue = issues.find((i) => i.key === key);
    return `<li class="${issue ? 'bad' : 'ok'}"><span class="r-icon">${issue ? '✗' : '✓'}</span><span><span class="r-title">${title}</span>${issue ? `<span class="r-text">${esc(issue.text)}</span>` : ''}</span></li>`;
  }).join('')}</ul>`;
}

async function checkDocumentFile(bytes, name, switched) {
  const model = await readDocument(bytes, name);
  let note = switched;
  // Какой образец: по совпадению слов
  const all = model.body.flatMap((b) => (b.type === 'p' ? [b.text] : b.type === 'table' ? b.rows.flatMap((r) => r.map((c) => c.text)) : [])).join(' ');
  const best = bestSample(all);
  if (best && best !== state.sample) {
    openSample(best);
    note += `${note ? ' ' : ''}Документ похож на образец «${best.title}» — открыл его.`;
  }
  const res = checkDocument(model, state.sample);
  const wrongFormat = model.format !== 'odt';
  const score = wrongFormat ? 0 : res.score;
  saveScore(`13.2/${state.sample.id}`, score);

  const html = `
    ${note ? `<p class="muted small">${esc(note)}</p>` : ''}
    ${scoreBox(score, name, wrongFormat ? 'Неверный формат файла.' : res.why, wrongFormat ? formatNoteHTML(model.format, 'odt', res.score) : '')}
    <ul class="groups">
      <li class="${res.textPresent && !res.text.length ? 'ok' : 'bad'}">
        <h3>Основной текст <span class="count">${res.textPresent ? `нарушений: ${res.text.length}` : 'не найден'}</span></h3>
        ${res.textPresent ? reqList(TEXT_ITEMS, res.text) : '<p class="small" style="margin:0">В документе не найден основной текст образца.</p>'}
      </li>
      <li class="${res.tablePresent && !res.table.length ? 'ok' : 'bad'}">
        <h3>Таблица <span class="count">${res.tablePresent ? `нарушений: ${res.table.length}` : 'нет'}</span></h3>
        ${res.tablePresent ? reqList(TABLE_ITEMS, res.table) : '<p class="small" style="margin:0">В документе нет таблицы. Вставьте её командой Таблица → Вставить таблицу.</p>'}
      </li>
    </ul>
    ${res.notes.length ? `<div class="notes">${res.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>` : ''}
    ${diffHTML(res)}`;
  show('#result-132', html);
}

function bestSample(text) {
  const words = new Set((text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]{4,}/gu) || []));
  if (words.size < 5) return null;
  let best = null;
  let bestScore = 0;
  for (const s of SAMPLES) {
    const sw = new Set((plain([s.heading, ...s.text, ...s.table.flat()].join(' ')).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]{4,}/gu) || []));
    let common = 0;
    for (const w of sw) if (words.has(w)) common++;
    const score = common / sw.size;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return bestScore >= 0.35 ? best : null;
}

// Текст ученика с отмеченными ошибками
function diffHTML(res) {
  const render = (cmp) => {
    const errAt = new Map(cmp.errors.map((e) => [e.pair, e]));
    const markAt = new Map(cmp.marks.map((m) => [m.pair, m]));
    let html = '';
    cmp.pairs.forEach((p, k) => {
      const e = errAt.get(k);
      const m = markAt.get(k);
      const tok = p.b ?? p.a;
      const brk = k > 0 && (p.b ? p.b.start : p.a.start);
      const space = brk ? '<br>' : p.b ? (p.b.space ? ' ' : '') : ' ';
      if (tok.raw === '‖') {
        html += '<span class="d-sep">|</span>';
        return;
      }
      let word = esc(tok.raw);
      if (p.b && p.b.marks) {
        if (p.b.marks.includes('u')) word = `<u>${word}</u>`;
        if (p.b.marks.includes('i')) word = `<i>${word}</i>`;
        if (p.b.marks.includes('b')) word = `<b>${word}</b>`;
      }
      let cls = '';
      let title = '';
      if (e) {
        cls = { typo: 'd-typo', case: 'd-typo', missing: 'd-miss', extra: 'd-extra', space: 'd-space' }[e.kind];
        title = e.text;
      } else if (m) {
        cls = 'd-mark';
        title = `${describeMarks(m.got)}, нужно ${describeMarks(m.want)}`;
      }
      html += space + (cls ? `<span class="${cls}" title="${esc(title)}">${word}</span>` : word);
    });
    return html.trim();
  };
  const parts = [];
  if (res.textPresent || res.cmp.pairs.some((p) => p.b)) {
    parts.push(`<p class="small" style="margin:8px 0 0"><b>Текст</b> — ошибок набора: ${res.typos.length} (допускается 5)${res.cmp.marks.length ? `, неверно выделено слов: ${res.cmp.marks.length}` : ''}</p><div class="diff">${render(res.cmp)}</div>`);
  }
  if (res.tcmp) {
    parts.push(`<p class="small" style="margin:8px 0 0"><b>Таблица</b> (ячейки по строкам) — ошибок набора: ${res.tableTypos.length} (допускается 3)${res.tcmp.marks.length ? `, неверно выделено слов: ${res.tcmp.marks.length}` : ''}</p><div class="diff">${render(res.tcmp)}</div>`);
  }
  if (!parts.length) return '';
  const list = [...res.typos, ...res.tableTypos].slice(0, 30).map((e) => `<li>${esc(e.text)}</li>`).join('');
  return `<details class="diff-preview" ${res.typos.length + res.tableTypos.length + res.cmp.marks.length ? 'open' : ''}><summary>Ваш текст в сравнении с образцом</summary>
    ${parts.join('')}
    <div class="diff-legend"><span><span class="d-typo" style="background:#ffd9d6">слово</span> опечатка</span><span><span style="text-decoration:line-through;color:#b3261e">слово</span> пропущено</span><span><span style="background:#ffe0b2;text-decoration:line-through">слово</span> лишнее</span><span><span style="box-shadow:inset 0 -3px 0 #f29900">слово</span> ошибка в пробелах</span><span><span style="outline:2px dashed #8e24aa">слово</span> неверное выделение</span></div>
    ${list ? `<ul class="tight small" style="margin-top:6px">${list}</ul>` : ''}
    <p class="small muted">Наведите указатель на отмеченное слово, чтобы увидеть пояснение.</p></details>`;
}

// =====================================================================
// Справка, клавиши, запуск
// =====================================================================

const help = $('#help');
$('#btn-help').addEventListener('click', () => help.showModal());
$('#btn-help-close').addEventListener('click', () => help.close());
help.addEventListener('click', (e) => {
  if (e.target === help) help.close();
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    help.open ? help.close() : help.showModal();
  }
});

function applyHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = /^13\.([12])(?:\/([a-z-]+))?$/.exec(h);
  if (!m) return false;
  if (m[1] === '1') {
    setMode('13.1', false);
    openTopic(topicById(m[2]) ?? state.topic, false);
  } else {
    setMode('13.2', false);
    openSample(sampleById(m[2]) ?? state.sample, false);
  }
  setHash(currentHash());
  return true;
}

window.addEventListener('hashchange', applyHash);

state.topic = topicById(store.get('topic')) ?? TOPICS[0];
state.sample = sampleById(store.get('sample')) ?? SAMPLES[0];
fillTopicSelect();
fillSampleSelect();
openTopic(state.topic, false);
openSample(state.sample, false);
if (!applyHash()) setMode(store.get('mode', '13.1'));
