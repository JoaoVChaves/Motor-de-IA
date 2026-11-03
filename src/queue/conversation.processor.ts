
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { CONVERSATION_QUEUE } from './queue.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisLockService } from './redis-lock.service.js';

interface ConversationJobData {
  tenantId: string;
  conversationId: string;
}

interface ConversationBatch {
  version: number;
  messages: {
    id: string;
    texto: string;
    autor: string;
    simulacao: boolean;
  }[];
}

@Processor(CONVERSATION_QUEUE)
export class ConversationProcessor extends WorkerHost {
  private readonly logger = new Logger(ConversationProcessor.name);

  private readonly lockTtl = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisLock: RedisLockService,
  ) {
    super();
  }

  async process(job: Job<ConversationJobData>): Promise<void> {
    const { tenantId, conversationId } = job.data;

    const lockKey = `lock:conv:${conversationId}`;
    const lockToken = randomUUID();

    const lockAcquired = await this.redisLock.adquirir(
      lockKey,
      lockToken,
      this.lockTtl,
    );

    if (!lockAcquired) {
      this.logger.warn(
        `Conversa já está bloqueada: ${conversationId}`,
      );

      throw new Error(
        `Lock indisponível para a conversa ${conversationId}.`,
      );
    }

    const lockRenewal = setInterval(async () => {
      try {
        const renovado = await this.redisLock.renovar(
          lockKey,
          lockToken,
          this.lockTtl,
        );

        if (!renovado) {
          this.logger.error(
            `Lock perdido durante processamento: ${conversationId}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Erro ao renovar lock da conversa ${conversationId}: ${String(error)}`,
        );
      }
    }, this.lockTtl / 3);

    try {
      const batch = await this.claimMessages(
        tenantId,
        conversationId,
      );

      if (!batch || batch.messages.length === 0) {
        this.logger.log(
          `Nenhuma mensagem pendente para a conversa ${conversationId}`,
        );
        return;
      }

      const simulacao = batch.messages.some(
        (message) => message.simulacao,
      );

      this.logger.log(
        `Lote assumido | Tenant: ${tenantId} | Conversa: ${conversationId} | Mensagens: ${batch.messages.length} | Simulação: ${simulacao} | Versão: ${batch.version}`,
      );

      // Próxima etapa: processamento do lote pelo LLM.
    } finally {
      clearInterval(lockRenewal);
      await this.redisLock.liberar(lockKey, lockToken);
    }
  }

  private async claimMessages(
    tenantId: string,
    conversationId: string,
  ): Promise<ConversationBatch | null> {
    return this.prisma.$transaction(async (tx) => {
      const conversa = await tx.conversation.findFirst({
        where: {
          id: conversationId,
          tenant_id: tenantId,
        },
        select: {
          id: true,
          estado: true,
          version: true,
        },
      });

      if (
        !conversa ||
        !['IA_ATIVA', 'PROCESSANDO'].includes(conversa.estado)
      ) {
        return null;
      }

      const transicao = await tx.conversation.updateMany({
        where: {
          id: conversationId,
          tenant_id: tenantId,
          estado: conversa.estado,
          version: conversa.version,
        },
        data: {
          estado: 'PROCESSANDO',
          version: {
            increment: 1,
          },
        },
      });

      if (transicao.count !== 1) {
        return null;
      }

      const novaVersao = conversa.version + 1;

      const mensagens = await tx.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          status: {
            in: ['PENDING', 'PROCESSING'],
          },
          autor: 'lead',
        },
        orderBy: [
          { message_timestamp: 'asc' },
          { created_at: 'asc' },
        ],
        select: {
          id: true,
          texto: true,
          autor: true,
          simulacao: true,
        },
      });

      if (mensagens.length === 0) {
        await tx.conversation.updateMany({
          where: {
            id: conversationId,
            tenant_id: tenantId,
            estado: 'PROCESSANDO',
            version: novaVersao,
          },
          data: {
            estado: 'IA_ATIVA',
            version: {
              increment: 1,
            },
          },
        });

        return {
          version: novaVersao,
          messages: [],
        };
      }

      const ids = mensagens.map((message) => message.id);

      const atualizacao = await tx.message.updateMany({
        where: {
          id: {
            in: ids,
          },
          tenant_id: tenantId,
          status: 'PENDING',
        },
        data: {
          status: 'PROCESSING',
        },
      });

      if (atualizacao.count !== mensagens.length) {
        throw new Error(
          'Não foi possível assumir todas as mensagens pendentes.',
        );
      }

      return {
        version: novaVersao,
        messages: mensagens,
      };
    });
  }
}
