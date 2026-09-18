# GNS Capacity verification — 18 September 2026

## Live database

The existing GNS Cargo Ordre project has received the migrations `20260918135618_capacity_realtime_revocation_and_vehicle_integrity` and `20260918141623_capacity_verified_profile_identity`. Scope is the two Capacity tables; existing order tables/users were not changed. Twenty-four SQL assertions passed under the actual authenticated database role, followed by two identity/verified-email assertions. Synthetic identities, profiles and vehicles were fully rolled back. Cleanup was checked: zero retained test users, zero vehicles and the original four Capacity profiles.

Verified: Admin approval and all-vehicle visibility; Dispatcher all-vehicle visibility and reserve/release; Carrier isolation; pending-user isolation and profile completion; prevention of self-approval, self-elevation, spoofed email, stale reservations and duplicate normalized plates; server-controlled reservation actor/time; immutable vehicle ownership; deletion/editing protection for reserved vehicles; immediate loss of read access on revocation; and realtime publication for both tables.

## Production and browser verification

Commit `081a91246a42403ffe2157e3a0299608041c971e` passed GitHub Actions run `35355053105`, including npm ci, 15 unit tests, production compilation, rendered browser checks and a public production probe. `https://gns-capacity-test.vercel.app/api/health` returned HTTP 200, configured=true and that exact commit SHA. Browser verification showed the Microsoft login button; clicking it reached `login.microsoftonline.com` with callback `https://lpovhfipxoeqqnfnipia.supabase.co/auth/v1/callback` and exactly `openid email profile` scopes. These results are in the workflow's `capacity-check-evidence` artifact. The first browser run found a same-document error-fragment bug; it was fixed and the rerun passed.

The Vercel connector itself returns empty project lists/404 errors and its direct deployment action has a schema mismatch. Deployment nevertheless works through the existing GitHub integration, confirmed by Vercel's successful GitHub commit status and the independent production HTTP/browser checks. No authenticated Cloud Browser session was available; automated Chromium checks ran in GitHub Actions.

## Remaining verification and security work

No real Microsoft account credentials were entered. Successful Microsoft authorization-code exchange and the resulting authenticated production browser session are NOT verified. The Azure client secret and tenant settings cannot be read or changed through the available database tools and were not modified. Production cancellation/return testing is being added; consult its actual run before claiming that check passed.

npm audit detected one critical and two high dependency findings on the original Next.js 16.1.6 dependency tree and recommended Next.js 16.3.5. A separate read-only workflow prepares and tests that exact candidate and uploads its package/lock files for review. The candidate is not installed in production merely because that workflow exists; final package files must be committed and the subsequent production revision tested.

Supabase security advisors returned no Capacity-specific findings. Existing warnings concerning separate order-system SECURITY DEFINER functions and global leaked-password protection remain outside this change's scope. References:
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Before marking the entire solution complete, perform a real Microsoft sign-in and verify authenticated profile approval, registration, cross-carrier isolation, reservation/release and revocation in the production browser. Database tests and fake-credential local UI smoke tests alone are not end-to-end Microsoft authentication evidence.
