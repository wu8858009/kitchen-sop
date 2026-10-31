"""由 web/icons/icon.svg 產生 PWA 用 PNG 與 Windows 用 .ico"""
import sys
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parent
ICONS = ROOT / "web" / "icons"


def render(size: int, pad: float = 0.0, bg=None) -> QImage:
    img = QImage(size, size, QImage.Format_ARGB32)
    img.fill(bg if bg is not None else Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    m = int(size * pad)
    QSvgRenderer(str(ICONS / "icon.svg")).render(p, (img.rect().adjusted(m, m, -m, -m)).toRectF())
    p.end()
    return img


def main() -> None:
    QGuiApplication.instance() or QGuiApplication(sys.argv)
    render(192).save(str(ICONS / "icon-192.png"))
    render(512).save(str(ICONS / "icon-512.png"))
    render(180).save(str(ICONS / "apple-touch-icon.png"))
    sizes = [16, 24, 32, 48, 64, 128, 256]
    try:
        from PIL import Image
        big = ROOT / "build" / "icon-256.png"
        big.parent.mkdir(exist_ok=True)
        render(256).save(str(big))
        Image.open(big).save(ROOT / "app.ico", sizes=[(s, s) for s in sizes])
    except ImportError:
        render(256).save(str(ROOT / "app.ico"))
    print("icons ok")


if __name__ == "__main__":
    main()
