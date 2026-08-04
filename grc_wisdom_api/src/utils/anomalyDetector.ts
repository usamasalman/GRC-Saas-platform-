/**
 * Calculates the Z-Score of a given value against an array of historical values.
 * Z-Score = (Value - Mean) / Standard Deviation
 * A Z-Score > 3 or < -3 typically indicates a severe statistical anomaly.
 */
const calculateZScore = (currentValue: number, history: number[]): number => {
  if (history.length === 0) return 0;

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  
  const variance = history.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / history.length;
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) return 0; // No variance in history

  return (currentValue - mean) / standardDeviation;
};

/**
 * Nightly Job: Checks if the latest risk score for a branch has plummeted or spiked unusually.
 */
export const detectRiskAnomalies = async (tenantId: string): Promise<boolean> => {
  console.log(`[Anomaly Engine]: Running statistical analysis for Tenant ${tenantId}...`);

  // Mocking the database fetch of the last 90 days of Risk Scores
  // const snapshots = await prisma.riskScoreSnapshot.findMany({ where: { tenantId }, orderBy: { recordedAt: 'asc' }});
  
  const mockHistoricalScores = [80, 82, 79, 81, 80, 78, 83];
  const latestScore = 35; // A massive, sudden drop in compliance
  
  const zScore = calculateZScore(latestScore, mockHistoricalScores);
  
  console.log(`[Anomaly Engine]: Calculated Z-Score is ${zScore.toFixed(2)}`);

  // A Z-Score less than -3 indicates a catastrophic drop in compliance compared to the norm
  if (zScore < -3) {
    console.error(`[CRITICAL ALERT]: Severe statistical anomaly detected for Tenant ${tenantId}!`);
    console.error(`Expected ~80, but received ${latestScore}. Triggering urgent Webhooks...`);
    // Here we would call the Webhook Dispatcher to alert the Executive Team
    return true; // Anomaly detected
  }

  return false; // Normal variance
};
