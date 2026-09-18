#!/usr/bin/env bash
# Public, unauthenticated production checks. Never handles a user's password/token.
set -euo pipefail
mkdir -p test-artifacts
trap 'agent-browser --session production-smoke close || true' EXIT
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
const url='https://gns-capacity-test.vercel.app/api/health';
let last;
for(let i=0;i<45;i++) {
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(10000),cache:'no-store'});
    last={status:response.status};
    if(response.ok) {
      const health=await response.json(); last={...last,...health};
      if(health.configured && health.revision===process.env.GITHUB_SHA) {
        writeFileSync('test-artifacts/production-health.json',JSON.stringify(last,null,2));
        console.log('PASS production serves the expected commit:', health.revision);
        process.exit(0);
      }
    }
  } catch(e) {last={error:e.message};}
  await new Promise(resolve=>setTimeout(resolve,2000));
}
writeFileSync('test-artifacts/production-health.json',JSON.stringify(last,null,2));
throw new Error(`Production revision did not become ready: ${JSON.stringify(last)}`);
JS
agent-browser --session production-smoke open https://gns-capacity-test.vercel.app/
agent-browser --session production-smoke wait --load networkidle
agent-browser --session production-smoke snapshot -i | tee test-artifacts/production-login.txt
grep -q 'Logg inn med Microsoft' test-artifacts/production-login.txt
agent-browser --session production-smoke screenshot test-artifacts/production-login.png
agent-browser --session production-smoke find role button click --name 'Logg inn med Microsoft'
agent-browser --session production-smoke wait --url '**login.microsoftonline.com**'
agent-browser --session production-smoke eval '(() => {const u=new URL(location.href); if(u.hostname!=="login.microsoftonline.com") throw new Error("Microsoft login not reached"); const callback=u.searchParams.get("redirect_uri"); if(callback!=="https://lpovhfipxoeqqnfnipia.supabase.co/auth/v1/callback") throw new Error("Wrong Supabase callback"); const scopes=(u.searchParams.get("scope")||"").split(" "); if(!scopes.includes("email") || scopes.filter(s=>s==="openid").length!==1) throw new Error("Invalid OAuth scopes"); return JSON.stringify({host:u.hostname,callback,scopes,realMicrosoftLoginCompleted:false});})()' | tee test-artifacts/production-oauth-start.json
agent-browser --session production-smoke screenshot test-artifacts/microsoft-sign-in.png
echo 'PASS: production revision, rendered login, Microsoft redirect, callback and scopes.'
echo 'NOT TESTED: account credentials, Microsoft callback code exchange, authenticated production session.'
