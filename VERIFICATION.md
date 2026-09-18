# GNS Capacity verification — 18 September 2026

## Verified against the existing Supabase project

Migration `20260918135618_capacity_realtime_revocation_and_vehicle_integrity` was applied to the existing GNS Cargo Ordre database. No order tables or existing users were changed. Twenty-four SQL assertions passed under the actual `authenticated` database role with synthetic test identities. The entire test transaction was rolled back; no test accounts or vehicles were retained.

The checks covered: Admin approval; protection against removing own admin access; Admin and Dispatcher visibility; anonymous denial; registration normalization; duplicate plates across carriers; carrier isolation; denied cross-carrier editing; denied carrier reservation; pending-user isolation, registration denial and self-elevation denial; pending profile completion; Dispatcher inability to grant admin access; server-controlled reservation actor/time; reserve and release; stale-status protection; stale-version/ABA protection; denied deletion and editing of reserved vehicles; immediate loss of vehicle visibility after revocation; and both Capacity tables in the realtime publication.

Supabase security advisors were also run. No Capacity-specific warnings were returned. Existing warnings on the separate order-system functions and global leaked-password protection remain outside the scope of this change.

## Verified locally

`node --test tests/capacity.test.mjs`: 15 tests passed. JSX files were syntax-checked using the installed TypeScript parser. This is not a production build or a real OAuth login test.

## Automated build/browser checks

The `Capacity checks` GitHub Actions workflow installs the existing locked dependencies, runs unit tests, compiles the production application and uses pinned `agent-browser` to verify the rendered login screen and query/fragment OAuth error recovery. CI uses deliberately non-working Supabase credentials. Passing CI does NOT prove real Microsoft authentication, live Supabase sessions or a Vercel production deployment. Consult the workflow run for its actual outcome; creation of a workflow is not a passed run.

## Outstanding production verification

The connected Vercel service returned empty project lists for both GNS Cargo teams, and a direct lookup of the previously provided project ID returned 404. The deployment action failed input validation because its exposed schema did not provide the parameters required by its backend. The production URL could not be fetched. No authenticated Cloud Browser session was available in the execution environment.

The Microsoft provider secret/tenant configuration and Supabase Auth URL allowlist were not accessible through the connected database tools and have NOT been changed or verified. The frontend now requests Azure login with PKCE, scopes `email profile`, and the current app origin followed by `/`. Production Supabase Auth must explicitly allow `https://gns-capacity-test.vercel.app/`. The Azure app's Web callback must be the existing Supabase project's `/auth/v1/callback`, not the frontend URL. The client secret must be the secret VALUE, not its identifier.

Before marking production complete, obtain working deployment access, verify provider configuration, deploy the tested commit, then run real Microsoft sign-in, new-user approval, isolated Carrier access, registration, Dispatcher reservation/release, revocation and sign-out on the production domain. Do not report production as complete based only on database or mocked browser checks.

Official setup references:
- https://supabase.com/docs/guides/auth/social-login/auth-azure
- https://supabase.com/docs/guides/auth/redirect-urls
