import time
import shutil
from pathlib import Path
from datetime import datetime
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except ImportError:
    ZoneInfo = None

# Local OneDrive paths
BASE_DIR = Path(r"C:\Users\tyamashita\OneDrive - GEOLABS, INC\Edward Shinsato's files - DAILY DRILL SCHEDULE")
TODAY_DIR = BASE_DIR / "_Today's Schedule"
OUTPUT_FILE = TODAY_DIR / "latest.pdf"

CHECK_SECONDS = 60  # how often to check (seconds)

def hawaii_today():
    if ZoneInfo:
        now_hst = datetime.now(ZoneInfo("Pacific/Honolulu"))
    else:
        now_hst = datetime.now()  # assume local clock is already Hawaii time
    return now_hst.strftime("%Y.%m.%d")

def find_todays_pdf():
    if ZoneInfo:
        now_hst = datetime.now(ZoneInfo("Pacific/Honolulu"))
    else:
        now_hst = datetime.now()
    month_folder = now_hst.strftime("%B %Y")
    mf = BASE_DIR / month_folder
    if not mf.is_dir():
        return None
    fname = f"{hawaii_today()}.pdf"
    candidate = mf / fname
    return candidate if candidate.exists() else None

def find_newest_pdf():
    newest = None
    newest_mtime = -1
    for sub in BASE_DIR.iterdir():
        if sub.is_dir() and sub.name != "_Today's Schedule":
            for p in sub.glob("*.pdf"):
                try:
                    m = p.stat().st_mtime
                    if m > newest_mtime:
                        newest, newest_mtime = p, m
                except FileNotFoundError:
                    pass
    return newest

def publish(src: Path):
    TODAY_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUTPUT_FILE.with_suffix(".pdf.tmp")
    if tmp.exists():
        tmp.unlink()
    shutil.copy2(src, tmp)
    if OUTPUT_FILE.exists():
        OUTPUT_FILE.unlink()
    tmp.replace(OUTPUT_FILE)

def main_loop():
    print(f"Watching: {BASE_DIR}")
    print("Updating _Today's Schedule/latest.pdf every time a new file is found...")
    last_src = None
    while True:
        try:
            src = find_todays_pdf()
            if not src:
                src = find_newest_pdf()
            if src and (not last_src or src.resolve() != last_src):
                publish(src)
                last_src = src.resolve()
                print(f"[{datetime.now()}] Published: {src.name}")
        except Exception as e:
            print("Error:", e)
        time.sleep(CHECK_SECONDS)

if __name__ == "__main__":
    main_loop()
