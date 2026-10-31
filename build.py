"""打包 Windows 版：python build.py → dist\\廚房SOP.exe"""
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "廚房SOP"


def main() -> None:
    subprocess.check_call([sys.executable, str(ROOT / "make_icons.py")])
    for d in ("build", "dist"):
        shutil.rmtree(ROOT / d / NAME, ignore_errors=True)
    subprocess.check_call([
        sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
        "--name", NAME,
        "--icon", str(ROOT / "app.ico"),
        "--add-data", f"{ROOT / 'web'};web",
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build"),
        "--specpath", str(ROOT / "build"),
        str(ROOT / "desktop" / "main.py"),
    ], cwd=ROOT)
    exe = ROOT / "dist" / f"{NAME}.exe"
    print(f"\n完成：{exe}  ({exe.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
