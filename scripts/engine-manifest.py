import hashlib,json,pathlib
p=pathlib.Path('site/engine')
manifest={'upstream':'saigo-online/katago-webgpu','revision':'d5ad1c0423dba989c60a2f06b1848e7eec2b5941','researchABI':1,'patchSha256':hashlib.sha256(pathlib.Path('scripts/patch-engine.py').read_bytes()).hexdigest(),'emscripten':'6.0.1','files':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in p.glob('kataeval-mt.*')}}
(p/'manifest.json').write_text(json.dumps(manifest,indent=2))
