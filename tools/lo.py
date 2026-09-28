# Подключение к LibreOffice через UNO. Запускать питоном из комплекта LibreOffice:
#   "C:\Program Files\LibreOffice\program\python.exe" tools\make_fixtures.py

import os
import subprocess
import time

import uno
from com.sun.star.beans import PropertyValue

SOFFICE = r'C:\Program Files\LibreOffice\program\soffice.exe'
PORT = 2083


def prop(name, value):
    p = PropertyValue()
    p.Name = name
    p.Value = value
    return p


def connect():
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    url = f'uno:socket,host=127.0.0.1,port={PORT};urp;StarOffice.ComponentContext'
    try:
        ctx = resolver.resolve(url)
    except Exception:
        profile = uno.systemPathToFileUrl(os.path.join(os.environ.get('TEMP', '.'), 'oge13-lo-profile'))
        subprocess.Popen([SOFFICE, '--headless', '--invisible', '--nologo', '--norestore',
                          f'-env:UserInstallation={profile}',
                          f'--accept=socket,host=127.0.0.1,port={PORT};urp;'])
        for _ in range(60):
            time.sleep(1)
            try:
                ctx = resolver.resolve(url)
                break
            except Exception:
                pass
        else:
            raise RuntimeError('LibreOffice не запустился')
    global CTX
    CTX = ctx
    return ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)


CTX = None


def load_graphic(path):
    provider = CTX.ServiceManager.createInstanceWithContext('com.sun.star.graphic.GraphicProvider', CTX)
    return provider.queryGraphic((prop('URL', uno.systemPathToFileUrl(os.path.abspath(path))),))


def new_doc(desktop, kind):
    return desktop.loadComponentFromURL(f'private:factory/{kind}', '_blank', 0, (prop('Hidden', True),))


def save(doc, path, flt):
    url = uno.systemPathToFileUrl(os.path.abspath(path))
    doc.storeToURL(url, (prop('FilterName', flt),))
