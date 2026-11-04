
import { Prisma } from '../generated/prisma/client.js';
import { TurnStepService } from './turn-step.service.js';
import type { LlmCompletionResponse } from './interfaces/llm-provider.interface.js';
import { jest, describe, expect, it, beforeEach } from '@jest/globals';

describe('TurnStepService', () => {
  let service: TurnStepService;

  const prisma = {
    turnStep: {
        findUnique: jest.fn(async (_args: any): Promise<any> => null),
        create: jest.fn(async (_args: any): Promise<any> => ({})),
    },
  };

  const response: LlmCompletionResponse = {
    content: 'Olá! Como posso ajudar?',
    toolCalls: [
      {
        id: 'call-123',
        name: 'consultar_agenda',
        arguments: { cidade: 'Caruaru' },
      },
    ],
    provider: 'gemini',
    model: 'gemini-test',
    usage: {
      promptTokens: 100,
      completionTokens: 30,
      estimatedCostUsd: 0.001,
    },
  };

  const savedStep = {
    id: 'step-123',
    tenant_id: 'tenant-1',
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    step_index: 0,
    provider: 'gemini',
    model: 'gemini-test',
    content: 'Olá! Como posso ajudar?',
    tool_calls: [
      {
        id: 'call-123',
        name: 'consultar_agenda',
        arguments: { cidade: 'Caruaru' },
      },
    ],
    prompt_tokens: 100,
    completion_tokens: 30,
    estimated_cost_usd: '0.001',
    created_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TurnStepService(prisma as any);
  });

  describe('buscar', () => {
    it('deve retornar null quando a etapa não existir', async () => {
      prisma.turnStep.findUnique.mockResolvedValue(null);

      const result = await service.buscar('tenant-1', 'turn-1', 0);

      expect(result).toBeNull();
    });

    it('deve reconstruir a resposta a partir do registro salvo', async () => {
      prisma.turnStep.findUnique.mockResolvedValue(savedStep);

      const result = await service.buscar('tenant-1', 'turn-1', 0);

      expect(result).toEqual({
        ...response,
        usage: {
          promptTokens: 100,
          completionTokens: 30,
          estimatedCostUsd: 0.001,
        },
      });

      expect(prisma.turnStep.findUnique).toHaveBeenCalledWith({
        where: {
          tenant_id_turn_id_step_index: {
            tenant_id: 'tenant-1',
            turn_id: 'turn-1',
            step_index: 0,
          },
        },
      });
    });
  });

  describe('salvar', () => {
    const params = {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      stepIndex: 0,
      response,
    };

    it('deve persistir uma nova resposta', async () => {
      prisma.turnStep.findUnique.mockResolvedValue(null);
      prisma.turnStep.create.mockResolvedValue(savedStep);

      const result = await service.salvar(params);

      expect(prisma.turnStep.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'tenant-1',
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          step_index: 0,
          provider: 'gemini',
          model: 'gemini-test',
          content: response.content,
          prompt_tokens: 100,
          completion_tokens: 30,
          estimated_cost_usd: 0.001,
        }),
      });

      expect(result).toEqual(response);
    });

    it('deve reutilizar uma resposta já persistida', async () => {
      prisma.turnStep.findUnique.mockResolvedValue(savedStep);

      const result = await service.salvar(params);

      expect(result).toEqual({
        ...response,
        usage: {
          promptTokens: 100,
          completionTokens: 30,
          estimatedCostUsd: 0.001,
        },
      });

      expect(prisma.turnStep.create).not.toHaveBeenCalled();
    });

    it('deve recuperar o registro vencedor em caso de conflito P2002', async () => {
      prisma.turnStep.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(savedStep);

      prisma.turnStep.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed',
          {
            code: 'P2002',
            clientVersion: '7.10.1',
          },
        ),
      );

      const result = await service.salvar(params);

      expect(prisma.turnStep.create).toHaveBeenCalledTimes(1);
      expect(prisma.turnStep.findUnique).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        ...response,
        usage: {
          promptTokens: 100,
          completionTokens: 30,
          estimatedCostUsd: 0.001,
        },
      });
    });

    it('deve propagar erros diferentes de P2002', async () => {
      const error = new Error('Database unavailable');

      prisma.turnStep.findUnique.mockResolvedValue(null);
      prisma.turnStep.create.mockRejectedValue(error);

      await expect(service.salvar(params)).rejects.toThrow(
        'Database unavailable',
      );
    });
  });
});
