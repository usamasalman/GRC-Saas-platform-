import React from 'react';

/**
 * The platform's icon set.
 *
 * Replaces the emoji and Unicode dingbats that were standing in for icons.
 * Those render differently on every OS — a shield is flat grey on Windows and
 * glossy blue on macOS — they cannot inherit colour or weight, they sit on the
 * text baseline rather than optical centre, and screen readers announce them
 * as words in the middle of a label.
 *
 * Every glyph here is a single 24×24 stroke path on `currentColor`, so an icon
 * takes the colour and size of whatever it sits in and stays consistent with
 * the type around it. Geometry is drawn on a 2px grid with 1.75 stroke, round
 * caps and joins — the weight that reads as engineered rather than decorative
 * at the 14–18px sizes this product uses.
 */

export type IconName =
  // ── Navigation and domain ──────────────────────────────────────────────
  | 'dashboard' | 'scorecard' | 'lifecycle' | 'approvals' | 'documents'
  | 'standards' | 'authoring' | 'controls' | 'implementations'
  | 'risk' | 'audit' | 'vendors' | 'assets' | 'teams' | 'users' | 'roles'
  | 'servicedesk' | 'knowledge' | 'exposure' | 'phishing'
  | 'marketplace' | 'tools' | 'install' | 'repository' | 'enablement'
  | 'subscriptions' | 'plans' | 'invoices' | 'payments' | 'gateway'
  | 'help' | 'switch' | 'settings'
  // ── Analysis ───────────────────────────────────────────────────────────
  | 'matrix' | 'network' | 'trend' | 'target' | 'shield' | 'gauge'
  // ── Actions ────────────────────────────────────────────────────────────
  | 'refresh' | 'close' | 'check' | 'plus' | 'minus' | 'download' | 'upload'
  | 'search' | 'edit' | 'trash' | 'filter' | 'external' | 'link' | 'copy'
  // ── Direction ──────────────────────────────────────────────────────────
  | 'chevronRight' | 'chevronDown' | 'chevronUp' | 'arrowRight' | 'arrowLeft'
  | 'caretUp' | 'caretDown'
  // ── Status ─────────────────────────────────────────────────────────────
  | 'warning' | 'error' | 'info' | 'success' | 'lock' | 'unlock' | 'clock'
  | 'flag' | 'bell' | 'menu' | 'user' | 'building' | 'branch' | 'sparkline';

