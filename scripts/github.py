"""Use Git Credential Manager in memory. Never print or persist credentials."""
import subprocess, os, json, urllib.request, sys
p = subprocess.run(['git','credential','fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True,
                   env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'})
d = dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
token = d.get('password')
if not token: raise SystemExit('No GitHub credential available. Sign in with Git Credential Manager.')
method, path = sys.argv[1:3]
body = json.loads(sys.argv[3]) if len(sys.argv)>3 else None
req = urllib.request.Request('https://api.github.com/'+path, data=json.dumps(body).encode() if body is not None else None,
    method=method, headers={'Authorization':'Bearer '+token,'User-Agent':'KataGo-Teacher-Lab','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
try:
    with urllib.request.urlopen(req) as res:
        data=res.read().decode()
        print(data or res.status)
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()); sys.exit(1)
