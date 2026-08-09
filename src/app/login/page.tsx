'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithPassword,
  signUpWithPassword,
  type AuthResult,
} from '@/lib/auth/actions';
import Pushpin from '@/components/pushpin/Pushpin';
import '@/components/corkboard/cork-texture.css';
import '@/components/polaroid/polaroid.css';
import './login.css';

type Mode = 'sign_in' | 'sign_up';
type Status = 'idle' | 'loading' | 'check_email' | 'error';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSignUp = mode === 'sign_up';

  function toggleMode() {
    setMode((current) => (current === 'sign_in' ? 'sign_up' : 'sign_in'));
    setStatus('idle');
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage(null);

    const result: AuthResult = isSignUp
      ? await signUpWithPassword(email, password)
      : await signInWithPassword(email, password);

    if (result.status === 'error') {
      setStatus('error');
      setErrorMessage(result.message);
      return;
    }

    if (result.status === 'check_email') {
      setStatus('check_email');
      return;
    }

    // 'signed_in' — nudge into the app immediately rather than leaving the
    // user on a stale login screen; proxy.ts also handles this on next nav.
    router.push('/');
    router.refresh();
  }

  return (
    <main className="login-page cork-texture">
      {/* A large Polaroid pinned to the corkboard (design-system.md §9) —
          same off-white card, asymmetric chin padding, and exact
          --shadow-polaroid token as every media Polaroid on the board,
          plus the real <Pushpin> component, so /login reads as part of the
          same physical corkboard rather than a generic app screen. */}
      <div className="login-polaroid">
        <Pushpin color="red" position="top" />
        <div className="polaroid-body">
          <div className="login-polaroid-photo">
            {status === 'check_email' ? (
              <div className="login-sent">
                <p className="login-sent-title">Confirm your email</p>
                <p className="login-sent-body">
                  We sent a confirmation link to <strong>{email}</strong>. Open
                  it on this device to finish creating your account.
                </p>
              </div>
            ) : (
              <>
                <h1 className="login-heading">
                  {isSignUp ? 'Create your memokeeps account' : 'Sign in to memokeeps'}
                </h1>
                <p className="login-subheading">
                  {isSignUp
                    ? 'Save your family memories in one place'
                    : 'Welcome back'}
                </p>
                <form onSubmit={handleSubmit} className="login-form">
                  <label className="login-field">
                    Email
                    <input
                      type="email"
                      name="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="login-input"
                    />
                  </label>
                  <label className="login-field">
                    Password
                    <input
                      type="password"
                      name="password"
                      required
                      autoComplete={isSignUp ? 'new-password' : 'current-password'}
                      placeholder={isSignUp ? 'Create a password' : 'Your password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="login-input"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="login-submit"
                  >
                    {status === 'loading'
                      ? isSignUp
                        ? 'Signing up…'
                        : 'Signing in…'
                      : isSignUp
                        ? 'Sign up'
                        : 'Log in'}
                  </button>
                  {status === 'error' && errorMessage ? (
                    <p className="login-error">{errorMessage}</p>
                  ) : null}
                </form>
                <p className="login-toggle">
                  {isSignUp
                    ? 'Already have an account?'
                    : "Don't have an account?"}{' '}
                  <button
                    type="button"
                    className="login-toggle-button"
                    onClick={toggleMode}
                  >
                    {isSignUp ? 'Log in' : 'Sign up'}
                  </button>
                </p>
              </>
            )}
          </div>

          <div className="polaroid-chin">
            <span>memokeeps</span>
          </div>
        </div>
      </div>
    </main>
  );
}