/**
 * Paths are authored for `fill="none"` with a stroked outline. A few glyphs
 * carry a second filled element (a dot, a bullet) which is marked inline.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  // ── Navigation and domain ──────────────────────────────────────────────
  dashboard: <><rect x="3" y="3" width="7.5" height="8.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5" rx="1.5" /><rect x="13.5" y="11" width="7.5" height="10" rx="1.5" /><rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" /></>,
  scorecard: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7.5 15.5v-3M12 15.5v-6M16.5 15.5v-4.5" /></>,
  lifecycle: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20.5 4v4.5H16" /></>,
  approvals: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H15l5 5v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5Z" /><path d="M14.5 4v5.5H20" /><path d="M8.5 14.5l2 2 4-4.5" /></>,
  documents: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H14l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5Z" /><path d="M13.5 3v5.5H19" /><path d="M8.5 13h7M8.5 16.5h4.5" /></>,
  standards: <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5Z" /><path d="M9 7.5h6M9 11h6M9 14.5h3.5" /></>,
  authoring: <><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5Z" /><path d="M13.5 7l3 3" /></>,
  controls: <><path d="M12 3l7.5 3.2v5.3c0 4.2-3 8-7.5 9.5-4.5-1.5-7.5-5.3-7.5-9.5V6.2Z" /><path d="M9 12l2 2 4-4.5" /></>,
  implementations: <><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M6.5 7h.01M6.5 17h.01" /></>,
  risk: <><path d="M12 3.5 21 19.5H3Z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" /></>,
  audit: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.2 15.2 21 21" /><path d="M8 10.5l2 2 3.5-4" /></>,
  vendors: <><path d="M3 20V9l5-3.5L13 9v11" /><path d="M13 20V12h8v8" /><path d="M6.5 12.5h3M6.5 16h3M16.5 15.5h1.5" /></>,
  assets: <><path d="M12 2.8 20.5 7v10L12 21.2 3.5 17V7Z" /><path d="M3.5 7 12 11.5 20.5 7" /><path d="M12 11.5v9.7" /></>,
  teams: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" /><path d="M16 5.6a3.2 3.2 0 0 1 0 4.8M17.5 14.6a5.5 5.5 0 0 1 3 4.9" /></>,
  users: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  roles: <><rect x="3.5" y="4" width="17" height="16" rx="2" /><path d="M3.5 9.5h17M9.5 9.5V20" /><path d="M13 13.5h4M13 16.5h4" /></>,
  servicedesk: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.6 2.6 0 1 1 3.3 3.7c-.6.3-.9.9-.9 1.5" /><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" /></>,
  knowledge: <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z" /></>,
  exposure: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  phishing: <><path d="M4 17c0-4 3-7 7-7h6" /><path d="M14 7l3.5 3-3.5 3" /><path d="M4 17v3" /><circle cx="4" cy="17" r="1.6" /></>,
  marketplace: <><path d="M3.5 8.5 5 4h14l1.5 4.5" /><path d="M4 8.5h16V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19Z" /><path d="M9.5 12.5h5" /></>,
  tools: <><path d="M14.5 6.5a4 4 0 0 0 5.2 5.2L14 17.4l-2.6 2.6a2 2 0 0 1-2.8-2.8l2.6-2.6L5.5 8.9a4 4 0 0 0 5.2-5.2Z" /></>,
  install: <><path d="M12 3.5v10M8.5 10l3.5 3.5 3.5-3.5" /><path d="M4.5 16v3A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></>,
  repository: <><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" /><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /></>,
  enablement: <><circle cx="12" cy="12" r="8.5" /><path d="M8 12l2.8 2.8L16 9.5" /></>,
  subscriptions: <><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M6.5 14.5h4" /></>,
  plans: <><path d="M12 3.2 14.7 9l6.3.6-4.8 4.2 1.5 6.2L12 16.8 6.3 20l1.5-6.2L3 9.6 9.3 9Z" /></>,
  invoices: <><path d="M5.5 3h13v18l-2.2-1.6-2.2 1.6-2.1-1.6L9.7 21l-2.1-1.6L5.5 21Z" /><path d="M9 8.5h6M9 12.5h6" /></>,
  payments: <><rect x="2.5" y="5.5" width="19" height="13" rx="2" /><path d="M2.5 10h19" /><path d="M6 14.5h3.5" /></>,
  gateway: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="7.5" y="7.5" width="9" height="9" rx="2" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.5a2.4 2.4 0 1 1 3.1 3.5c-.5.3-.8.8-.8 1.4" /><circle cx="12" cy="16.8" r=".6" fill="currentColor" stroke="none" /></>,
  switch: <><path d="M4 8h13l-3-3M20 16H7l3 3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,

  // ── Analysis ───────────────────────────────────────────────────────────
  matrix: <><rect x="3.5" y="3.5" width="17" height="17" rx="1.5" /><path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" /></>,
  network: <><circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M8.2 8.4 10.6 16M15.8 8.4 13.4 16M8.5 7h7" /></>,
  trend: <><path d="M3.5 16.5 9 11l3.5 3.5L20.5 6.5" /><path d="M20.5 11V6.5H16" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" /></>,
  shield: <><path d="M12 3l7.5 3.2v5.3c0 4.2-3 8-7.5 9.5-4.5-1.5-7.5-5.3-7.5-9.5V6.2Z" /></>,
  gauge: <><path d="M4 17a8.5 8.5 0 1 1 16 0" /><path d="M12 17l4-5" /><circle cx="12" cy="17" r="1.3" fill="currentColor" stroke="none" /></>,

  // ── Actions ────────────────────────────────────────────────────────────
  refresh: <><path d="M20 11.5A8 8 0 1 0 18.4 17" /><path d="M20.5 6.5V12H15" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5 9.8 17.5 19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  download: <><path d="M12 3.5v11M7.8 10.5 12 14.7l4.2-4.2" /><path d="M4.5 17v2.5A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V17" /></>,
  upload: <><path d="M12 20.5v-11M7.8 13.5 12 9.3l4.2 4.2" /><path d="M4.5 6V4.5A1.5 1.5 0 0 1 6 3h12a1.5 1.5 0 0 1 1.5 1.5V6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.2 15.2 21 21" /></>,
  edit: <><path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5Z" /></>,
  trash: <><path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" /><path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4A1.4 1.4 0 0 0 16.6 20l.9-13.5" /></>,
  filter: <path d="M3.5 5.5h17l-6.5 7.7V20l-4-2.2v-4.6Z" />,
  external: <><path d="M14 4.5h5.5V10" /><path d="M19.5 4.5 11 13" /><path d="M18 14.5v4A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" /></>,
  link: <><path d="M10.5 13.5a3.8 3.8 0 0 0 5.4 0l2.8-2.8a3.8 3.8 0 0 0-5.4-5.4l-1.4 1.4" /><path d="M13.5 10.5a3.8 3.8 0 0 0-5.4 0l-2.8 2.8a3.8 3.8 0 0 0 5.4 5.4l1.4-1.4" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="1.8" /><path d="M15.5 8.5v-3A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" /></>,

  // ── Direction ──────────────────────────────────────────────────────────
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  chevronDown: <path d="M5.5 9.5 12 16l6.5-6.5" />,
  chevronUp: <path d="M5.5 14.5 12 8l6.5 6.5" />,
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  arrowLeft: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  caretUp: <path d="M7 14.5 12 9.5l5 5" />,
  caretDown: <path d="M7 9.5 12 14.5l5-5" />,

  // ── Status ─────────────────────────────────────────────────────────────
  warning: <><path d="M12 3.5 21 19.5H3Z" /><path d="M12 10v4" /><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none" /></>,
  error: <><circle cx="12" cy="12" r="8.5" /><path d="M9 9l6 6M15 9l-6 6" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11.5V16" /><circle cx="12" cy="8.2" r=".7" fill="currentColor" stroke="none" /></>,
  success: <><circle cx="12" cy="12" r="8.5" /><path d="M8.2 12.2 11 15l4.8-5.6" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.2V12l3.2 2" /></>,
  flag: <><path d="M5.5 21V4" /><path d="M5.5 5h10l-1.6 3.3L15.5 12h-10Z" /></>,
  bell: <><path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5Z" /><path d="M10.2 19a2 2 0 0 0 3.6 0" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  building: <><path d="M4 20.5V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v15" /><path d="M16 10h3.5A1.5 1.5 0 0 1 21 11.5v9" /><path d="M3 20.5h18" /><path d="M7.5 8h5M7.5 12h5M7.5 16h5" /></>,
  branch: <><circle cx="7" cy="6" r="2.5" /><circle cx="7" cy="18" r="2.5" /><circle cx="17" cy="12" r="2.5" /><path d="M7 8.5v7M9.5 6h3a2 2 0 0 1 2 2v2M9.5 18h3a2 2 0 0 0 2-2v-2" /></>,
  sparkline: <path d="M3 16l4-5 3.5 3L14 8l3 4 4-6" />,
};

type Props = {
  name: IconName;
  /** Optical size in px. 16 for inline label, 18 for nav, 20+ for headers. */
  size?: number;
  /** Overrides the inherited colour. Prefer inheriting. */
  color?: string;
  /** Stroke weight. Nudge up only when an icon sits alone at a large size. */
  strokeWidth?: number;
  style?: React.CSSProperties;
  /**
   * Give a label only when the icon is the sole meaning — an icon-only button.
   * Beside visible text it is decoration and stays hidden from assistive tech,
   * which is the default.
   */
  label?: string;
};

const Icon: React.FC<Props> = ({ name, size = 18, color, strokeWidth = 1.75, style, label }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color || 'currentColor'}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    focusable="false"
    style={{ flexShrink: 0, display: 'block', ...style }}
  >
    {PATHS[name]}
  </svg>
);

export default Icon;
