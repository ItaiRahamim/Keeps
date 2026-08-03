'use client';

import {
  isAuthApiError,
  isAuthWeakPasswordError,
  type AuthError,
} from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export type AuthResult =
  | { status: 'signed_in' }
  | { status: 'check_email' } // signUp succeeded but requires email confirmation before a session exists
  | { status: 'error'; message: string };

/** Same fallback pattern the old magic-link login page used. */
function emailRedirectTo(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
  return `${siteUrl}/auth/callback`;
}

/**
 * Turns a raw Supabase auth error into a message a user can act on.
 *
 * `error.code` (stable, documented at supabase.com/docs/guides/auth/debugging/error-codes)
 * is preferred over `error.message` (free text meant for logs) wherever a
 * code exists — see the SDK's own guidance in GoTrueClient's signInWithPassword
 * jsdoc: "The error.code ... is often more useful for branching than
 * error.message".
 */
function describeAuthError(error: AuthError): string {
  if (isAuthWeakPasswordError(error)) {
    const hints: string[] = [];
    if (error.reasons.includes('length')) hints.push('be at least 6 characters long');
    if (error.reasons.includes('characters')) hints.push('use a wider mix of characters');
    if (error.reasons.includes('pwned')) {
      hints.push("not be a password that's appeared in a known data breach");
    }
    return hints.length > 0
      ? `That password is too weak — it needs to ${hints.join(' and ')}.`
      : error.message || 'That password is too weak. Please choose a stronger one.';
  }

  if (isAuthApiError(error)) {
    switch (error.code) {
      // Only reached when this project has "Confirm email" (and "Confirm
      // phone") disabled, in which case Supabase itself chooses to disclose
      // the duplicate rather than obfuscate it — see the anti-enumeration
      // handling in signUpWithPassword below for the opposite case.
      case 'user_already_exists':
      case 'email_exists':
        return 'An account with this email already exists. Try signing in instead.';

      case 'invalid_credentials':
        return 'Incorrect email or password.';

      case 'email_not_confirmed':
        return 'Please confirm your email address before signing in — check your inbox for the confirmation link.';

      case 'email_address_invalid':
        return 'Please enter a valid email address.';

      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'Too many attempts. Please wait a moment and try again.';

      case 'signup_disabled':
      case 'email_provider_disabled':
        return 'Sign-ups are currently disabled.';

      default:
        return error.message || 'Something went wrong. Please try again.';
    }
  }

  return error.message || 'Something went wrong. Please try again.';
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { status: 'error', message: describeAuthError(error) };
  }

  if (!data.session) {
    // Not expected for signInWithPassword on success, but guard anyway.
    return { status: 'error', message: 'Something went wrong. Please try again.' };
  }

  return { status: 'signed_in' };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: emailRedirectTo() },
  });

  if (error) {
    return { status: 'error', message: describeAuthError(error) };
  }

  if (data.session) {
    // "Confirm email" is disabled on this project — signUp() already signed the user in.
    return { status: 'signed_in' };
  }

  // No session and no error. Two distinct situations produce exactly this
  // shape, and Supabase makes them deliberately indistinguishable:
  //  1. A genuinely new signup, pending email confirmation.
  //  2. Signing up with an email that's already registered *and confirmed*
  //     (with "Confirm email" and "Confirm phone" both enabled on this
  //     project): the API returns a success response containing an
  //     obfuscated/fake user object — `data.user.identities` is an empty
  //     array, vs. populated for a real new identity — specifically so a
  //     caller can't tell the two apart and leak which emails are registered.
  // We return the same `check_email` result for both on purpose: branching
  // on the empty-identities signal here would reintroduce exactly the
  // enumeration leak Supabase's server just went out of its way to prevent.
  return { status: 'check_email' };
}
