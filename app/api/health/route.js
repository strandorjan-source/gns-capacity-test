export const dynamic = 'force-dynamic';
export function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  // Presence and deployed revision only; this is not an OAuth/database health assertion.
  return Response.json({ service: 'gns-capacity', configured, revision: process.env.VERCEL_GIT_COMMIT_SHA || null }, { status: configured ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
