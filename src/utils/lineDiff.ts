/**
 * Line-by-line comparison of two texts, for showing what a next version
 * changes against the version in force.
 *
 * A longest-common-subsequence over lines: small, exact, and enough for a
 * policy. Texts too large to compare in the browser return null, and the
 * caller shows the two side by side instead of a slow page.
 */

export interface DiffLine {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

/** Above this many line pairs the table would cost more than it is worth. */
const MAX_CELLS = 2_000_000;

export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return null;

  const rows: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i += 1; j += 1; }
    else if (rows[i + 1][j] >= rows[i][j + 1]) { out.push({ kind: 'removed', text: a[i] }); i += 1; }
    else { out.push({ kind: 'added', text: b[j] }); j += 1; }
  }
  while (i < n) { out.push({ kind: 'removed', text: a[i] }); i += 1; }
  while (j < m) { out.push({ kind: 'added', text: b[j] }); j += 1; }
  return out;
}

/**
 * The changes with a little context around each, and the long unchanged
 * stretches folded to a count, so a one-line edit in a long policy is found.
 */
export function foldUnchanged(lines: DiffLine[], context = 2): (DiffLine | { kind: 'folded'; count: number })[] {
  const keep = lines.map(() => false);
  lines.forEach((l, idx) => {
    if (l.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k += 1) keep[k] = true;
  });
  const out: (DiffLine | { kind: 'folded'; count: number })[] = [];
  let folded = 0;
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      if (folded) { out.push({ kind: 'folded', count: folded }); folded = 0; }
      out.push(l);
    } else {
      folded += 1;
    }
  });
  if (folded) out.push({ kind: 'folded', count: folded });
  return out;
}
