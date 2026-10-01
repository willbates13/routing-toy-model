#!/usr/bin/env bash
# Create the virtual environment and install the one dependency.
set -euo pipefail
cd "$(dirname "$0")"

PY=${PYTHON:-python3}
$PY -m venv .venv
./.venv/bin/pip install --quiet --upgrade pip
./.venv/bin/pip install --quiet -r requirements.txt

echo "Done. Start it with:  ./run.sh"
