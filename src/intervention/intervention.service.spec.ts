
import { ConflictException, NotFoundException } from '@nestjs/common';
import { InterventionService } from './intervention.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import { ConversationQueueService } from '../queue/conversation-queue.service.js';

describe('InterventionService', () => {
  let service: InterventionService;
  let tx: any;

  let prismaMock: {
    $transaction: jest.Mock;
    message: {
      findFirst: jest.Mock<() => Promise<any>>;
    };
  };

  let tenantsService: { findById: jest.Mock };

  const conversationQueueMock = {
    cancelarProcessamento: jest.fn<
      (tenantId: string, conversationId: string) => Promise<void>
    >().mockResolvedValue(undefined),

    agendarProcessamento: jest.fn<
      (tenantId: string, conversationId: string) => Promise<void>
    >().mockResolvedValue(undefined),
  };

  const conversa = {
    id: 'conversation-1',
    tenant_id: 'tenant-1',
    telefone: '5581999990000',
    estado: 'PROCESSANDO',
    version: 3,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tx = {
      conversation: {
        findUnique: jest.fn(),
        updateMany: jest.fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },

      message: {
        updateMany: jest.fn<() => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
        findFirst: jest.fn<() => Promise<any>>(),
      },

      auditLog: {
        create: jest.fn<() => Promise<Record<string, never>>>()
          .mockResolvedValue({}),
      },
    };

    prismaMock = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      message: {
        findFirst: jest.fn<() => Promise<any>>()
          .mockResolvedValue(null),
      },
    };

    tenantsService = {
      findById: jest.fn<() => Promise<{ id: string }>>()
        .mockResolvedValue({ id: 'tenant-1' }),
    };

    service = new InterventionService(
      prismaMock as unknown as PrismaService,
      tenantsService as unknown as TenantsService,
      conversationQueueMock as unknown as ConversationQueueService,
    );
  });

  it('deve permitir assumir uma conversa em PROCESSANDO', async () => {
    tx.conversation.findUnique.mockResolvedValue(conversa);

    const resultado = await service.executar({
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      acao: 'assumir',
    });

    expect(resultado).toEqual({
      sucesso: true,
      estado: 'HUMANO_ATIVO',
      version: 4,
    });

    expect(tx.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        tenant_id: 'tenant-1',
        estado: 'PROCESSANDO',
        version: 3,
      },
      data: {
        estado: 'HUMANO_ATIVO',
        version: { increment: 1 },
      },
    });

    expect(tx.message.updateMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('deve cancelar o processamento da fila ao assumir uma conversa', async () => {
    tx.conversation.findUnique.mockResolvedValue(conversa);

    await service.executar({
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      acao: 'assumir',
    });

    expect(conversationQueueMock.cancelarProcessamento)
      .toHaveBeenCalledWith('tenant-1', 'conversation-1');
  });

  it('deve tratar assumir uma conversa já assumida como idempotente', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      ...conversa,
      estado: 'HUMANO_ATIVO',
    });

    const resultado = await service.executar({
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      acao: 'assumir',
    });

    expect(resultado).toEqual({
      sucesso: true,
      estado: 'HUMANO_ATIVO',
      ja_estava_assumida: true,
    });

    expect(tx.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('deve religar a IA quando a conversa estiver em HUMANO_ATIVO', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      ...conversa,
      estado: 'HUMANO_ATIVO',
    });

    const resultado = await service.executar({
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      acao: 'religar',
    });

    expect(resultado).toEqual({
      sucesso: true,
      estado: 'IA_ATIVA',
      version: 4,
    });

    expect(tx.conversation.updateMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('deve agendar processamento ao religar a IA com mensagem pendente', async () => {
    tx.conversation.findUnique.mockResolvedValue({
      ...conversa,
      estado: 'HUMANO_ATIVO',
    });

    prismaMock.message.findFirst.mockResolvedValue({
      id: 'message-1',
      status: 'PENDING',
      autor: 'lead',
    });

    await service.executar({
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      acao: 'religar',
    });

    expect(conversationQueueMock.agendarProcessamento)
      .toHaveBeenCalledWith('tenant-1', 'conversation-1');
  });

  it('não deve permitir religar a IA durante PROCESSANDO', async () => {
    tx.conversation.findUnique.mockResolvedValue(conversa);

    await expect(
      service.executar({
        tenant_id: 'tenant-1',
        telefone: '5581999990000',
        acao: 'religar',
      }),
    ).rejects.toThrow(ConflictException);

    expect(tx.conversation.updateMany).not.toHaveBeenCalled();

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resultado: 'REJECTED_BY_POLICY',
        }),
      }),
    );
  });

  it('deve retornar 404 quando a conversa não existir', async () => {
    tx.conversation.findUnique.mockResolvedValue(null);

    await expect(
      service.executar({
        tenant_id: 'tenant-1',
        telefone: '5581999990000',
        acao: 'assumir',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve retornar conflito se a versão da conversa mudar durante a intervenção', async () => {
    tx.conversation.findUnique.mockResolvedValue(conversa);
    tx.conversation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.executar({
        tenant_id: 'tenant-1',
        telefone: '5581999990000',
        acao: 'assumir',
      }),
    ).rejects.toThrow(ConflictException);
  });
});
