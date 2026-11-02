
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantsService: TenantsService,
  ) {}

  async consultar(tenantId: string, telefone: string) {
    await this.tenantsService.findById(tenantId);

    const conversa = await this.prisma.conversation.findUnique({
      where: {
        tenant_id_telefone: {
          tenant_id: tenantId,
          telefone,
        },
      },
      include: {
        lead_sheet: true,

        booked_slots: {
          orderBy: {
            booked_at: 'desc',
          },
        },

        messages: {
          orderBy: [
            { message_timestamp: 'asc' },
            { created_at: 'asc' },
          ],
        },

        audit_logs: {
          orderBy: {
            created_at: 'asc',
          },
        },
      },
    });

    if (!conversa) {
      throw new NotFoundException(
        'Conversa não encontrada para este tenant.',
      );
    }

    return conversa;
  }
}
