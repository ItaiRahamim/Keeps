import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for use in Server Components, Route Handlers, and Server
 * Actions. Must be created fresh on every request (never module-level
 * singleton) — it closes over the current request's cookie jar.
 *
 * Next.js 16 has no synchronous `cookies()` fallback, so this factory is
 * async and must be awaited by callers: `const supabase = await createClient()`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // `setAll` was called from a Server Component render, which
            // cannot set cookies. This is safe to ignore as long as `proxy.ts`
            // is also refreshing the session on every request.
          }
        },
      },
    }
  );
}
