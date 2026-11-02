
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { WebhookService } from './webhook.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

describe('WebhookService', () => {
  let service: WebhookService;
  let tx: any;
  let prismaMock: any;
  let tenantsService: any;

  const dto = {
    message_id: 'wamid-123',
    tenant_id: 'tenant-1',
    telefone: '5581999990000',
    texto: 'Olá, gostaria de saber mais.',
    autor: 'lead' as const,
    simulacao: false,
  };

  const conversa = {
    id: 'conversation-1',
    tenant_id: 'tenant-1',
    telefone: '5581999990000',
    estado: 'IA_ATIVA',
  };

  beforeEach(() => {
    tx = {
      message: {
        findUnique: jest.fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue(null),

        create: jest.fn<(...args: any[]) => Promise<any>>()
          .mockImplementation(async (args: any) => ({
            id: 'message-1',
            status: args.data.status,
          })),
      },

      leadSheet: {
        upsert: jest.fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue({
            id: 'lead-sheet-1',
            conversation_id: 'conversation-1',
          }),
      },

      conversation: {
        upsert: jest.fn<(...args: any[]) => Promise<any>>()
          .mockResolvedValue(conversa),
      },
    };

    prismaMock = {
      $transaction: jest.fn((callback: any) => callback(tx)),
      message: {
        findUnique: jest.fn(),
      },
    };

    tenantsService = {
      findById: jest.fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ id: 'tenant-1' }),
    };

    service = new WebhookService(
      prismaMock as unknown as PrismaService,
      tenantsService as unknown as TenantsService,
    );
  });

  it('deve registrar uma nova mensagem e criar a conversa', async () => {
    const resultado = await service.receberMensagem(dto);

    expect(resultado).toEqual({
      sucesso: true,
      idempotent_duplicate: false,
      message_id: 'message-1',
      conversation_id: 'conversation-1',
      status: 'PENDING',
      estado_conversa: 'IA_ATIVA',
    });

    expect(tx.conversation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_telefone: {
            tenant_id: 'tenant-1',
            telefone: '5581999990000',
          },
        },
        create: {
          tenant_id: 'tenant-1',
          telefone: '5581999990000',
        },
      }),
    );

    expect(tx.leadSheet.upsert).toHaveBeenCalledWith({
      where: {
        conversation_id: 'conversation-1',
      },
      create: {
        conversation_id: 'conversation-1',
      },
      update: {},
    });

    expect(tx.message.create).toHaveBeenCalled();
  });

  it('deve identificar uma mensagem duplicada sem criar outra', async () => {
    tx.message.findUnique.mockResolvedValue({
      id: 'message-existing',
      status: 'PROCESSED',
    });

    const resultado = await service.receberMensagem(dto);

    expect(resultado).toEqual({
      sucesso: true,
      idempotent_duplicate: true,
      message_id: 'message-existing',
      status: 'PROCESSED',
    });

    expect(tx.conversation.upsert).not.toHaveBeenCalled();
    expect(tx.message.create).not.toHaveBeenCalled();
  });

  it('deve registrar mensagens humanas como PROCESSED', async () => {
    const resultado = await service.receberMensagem({
      ...dto,
      autor: 'humano',
    });

    expect(resultado.status).toBe('PROCESSED');

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          autor: 'humano',
          status: 'PROCESSED',
        }),
      }),
    );
  });

  it('deve ignorar mensagens do lead quando um humano estiver atendendo', async () => {
    tx.conversation.upsert.mockResolvedValue({
      ...conversa,
      estado: 'HUMANO_ATIVO',
    });

    const resultado = await service.receberMensagem(dto);

    expect(resultado.status).toBe('IGNORED_HUMAN');
  });

  it('deve ignorar mensagens do lead quando a conversa estiver HUMANO_PENDENTE', async () => {
    tx.conversation.upsert.mockResolvedValue({
      ...conversa,
      estado: 'HUMANO_PENDENTE',
    });

    const resultado = await service.receberMensagem(dto);

    expect(resultado.status).toBe('IGNORED_HUMAN');
  });

  it('deve manter mensagens do lead como PENDING durante PROCESSANDO', async () => {
    tx.conversation.upsert.mockResolvedValue({
      ...conversa,
      estado: 'PROCESSANDO',
    });

    const resultado = await service.receberMensagem(dto);

    expect(resultado.status).toBe('PENDING');
  });

  it('deve rejeitar mensagens de um tenant inexistente', async () => {
    tenantsService.findById.mockRejectedValue(
      new NotFoundException('Tenant não encontrado.'),
    );

    await expect(
      service.receberMensagem(dto),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('deve utilizar a data informada no timestamp', async () => {
    const timestamp = '2026-11-02T14:03:11-03:00';

    await service.receberMensagem({
      ...dto,
      timestamp,
    });

    const chamada = tx.message.create.mock.calls[0][0] as any;

    expect(chamada.data.message_timestamp).toEqual(
      new Date(timestamp),
    );
  });

  it('deve garantir uma LeadSheet para uma conversa existente', async () => {
    tx.conversation.upsert.mockResolvedValue(conversa);

    await service.receberMensagem(dto);

    expect(tx.leadSheet.upsert).toHaveBeenCalledWith({
      where: {
        conversation_id: 'conversation-1',
      },
      create: {
        conversation_id: 'conversation-1',
      },
      update: {},
    });
  });
});
