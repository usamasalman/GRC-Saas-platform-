import { useEffect, useState } from 'react';
import { onIdentityChange } from '../api/sessionIdentity';
import type { IdentitySwitch } from '../api/sessionIdentity';

/**
 * Tells a tab that the browser has signed in as somebody else, and stops it.
 *
 * Without this the first tab went on showing the first person's screen while
 * every click it sent went out as the second — so an approval pressed under
 * one name was recorded against another. sessionIdentity refuses to send those
 * requests; this is what the person sees instead of a string of failures with
 * no reason given.
 *
 * It blocks the whole page on purpose. A dismissible banner would leave the
 * stale screen usable, and the stale screen is the problem.
 */
export default function SessionSwitchedGuard() {
  const [change, setChange] = useState<IdentitySwitch | null>(null);

  useEffect(() => onIdentityChange(setChange), []);

  if (!change) return null;

  const signedOut = change.now === null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-switched-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(11, 21, 36, 0.72)',
        // Scrolls rather than clips on a short screen. Centring with
        // align-items would push the top of a tall card off-screen where it
        // cannot be scrolled back to; margin:auto centres only when it fits.
        display: 'flex', overflowY: 'auto', padding: 16,
      }}
    >
      <div style={{
        margin: 'auto',
        width: '100%', maxWidth: 520, background: 'var(--surface)', color: 'var(--ink-body)',
        border: '1px solid var(--line)', borderRadius: 12, padding: 24,
        boxShadow: '0 20px 48px rgba(11, 21, 36, 0.3)',
      }}>
        <h2 id="session-switched-title" style={{ margin: '0 0 12px', fontSize: 18, color: 'var(--ink)' }}>
          {signedOut ? 'You signed out in another tab' : 'Another tab signed in as someone else'}
        </h2>

        <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.6 }}>
          This tab was working as <strong>{change.was.label}</strong>.{' '}
          {signedOut
            ? 'Another tab in this browser has signed out.'
            : <>Another tab in this browser is now signed in as <strong>{change.now!.label}</strong>.</>}
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.6 }}>
          So that nothing is done or recorded under the wrong name, this tab has stopped
          sending anything. Whatever was on screen here was not saved after the switch.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {signedOut ? (
            <button
              onClick={() => { window.location.href = '/login'; }}
              style={{ background: 'var(--brand)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
            >
              Sign in again
            </button>
          ) : (
            <button
              onClick={() => window.location.reload()}
              style={{ background: 'var(--brand)', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
            >
              Continue as {change.now!.label}
            </button>
          )}
        </div>

        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--ink-muted)' }}>
          Tabs in the same browser always share one sign-in. To work as two people at
          once — for example to request something as one user and approve it as
          another — open the second account in a private (incognito) window or a
          different browser.
        </p>
      </div>
    </div>
  );
}
