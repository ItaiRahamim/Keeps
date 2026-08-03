'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server Action: signs the current user out and redirects to /login.
 * Wire this up to a <form action={signOut}> or call it from a client
 * component via a thin server-action wrapper.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
