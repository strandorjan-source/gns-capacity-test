#!/usr/bin/env bash
# Public read-only UI checks. No real account or transport registrations.
set -euo pipefail
mkdir -p test-artifacts
browser() { agent-browser --session production-languages "$@"; }
trap 'browser close || true' EXIT
browser open https://gns-capacity-test.vercel.app/
browser wait --load networkidle
browser eval '(() => {const s=document.querySelector("#gns-language-select");if(!s||s.value!=="nb"||s.options.length!==9)throw Error("Language selector or Norwegian default missing");if(s.querySelector("option[value=pl]").textContent!=="Polski"||s.querySelector("option[value=lv]").textContent!=="Latviešu")throw Error("Native language labels missing");return "PASS"})()' | grep -q PASS
for language in nb en de fr da sv nl pl lv; do
  browser select '#gns-language-select' "$language"
  browser wait 150
  browser eval '(() => {const l=document.documentElement.lang;const titles={nb:"Velkommen til GNS Capacity",en:"Welcome to GNS Capacity",de:"Willkommen bei GNS Capacity",fr:"Bienvenue sur GNS Capacity",da:"Velkommen til GNS Capacity",sv:"Välkommen till GNS Capacity",nl:"Welkom bij GNS Capacity",pl:"Witamy w GNS Capacity",lv:"Laipni lūdzam GNS Capacity"};if(document.querySelector("h1").textContent!==titles[l])throw Error("Production language failed: "+l);return "PASS: "+l})()' | tee -a test-artifacts/production-languages.txt | grep -q PASS
  browser screenshot "test-artifacts/production-language-$language.png"
done
browser set viewport 390 844
for language in pl lv; do
  browser select '#gns-language-select' "$language"
  browser open https://gns-capacity-test.vercel.app/
  browser wait --load networkidle
  browser eval "(() => {if(document.documentElement.lang!=='$language'||document.querySelector('#gns-language-select').value!=='$language')throw Error('Production preference not remembered');const r=document.querySelector('#gns-language-select').getBoundingClientRect();if(r.right>window.innerWidth||r.left<0||document.documentElement.scrollWidth>window.innerWidth)throw Error('Mobile overflow');return 'PASS: remembered $language on mobile'})()" | tee -a test-artifacts/production-languages.txt | grep -q PASS
  browser screenshot "test-artifacts/production-language-mobile-$language.png"
done
browser errors | tee test-artifacts/production-language-errors.txt
! grep -Ei 'ReferenceError|TypeError|Hydration|Minified React error' test-artifacts/production-language-errors.txt
echo 'PASS: nine production languages, Norwegian default, Polish and Latvian remembered preferences and mobile layout.' | tee -a test-artifacts/production-languages.txt
