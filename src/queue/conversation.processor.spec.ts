
import { describe, expect, it, jest } from '@jest/globals';
import type { Job } from 'bullmq';
import { ConversationProcessor } from './conversation.processor.js';

describe('ConversationProcessor', () => {

  const promptBuilderMock = {
    build: jest.fn().mockImplementation(
      async (): Promise<string> => 'Prompt de teste',
    ),
  };

  const toolExecutorMock = {
    executar: jest.fn().mockImplementation(async (): Promise<any> => ({
      sucesso: true,
    })),
  };

  const turnStepServiceMock = {
    buscar: jest.fn().mockImplementation(async () => null),
    salvar: jest.fn().mockImplementation(async (params: any) => params.response),
  };

  const llmProviderMock = {
    generateTurn: jest.fn(),
  };

  const configurarLlmParaTurno = () => {
    llmProviderMock.generateTurn.mockReset();

    // Etapa 1: adicionar tag
    llmProviderMock.generateTurn.mockImplementationOnce(
      async (): Promise<any> => ({
        content: '',
        toolCalls: [
          {
            id: 'call-tag',
            name: 'adicionar_tag',
            arguments: { tag: 'qualificado' },
          },
        ],
        provider: 'mock',
        model: 'mock-model',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          estimatedCostUsd: null,
        },
      }),
    );

    // Etapa 2: mover estágio
    llmProviderMock.generateTurn.mockImplementationOnce(
      async (): Promise<any> => ({
        content: '',
        toolCalls: [
          {
            id: 'call-stage',
            name: 'mover_estagio',
            arguments: { estagio: 'Qualificacao' },
          },
        ],
        provider: 'mock',
        model: 'mock-model',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          estimatedCostUsd: null,
        },
      }),
    );

    // Etapa 3: resposta final
    llmProviderMock.generateTurn.mockImplementationOnce(
      async (): Promise<any> => ({
        content: 'Vou ajudar você com energia solar!',
        toolCalls: [],
        provider: 'mock',
        model: 'mock-model',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          estimatedCostUsd: null,
        },
      }),
    );
  };

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
        findMany: jest.fn(async (_args: any) => [] as any[])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(mensagens),
        updateMany: jest.fn(async () => ({ count: 1 })),
        upsert: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    configurarLlmParaTurno();

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(redisLockMock.adquirir).toHaveBeenCalledTimes(1);
    expect(tx.conversation.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.message.findMany).toHaveBeenCalledTimes(2);
    expect(tx.message.updateMany).toHaveBeenCalledTimes(2);
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
        findMany: jest.fn(async (_args: any) => [] as any[])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(mensagens),
        updateMany: jest.fn(async (_args: any) => ({ count: 3 })),
        upsert: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    configurarLlmParaTurno();

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(tx.message.findMany).toHaveBeenCalledTimes(2);

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
        turn_id: expect.any(String),
      },
    });

    expect(tx.message.updateMany).toHaveBeenCalledTimes(2);
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });


  it('não deve processar quando o lock estiver ocupado', async () => {
    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => false),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
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
        upsert: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
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
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    expect(tx.conversation.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.conversation.updateMany).not.toHaveBeenCalled();
    expect(tx.message.findMany).not.toHaveBeenCalled();
    expect(tx.message.updateMany).not.toHaveBeenCalled();
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });

  
  it('deve recuperar um turno interrompido após a transferência para humano', async () => {
    const turnId = 'turn-transfer-123';

    const mensagens = [
      {
        id: 'message-1',
        texto: 'Quero falar com um atendente',
        autor: 'lead',
        simulacao: false,
        status: 'PROCESSING',
        turn_id: turnId,
      },
    ];

    const tx = {
      conversation: {
        findFirst: jest.fn<(...args: any[]) => Promise<any>>()
          .mockImplementationOnce(async (_args: any) => ({
            id: 'conversation-1',
            estado: 'HUMANO_PENDENTE',
            version: 3,
          }))
          .mockImplementationOnce(async (_args: any) => ({
            id: 'conversation-1',
          })),
        updateMany: jest.fn(),
      },
      message: {
        findMany: jest.fn(async () => mensagens),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
        upsert: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async (_args: any) => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    // Simula a resposta do LLM já persistida antes da interrupção.
    turnStepServiceMock.buscar.mockClear();
    turnStepServiceMock.buscar.mockImplementationOnce(
      async () => ({
        content: '',
        toolCalls: [
          {
            id: 'call-transfer',
            name: 'transferir_humano',
            arguments: {
              motivo: 'Lead solicitou atendimento humano',
            },
          },
        ],
        provider: 'mock',
        model: 'mock-model',
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          estimatedCostUsd: null,
        },
      }),
    );

    // Simula o replay idempotente da transferência já executada.
    toolExecutorMock.executar.mockClear();
    toolExecutorMock.executar.mockImplementationOnce(
      async () => ({ sucesso: true }),
    );

    llmProviderMock.generateTurn.mockReset();

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
    );

    await expect(processor.process(job)).resolves.toBeUndefined();

    // Recuperou o turno original.
    expect(tx.conversation.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'conversation-1',
        tenant_id: 'tenant-1',
      },
      select: {
        id: true,
        estado: true,
        version: true,
      },
    });

    // Não tentou alterar novamente o estado da conversa.
    expect(tx.conversation.updateMany).not.toHaveBeenCalled();

    // Recuperou a resposta persistida, sem chamar novamente o LLM.
    expect(turnStepServiceMock.buscar).toHaveBeenCalledWith(
      'tenant-1',
      turnId,
      0,
    );
    expect(llmProviderMock.generateTurn).not.toHaveBeenCalled();

    // Reutilizou a execução da ferramenta com a versão anterior à transferência.
    expect(toolExecutorMock.executar).toHaveBeenCalledWith(
      'transferir_humano',
      {
        motivo: 'Lead solicitou atendimento humano',
      },
      {
        tenantId: 'tenant-1',
        conversaId: 'conversation-1',
        expectedVersion: 2,
        turnId,
        stepIndex: 0,
        callIndex: 0,
        simulacao: false,
      },
    );

    // Finalizou as mensagens que ficaram em PROCESSING.
    expect(tx.message.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        conversation_id: 'conversation-1',
        turn_id: turnId,
        autor: 'lead',
        status: 'PROCESSING',
      },
      data: {
        status: 'PROCESSED',
      },
    });

    // Registrou as métricas do turno recuperado.
    expect(tx.turnMetric.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        conversation_id: 'conversation-1',
        turn_id: turnId,
        acoes_executadas: ['transferir_humano'],
        simulacao: false,
      }),
    });

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
        turn_id: 'turn-123',
      },
    ];

    const tx = {
      conversation: {
        findFirst: jest.fn(async (_args: any) => ({
          id: 'conversation-1',
          estado: 'PROCESSANDO',
          version: 2,
        })),
        updateMany: jest.fn(async (_args: any) => ({ count: 1 })),
      },
      message: {
        findMany: jest.fn(async (_args: any) => mensagens),
        updateMany: jest.fn(async (_args: any) => ({ count: 0 })),
        upsert: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    configurarLlmParaTurno();

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
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
          status:'PROCESSING',
        }),
      }),
    );

    expect(tx.message.updateMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        conversation_id: 'conversation-1',
        turn_id: 'turn-123',
        autor: 'lead',
        status: 'PROCESSING',
      },
      data: {
        status: 'PROCESSED',
      },
    });
    expect(redisLockMock.liberar).toHaveBeenCalledTimes(1);
  });

  it('não deve executar a limpeza antes de esgotar as tentativas', async () => {
    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
      $transaction: jest.fn(),
    };

    const redisLockMock = {
      adquirir: jest.fn(async () => true),
      liberar: jest.fn(async () => undefined),
    };

    const processor = new ConversationProcessor(
      prismaMock as any,
      redisLockMock as any,
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
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
        upsert: jest.fn(async () => ({})),
      },
      auditLog: {
        create: jest.fn(async (_args: any) => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
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
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
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
        upsert: jest.fn(async () => ({})),
      },
      auditLog: {
        create: jest.fn(async () => ({})),
      },
      turnMetric: {
        create: jest.fn(async () => ({})),
      },
    };

    const prismaMock = {
      message: {
        findMany: jest.fn(async () => [] as any[]),
      },
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
      promptBuilderMock as any,
      turnStepServiceMock as any,
      llmProviderMock as any,
      toolExecutorMock as any,
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
