
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConversationQueueService } from './conversation-queue.service.js';

@Injectable()
export class ConversationReconciliationService {
  private readonly logger = new Logger(
    ConversationReconciliationService.name,
  );

  private executando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationQueue: ConversationQueueService,
  ) {}

  @Cron('*/30 * * * * *')
  async reconciliarPendencias(): Promise<void> {
    if (this.executando) return;

    this.executando = true;

    try {
      const conversas = await this.prisma.conversation.findMany({
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

      for (const conversa of conversas) {
        try {
          await this.conversationQueue.garantirProcessamento(
            conversa.tenant_id,
            conversa.id,
          );
        } catch (error) {
          this.logger.error(
            `Falha ao reconciliar conversa ${conversa.id}: ${String(error)}`,
          );
        }
      }

      if (conversas.length > 0) {
        this.logger.log(
          `${conversas.length} conversa(s) verificadas na reconciliação.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Falha na reconciliação de mensagens: ${String(error)}`,
      );
    } finally {
      this.executando = false;
    }
  }
}
