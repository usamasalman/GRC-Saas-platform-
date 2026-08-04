import { calculateScorecardRollup } from './rollupUtils';
import { callLlmMock } from './llmUtils';

/**
 * Takes the raw mathematical scorecard rollup from Phase 3 and passes it to the AI Model 
 * from Phase 5 to generate a 3-bullet plain-English brief for CEOs.
 */
export const generateExecutiveSummary = async (branchScores: number[]): Promise<string> => {
  console.log(`[Executive Summary]: Aggregating raw data...`);
  
  // 1. Get raw math from Phase 3 util
  const rollup = calculateScorecardRollup(branchScores);

  const prompt = `
    You are an expert Chief Risk Officer.
    Here is the aggregated data for our Holding Company across ${rollup.totalEntities} subsidiary branches:
    - Average Risk Score: ${rollup.averageRisk}/100
    - Maximum Single Branch Risk: ${rollup.maxRisk}/100

    Write a 3-bullet, professional Executive Summary for the CEO explaining this data.
    Do not use introductory text, just provide the bullets.
  `.trim();

  console.log(`[Executive Summary]: Sending raw data to AI for translation...`);

  // 2. Call the LLM
  const summary = await callLlmMock(prompt);

  return summary;
};
