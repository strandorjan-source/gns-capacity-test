# Capacity update — 21 September 2026

Added separate Ledige biler / Reserverte biler tabs and a Ledigdato dropdown (plus Alle datoer). The date and search selection persist across tab switches; counts follow those filters. History has its own date selection. Date matching uses Europe/Oslo. The selected date remains visible if a live update removes the last matching vehicle.

Approved carriers can now edit their own nondeleted vehicles, including reserved vehicles. The same form and optimistic updated_at conflict check used by admin are reused. Only vehicle details are submitted. The database still rejects changes to owner, reservation status, booking actor/time/comment and deletion of reserved vehicles; every accepted edit is audited.

Validation:
- 34 logic/rendered-component checks passed, including status/date/search combinations, Norwegian midnight, own/other/deleted/reserved editing controls and accessible filter markup.
- Next.js production compilation passed locally using webpack with the unchanged installed dependency tree.
- Migration `20260921134554_capacity_carrier_vehicle_edit` applied to GNS Cargo Ordre.
- Transactional integration suite passed against the live database as authenticated admin, dispatcher, isolated carriers and revoked/pending users. Added reserved/free carrier edits, preserved booking data, audit attribution and denial of owner/booking tampering. All test fixtures rolled back.
- No new Capacity security advisor findings. Existing shared order-system and global auth findings remain as documented below.

The user explicitly authorized GitHub upload and production publication on 21 September 2026. The earlier automatic approval block is resolved. Production deployment and CI can be verified against this commit in GitHub/Vercel. The Cloud Browser is at the public login page without an authenticated account, so this session does not claim an authenticated production browser test.

---

# Capacity update — 19 September 2026

Implemented admin vehicle editing, recoverable deletion/restore, automatic Norwegian-calendar-day history, explicit rear/side door types, reservation actor name/email/time and optional load comments, plus a protected event log. Same plate may be entered on different dates; a duplicate on the same Norwegian date is rejected. Existing door types remain unknown unless previously explicit. Existing reservations are imported with their recorded actor/time; earlier actions cannot be reconstructed.

Validation before deployment:
- 28 Node checks passed (22 logic tests and six rendered-component tests), including Norwegian date boundaries, door validation, payload ownership/booking protection and preserving booking fields during editing.
- Next.js production build passed.
- Transactional database integration checks in `supabase/tests/capacity_history_booking.sql` passed for admin, dispatcher, two isolated carriers, pending/revoked users and anonymous access. Tested registration, current/past dates, duplicates, door validation, reservation attribution/time spoof protection, immutable comments, edit audit, stale writes, release, recoverable deletion/restore and audit write denial. All fixtures rolled back.
- Production database retains its four original vehicles and two reservations. Both reservation names/emails are populated. No test identities remain.
- No new Capacity advisor findings. Shared order-system and global auth warnings listed below are unchanged.

Successful Microsoft login and authenticated production UI interactions have not been verified in this session. Production revision `30da2a8a566739bbb8233d20899da69a8baf5c09` returned configured=true and Vercel success. The production login page rendered without application console errors. This confirms public deployment, not an authenticated browser test. The subsequent verification commit also clears open dialogs/logs when roles change.

---

# GNS Capacity verification — 18 September 2026

## Live database

The existing GNS Cargo Ordre project received migrations `20260918135618_capacity_realtime_revocation_and_vehicle_integrity` and `20260918141623_capacity_verified_profile_identity`. Only Capacity tables were changed. Twenty-four SQL assertions passed under the authenticated database role, followed by two verified-email identity assertions. Test identities/profiles/vehicles were rolled back. Cleanup was checked: zero retained test users, zero vehicles, original four Capacity profiles.

Verified: Admin approval and all-vehicle visibility; Dispatcher visibility and reserve/release; Carrier isolation; pending-user isolation and profile completion; prevention of self-approval, self-elevation, spoofed email, stale reservations and duplicate normalized plates; server-controlled reservation actor/time; immutable ownership; protection of reserved vehicles; immediate loss of read access on revocation; realtime enabled for both tables.

## Deployment and browser evidence

Commit `081a91246a42403ffe2157e3a0299608041c971e` passed GitHub Actions `35355053105`: 15 unit tests, production compilation, rendered browser checks and a production probe. The production health endpoint returned HTTP 200, configured=true and that exact SHA. Clicking the rendered login button reached Microsoft with callback `https://lpovhfipxoeqqnfnipia.supabase.co/auth/v1/callback` and scopes `openid email profile`.

The following commit `7ba65fa973e7edbccf5fcde1db8b6695294ac697` also deployed and passed these checks. Its extended cancellation-return test timed out after navigating to the Supabase callback. This is NOT a passed full OAuth roundtrip. The next test revision captures sanitized failure diagnostics. Consult actual workflow results, not this file alone, before marking a revision fully tested.

Vercel's connector returns empty project lists/404 errors, but the existing GitHub deployment integration works, independently confirmed by production revision checks. No authenticated Cloud Browser session was available. Chromium browser checks ran through agent-browser in GitHub Actions.

## Security dependency update

The original Next.js 16.1.6 tree had three npm audit findings (one critical, two high). Next.js 16.3.5 was prepared in workflow `35355509944`; its exact registry-generated dependency tree passed npm audit with zero findings, all 15 unit tests, production compilation and local browser smoke tests. The reviewed package files are now committed, with a formatting-only minification of the lockfile. CI enforces the audit rather than suppressing failures. A subsequent production revision check is still required for each deployment.

## Not yet verified

No real Microsoft credentials were entered. Successful authorization-code exchange and an authenticated production browser session remain unverified. The database currently contains no Azure-linked identities. The Azure secret/tenant and Supabase Auth redirect configuration were not accessible through the connected database tools and were not changed. The cancellation-return failure still requires diagnosis; do not infer that redirect allowlisting works merely from the outgoing Microsoft URL.

Before declaring the whole solution complete, verify real Microsoft sign-in, profile approval, plate registration, Carrier isolation, Dispatcher reserve/release and revocation in the production browser.

Supabase advisors returned no Capacity-specific findings. Pre-existing shared-order-system SECURITY DEFINER warnings and global leaked-password protection remain outside this change's scope:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
