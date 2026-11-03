
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
        status: 'PENDING',
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
  
  it('deve assumir três mensagens pendentes no mesmo lote', async () => {
    const mensagens = [
      {
        id: 'message-1',
        texto: 'Olá',
        autor: 'lead',
        simulacao: false,
        status: 'PENDING',
      },
      {
        id: 'message-2',
        texto: 'Quero saber sobre energia solar',
        autor: 'lead',
        simulacao: false,
        status: 'PENDING',
      },
      {
        id: 'message-3',
        texto: 'Qual o valor?',
        autor: 'lead',
        simulacao: false,
        status: 'PENDING',
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
        findMany: jest.fn(async () => mensagens),
        updateMany: jest.fn(async (_args: any) => ({ count: 3 })),
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

    expect(tx.message.findMany).toHaveBeenCalledTimes(1);

    expect(tx.message.updateMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['message-1', 'message-2', 'message-3'],
        },
        tenant_id: 'tenant-1',
        status: 'PENDING',
      },
      data: {
        status: 'PROCESSING',
      },
    });

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
        status: 'PROCESSING',
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
        updateMany: jest.fn(async (_args: any) => ({ count: 0 })),
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

  it('não deve executar a limpeza antes de esgotar as tentativas', async () => {
    const prismaMock = {
      $transaction: jest.fn(),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
    );

    const failedJob = {
      ...job,
      id: 'job-1',
      opts: { attempts: 3 },
      attemptsMade: 2,
    } as Job<{
      tenantId: string;
      conversationId: string;
    }>;

    await processor.onFailed(failedJob, new Error('Erro temporário'));

    expect(redisLockMock.adquirir).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('deve marcar mensagens como FAILED, restaurar a conversa e registrar auditoria após a última tentativa', async () => {
    const tx = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation-1',
          estado: 'PROCESSANDO',
          version: 4,
        })),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
      message: {
        findMany: jest.fn(async (_args: any) => [
          { id: 'message-1', simulacao: false },
        ]),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
      auditLog: {
        create: jest.fn(async (_args: any) => ({})),
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

    const failedJob = {
      ...job,
      id: 'job-1',
      opts: { attempts: 3 },
      attemptsMade: 3,
    } as Job<{
      tenantId: string;
      conversationId: string;
    }>;

    await processor.onFailed(failedJob, new Error('Falha no LLM'));

    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        tenant_id: 'tenant-1',
        estado: 'PROCESSANDO',
        version: 4,
      },
      data: {
        estado: 'IA_ATIVA',
        version: { increment: 1 },
      },
    });

    expect(tx.message.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['message-1'] },
        tenant_id: 'tenant-1',
        conversation_id: 'conversation-1',
        status: 'PROCESSING',
      },
      data: { status: 'FAILED' },
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        conversation_id: 'conversation-1',
        acao: 'FALHA_PROCESSAMENTO_IA',
        resultado: 'FAILED',
        detalhes: 'Falha no LLM',
      }),
    });

    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });

  it('não deve alterar uma conversa assumida por um humano', async () => {
    const tx = {
      conversation: {
        findFirst: jest.fn(async () => ({
          id: 'conversation-1',
          estado: 'HUMANO_ATIVO',
          version: 5,
        })),
        updateMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
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

    const failedJob = {
      ...job,
      id: 'job-1',
      opts: { attempts: 3 },
      attemptsMade: 3,
    } as Job<{
      tenantId: string;
      conversationId: string;
    }>;

    await processor.onFailed(failedJob, new Error('Falha no LLM'));

    expect(tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });
});
