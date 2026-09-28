#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-artifacts
browser() { agent-browser --session i18n-smoke "$@"; }
trap 'browser close || true' EXIT
browser open http://localhost:3000/
browser wait --load networkidle
browser eval 'localStorage.removeItem("gns-capacity-language")'
browser open http://localhost:3000/
browser wait --load networkidle
browser eval '(() => {const s=document.querySelector("#gns-language-select");if(!s||s.value!=="nb"||s.options.length!==7)throw Error("Default or options");return "PASS"})()' | grep -q PASS
for language in nb en de fr da sv nl; do
  browser select '#gns-language-select' "$language"
  browser wait 150
  browser eval '(() => {const l=document.documentElement.lang;const titles={nb:"Velkommen til GNS Capacity",en:"Welcome to GNS Capacity",de:"Willkommen bei GNS Capacity",fr:"Bienvenue sur GNS Capacity",da:"Velkommen til GNS Capacity",sv:"Välkommen till GNS Capacity",nl:"Welkom bij GNS Capacity"};if(document.querySelector("h1").textContent!==titles[l])throw Error("Login not translated: "+l);return "PASS"})()' | grep -q PASS
  browser screenshot "test-artifacts/language-login-$language.png"
done
browser open http://localhost:3000/i18n-check
browser wait --load networkidle
browser eval '(() => {if(document.documentElement.lang!=="nl")throw Error("Preference lost on navigation");return "PASS"})()' | grep -q PASS
browser select '#gns-language-select' en
browser fill 'input[placeholder="Company name"]' 'Carrier I18N Test'
browser eval 'window.__fixtureValues=JSON.stringify([...document.querySelectorAll("#fixture-form input,#fixture-form select,#fixture-form textarea")].map(e=>e.value)); "Saved fixture inputs"'
for language in nb en de fr da sv nl; do
  browser select '#gns-language-select' "$language"
  browser wait 150
  browser eval '(() => {const l=document.documentElement.lang;const labels={nb:"Meld inn ledig bil",en:"Register available vehicle",de:"Verfügbares Fahrzeug melden",fr:"Déclarer un véhicule disponible",da:"Tilmeld ledig bil",sv:"Anmäl ledigt fordon",nl:"Beschikbaar voertuig aanmelden"};if(document.querySelector("#fixture-form form button").textContent!==labels[l])throw Error("Form button not translated: "+l);const values=JSON.stringify([...document.querySelectorAll("#fixture-form input,#fixture-form select,#fixture-form textarea")].map(e=>e.value));if(values!==window.__fixtureValues)throw Error("Language changed entered values");const sels=[...document.querySelectorAll("#fixture-form select")];if(!sels.some(s=>s.value==="Sideåpning og bakdører")||!sels.some(s=>s.value==="Utlandet"))throw Error("Database enums changed");if(document.querySelector(".vehicle-table tbody td:nth-child(2) b").textContent!=="Ledig")throw Error("Carrier name translated");if(document.querySelector(".vehicle-table .multiline").textContent!=="Sideåpning")throw Error("User comment translated");return "PASS"})()' | grep -q PASS
  browser screenshot "test-artifacts/language-form-$language.png"
done
browser eval 'document.querySelector("#fixture-form form").requestSubmit()'
browser wait 150
browser eval '(() => {const p=JSON.parse(document.querySelector("#fixture-saved").textContent);if(p.registration!=="TEST88"||p.trailer_number!=="TR-123"||p.carrier!=="Carrier I18N Test"||p.vehicle_type!=="Termo"||p.door_type!=="Sideåpning og bakdører"||p.loading_region!=="Utlandet"||p.available_at!=="2026-10-10T06:30:00.000Z")throw Error("Incorrect saved payload");return "PASS"})()' | grep -q PASS
browser fill 'input[placeholder="Bedrijfsnaam"]' ''
browser eval 'document.querySelector("#fixture-form form").requestSubmit()'
browser wait 150
browser eval '(() => {if(document.querySelector("input[placeholder=Bedrijfsnaam]").validationMessage!=="Vul dit veld in.")throw Error("Required-field message not translated");return "PASS"})()' | grep -q PASS
browser set viewport 390 844
browser open http://localhost:3000/
browser wait --load networkidle
browser eval '(() => {if(document.documentElement.lang!=="nl"||document.querySelector("#gns-language-select").value!=="nl")throw Error("Preference not persisted");const r=document.querySelector("#gns-language-select").getBoundingClientRect();if(r.right>window.innerWidth||r.left<0)throw Error("Mobile selector overflow");return "PASS"})()' | grep -q PASS
browser screenshot test-artifacts/language-mobile.png
browser errors | tee test-artifacts/language-browser-errors.txt
! grep -Ei 'ReferenceError|TypeError|Hydration|Minified React error' test-artifacts/language-browser-errors.txt
printf '%s\n' 'PASS: seven login languages, seven carrier form languages, stable form values and database enums, unmodified carrier text, registration payload, Norwegian timezone, translated required validation, persistent preference, mobile selector.' | tee test-artifacts/i18n-result.txt
