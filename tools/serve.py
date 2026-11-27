"""Preview the demo and the case study as they appear on baizakisaev.com.

The site is put together by the portfolio repository (nolimitbaiza/portfolio): the home page, the
posts and everything the pages share (styles, fonts, the header, the offline service worker) live
there, along with the server. This runs the portfolio's tools/serve.py with this checkout in place
of its copy of AI Grid Trader, so the files listed in publish.json are served from here and edits
show up on reload. A file that publish.json doesn't list is not served, just as on the live site.

Usage: python tools/serve.py [port]        (default 8600, then open http://localhost:8600/ai-grid-trader)
Needs: the portfolio checked out next to this repository, or its folder in the PORTFOLIO variable:
       git clone https://github.com/nolimitbaiza/portfolio ../portfolio
"""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORTFOLIO = Path(os.environ.get("PORTFOLIO", ROOT.parent / "portfolio")).resolve()
SERVER = PORTFOLIO / "tools" / "serve.py"

if not SERVER.is_file():
    sys.exit(f"The portfolio repository was not found at {PORTFOLIO}.\n"
             f"Clone it next to this one:  git clone https://github.com/nolimitbaiza/portfolio {ROOT.parent / 'portfolio'}\n"
             "or set PORTFOLIO to its folder.")
try:
    sys.exit(subprocess.call([sys.executable, str(SERVER), *sys.argv[1:], "--project", f"ai-grid-trader={ROOT}"]))
except KeyboardInterrupt:
    pass
