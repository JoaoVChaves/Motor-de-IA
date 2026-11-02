import { Module } from '@nestjs/common';
import { MockLlmAdapter } from './adapters/mock-llm.adapter.js';

export const LLM_PROVIDER = 'LLM_PROVIDER';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      useClass: MockLlmAdapter,
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}