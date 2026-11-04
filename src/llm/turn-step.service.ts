
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

import type {
  LlmCompletionResponse,
  LlmToolCall,
} from './interfaces/llm-provider.interface.js';

@Injectable()
export class TurnStepService {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(
    tenantId: string,
    turnId: string,
    stepIndex: number,
  ): Promise<LlmCompletionResponse | null> {
    const step = await this.prisma.turnStep.findUnique({
      where: {
        tenant_id_turn_id_step_index: {
          tenant_id: tenantId,
          turn_id: turnId,
          step_index: stepIndex,
        },
      },
    });

    if (!step) {
      return null;
    }

    return {
      content: step.content,
      toolCalls: (step.tool_calls ?? []) as unknown as LlmToolCall[],
      provider: step.provider,
      model: step.model,
      usage: {
        promptTokens: step.prompt_tokens,
        completionTokens: step.completion_tokens,
        estimatedCostUsd: step.estimated_cost_usd
          ? Number(step.estimated_cost_usd)
          : null,
      },
    };
  }

  async salvar(params: {
    tenantId: string;
    conversationId: string;
    turnId: string;
    stepIndex: number;
    response: LlmCompletionResponse;
  }): Promise<LlmCompletionResponse> {
    const {
      tenantId,
      conversationId,
      turnId,
      stepIndex,
      response,
    } = params;

    const existente = await this.buscar(
      tenantId,
      turnId,
      stepIndex,
    );

    if (existente) {
      return existente;
    }

    try {
      await this.prisma.turnStep.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversationId,
          turn_id: turnId,
          step_index: stepIndex,
          provider: response.provider,
          model: response.model,
          content: response.content,
          tool_calls: response.toolCalls as unknown as Prisma.InputJsonValue,
          prompt_tokens: response.usage.promptTokens,
          completion_tokens: response.usage.completionTokens,
          estimated_cost_usd: response.usage.estimatedCostUsd,
        },
      });

      return response;
    } catch (error) {
      // Outra execução pode ter persistido a mesma etapa simultaneamente.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const recuperada = await this.buscar(
          tenantId,
          turnId,
          stepIndex,
        );

        if (recuperada) {
          return recuperada;
        }
      }

      throw error;
    }
  }
}
