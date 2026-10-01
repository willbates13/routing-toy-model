"""Entry point: start the interactive page.

    python main.py            # serve on http://127.0.0.1:8000
    python main.py --port 8080 --no-browser
"""

import argparse

from aoa.server import serve


def main():
    p = argparse.ArgumentParser(description="AOA toy model")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--no-browser", action="store_true")
    args = p.parse_args()
    serve(port=args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
