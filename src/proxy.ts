import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Next.js 16 renamed `middleware.ts` -> `proxy.ts` and the exported function
// `middleware` -> `proxy`. See node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md.
export async function proxy(request: NextRequest) {
  // `supabaseResponse` is re-created every time `setAll` runs below, so that
  // any refreshed auth cookies from Supabase are copied onto the *response*
  // object that's actually returned (not just the incoming request).
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // @supabase/ssr 0.12.x requires the getAll/setAll pair — the old
        // get/set/remove triple from pre-0.9 examples does not satisfy this
        // version's types and will not refresh sessions correctly.
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not add any logic between createServerClient and this call
  // — it refreshes the session and must run before any redirect decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/auth');

  // Unauthenticated users are redirected to /login from anywhere else in the
  // app (the spec calls out "/" specifically, but the whole corkboard lives
  // under "/", so protecting all non-auth routes is the correct generalization).
  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Authenticated users hitting /login are bounced back to the board.
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip Next internals, the PWA files (manifest, service worker, icons),
    // and common static file extensions.
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif|css|js)$).*)',
  ],
};
