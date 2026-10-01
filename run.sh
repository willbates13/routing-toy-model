#!/usr/bin/env bash
# Start the page. Creates the virtual environment first if it is missing.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x ./.venv/bin/python ]; then
  echo "No virtual environment yet - running setup..."
  ./setup.sh
fi

exec ./.venv/bin/python main.py "$@"
