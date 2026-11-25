"""Record the silent demo loop on the home page's AI Grid Trader card.

It plays presenter mode on Germany's real prices: the market, the first buy and the first sell
(each explained), the rest of the 48 hours, the result, then the full year. One light and one
dark video, plus a still of each for the poster.

    python tools/serve.py &
    python tools/build_demo_loop.py [http://localhost:8600/]

Needs Playwright with Chromium (pip install playwright && playwright install chromium ffmpeg).
Frames come from Chromium's screencast and are encoded to VP9 WebM with the ffmpeg build that
Playwright installs, so nothing else is needed. Writes assets/video/demo-loop{,-dark}.webm and
assets/img/demo-loop{,-dark}.jpg.
"""
import glob
import os
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"
ROOT = Path(__file__).resolve().parent.parent
FPS = 25
SIZE = (1280, 720)           # CSS pixels: the presenter layout at 16:9
SCALE = 1.5                  # recorded at 1920x1080 so it stays sharp on high-resolution screens
# (seconds to hold, then the key that moves on); the trades step stops at the buy, then the sell.
SCRIPT = [(2.5, "ArrowRight"), (4.5, "ArrowRight"), (4.5, "ArrowRight"), (6.0, "ArrowRight"),
          (4.0, "ArrowRight"), (5.0, None)]
HIDE = ".stage-pick, .stage-keys, #stage-close, .stage-nav { visibility: hidden !important; }"


def ffmpeg():
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".cache")) / "ms-playwright"
    if not base.exists():
        base = Path.home() / ".cache" / "ms-playwright"
    found = sorted(glob.glob(str(base / "ffmpeg-*" / "ffmpeg*")))
    if not found:
        sys.exit("Playwright's ffmpeg is missing: run  playwright install ffmpeg")
    return found[-1]


def record(pw, scheme, suffix):
    # The screencast captures the browser window, so the window (not an emulated viewport) sets the size.
    browser = pw.chromium.launch(args=[f"--window-size={SIZE[0]},{SIZE[1]}", f"--force-device-scale-factor={SCALE}"])
    page = browser.new_context(no_viewport=True, color_scheme=scheme, reduced_motion="no-preference").new_page()
    # Presenter mode asks for full screen, which resizes a headless window: keep the window as it is.
    page.add_init_script("Element.prototype.requestFullscreen = () => Promise.resolve();"
                         "Element.prototype.webkitRequestFullscreen = () => {};")
    page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
    page.wait_for_timeout(2500)
    page.add_style_tag(content=HIDE)
    page.click("#btn-present")
    page.wait_for_timeout(1800)                       # let the first slide settle before recording
    # The poster is the first frame, so nothing jumps when playback starts.
    page.screenshot(path=str(ROOT / "assets" / "img" / f"demo-loop{suffix}.jpg"), type="jpeg", quality=80)

    frames = []                                       # (timestamp, jpeg bytes)
    cdp = page.context.new_cdp_session(page)

    def on_frame(ev):
        frames.append((ev["metadata"]["timestamp"], ev["data"]))
        cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})

    cdp.on("Page.screencastFrame", on_frame)
    cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92,
                                      "maxWidth": int(SIZE[0] * SCALE), "maxHeight": int(SIZE[1] * SCALE)})
    page.wait_for_timeout(200)
    for hold, key in SCRIPT:
        page.wait_for_timeout(int(hold * 1000))
        if key:
            page.keyboard.press(key)
    cdp.send("Page.stopScreencast")
    browser.close()

    # Screencast frames arrive only when the page repaints: hold each one until the next.
    import base64
    frames.sort()
    start = frames[0][0]
    total = sum(h for h, _ in SCRIPT)
    out = ROOT / "assets" / "video" / f"demo-loop{suffix}.webm"
    out.parent.mkdir(exist_ok=True)
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(FPS),
           "-i", "pipe:0", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-deadline", "good",
           "-cpu-used", "2", "-pix_fmt", "yuv420p", "-an", str(out)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    j = 0
    for n in range(int(total * FPS)):
        t = start + n / FPS
        while j + 1 < len(frames) and frames[j + 1][0] <= t:
            j += 1
        proc.stdin.write(base64.b64decode(frames[j][1]))
    proc.stdin.close()
    if proc.wait():
        sys.exit("ffmpeg failed")
    print(f"{out.relative_to(ROOT)}: {len(frames)} frames, {total:.1f} s, {out.stat().st_size / 1e6:.2f} MB")


with sync_playwright() as pw:
    record(pw, "light", "")
    record(pw, "dark", "-dark")
