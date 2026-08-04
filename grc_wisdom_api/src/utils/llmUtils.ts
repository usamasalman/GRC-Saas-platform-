export const generateEmbeddingMock = (text: string): number[] => {
  // Simulates an API call to an embedding model (e.g., text-embedding-ada-002)
  // Returns a mock vector of 1536 dimensions
  return new Array(1536).fill(0).map(() => Math.random());
};

export const callLlmMock = async (prompt: string): Promise<string> => {
  // Simulates a network call to OpenAI GPT-4 or Gemini
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(`[AI GENERATED RESPONSE]: Based on the provided context, the answer is: We do not share your data. (Prompt length was ${prompt.length} chars)`);
    }, 1500); // Simulate network latency
  });
};
