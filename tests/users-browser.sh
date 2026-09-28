#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-artifacts
ab() { agent-browser --session admin-removal "$@"; }
trap 'ab close || true' EXIT
ab open http://localhost:3000/users-check
ab wait --load networkidle
ab snapshot -i > test-artifacts/users-initial.txt
ab eval '(() => {if(document.querySelectorAll(".userrow").length!==5)throw Error("Removed user visible");for(const id of ["admin","active"])if(document.querySelector(`[data-user-id=${id}] button[aria-label^="Slett "]`))throw Error("Active or self deletion shown");if(document.querySelectorAll("button[aria-label^=\"Slett \"]").length!==3)throw Error("Inactive delete buttons missing");return "PASS"})()' | grep -q PASS
ab click '[aria-label="Slett Pending Request"]'
ab eval '(() => {if(!document.querySelector("dialog[open]"))throw Error("No confirmation");if(JSON.parse(document.querySelector("#users-fixture-state").textContent).calls!==0)throw Error("Deleted before confirmation");return "PASS"})()' | grep -q PASS
ab screenshot test-artifacts/users-confirmation.png
ab press Escape
ab eval '(() => {if(document.querySelector("dialog[open]")||JSON.parse(document.querySelector("#users-fixture-state").textContent).calls!==0)throw Error("Cancel unsafe");return "PASS"})()' | grep -q PASS
ab click '[aria-label="Slett Pending Request"]'
ab find role button click --name 'Bekreft sletting'
ab wait 100
ab eval '(() => {const s=JSON.parse(document.querySelector("#users-fixture-state").textContent);if(s.calls!==1||s.count!==6||!s.removed.includes("pending")||document.querySelector("[data-user-id=pending]"))throw Error("Pending removal failed");return "PASS"})()' | grep -q PASS
ab find role button click --name 'Simulate database failure'
ab click '[aria-label="Slett Revoked User"]'
ab find role button click --name 'Bekreft sletting'
ab wait 100
ab eval '(() => {if(!document.querySelector("dialog[open] .formerror")||!document.querySelector("[data-user-id=revoked]"))throw Error("Error caused false deletion");return "PASS"})()' | grep -q PASS
ab find role button click --name 'Bekreft sletting'
ab wait 100
ab eval '(() => {if(document.querySelector("[data-user-id=revoked]")||JSON.parse(document.querySelector("#users-fixture-state").textContent).calls!==3)throw Error("Retry or revoked removal failed");return "PASS"})()' | grep -q PASS
ab click '[data-user-id=active] .user-actions button'
ab click '[aria-label="Slett Active User"]'
ab find role button click --name 'Bekreft sletting'
ab wait 100
ab find role button click --name 'Simulate concurrent approval'
ab click '[aria-label="Slett Race Request"]'
ab find role button click --name 'Bekreft sletting'
ab wait 100
ab eval '(() => {const s=JSON.parse(document.querySelector("#users-fixture-state").textContent);if(s.calls!==5||s.removed.includes("stale")||!document.querySelector("dialog[open] .formerror"))throw Error("Concurrent approval not protected");return "PASS"})()' | grep -q PASS
ab press Escape
ab find role button click --name 'Oppdater'
ab wait 100
ab eval '(() => {if(document.querySelector("[aria-label=\"Slett Race Request\"]"))throw Error("Fresh active row still deletable");return "PASS"})()' | grep -q PASS
ab set viewport 390 844
ab screenshot test-artifacts/users-mobile.png
ab eval '(() => {for(const e of document.querySelectorAll(".users button,.users select")){const r=e.getBoundingClientRect();if(r.right>innerWidth||r.left<0)throw Error("Mobile controls overflow");}return "PASS"})()' | grep -q PASS
ab find role button click --name 'Show removed access'
for language in nb en de fr da sv nl; do
  ab select '#gns-language-select' "$language"
  ab wait 100
  ab eval '(() => {const names={nb:"Tilgangen er fjernet",en:"Access removed",de:"Zugriff entfernt",fr:"Accès supprimé",da:"Adgangen er fjernet",sv:"Åtkomsten har tagits bort",nl:"Toegang verwijderd"};if(document.querySelector("h1").textContent!==names[document.documentElement.lang]||document.querySelector("form"))throw Error("Removed screen not localized or allows reapplication");return "PASS"})()' | grep -q PASS
done
ab errors > test-artifacts/users-browser-errors.txt
! grep -Ei 'ReferenceError|TypeError|Hydration|Minified React error' test-artifacts/users-browser-errors.txt
echo 'PASS: confirmed removal, Escape cancellation, pending/revoked users, revoke-then-delete, server error retry, concurrent approval, unchanged fixture identities, mobile controls, seven removed-access languages.' | tee test-artifacts/users-result.txt
