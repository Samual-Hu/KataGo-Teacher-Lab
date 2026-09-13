#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
REV=d5ad1c0423dba989c60a2f06b1848e7eec2b5941
if [ ! -d upstream ]; then
  git clone https://github.com/saigo-online/katago-webgpu.git upstream
  git -C upstream checkout "$REV"
fi
test "$(git -C upstream rev-parse HEAD)" = "$REV"
python3 scripts/patch-engine.py
MT=1 bash upstream/scripts/build-eval.sh
mkdir -p site/engine
cp upstream/web/demo/kataeval-mt.* site/engine/
cp upstream/LICENSE site/engine/LICENSE
python3 - <<'PY'
import hashlib,json,pathlib
p=pathlib.Path('site/engine')
manifest={'upstream':'saigo-online/katago-webgpu','revision':'d5ad1c0423dba989c60a2f06b1848e7eec2b5941','researchABI':1,'files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in p.glob('kataeval-mt.*')}}
(p/'manifest.json').write_text(json.dumps(manifest,indent=2))
PY
