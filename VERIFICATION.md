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
