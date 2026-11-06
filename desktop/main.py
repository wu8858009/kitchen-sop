"""廚房 SOP 食譜及倍數計算系統 — Windows 桌面版（pywebview + WebView2，資料存 %APPDATA%\\KitchenSOP）"""
import base64
import ctypes
import datetime as dt
import functools
import json
import os
import sys
import threading
import time
import webbrowser
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

    def export_image(self, data_url, filename):
        """把標籤或照片存成圖片檔（PNG 或 JPG，依 data URL 而定）"""
        jpg = data_url.startswith("data:image/jpeg")
        ext, types = (".jpg", ("JPG 圖片 (*.jpg;*.jpeg)",)) if jpg else (".png", ("PNG 圖片 (*.png)",))
        docs = Path.home() / "Documents"
        res = _window.create_file_dialog(
            webview.FileDialog.SAVE,
            directory=str(docs if docs.exists() else Path.home()),
            save_filename=filename,
            file_types=types,
        )
        if not res:
            return ""
        path = Path(res[0] if isinstance(res, (list, tuple)) else res)
        if path.suffix.lower() not in ((".jpg", ".jpeg") if jpg else (".png",)):
            path = path.with_suffix(ext)
        path.write_bytes(base64.b64decode(data_url.split(",", 1)[1]))
        return str(path)

    def open_url(self, url):
        """WebView2 不能連藍牙／USB 印表機，標籤列印交給瀏覽器；只開自己的網站"""
        if not url.startswith("https://wu8858009.github.io/kitchen-sop/"):
            return False
        return webbrowser.open(url)

    def set_ime(self, mode):
        """輸入框取得焦點時切換輸入法：'zh' 中文、'en' 英數"""
        return _set_ime(mode == "zh")


# ---------------------------------------------------------------- 輸入法切換
# WebView2 的輸入框在另一個行程，不能直接用 ImmGetContext；改送 WM_IME_CONTROL 給焦點視窗的預設 IME 視窗，
# 微軟注音等新版輸入法也吃這個訊息。
_WM_IME_CONTROL = 0x0283
_IMC_GETCONVERSIONMODE, _IMC_SETCONVERSIONMODE, _IMC_GETOPENSTATUS, _IMC_SETOPENSTATUS = 0x1, 0x2, 0x5, 0x6
_IME_CMODE_NATIVE = 0x1
_WM_INPUTLANGCHANGEREQUEST = 0x0050
_ZH_LANGS = (0x0404, 0x0C04, 0x1404, 0x0804, 0x1004)  # 繁中台灣優先，其次香港、澳門、簡中


class _GUITHREADINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("hwndActive", ctypes.c_void_p),
                ("hwndFocus", ctypes.c_void_p), ("hwndCapture", ctypes.c_void_p), ("hwndMenuOwner", ctypes.c_void_p),
                ("hwndMoveSize", ctypes.c_void_p), ("hwndCaret", ctypes.c_void_p), ("rcCaret", ctypes.c_long * 4)]


def _focus_hwnd():
    u = ctypes.windll.user32
    u.GetForegroundWindow.restype = ctypes.c_void_p
    fg = u.GetForegroundWindow()
    if not fg:
        return None, 0
    tid = u.GetWindowThreadProcessId(ctypes.c_void_p(fg), None)
    gti = _GUITHREADINFO(cbSize=ctypes.sizeof(_GUITHREADINFO))
    if u.GetGUIThreadInfo(tid, ctypes.byref(gti)) and gti.hwndFocus:
        return gti.hwndFocus, tid
    return fg, tid


def _ime_send(hwnd, cmd, val=0):
    u, imm = ctypes.windll.user32, ctypes.windll.imm32
    imm.ImmGetDefaultIMEWnd.restype = ctypes.c_void_p
    ime = imm.ImmGetDefaultIMEWnd(ctypes.c_void_p(hwnd))
    if not ime:
        return None
    res = ctypes.c_size_t(0)
    ok = u.SendMessageTimeoutW(ctypes.c_void_p(ime), _WM_IME_CONTROL, ctypes.c_size_t(cmd), ctypes.c_ssize_t(val), 0x2, 300, ctypes.byref(res))
    return res.value if ok else None


def _set_ime(chinese):
    try:
        hwnd, tid = _focus_hwnd()
        if not hwnd:
            return False
        u = ctypes.windll.user32
        if chinese:
            # 目前不是中文鍵盤時，切到已安裝的中文輸入法
            u.GetKeyboardLayout.restype = ctypes.c_void_p
            cur = (u.GetKeyboardLayout(tid) or 0) & 0xFFFF
            if cur not in _ZH_LANGS:
                n = u.GetKeyboardLayoutList(0, None)
                arr = (ctypes.c_void_p * n)()
                u.GetKeyboardLayoutList(n, arr)
                hkls = [h for h in arr if h]
                zh = next((h for lang in _ZH_LANGS for h in hkls if h & 0xFFFF == lang), None)
                if zh:
                    u.PostMessageW(ctypes.c_void_p(hwnd), _WM_INPUTLANGCHANGEREQUEST, 0, ctypes.c_void_p(zh))
                    time.sleep(0.15)
        _ime_send(hwnd, _IMC_SETOPENSTATUS, 1)
        mode = _ime_send(hwnd, _IMC_GETCONVERSIONMODE) or 0
        mode = (mode | _IME_CMODE_NATIVE) if chinese else (mode & ~_IME_CMODE_NATIVE)
        _ime_send(hwnd, _IMC_SETCONVERSIONMODE, mode)
        return _ime_send(hwnd, _IMC_GETCONVERSIONMODE)
    except Exception:  # noqa: BLE001 - 切換失敗不影響輸入
        return False


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
        if os.environ.get("KITCHENSOP_IMETEST"):
            # 點進數字欄 → 英數；點進文字欄 → 中文（讀回 IME 的轉換模式，bit0 = 中文）
            ime = {}
            for name, js in (("mult_en", "document.querySelector('#mult').focus()"),
                             ("edit_name_zh", "location.hash='#/edit/'+window.__kitchen.db.recipes[0].id; setTimeout(()=>document.querySelector('[data-bind=\"name\"]').focus(),300)"),
                             ("edit_qty_en", "document.querySelector('[data-bind=\"ingredients.0.qty\"]').focus()"),
                             ("edit_step_zh", "document.querySelector('[data-bind=\"steps.0.text\"]').focus()")):
                _window.evaluate_js(js)
                time.sleep(1.2)
                hwnd, _ = _focus_hwnd()
                ime[name] = _ime_send(hwnd, _IMC_GETCONVERSIONMODE) if hwnd else None
            result["ime"] = ime
        _window.evaluate_js("location.hash='#/labels'")
        time.sleep(0.5)
        result["label_btns"] = _window.evaluate_js("[...document.querySelectorAll('.label-page .btn')].map(b => b.innerText)")
        result["label_api"] = _window.evaluate_js("[typeof window.pywebview.api.open_url, typeof window.pywebview.api.export_image]")
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
        APP_TITLE, url, js_api=Api(), min_size=(420, 560), text_select=True, maximized=True, **_fit_screen(),
    )
    selftest = os.environ.get("KITCHENSOP_SELFTEST")
    kwargs = dict(private_mode=False, storage_path=str(DATA_DIR / "webview"), gui="edgechromium")
    if selftest:
        webview.start(_selftest, (selftest,), **kwargs)
    else:
        webview.start(**kwargs)


if __name__ == "__main__":
    main()
