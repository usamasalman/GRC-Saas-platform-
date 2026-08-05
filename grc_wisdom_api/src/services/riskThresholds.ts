/**
 * Threshold band logic for enterprise risk management.
 *
 * Both helpers are pure so the same rule can be applied server-side on write
 * and re-derived for display without the two drifting apart.
 */

/** Where a residual risk score sits against board-set appetite. */
export type AppetiteBand = 'WithinAppetite' | 'WithinTolerance' | 'BeyondTolerance';

export type Appetite = {
  appetiteThreshold: number;
  toleranceThreshold: number;
};

/**
 * Residual scores are 1-25 (likelihood x impact).
 *
 *  - WithinAppetite   — carried as normal business risk.
 *  - WithinTolerance  — may be accepted, but only with a documented approval.
 *  - BeyondTolerance  — cannot be accepted; it has to be treated down.
 */
export function evaluateAppetite(residualScore: number, appetite: Appetite): AppetiteBand {
  if (residualScore <= appetite.appetiteThreshold) return 'WithinAppetite';
  if (residualScore <= appetite.toleranceThreshold) return 'WithinTolerance';
  return 'BeyondTolerance';
}

/** RAG status of a KRI reading. */
export type BreachLevel = 'Green' | 'Amber' | 'Red';

/**
 * `direction` says which way is bad. Fraud losses are Higher-is-worse;
 * patching compliance is Lower-is-worse. Getting this wrong silently inverts
 * every alert, so it is stored on the KRI rather than inferred.
 */
export function kriBreachLevel(
  value: number,
  opts: { direction: string; amberThreshold: number; redThreshold: number },
): BreachLevel {
  const { direction, amberThreshold, redThreshold } = opts;
  if (direction === 'Lower') {
    if (value <= redThreshold) return 'Red';
    if (value <= amberThreshold) return 'Amber';
    return 'Green';
  }
  if (value >= redThreshold) return 'Red';
  if (value >= amberThreshold) return 'Amber';
  return 'Green';
}

/**
 * Thresholds must be ordered consistently with the direction, otherwise a
 * reading can never reach Red (or is Red from the start).
 */
export function validateKriThresholds(
  direction: string,
  amberThreshold: number,
  redThreshold: number,
): string | null {
  if (direction !== 'Higher' && direction !== 'Lower') {
    return 'direction must be Higher or Lower';
  }
  if (direction === 'Higher' && redThreshold <= amberThreshold) {
    return 'For a Higher-is-worse KRI, redThreshold must be above amberThreshold';
  }
  if (direction === 'Lower' && redThreshold >= amberThreshold) {
    return 'For a Lower-is-worse KRI, redThreshold must be below amberThreshold';
  }
  return null;
}
