import { jest, describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { ConversationReconciliationService } from './conversation-reconciliation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConversationQueueService } from './conversation-queue.service.js';

type ConversaPendente = {
  id: string;
  tenant_id: string;
};

type FindManyMock = jest.MockedFunction<
  (args: {
    where: {
      estado: string;
      messages: {
        some: {
          status: string;
          autor: string;
        };
      };
    };
    select: {
      id: boolean;
      tenant_id: boolean;
    };
  }) => Promise<ConversaPendente[]>
>;

type GarantirProcessamentoMock = jest.MockedFunction<
  (tenantId: string, conversationId: string) => Promise<void>
>;

describe('ConversationReconciliationService', () => {
  let service: ConversationReconciliationService;

  let prisma: {
    conversation: {
        findMany: FindManyMock;
    };
    };

  let conversationQueue: {
    garantirProcessamento: GarantirProcessamentoMock;
    };

  beforeEach(() => {
    prisma = {
        conversation: {
        findMany: jest.fn<Parameters<FindManyMock>[0] extends never ? never : (args: Parameters<FindManyMock>[0]) => ReturnType<FindManyMock>>(),
        },
    };

    conversationQueue = {
        garantirProcessamento: jest.fn<
        (tenantId: string, conversationId: string) => Promise<void>
        >(),
    };

    service = new ConversationReconciliationService(
        prisma as unknown as PrismaService,
        conversationQueue as unknown as ConversationQueueService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('deve agendar o processamento de todas as conversas encontradas', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', tenant_id: 'tenant-1' },
      { id: 'conversation-2', tenant_id: 'tenant-2' },
    ]);

    await service.reconciliarPendencias();

    expect(prisma.conversation.findMany).toHaveBeenCalledWith({
      where: {
        estado: 'IA_ATIVA',
        messages: {
          some: {
            status: 'PENDING',
            autor: 'lead',
          },
        },
      },
      select: {
        id: true,
        tenant_id: true,
      },
    });

    expect(conversationQueue.garantirProcessamento).toHaveBeenCalledTimes(2);

    expect(conversationQueue.garantirProcessamento).toHaveBeenNthCalledWith(
      1,
      'tenant-1',
      'conversation-1',
    );

    expect(conversationQueue.garantirProcessamento).toHaveBeenNthCalledWith(
      2,
      'tenant-2',
      'conversation-2',
    );
  });

  it('não deve agendar quando não encontrar conversas pendentes', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);

    await service.reconciliarPendencias();

    expect(conversationQueue.garantirProcessamento).not.toHaveBeenCalled();
  });

  it('deve continuar reconciliando mesmo quando uma conversa falhar', async () => {
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', tenant_id: 'tenant-1' },
      { id: 'conversation-2', tenant_id: 'tenant-1' },
    ]);

    conversationQueue.garantirProcessamento
      .mockRejectedValueOnce(new Error('Falha ao agendar'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.reconciliarPendencias(),
    ).resolves.toBeUndefined();

    expect(conversationQueue.garantirProcessamento).toHaveBeenCalledTimes(2);
  });

  it('não deve propagar erro quando a consulta ao banco falhar', async () => {
    prisma.conversation.findMany.mockRejectedValue(
      new Error('Falha no banco'),
    );

    await expect(
      service.reconciliarPendencias(),
    ).resolves.toBeUndefined();

    expect(conversationQueue.garantirProcessamento).not.toHaveBeenCalled();
  });
});