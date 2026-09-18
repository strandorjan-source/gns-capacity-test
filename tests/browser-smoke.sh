#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-artifacts
trap 'agent-browser close || true' EXIT
agent-browser open http://localhost:3000/
agent-browser wait --load networkidle
agent-browser snapshot -i | tee test-artifacts/login.txt
grep -q 'Logg inn med Microsoft' test-artifacts/login.txt
agent-browser eval 'document.querySelector("[data-nextjs-dialog], .vite-error-overlay") ? "ERROR_OVERLAY" : "OK"' | grep -q 'OK'
agent-browser screenshot test-artifacts/login.png
agent-browser open 'http://localhost:3000/?error=server_error&error_description=test-provider-code'
agent-browser wait --load networkidle
agent-browser get text body | tee test-artifacts/oauth-query-error.txt
grep -q 'Microsoft-innloggingen kunne ikke fullføres' test-artifacts/oauth-query-error.txt
! grep -q 'test-provider-code' test-artifacts/oauth-query-error.txt
agent-browser screenshot test-artifacts/oauth-error.png
agent-browser open 'http://localhost:3000/#error=access_denied&error_description=test-provider-code'
agent-browser wait --load networkidle
agent-browser get text body | tee test-artifacts/oauth-fragment-error.txt
grep -q 'avbrutt eller avvist' test-artifacts/oauth-fragment-error.txt
! grep -q 'test-provider-code' test-artifacts/oauth-fragment-error.txt
curl --fail --silent http://localhost:3000/api/health | tee test-artifacts/health.json
node -e 'const h=JSON.parse(require("fs").readFileSync("test-artifacts/health.json")); if(!h.configured || h.service!=="gns-capacity") process.exit(1)'
echo 'PASS: login UI, query/fragment OAuth error recovery, no provider-code leakage, configuration health.'
echo 'NOT TESTED HERE: real Microsoft authentication, live Supabase session, production Vercel URL.'
