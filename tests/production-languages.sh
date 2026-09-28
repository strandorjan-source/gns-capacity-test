#!/usr/bin/env bash
# Public read-only UI checks. No real account or transport registrations.
set -euo pipefail
mkdir -p test-artifacts
browser() { agent-browser --session production-languages "$@"; }
trap 'browser close || true' EXIT
browser open https://gns-capacity-test.vercel.app/
browser wait --load networkidle
browser eval '(() => {const s=document.querySelector("#gns-language-select");if(!s||s.value!=="nb"||s.options.length!==7)throw Error("Language selector or Norwegian default missing");return "PASS"})()' | grep -q PASS
for language in nb en de fr da sv nl; do
  browser select '#gns-language-select' "$language"
  browser wait 150
  browser eval '(() => {const l=document.documentElement.lang;const titles={nb:"Velkommen til GNS Capacity",en:"Welcome to GNS Capacity",de:"Willkommen bei GNS Capacity",fr:"Bienvenue sur GNS Capacity",da:"Velkommen til GNS Capacity",sv:"Välkommen till GNS Capacity",nl:"Welkom bij GNS Capacity"};if(document.querySelector("h1").textContent!==titles[l])throw Error("Production language failed: "+l);return "PASS: "+l})()' | tee -a test-artifacts/production-languages.txt | grep -q PASS
  browser screenshot "test-artifacts/production-language-$language.png"
done
browser open https://gns-capacity-test.vercel.app/
browser wait --load networkidle
browser eval '(() => {if(document.documentElement.lang!=="nl"||document.querySelector("#gns-language-select").value!=="nl")throw Error("Production preference not remembered");return "PASS: language remembered"})()' | tee -a test-artifacts/production-languages.txt | grep -q PASS
browser set viewport 390 844
browser screenshot test-artifacts/production-language-mobile.png
browser errors | tee test-artifacts/production-language-errors.txt
! grep -Ei 'ReferenceError|TypeError|Hydration|Minified React error' test-artifacts/production-language-errors.txt
echo 'PASS: seven production languages, Norwegian default, remembered preference.' | tee -a test-artifacts/production-languages.txt
