import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Exchanges the `code` query param for a session via PKCE code exchange,
// then redirects into the app. With password-based auth this now serves
// email-confirmation links from signUp() (previously it served magic-link
// sign-ins) — same underlying mechanism, so no logic change was needed here,
// only this comment. Matches the redirect target configured via
// `emailRedirectTo` in src/lib/auth/actions.ts.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
