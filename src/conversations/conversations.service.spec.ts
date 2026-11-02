
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

describe('ConversationsService', () => {
  let service: ConversationsService;
  let prismaMock: any;
  let tenantsService: any;

  beforeEach(() => {
    prismaMock = {
      conversation: {
        findUnique: jest.fn(),
      },
    };

    tenantsService = {
      findById: jest.fn<() => Promise<{ id: string }>>()
        .mockResolvedValue({ id: 'tenant-1' }),
    };

    service = new ConversationsService(
      prismaMock as unknown as PrismaService,
      tenantsService as unknown as TenantsService,
    );
  });

  it('deve consultar uma conversa com seus relacionamentos', async () => {
    const conversa = {
      id: 'conversation-1',
      tenant_id: 'tenant-1',
      telefone: '5581999990000',
      estado: 'IA_ATIVA',
      lead_sheet: null,
      booked_slots: [],
      messages: [],
      audit_logs: [],
    };

    prismaMock.conversation.findUnique.mockResolvedValue(conversa);

    const resultado = await service.consultar(
      'tenant-1',
      '5581999990000',
    );

    expect(resultado).toEqual(conversa);

    expect(tenantsService.findById).toHaveBeenCalledWith('tenant-1');

    expect(prismaMock.conversation.findUnique).toHaveBeenCalledWith({
      where: {
        tenant_id_telefone: {
          tenant_id: 'tenant-1',
          telefone: '5581999990000',
        },
      },
      include: {
        lead_sheet: true,
        booked_slots: {
          orderBy: { booked_at: 'desc' },
        },
        messages: {
          orderBy: [
            { message_timestamp: 'asc' },
            { created_at: 'asc' },
          ],
        },
        audit_logs: {
          orderBy: { created_at: 'asc' },
        },
      },
    });
  });

  it('deve retornar 404 quando a conversa não existir', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);

    await expect(
      service.consultar('tenant-1', '5581999990000'),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve validar o tenant antes de consultar a conversa', async () => {
    tenantsService.findById.mockRejectedValue(
      new NotFoundException('Tenant não encontrado.'),
    );

    await expect(
      service.consultar('tenant-inexistente', '5581999990000'),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('deve filtrar a consulta pelo tenant e telefone simultaneamente', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null);

    await expect(
      service.consultar('tenant-2', '5581999990000'),
    ).rejects.toThrow(NotFoundException);

    expect(prismaMock.conversation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id_telefone: {
            tenant_id: 'tenant-2',
            telefone: '5581999990000',
          },
        },
      }),
    );
  });
});
