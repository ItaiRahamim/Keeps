import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Exchanges the `code` query param from the magic-link email for a session,
// then redirects into the app. Matches the redirect target configured in
// `emailRedirectTo` in src/app/login/page.tsx.
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
