"""A tiny standard-library web server: static page plus two JSON endpoints.

    GET  /                 the page
    GET  /api/baseline     the swept live-share reference run
    POST /api/run          body: a target rule -> that rule's run
"""

import json
import os
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from .experiment import get_baseline, load_scenario, run_challenger
from .scenario import ScenarioConfig

WEB_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web"
)


class Handler(SimpleHTTPRequestHandler):
    scenario = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, fmt, *args):  # quieter console
        if any("/api/" in str(arg) for arg in args):
            super().log_message(fmt, *args)

    def do_GET(self):
        if self.path.startswith("/api/baseline"):
            return self._json(get_baseline(self.scenario))
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/run"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        try:
            payload = run_challenger(self.scenario, body)
        except ValueError as exc:
            return self._json({"error": str(exc)}, status=400)
        return self._json(payload)

    def _json(self, payload, status=200):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def serve(port=8000, open_browser=True, config=None):
    Handler.scenario = load_scenario(config or ScenarioConfig())
    print("Building the baseline run (first time only)...")
    get_baseline(Handler.scenario)

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"\n  AOA toy model running at {url}\n  Press Ctrl+C to stop.\n")
    if open_browser:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.server_close()
