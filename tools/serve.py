"""Local web server that behaves like the live site (see Caddyfile): clean URLs, so / is the
home page and /ai-grid-trader serves ai-grid-trader.html, and unknown addresses get 404.html.

Usage: python tools/serve.py [port]        (default 8600, serves the repository folder)
"""
import http.server
import io
import os
import re
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

    def send_head(self):
        # Byte ranges, as Caddy sends them: browsers can only seek a video that the server serves in parts.
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        local = self.translate_path(self.path)
        if not match or not os.path.isfile(local) or match.group(1) == match.group(2) == "":
            return super().send_head()
        size = os.path.getsize(local)
        first, last = match.groups()
        start = int(first) if first else max(size - int(last), 0)
        end = min(int(last), size - 1) if first and last else size - 1
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        with open(local, "rb") as f:
            f.seek(start)
            body = f.read(end - start + 1)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(local))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return io.BytesIO(body)

    def send_error(self, code, message=None, explain=None):
        page = Path(self.directory) / "404.html"
        if code != 404 or not page.exists():
            return super().send_error(code, message, explain)
        body = page.read_bytes()
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), partial(Handler, directory=str(ROOT)))
    print(f"Serving {ROOT} on http://localhost:{PORT}/", flush=True)
    server.serve_forever()
