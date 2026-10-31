"""廚房 SOP 食譜及倍數計算系統 — Windows 桌面版（pywebview + WebView2，資料存 %APPDATA%\\KitchenSOP）"""
import ctypes
import datetime as dt
import functools
import json
import os
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import webview

APP_TITLE = "廚房 SOP 食譜及倍數計算系統"

if getattr(sys, "frozen", False):
    WEB_DIR = Path(sys._MEIPASS) / "web"
else:
    WEB_DIR = Path(__file__).resolve().parent.parent / "web"

DATA_DIR = Path(os.environ.get("KITCHENSOP_DATA") or Path(os.environ.get("APPDATA", Path.home())) / "KitchenSOP")
DATA_FILE = DATA_DIR / "data.json"
BACKUP_DIR = DATA_DIR / "backups"
KEEP_BACKUPS = 30

_window = None


class Api:
    """給網頁呼叫的介面（window.pywebview.api.*）"""

    def load(self):
        if not DATA_FILE.exists():
            return ""
        return DATA_FILE.read_text(encoding="utf-8")

    def save(self, text):
        try:
            json.loads(text)  # 不寫入損壞的內容
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = DATA_FILE.with_suffix(".tmp")
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, DATA_FILE)
            _daily_backup(text)
            return True
        except Exception as e:  # noqa: BLE001 - 錯誤訊息回傳給網頁顯示
            return f"{type(e).__name__}: {e}"

    def data_path(self):
        return str(DATA_FILE)

    def export_file(self, text, filename):
        docs = Path.home() / "Documents"
        res = _window.create_file_dialog(
            webview.FileDialog.SAVE,
            directory=str(docs if docs.exists() else Path.home()),
            save_filename=filename,
            file_types=("JSON 備份 (*.json)",),
        )
        if not res:
            return ""
        path = Path(res[0] if isinstance(res, (list, tuple)) else res)
        if path.suffix.lower() != ".json":
            path = path.with_suffix(".json")
        path.write_text(text, encoding="utf-8")
        return str(path)


def _daily_backup(text):
    """每天保留一份資料快照，最多 KEEP_BACKUPS 份"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    (BACKUP_DIR / f"data_{dt.date.today():%Y%m%d}.json").write_text(text, encoding="utf-8")
    for old in sorted(BACKUP_DIR.glob("data_*.json"))[:-KEEP_BACKUPS]:
        old.unlink(missing_ok=True)


class _QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def log_message(self, *args):  # --windowed 時沒有 stderr
        pass


def _serve_web():
    """只綁本機的靜態伺服器；資料存在檔案，不依賴網頁來源，所以用隨機埠即可"""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(_QuietHandler, directory=str(WEB_DIR)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/index.html?desktop=1"


def _single_instance():
    if os.environ.get("KITCHENSOP_DATA"):
        return True  # 測試用的獨立資料夾不受限制
    ctypes.windll.kernel32.CreateMutexW(None, False, "KitchenSOP_SingleInstance")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        ctypes.windll.user32.MessageBoxW(None, "程式已經在執行中。", APP_TITLE, 0x40)
        return False
    return True


def _selftest(out_path):
    """KITCHENSOP_SELFTEST=<結果檔>：啟動後自動操作畫面、寫出結果並關閉"""
    result = {"ok": False}
    try:
        _window.events.loaded.wait(30)
        n = -1
        for _ in range(100):
            n = _window.evaluate_js("window.__kitchen && window.__kitchen.db ? window.__kitchen.db.recipes.length : -1")
            if n is not None and n >= 0:
                break
            time.sleep(0.2)
        result["recipes"] = n
        time.sleep(0.5)
        result["cards"] = _window.evaluate_js("document.querySelectorAll('#list .rcard').length")
        _window.evaluate_js("location.hash = '#/r/' + window.__kitchen.db.recipes[0].id")
        time.sleep(0.4)
        _window.evaluate_js("document.querySelector('[data-act=mult][data-v=\"2\"]').click()")
        time.sleep(0.3)
        result["first_row"] = _window.evaluate_js("document.querySelector('#ing tr:not(.grp)').innerText")
        result["data_path"] = str(DATA_FILE)
        time.sleep(3)  # 有設定雲端時等同步完成
        result["names"] = _window.evaluate_js("window.__kitchen.db.recipes.map(r => r.name)")
        result["sync"] = _window.evaluate_js("JSON.stringify(window.__kitchen.db.sync)")
        result["file_exists"] = DATA_FILE.exists()
        result["window"] = [_window.x, _window.y, _window.width, _window.height]
        result["ok"] = bool(result["names"]) and result["file_exists"]
    except Exception as e:  # noqa: BLE001
        result["error"] = repr(e)
    Path(out_path).write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    _window.destroy()


def _fit_screen(margin=24):
    """依螢幕工作區（扣掉工作列）決定視窗大小，並置中；單位為邏輯像素"""
    try:
        s = webview.screens[0]
        wa = s.frame  # WorkingArea，與 s.width 同單位
        w, h = max(420, wa.Width - margin * 2), max(560, wa.Height - margin * 2)
        return dict(width=w, height=h, x=wa.X + (wa.Width - w) // 2, y=wa.Y + (wa.Height - h) // 2)
    except Exception:  # noqa: BLE001
        return dict(width=1200, height=760)


def main():
    global _window
    if not _single_instance():
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    url = _serve_web()
    _window = webview.create_window(
        APP_TITLE, url, js_api=Api(), min_size=(420, 560), text_select=True, **_fit_screen(),
    )
    selftest = os.environ.get("KITCHENSOP_SELFTEST")
    kwargs = dict(private_mode=False, storage_path=str(DATA_DIR / "webview"), gui="edgechromium")
    if selftest:
        webview.start(_selftest, (selftest,), **kwargs)
    else:
        webview.start(**kwargs)


if __name__ == "__main__":
    main()
