# Создаёт файлы для автотестов настоящим LibreOffice: верные решения и типичные ошибки.
# Запуск (нужен установленный LibreOffice):
#   "C:\Program Files\LibreOffice\program\python.exe" tools\make_fixtures.py
# Файлы появятся в tests/fixtures. Имя: <задание>__<случай>.<формат>

import os
import struct
import sys
import tempfile
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lo import connect, new_doc, save, load_graphic  # noqa: E402

import uno  # noqa: E402
from com.sun.star.awt import Size, Point  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures')
TMP = tempfile.mkdtemp(prefix='oge13-')
os.makedirs(OUT, exist_ok=True)

FONT = 'Liberation Sans'


def png(path, w, h, color):
    raw = b''.join(b'\x00' + bytes(color) * w for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(data)
    return path


PICS = [png(os.path.join(TMP, f'p{i}.png'), 1200, 900, c) for i, c in enumerate(
    [(160, 110, 60), (60, 120, 60), (70, 130, 190), (200, 170, 60), (120, 80, 150), (190, 90, 80)])]
PORTRAIT = png(os.path.join(TMP, 'portrait.png'), 900, 1200, (90, 90, 90))

desktop = connect()

# =====================================================================
# 13.1 — презентации
# =====================================================================

TEXTS = [
    'Бурый медведь — один из самых крупных хищников суши, его масса достигает 450 кг.',
    'Медведь живёт в лесах Евразии, в России — от Кольского полуострова до Камчатки.',
    'Зимой медведь спит в берлоге, где у медведицы рождаются медвежата.',
    'Бурый медведь всеяден: ест ягоды, орехи, корни, мёд и ловит рыбу.',
    'Медведь бегает со скоростью до 50 км/ч и хорошо плавает.',
]


def set_text(shape, text, size, font=FONT, bold=False):
    shape.String = text
    cur = shape.createTextCursor()
    cur.gotoStart(False)
    cur.gotoEnd(True)
    cur.CharHeight = size
    cur.CharFontName = font
    if bold:
        cur.CharWeight = 150


def textbox(doc, page, x, y, w, text, size=20, font=FONT):
    s = doc.createInstance('com.sun.star.drawing.TextShape')
    page.add(s)
    s.TextAutoGrowHeight = True
    s.TextAutoGrowWidth = False
    s.Position = Point(int(x * 1000), int(y * 1000))
    s.Size = Size(int(w * 1000), 1500)
    set_text(s, text, size, font)
    return s


def image(doc, page, x, y, w, h, path):
    g = doc.createInstance('com.sun.star.drawing.GraphicObjectShape')
    page.add(g)
    g.Graphic = load_graphic(path)
    g.Position = Point(int(x * 1000), int(y * 1000))
    g.Size = Size(int(w * 1000), int(h * 1000))
    return g


def presentation(case):
    """Верная презентация с изменениями для случая case."""
    doc = new_doc(desktop, 'simpress')
    pages = doc.DrawPages
    p1 = pages.getByIndex(0)
    p1.Width, p1.Height = 28000, 15750
    p1.Layout = 0
    title_font = 'Liberation Serif' if case == 'fonts' else FONT
    set_text(p1.getByIndex(0), 'Бурый медведь', 40, title_font)
    set_text(p1.getByIndex(1), 'Участник ОГЭ 1234567890', 24)

    text_size = 18 if case == 'sizes' else 20
    p2 = pages.insertNewByIndex(0)
    p2.Layout = 19  # только заголовок
    set_text(p2.getByIndex(0), 'Внешний вид и ареал', 24, title_font)
    w1 = 9.6 if case == 'distorted' else 7.2
    image(doc, p2, 1.5, 3.8, w1, 5.4, PICS[0])
    t = textbox(doc, p2, 10, 4.5, 16, TEXTS[0], text_size)
    if case == 'overlap':
        t.Position = Point(4000, 5000)
    textbox(doc, p2, 1.5, 10.5, 16, TEXTS[1], text_size)
    image(doc, p2, 19.3, 9.8, 7.2, 5.4, PICS[1])

    if case != 'two':
        p3 = pages.insertNewByIndex(1)
        p3.Layout = 19
        set_text(p3.getByIndex(0), 'Образ жизни и питание', 24, title_font)
        if case == 'layout':
            # все картинки сверху, весь текст снизу
            image(doc, p3, 1.2, 3.6, 6.4, 4.8, PICS[2])
            image(doc, p3, 10.8, 3.6, 6.4, 4.8, PICS[3])
            image(doc, p3, 20, 3.6, 6.4, 4.8, PICS[4])
            textbox(doc, p3, 1, 10.5, 7.8, TEXTS[2], text_size)
            textbox(doc, p3, 9.6, 10.5, 8.4, TEXTS[3], text_size)
            textbox(doc, p3, 18.6, 10.5, 8.4, TEXTS[4], text_size)
        else:
            textbox(doc, p3, 1, 4.2, 7.8, TEXTS[2], text_size)
            image(doc, p3, 10.8, 3.6, 6.4, 4.8, PICS[2])
            textbox(doc, p3, 18.6, 4.2, 8.4, TEXTS[3], text_size)
            image(doc, p3, 1.2, 10.2, 6.4, 4.8, PICS[3])
            textbox(doc, p3, 9.6, 10.8, 8.4, TEXTS[4], text_size)
            image(doc, p3, 20, 10.2, 6.4, 4.8, PICS[4])
        if case == 'transition':
            p3.Effect = uno.Enum('com.sun.star.presentation.FadeEffect', 'FADE_FROM_LEFT')
    if case == 'four':
        p4 = pages.insertNewByIndex(2)
        p4.Layout = 19
        set_text(p4.getByIndex(0), 'Спасибо за внимание', 24)
    return doc


# Все макеты слайдов 2 и 3, которые встречаются в вариантах (см. LAYOUTS в src/tasks.js)
LAYOUTS2 = ['IT/IT', 'TI/IT', 'TI/TI', 'IT/TI']
LAYOUTS3 = ['ITI/TIT', 'III/TTT', 'TTT/III', 'TTI/IIT', 'ITT/TII', 'TIT/ITI', 'IIT/TTI']


def fill_grid(doc, page, layout, texts, pics):
    """Раскладывает картинки и тексты по сетке макета: ряды через «/», I — картинка, T — текст."""
    rows = layout.split('/')
    n = len(rows[0])
    xs = [1.5, 14.5] if n == 2 else [1, 10, 19]
    cell = 12 if n == 2 else 8
    iw, ih = (7.2, 5.4) if n == 2 else (6.4, 4.8)
    tops = [3.6, 9.8] if n == 2 else [3.6, 10.2]
    ti = pi = 0
    for ri, row in enumerate(rows):
        for ci, c in enumerate(row):
            if c == 'I':
                image(doc, page, xs[ci], tops[ri], iw, ih, pics[pi])
                pi += 1
            else:
                textbox(doc, page, xs[ci], tops[ri] + 0.6, cell - 0.4, texts[ti])
                ti += 1


def grid_presentation(l2, l3):
    doc = new_doc(desktop, 'simpress')
    pages = doc.DrawPages
    p1 = pages.getByIndex(0)
    p1.Width, p1.Height = 28000, 15750
    p1.Layout = 0
    set_text(p1.getByIndex(0), 'Бурый медведь', 40)
    set_text(p1.getByIndex(1), 'Участник ОГЭ 1234567890', 24)
    p2 = pages.insertNewByIndex(0)
    p2.Layout = 19
    set_text(p2.getByIndex(0), 'Внешний вид и ареал', 24)
    fill_grid(doc, p2, l2, TEXTS[:2], PICS[:2])
    p3 = pages.insertNewByIndex(1)
    p3.Layout = 19
    set_text(p3.getByIndex(0), 'Образ жизни и питание', 24)
    fill_grid(doc, p3, l3, TEXTS[2:], PICS[2:5])
    return doc


def make_layouts():
    for i, l3 in enumerate(LAYOUTS3):
        l2 = LAYOUTS2[i % len(LAYOUTS2)]
        doc = grid_presentation(l2, l3)
        save(doc, os.path.join(OUT, f"layout__{l2.replace('/', '-')}_{l3.replace('/', '-')}.odp"), 'impress8')
        doc.close(True)


def make_presentations():
    for case in ['ok', 'distorted', 'sizes', 'fonts', 'two', 'layout', 'overlap', 'four', 'transition']:
        doc = presentation(case)
        save(doc, os.path.join(OUT, f'bear__{case}.odp'), 'impress8')
        if case == 'ok':
            save(doc, os.path.join(OUT, f'bear__{case}.pptx'), 'Impress MS PowerPoint 2007 XML')
        doc.close(True)
    # Презентация на макетах LibreOffice «Заголовок, содержимое» без изменения размеров шрифта
    doc = new_doc(desktop, 'simpress')
    pages = doc.DrawPages
    p1 = pages.getByIndex(0)
    p1.Layout = 0
    p1.getByIndex(0).String = 'Бурый медведь'
    p1.getByIndex(1).String = 'Участник 12345'
    p2 = pages.insertNewByIndex(0)
    p2.Layout = 1
    p2.getByIndex(0).String = 'Внешний вид'
    p2.getByIndex(1).String = TEXTS[0] + '\n' + TEXTS[1]
    save(doc, os.path.join(OUT, 'bear__defaults.odp'), 'impress8')
    doc.close(True)


# =====================================================================
# 13.2 — текстовые документы
# =====================================================================

PARA_BREAK = 0
LEFT, RIGHT, BLOCK, CENTER = 0, 1, 2, 3

HEADING = 'ВАРЕНЬЕ ИЗ ЕЖЕВИКИ'
TABLE = [['Ингредиенты', 'Количество'], ['Ягоды ежевики', '1 кг'], ['Сахар', '1,1 кг'], ['Лимонная кислота', '0,25 ч. л.']]
TEXT = [
    ('Перебрать килограмм ', ''), ('ежевики', 'i'),
    (', удалить мятые ягоды и веточки. Высыпать плоды на дуршлаг, помыть и дать стечь воде. Засыпать сахарным песком, '
     'оставить на 4 часа. Поставить сахарно-плодовую смесь на плиту. Постоянно помешивая, довести до кипения и '
     'проварить 3 минуты. Дать остыть. Повторить процедуру 3 раза. В конце по вкусу добавить лимонную кислоту, '
     'разложить горячее ', ''),
    ('ежевичное варенье', 'bu'), (' по стерилизованным банкам, закатать банки.', ''),
]


def put(text, cur, s, marks='', size=14):
    cur.CharHeight = size
    cur.CharWeight = 150 if 'b' in marks else 100
    cur.CharPosture = uno.Enum('com.sun.star.awt.FontSlant', 'ITALIC' if 'i' in marks else 'NONE')
    cur.CharUnderline = 1 if 'u' in marks else 0
    text.insertString(cur, s, False)


def spacing(cur, prop):
    ls = uno.createUnoStruct('com.sun.star.style.LineSpacing')
    ls.Mode = 0
    ls.Height = prop
    cur.ParaLineSpacing = ls


def document(case):
    doc = new_doc(desktop, 'swriter')
    text = doc.Text
    cur = text.createTextCursor()
    size = 12 if case == '12pt' else 14
    # Заголовок
    cur.ParaAdjust = CENTER
    cur.ParaBottomMargin = 0 if case == 'empty' else 500
    cur.ParaTopMargin = 0
    cur.ParaFirstLineIndent = 0
    spacing(cur, 100)
    put(text, cur, HEADING, 'bu', size)
    text.insertControlCharacter(cur, PARA_BREAK, False)
    if case == 'empty':
        cur.ParaBottomMargin = 0
        put(text, cur, '', '', size)
        text.insertControlCharacter(cur, PARA_BREAK, False)
    cur.ParaBottomMargin = 0
    cur.ParaAdjust = BLOCK
    # Таблица вставляется перед текущим абзацем
    tbl = doc.createInstance('com.sun.star.text.TextTable')
    tbl.initialize(len(TABLE), 2)
    text.insertTextContent(cur, tbl, False)
    if case != 'fullwidth':
        tbl.HoriOrient = 2  # CENTER
        tbl.Width = 11000
    for r, row in enumerate(TABLE):
        for c, val in enumerate(row):
            cell = tbl.getCellByName('AB'[c] + str(r + 1))
            ct = cell.Text
            cc = ct.createTextCursor()
            cc.ParaAdjust = CENTER if (r == 0 or c == 1) else LEFT
            cc.ParaFirstLineIndent = 0
            put(ct, cc, val, 'bi' if r == 0 and case != 'fullwidth' else '', size)
    # Текст после таблицы
    cur.ParaTopMargin = 0 if case == 'empty' else 500
    cur.ParaAdjust = BLOCK
    spacing(cur, 115)
    if case == 'spaces':
        cur.ParaFirstLineIndent = 0
    else:
        cur.ParaFirstLineIndent = 1000
    if case == 'empty':
        put(text, cur, '', '', size)
        text.insertControlCharacter(cur, PARA_BREAK, False)
        cur.ParaTopMargin = 0
    parts = list(TEXT)
    if case == 'spaces':
        parts[0] = ('      Перибрать килограм ', '')
    if case == 'enter':
        # строки заканчиваются клавишей Enter
        flat = ''.join(s for s, _ in parts)
        words = flat.split(' ')
        lines = [' '.join(words[i:i + 9]) for i in range(0, len(words), 9)]
        for k, line in enumerate(lines):
            if k:
                text.insertControlCharacter(cur, PARA_BREAK, False)
                cur.ParaFirstLineIndent = 0
            put(text, cur, line, '', size)
    else:
        for s, m in parts:
            put(text, cur, s, m, size)
    return doc


def make_documents():
    for case in ['ok', 'empty', 'spaces', 'fullwidth', 'enter', '12pt']:
        doc = document(case)
        save(doc, os.path.join(OUT, f'demo__{case}.odt'), 'writer8')
        if case == 'ok':
            save(doc, os.path.join(OUT, f'demo__{case}.docx'), 'MS Word 2007 XML')
        doc.close(True)


if __name__ == '__main__':
    make_presentations()
    make_layouts()
    make_documents()
    print('Готово:', ', '.join(sorted(os.listdir(OUT))))
