export const dynamic = 'force-dynamic';
export function GET() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  // Configuration presence only, not an assertion that OAuth or the database works.
  return Response.json({ service: 'gns-capacity', configured }, { status: configured ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
