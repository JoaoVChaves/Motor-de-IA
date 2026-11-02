import { MockLlmAdapter } from './mock-llm.adapter.js';
import { describe, expect, it, beforeEach } from '@jest/globals';

describe('MockLlmAdapter', () => {
  let adapter: MockLlmAdapter;

  beforeEach(() => {
    adapter = new MockLlmAdapter();
  });

  it('deve retornar uma resposta simulada', async () => {
    const response = await adapter.generateTurn();

    expect(response).toEqual({
      content: 'Resposta simulada pelo MockLlmAdapter.',
      toolCalls: [],
      provider: 'mock',
      model: 'mock-model',
      usage: {
        promptTokens: null,
        completionTokens: null,
        estimatedCostUsd: null,
      },
    });
  });

  it('não deve executar ferramentas', async () => {
    const response = await adapter.generateTurn();

    expect(response.toolCalls).toEqual([]);
  });
});