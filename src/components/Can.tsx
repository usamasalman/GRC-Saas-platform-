import React from 'react';
import { CAP, MAY } from '../pages/navCapabilities';

/**
 * Show a control only to someone who can actually use it.
 *
 * No button in this frontend read capabilities. Every action rendered for every
 * role and failed at the API, which is what the owner meant by the product
 * creating "hallucinations and misconception": a Platform Security Admin was
 * shown Delete on a control, clicked it, and was told the permission was not
 * granted — while logged in as the very role the message named.
 *
 * Two things this is not, and both matter.
 *
 * It is not a permission check. The server checks the grants on every route
 * regardless of what renders, and it is the only thing that decides. If this
 * disagrees with the API the API wins and the user gets a 403 — correct, just
 * ugly. Hiding a control is a courtesy to the reader, never a boundary.
 *
 * It is not a reason to trust the browser. The capability list arrives on the
 * signed-in user and a determined person can edit it; doing so reveals buttons
 * whose requests the server still refuses.
 *
 * Unknown means visible. A token predating the capability field, a changed
 * response shape, or a parse failure all render the control rather than an
 * empty screen — the same rule navVisible uses for the menu. A guard that fails
 * closed on missing data turns one bad deploy into a product nobody can
 * operate.
 */

/**
 * Re-exported so a caller needs one import, not two.
 *
 * Prefer MAY at a call site. It names the server's rule for a whole register
 * rather than one capability, so widening a route means editing one list here
 * instead of hunting every button that happened to name the old capability.
 */
export { CAP, MAY };

/**
 * The last parsed list, keyed by the exact string it came from.
 *
 * can() is called once per guarded control, so a register of five hundred rows
 * with two controls each calls it a thousand times in a render. Reading
 * localStorage is cheap; JSON.parse of the user object a thousand times is not.
 * Comparing the raw string first keeps the read fresh -- a role changed by an
 * administrator still takes effect on the next render, because AppShell rewrites
 * the entry from /api/auth/me -- while parsing only when it actually changes.
 */
let cachedRaw: string | null = null;
let cachedList: string[] | null = null;

function readCapabilities(): string[] | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem('grc_user_json');
  } catch {
    // Private browsing, blocked site data, a sandboxed frame: unknown, not empty.
    return null;
  }
  if (!raw) return null;
  if (raw === cachedRaw) return cachedList;

  cachedRaw = raw;
  try {
    const user = JSON.parse(raw);
    cachedList = Array.isArray(user?.capabilities) ? user.capabilities : null;
  } catch {
    // A corrupt entry is unknown too.
    cachedList = null;
  }
  return cachedList;
}

/**
 * Whether the user holds any one of these capabilities.
 *
 * Any one, not all: several registers are reachable by more than one duty, and
 * requiring the whole set would hide a control from everyone with a legitimate
 * route to it. That is what requireAnyCapability means on the routes.
 */
export function can(required: string | readonly string[]): boolean {
  const held = readCapabilities();
  if (!held) return true;
  const list = typeof required === 'string' ? [required] : required;
  if (list.length === 0) return true;
  return list.some((c) => held.includes(c));
}

const Can: React.FC<{
  /** The capability, or several — see can() for why any one is enough. */
  do: string | readonly string[];
  children: React.ReactNode;
  /**
   * Rendered instead when the user cannot act. Usually nothing. Worth supplying
   * where the absence would be confusing — a row whose only action disappears
   * reads better with a quiet "view only" than with an empty cell.
   */
  otherwise?: React.ReactNode;
}> = ({ do: required, children, otherwise = null }) => (
  <>{can(required) ? children : otherwise}</>
);

export default Can;
