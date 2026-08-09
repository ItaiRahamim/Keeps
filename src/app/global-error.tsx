'use client';

// Root-layout error boundary (Next.js App Router convention). `error.tsx`
// does NOT cover exceptions thrown by `layout.tsx` itself (only the page
// segment and below) — this is the only boundary that can catch those, and
// it must render its own <html>/<body> since it fully replaces the root
// layout while active. Without this file, an exception thrown while
// rendering the root layout (fonts, metadata, etc.) had literally nothing
// to catch it and would blank the entire app with no signal.
//
// STYLING NOTE: per Next's own docs (node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/error.md — "Good to know: global-error
// ... render[s] [its] own document and do[es] not include your global
// styles, so an app-level theme ... won't reach [it]. ... apply it inside
// your own global-error component"), this file has NO access to globals.css,
// the `--color-*`/`--shadow-*` theme tokens, or the next/font variables set
// on <html> by the real root layout — none of that renders when this file
// is active. Colors/shadow below are literal copies of design-system.md's
// documented "Pinned Keeps" palette (cork-tan board, off-white polaroid
// paper, the exact --shadow-polaroid value, pin-teal accent) so this still
// reads as the same physical design language rather than a generic crash
// screen, even though it can't reference the tokens themselves. Font is a
// plain system stack (no next/font available here either) — this is exactly
// `--font-ui`'s own fallback chain, so it degrades to the intended look
// anyway.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" style={{ colorScheme: 'light' }}>
      <body style={{ margin: 0, background: '#b8865b' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            boxSizing: 'border-box',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: 640,
              width: '100%',
              boxSizing: 'border-box',
              background: '#FDFBF7',
              color: '#3a2f22',
              padding: '1.5rem',
              boxShadow: '2px 8px 15px rgba(0,0,0,0.4)',
            }}
          >
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              memokeeps hit an unrecoverable error
            </h1>
            <p style={{ fontSize: '0.9rem', opacity: 0.75, margin: '0 0 1rem' }}>
              The root layout itself failed to render. Real error below (note: if this
              originated in a Server Component, production builds redact the message and
              only the digest below is reliable — match it against server logs):
            </p>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                textAlign: 'left',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                background: 'rgba(58,47,34,0.07)',
                border: '1px solid rgba(58,47,34,0.18)',
                margin: 0,
                padding: '0.75rem',
                borderRadius: 6,
                fontSize: '0.8rem',
                lineHeight: 1.5,
              }}
            >
              {error.message || '(no error message)'}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: '1rem',
                padding: '0.5rem 1.1rem',
                borderRadius: 6,
                border: 'none',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'white',
                background: '#2E7D6B',
                boxShadow: '2px 8px 15px rgba(0,0,0,0.4)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
