#!/usr/bin/env bash
# Build the current uncommitted patch locally, without changing the pristine upstream checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
WORKSPACE="$PWD"
BUILD="$HOME/.cache/katago-teacher-local-build"
mkdir -p "$BUILD/scripts" "$BUILD/site"
tar --exclude=upstream/.git --exclude=upstream/cpp/build-wasm -cf - upstream | tar -C "$BUILD" -xf -
cp scripts/patch-engine.py "$BUILD/scripts/"
cd "$BUILD"
python3 - <<'PY'
from pathlib import Path
for p in Path('upstream/cpp/kataeval').glob('sources*.txt'):
    p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n'))
PY
python3 scripts/patch-engine.py
EMSDK_DIR="$HOME/.cache/katago-research-emsdk" MT=1 bash upstream/scripts/build-eval.sh
mkdir -p "$WORKSPACE/site/engine"
cp upstream/web/demo/kataeval-mt.* "$WORKSPACE/site/engine/"
cp upstream/LICENSE "$WORKSPACE/site/engine/LICENSE"
cd "$WORKSPACE"
python3 scripts/engine-manifest.py
