
import { TurnStepService } from './turn-step.service.js';
import { PromptBuilderService } from './prompt-builder.service.js';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MockLlmAdapter } from './adapters/mock-llm.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import type { LlmProvider } from './interfaces/llm-provider.interface.js';

export const LLM_PROVIDER = 'LLM_PROVIDER';

@Module({
  imports: [ConfigModule, TenantsModule],
  providers: [
    TurnStepService,
    PromptBuilderService,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): LlmProvider => {
        const provider = config.get<string>('LLM_PROVIDER', 'mock');

        if (provider === 'gemini') {
          return new GeminiAdapter(
            config.getOrThrow<string>('GEMINI_API_KEY'),
            config.getOrThrow<string>('GEMINI_MODEL'),
            config.get<number>('LLM_TIMEOUT_MS', 30000),
          );
        }

        return new MockLlmAdapter();
      },
    },
  ],
  exports: [LLM_PROVIDER, TurnStepService, PromptBuilderService],
})
export class LlmModule {}
