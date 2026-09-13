import fs from 'node:fs';import crypto from 'node:crypto';
for(const f of ['index.html','app.js','style.css','core.js','engine-worker.js','coi-serviceworker.js','engine/kataeval-mt.js','engine/kataeval-mt.wasm','engine/manifest.json'])if(!fs.existsSync('site/'+f))throw Error('Missing deploy artifact: '+f);
const m=JSON.parse(fs.readFileSync('site/engine/manifest.json','utf8'));for(const [f,hash] of Object.entries(m.files))if(crypto.createHash('sha256').update(fs.readFileSync('site/engine/'+f)).digest('hex')!==hash)throw Error('Engine checksum mismatch: '+f);
console.log('Static site and engine hashes verified.');
