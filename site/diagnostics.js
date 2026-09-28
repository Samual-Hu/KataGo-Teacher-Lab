// Shared by classic Workers and the module UI. Error properties are often non-enumerable.
(() => {
  function describe(value, seen=new WeakSet(), depth=0) {
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:String(value);
    if(typeof value!=='object')return String(value);
    if(seen.has(value))return '[Circular]';
    if(depth>8)return '[Nested diagnostic omitted; inspect original exception in Console]';
    seen.add(value);
    if(Array.isArray(value))return value.map(v=>describe(v,seen,depth+1));
    const result={};
    try {result.constructorName=value.constructor?.name;} catch {}
    const keys=new Set(['name','message','stack','cause','error','reason','code','type','filename','lineno','colno']);
    try {for(const k of Object.getOwnPropertyNames(value))keys.add(k);} catch {}
    for(const key of keys)try {if(value[key]!==undefined&&typeof value[key]!=='function')result[key]=describe(value[key],seen,depth+1);}catch(e){result[key]='[Unreadable property: '+String(e)+']';}
    return result;
  }
  function report(error,context={}) {
    const exception=describe(error);
    const nested=exception?.error??exception?.reason??exception?.cause;
    let message=nested?.message||exception?.message||(typeof exception==='string'?exception:JSON.stringify(exception));
    if(/\[object (Object|ErrorEvent)\]/.test(message??''))message='原生线程异常：浏览器未提供异常正文，请查看运行时日志、文件位置和异常属性';
    return {message:message||'Unknown exception; inspect diagnostic details',exception,context:describe(context),reportedAt:new Date().toISOString()};
  }
  globalThis.KataDiagnostics={describe,report};
})();
