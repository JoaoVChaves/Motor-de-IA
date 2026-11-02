
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { MessageWebhookDto } from './dto/message-webhook.dto.js';

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantsService: TenantsService,
  ) {}

  async receberMensagem(dto: MessageWebhookDto) {
    const {
      message_id,
      tenant_id,
      telefone,
      texto,
      autor,
      simulacao,
    } = dto;

    await this.tenantsService.findById(tenant_id);

    const timestamp = dto.timestamp
      ? new Date(dto.timestamp)
      : new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const mensagemExistente = await tx.message.findUnique({
          where: {
            tenant_id_external_message_id: {
              tenant_id,
              external_message_id: message_id,
            },
          },
        });

        if (mensagemExistente) {
          return {
            sucesso: true,
            idempotent_duplicate: true,
            message_id: mensagemExistente.id,
            status: mensagemExistente.status,
          };
        }

        const conversa = await tx.conversation.upsert({
          where: {
            tenant_id_telefone: {
              tenant_id,
              telefone,
            },
          },
          create: {
            tenant_id,
            telefone,
          },
          update: {},
        });

        await tx.leadSheet.upsert({
          where: {
            conversation_id: conversa.id,
          },
          create: {
            conversation_id: conversa.id,
          },
          update: {},
        });

        let status: 'PENDING' | 'PROCESSED' | 'IGNORED_HUMAN';

        if (autor === 'humano') {
          status = 'PROCESSED';
        } else if (
          conversa.estado === 'HUMANO_ATIVO' ||
          conversa.estado === 'HUMANO_PENDENTE'
        ) {
          status = 'IGNORED_HUMAN';
        } else {
          status = 'PENDING';
        }

        const mensagem = await tx.message.create({
          data: {
            external_message_id: message_id,
            tenant_id,
            conversation_id: conversa.id,
            autor,
            texto,
            status,
            simulacao,
            message_timestamp: timestamp,
          },
        });

        return {
          sucesso: true,
          idempotent_duplicate: false,
          message_id: mensagem.id,
          conversation_id: conversa.id,
          status: mensagem.status,
          estado_conversa: conversa.estado,
        };
      });
    } catch (error) {
      // Proteção para duas requisições simultâneas com o mesmo ID.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const mensagemExistente = await this.prisma.message.findUnique({
          where: {
            tenant_id_external_message_id: {
              tenant_id,
              external_message_id: message_id,
            },
          },
        });

        if (mensagemExistente) {
          return {
            sucesso: true,
            idempotent_duplicate: true,
            message_id: mensagemExistente.id,
            status: mensagemExistente.status,
          };
        }
      }

      throw error;
    }
  }
}
