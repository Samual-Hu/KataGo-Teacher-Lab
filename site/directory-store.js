const name='katago-teacher-output';
function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('handles');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function rememberDirectory(handle){const d=await db();await new Promise((resolve,reject)=>{const t=d.transaction('handles','readwrite');t.objectStore('handles').put(handle,'last');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});}
export async function lastDirectory(){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction('handles').objectStore('handles').get('last');r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});}
