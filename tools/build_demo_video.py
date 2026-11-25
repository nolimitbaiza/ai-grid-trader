"""Record the short looping clip of the AI trading two days in Germany, shown in the case study instead
of a still picture (wide screens only; phones keep the still). The home page's project card has its own
loop of presenter mode (tools/build_demo_loop.py).

Writes, per theme:
  assets/video/chart-replay.webm / chart-replay-dark.webm   VP9 video, no sound
  assets/img/chart-replay.jpg    / chart-replay-dark.jpg    its last frame, the still
and docs/demo.gif, a smaller light-theme GIF for the README.

How: the demo's auto-play replays the 48 hours (two 15-minute steps every 90 ms). The page runs on
Playwright's fake clock, so each frame is captured after exactly one step of the replay: the clip
is smooth and the same on every run, however slow the machine.

Usage: serve the repo locally (python tools/serve.py), then
       python tools/build_demo_video.py [http://localhost:8600/]
Needs: pip install playwright pillow && python -m playwright install chromium ffmpeg
       (Playwright's own ffmpeg build encodes the VP9 video.)
"""
import glob
import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8600/"
FPS = 18
HOLD_START, HOLD_END = 0.6, 2.8           # seconds on the empty chart and on the finished result
WIDTH, HEIGHT, SCALE = 1180, 700, 1.5     # about the width and scale of tools/build_project_shot.py


def ffmpeg():
    pattern = os.path.expanduser("~/AppData/Local/ms-playwright/ffmpeg-*/ffmpeg-win64.exe") if os.name == "nt" \
        else os.path.expanduser("~/.cache/ms-playwright/ffmpeg-*/ffmpeg-linux")
    found = sorted(glob.glob(pattern)) or sorted(glob.glob(os.path.expanduser("~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac")))
    if not found:
        sys.exit("Playwright's ffmpeg not found: run  python -m playwright install ffmpeg")
    return found[-1]


def record(pw, scheme):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=SCALE,
                            color_scheme=scheme, service_workers="block")
    page.clock.install()                     # time still flows until it is paused below
    page.goto(URL + "ai-grid-trader#p=de", wait_until="networkidle")
    # A picture of the demo, not of a kiosk: no QR banner, header or scrollbar.
    page.add_style_tag(content="""
        body.kiosk .kiosk-banner, .site-header { display: none !important; }
        html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }
        /* The annual return arrives at the end; on one line it doesn't push the chart down mid-clip. */
        .kpi .sub { white-space: nowrap; }""")
    # The full-year simulation (Web Workers) supplies the annual return in the last frame.
    page.wait_for_function("!document.getElementById('stack').classList.contains('pending')", timeout=180000)
    page.clock.pause_at(page.evaluate("Date.now()") + 1000)
    page.keyboard.press("k")                 # start auto-play on Germany, frozen at its first frame
    page.clock.run_for(50)
    page.wait_for_function("document.body.classList.contains('kiosk')")

    def clip():
        chart = page.locator("#chart-main").bounding_box()
        top = page.locator("#kpis").bounding_box()
        return {"x": chart["x"], "y": top["y"] - 4, "width": chart["width"], "height": chart["y"] + chart["height"] - top["y"] + 4}

    box = clip()
    frames = []
    shot = lambda: Image.open(io.BytesIO(page.screenshot(clip=box, type="png"))).convert("RGB")
    first = shot()
    frames += [first] * round(HOLD_START * FPS)
    page.clock.run_for(1200)                 # auto-play waits 1.2 s before the first step
    for _ in range(96):                      # 192 steps, two per tick
        frames.append(shot())
        page.clock.run_for(90)
    if abs(clip()["y"] - box["y"]) > 1 or abs(clip()["height"] - box["height"]) > 1:
        sys.exit("the layout moved during the replay: the clip would cut it off")
    final = shot()
    frames += [final] * round(HOLD_END * FPS)
    browser.close()
    return frames


def encode(frames, out):
    # Playwright's ffmpeg build reads files only (no pipes), so the frames go through an MJPEG file.
    w, h = frames[0].size
    w2, h2 = w - w % 2, h - h % 2
    stream = Path(tempfile.gettempdir()) / f"{out.stem}.mjpeg"
    with open(stream, "wb") as fh:
        for f in frames:
            f.save(fh, "JPEG", quality=95)
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", str(stream),
           "-vf", f"crop={w2}:{h2}:0:0", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "36", "-row-mt", "1",
           "-pix_fmt", "yuv420p", "-an", str(out)]
    result = subprocess.run(cmd)
    stream.unlink()
    if result.returncode:
        sys.exit("ffmpeg failed")


with sync_playwright() as pw:
    for scheme, suffix in (("light", ""), ("dark", "-dark")):
        frames = record(pw, scheme)
        video = ROOT / "assets" / "video" / f"chart-replay{suffix}.webm"
        encode(frames, video)
        poster = ROOT / "assets" / "img" / f"chart-replay{suffix}.jpg"
        frames[-1].save(poster, "JPEG", quality=86, optimize=True, progressive=True)
        print(f"wrote {video.relative_to(ROOT)} ({video.stat().st_size // 1024} KB), {poster.relative_to(ROOT)} "
              f"{frames[-1].size[0]} x {frames[-1].size[1]}")
        if scheme == "light":
            # README GIF: 800 px wide, every other frame, one shared palette.
            small = [f.resize((800, round(800 * f.size[1] / f.size[0])), Image.LANCZOS) for f in frames[::2]]
            pal = small[-1].quantize(colors=128, method=Image.Quantize.MEDIANCUT)
            gif_frames = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in small]
            gif = ROOT / "docs" / "demo.gif"
            gif_frames[0].save(gif, save_all=True, append_images=gif_frames[1:], duration=round(2000 / FPS), loop=0, optimize=True)
            print(f"wrote {gif.relative_to(ROOT)} ({gif.stat().st_size // 1024} KB)")
