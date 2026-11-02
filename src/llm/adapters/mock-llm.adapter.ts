import { Injectable } from '@nestjs/common';
import type {
  LlmCompletionResponse,
  LlmProvider,
} from '../interfaces/llm-provider.interface.js';

@Injectable()
export class MockLlmAdapter implements LlmProvider {
  async generateTurn(): Promise<LlmCompletionResponse> {
    return {
      content: 'Resposta simulada pelo MockLlmAdapter.',
      toolCalls: [],
      provider: 'mock',
      model: 'mock-model',
      usage: {
        promptTokens: null,
        completionTokens: null,
        estimatedCostUsd: null,
      },
    };
  }
}