/**
 * Aggregates risk scores from an array of descendant branches into a single Group Scorecard.
 */
export const calculateScorecardRollup = (branchScores: number[]): { averageRisk: number, maxRisk: number, totalEntities: number } => {
  if (!branchScores || branchScores.length === 0) {
    return { averageRisk: 0, maxRisk: 0, totalEntities: 0 };
  }

  const total = branchScores.reduce((sum, score) => sum + score, 0);
  const averageRisk = total / branchScores.length;
  const maxRisk = Math.max(...branchScores);

  return {
    averageRisk: parseFloat(averageRisk.toFixed(2)),
    maxRisk,
    totalEntities: branchScores.length
  };
};
