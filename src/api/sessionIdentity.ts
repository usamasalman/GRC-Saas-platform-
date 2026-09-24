/**
 * Which person this tab is acting as — and a refusal to act as anybody else.
 *
 * The session lives in localStorage, which every tab of this site shares. The
 * request interceptor reads the token afresh on every call. So with two tabs
 * open, signing in as somebody else in the second one silently re-identified
 * the first: it kept showing the first person's name, data and buttons, and
 * its next click went out under the second person's token.
 *
 * In most products that is an annoyance. In this one it is the audit trail
 * being wrong. An approval pressed on a screen that says "Wasif" was executed
 * and recorded in the WORM log as whoever signed in last, and every
 * separation-of-duties check ran against that other person. It also meant one
 * person could hold two identities in one browser and switch between them
 * without either tab saying so.
 *
 * The rule now: a tab remembers the identity it was opened as. If the token
 * any request would carry belongs to somebody else, the request is not sent,
 * and the tab says what happened instead of carrying on as someone it is not.
 *
 * One browser still means one signed-in account — that is how the storage
 * works, and it is also the right answer for a compliance product. Two people
 * at once need two browsers or a private window, which keep separate storage.
 *
 * Imports nothing, so the rules run in a test without a browser.
 */

export interface Identity {
  /** User id, plus the impersonation session when viewing as a customer. */
  key: string;
  /** What a person would recognise: a name, or the account's email. */
  label: string;
}

export interface IdentitySwitch {
  was: Identity;
  /** Null when the other tab signed out rather than in as somebody else. */
  now: Identity | null;
}

/** Pages a person reaches before signing in. A tab opened on one is not anybody yet. */
const PUBLIC_PATHS = ['/login', '/control-plane', '/setup', '/forgot-password', '/reset-password'];

/**
 * The keys that change who a request acts as, and the one that names them.
 *
 * grc_user_json is here for the label only. A sign-in writes the token first
 * and the user record after it, so the first event arrives while the record
 * still describes the previous person and the notice can only give an email.
 * Found in a real two-tab run: without this key the notice said
 * "mahmoud@example.com" where it should have said the person's name.
 */
const WATCHED_KEYS = ['grc_jwt_token', 'grc_imp_token', 'grc_user_json'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Blocked or unavailable storage is "no token", not a crash.
    return null;
  }
}

/**
 * The claims inside a token, without verifying it.
 *
 * The server verifies every token it receives. This only needs to know whose
 * token it is, to compare with whose tab this is.
 */
function claims(token: string | null): { id?: string; email?: string; imp?: { sessionId?: string } } | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // atob gives bytes as a string; the JSON inside is UTF-8, and names in this
    // product are frequently Arabic.
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Who the next request from ANY tab of this browser would act as. */
export function currentIdentity(): Identity | null {
  const token = read('grc_imp_token') || read('grc_jwt_token');
  const c = claims(token);
  if (!c || !c.id) return null;

  const sessionId = c.imp?.sessionId ?? '';
  let name: string | null = null;
  try {
    const user = JSON.parse(read('grc_user_json') || 'null');
    if (user && user.id === c.id && user.name) name = String(user.name);
  } catch {
    // A corrupt user entry costs the label, not the check.
  }
  const who = name || c.email || 'another account';
  return {
    key: `${c.id}|${sessionId}`,
    label: sessionId ? `${who} (viewing as a customer)` : who,
  };
}

let pinned: Identity | null = null;
const listeners = new Set<(s: IdentitySwitch | null) => void>();

/** The identity this tab is acting as, or null before sign-in. */
export function pinnedIdentity(): Identity | null {
  return pinned;
}

/**
 * Adopt whoever is signed in now, as this tab.
 *
 * Called by this tab's own sign-in, which changes storage without reloading.
 * Another tab's sign-in never calls this — that is the whole point.
 */
export function pinCurrentIdentity(): void {
  pinned = currentIdentity();
  notify();
}

/** This tab signed out. It is nobody until it signs in again. */
export function clearPinnedIdentity(): void {
  pinned = null;
  notify();
}

/** Null while this tab and storage agree; otherwise what changed underneath it. */
export function identitySwitch(): IdentitySwitch | null {
  if (!pinned) return null;
  const now = currentIdentity();
  if (now && now.key === pinned.key) return null;
  return { was: pinned, now };
}

/**
 * Whether a request from this tab must not be sent.
 *
 * Only when a token WOULD be sent and it is somebody else's. A request with no
 * token at all is anonymous — it cannot act as the wrong person, and the
 * server refuses anything that needs one.
 */
export function blocksRequest(): boolean {
  if (!pinned) return false;
  const now = currentIdentity();
  if (!now || now.key === pinned.key) return false;
  notify();
  return true;
}

export function onIdentityChange(listener: (s: IdentitySwitch | null) => void): () => void {
  listeners.add(listener);
  listener(identitySwitch());
  return () => { listeners.delete(listener); };
}

function notify(): void {
  const s = identitySwitch();
  listeners.forEach((l) => l(s));
}

export const SESSION_SWITCHED_CODE = 'SESSION_SWITCHED';
export const SESSION_SWITCHED_MESSAGE =
  'Not sent: another tab in this browser is signed in as someone else.';

if (typeof window !== 'undefined') {
  const path = window.location.pathname;
  if (!PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    pinned = currentIdentity();
  }

  // Fires in every tab EXCEPT the one that wrote — exactly the tabs that need
  // telling. A null key means storage was cleared outright.
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key !== null && !WATCHED_KEYS.includes(e.key)) return;
    notify();
  });
}
