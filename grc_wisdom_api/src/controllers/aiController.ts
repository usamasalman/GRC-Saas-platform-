import { Response } from 'express';
import { AuthenticatedRequest } from '../middlewares/authMiddleware';
import { generateEmbeddingMock, callLlmMock } from '../utils/llmUtils';

export const askAiComplianceQuestion = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    const { question } = req.body;

    if (!question) {
      res.status(400).json({ status: 'error', message: 'Question is required.' });
      return;
    }

    // 1. Generate an embedding vector for the user's question
    const queryVector = generateEmbeddingMock(question);

    // 2. Perform a Semantic Search against the Vector DB (Mocked)
    // In production: SELECT content FROM "DocumentChunk" ORDER BY vector <=> $1 LIMIT 3;
    const retrievedChunks = [
      "Data retention policy states all data must be kept for 7 years.",
      "PDPL requires encryption for all PII data."
    ];

    // 3. Construct the RAG Prompt
    const prompt = `
      Context Information:
      ${retrievedChunks.join('\n')}
      
      User Question: ${question}
      
      Answer the question strictly based on the Context Information provided.
    `.trim();

    // 4. Call the LLM
    const aiAnswer = await callLlmMock(prompt);

    res.status(200).json({
      status: 'success',
      data: {
        question,
        answer: aiAnswer,
        sources: retrievedChunks
      }
    });
  } catch (error: any) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
