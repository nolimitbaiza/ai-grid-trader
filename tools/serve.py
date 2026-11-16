"""Local web server with the same clean URLs as the live site (Caddyfile):
/ is the home page and /ai-grid-trader serves ai-grid-trader.html.

Usage: python tools/serve.py [port]        (default 8600, serves the repository folder)
"""
import http.server
import os
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8600


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        local = super().translate_path(path)
        if not os.path.exists(local) and os.path.exists(local + ".html"):
            return local + ".html"
        return local

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), partial(Handler, directory=str(ROOT)))
    print(f"Serving {ROOT} on http://localhost:{PORT}/", flush=True)
    server.serve_forever()
