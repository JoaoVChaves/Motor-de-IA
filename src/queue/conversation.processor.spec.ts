
import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import { ConversationProcessor } from './conversation.processor.js';

describe('ConversationProcessor', () => {
  const job = {
    name: 'process-conversation',
    data: {
      tenantId: 'tenant-1',
      conversationId: 'conversation-1',
    },
  } as Job<{
    tenantId: string;
    conversationId: string;
  }>;

  it('deve assumir as mensagens pendentes de uma conversa', async () => {
    const mensagens = [
      {
        id: 'message-1',
        texto: 'Quero saber sobre energia solar',
        autor: 'lead',
        simulacao: false,
      },
    ];

    const tx = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation-1',
          estado: 'IA_ATIVA',
          version: 1,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      message: {
        findMany: jest.fn(async (_args: any) => mensagens),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };

    const prismaMock = {
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(redisLockMock.adquirir).toHaveBeenCalledTimes(1);
    expect(tx.conversation.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.message.findMany).toHaveBeenCalledTimes(1);
    expect(tx.message.updateMany).toHaveBeenCalledTimes(1);
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });

  it('não deve processar quando o lock estiver ocupado', async () => {
    const prismaMock = {
      $transaction: jest.fn(),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => false),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
    );

    await expect(processor.process(job)).rejects.toThrow(
      'Lock indisponível para a conversa conversation-1.',
    );

    expect(redisLockMock.adquirir).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(redisLockMock.liberar).not.toHaveBeenCalled();
  });

  it('não deve processar uma conversa assumida por um humano', async () => {
    const tx = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation-1',
          estado: 'HUMANO_ATIVO',
          version: 2,
        })),
        updateMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const prismaMock = {
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(tx.conversation.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(tx.message.findMany).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });

  it('deve recuperar mensagens de uma conversa que ficou PROCESSANDO', async () => {
    const mensagens = [
      {
        id: 'message-1',
        texto: 'Quero saber sobre energia solar',
        autor: 'lead',
        simulacao: false,
      },
    ];

    const tx = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation-1',
          estado: 'PROCESSANDO',
          version: 2,
        })),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
      message: {
        findMany: jest.fn(async (_args: any) => mensagens),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
    };

    const prismaMock = {
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        tenant_id: 'tenant-1',
        estado: 'PROCESSANDO',
        version: 2,
      },
      data: {
        estado: 'PROCESSANDO',
        version: {
          increment: 1,
        },
      },
    });

    expect(tx.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: ['PENDING', 'PROCESSING'],
          },
        }),
      }),
    );

    expect(tx.message.updateMany).toHaveBeenCalledTimes(1);
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });
});
