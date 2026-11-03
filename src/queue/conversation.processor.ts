
import { Processor, WorkerHost, InjectQueue, OnWorkerEvent, } from '@nestjs/bullmq';
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
  simulacao: boolean;
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

    let lockPerdido = false;
    let renovacaoEmAndamento = false;

    const lockRenewal = setInterval(async () => {
      if (lockPerdido || renovacaoEmAndamento) return;

      renovacaoEmAndamento = true;

      try {
        const renovado = await this.redisLock.renovar(
          lockKey,
          lockToken,
          this.lockTtl,
        );

        if (!renovado) {
          lockPerdido = true;

          this.logger.error(
            `Lock perdido durante processamento: ${conversationId}`,
          );
        }
      } catch (error) {
        lockPerdido = true;

        this.logger.error(
          `Erro ao renovar lock da conversa ${conversationId}: ${String(error)}`,
        );
      } finally {
        renovacaoEmAndamento = false;
      }
    }, this.lockTtl / 3);

    try {
      const batch = await this.claimMessages(
        tenantId,
        conversationId,
      );

      if (lockPerdido) {
        throw new Error(
          `Lock perdido durante processamento da conversa ${conversationId}.`,
        );
      }

      if (!batch || batch.messages.length === 0) {
        this.logger.log(
          `Nenhuma mensagem pendente para a conversa ${conversationId}`,
        );
        return;
      }

      const simulacao = batch.simulacao;

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
          status: true,
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
          simulacao: false,
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

      const totalPendentes = mensagens.filter(
        (message) => message.status === 'PENDING',
      ).length;

      if (atualizacao.count !== totalPendentes) {
        throw new Error(
          'Não foi possível assumir todas as mensagens pendentes.',
        );
      }

      return {
        version: novaVersao,
        simulacao: mensagens.some((message) => message.simulacao),
        messages: mensagens,
      };
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<ConversationJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;

    const tentativasMaximas = job.opts.attempts ?? 1;

    if (job.attemptsMade < tentativasMaximas) {
      return;
    }

    const { tenantId, conversationId } = job.data;

    const lockKey = `lock:conv:${conversationId}`;
    const lockToken = randomUUID();

    let lockAcquired = false;

    try {
      lockAcquired = await this.redisLock.adquirir(
        lockKey,
        lockToken,
        this.lockTtl,
      );

      if (!lockAcquired) {
        this.logger.warn(
          `Tratamento de falha adiado: conversa ainda bloqueada ${conversationId}`,
        );
        return;
      }

      await this.prisma.$transaction(async (tx) => {
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

        if (!conversa) return;

        let mensagens: {
          id: string;
          simulacao: boolean;
        }[] = [];

        if (conversa.estado === 'PROCESSANDO') {
          const transicao = await tx.conversation.updateMany({
            where: {
              id: conversationId,
              tenant_id: tenantId,
              estado: 'PROCESSANDO',
              version: conversa.version,
            },
            data: {
              estado: 'IA_ATIVA',
              version: {
                increment: 1,
              },
            },
          });

          if (transicao.count === 1) {
            mensagens = await tx.message.findMany({
              where: {
                tenant_id: tenantId,
                conversation_id: conversationId,
                autor: 'lead',
                status: 'PROCESSING',
              },
              select: {
                id: true,
                simulacao: true,
              },
            });

            if (mensagens.length > 0) {
              await tx.message.updateMany({
                where: {
                  id: {
                    in: mensagens.map((message) => message.id),
                  },
                  tenant_id: tenantId,
                  conversation_id: conversationId,
                  status: 'PROCESSING',
                },
                data: {
                  status: 'FAILED',
                },
              });
            }
          }
        }

        await tx.auditLog.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversationId,
            acao: 'FALHA_PROCESSAMENTO_IA',
            resultado: 'FAILED',
            detalhes: error.message,
            parametros: {
              tentativas: job.attemptsMade,
              tentativasMaximas,
              jobId: job.id ?? null,
              mensagensAfetadas: mensagens.length,
            },
            simulacao: mensagens.some(
              (message) => message.simulacao,
            ),
          },
        });
      });

      this.logger.error(
        `Falha definitiva registrada | Conversa: ${conversationId} | Tentativas: ${job.attemptsMade} | Erro: ${error.message}`,
      );
    } catch (cleanupError) {
      this.logger.error(
        `Erro ao executar tratamento de falha definitiva da conversa ${conversationId}: ${String(cleanupError)}`,
      );
    } finally {
      if (lockAcquired) {
        await this.redisLock.liberar(lockKey, lockToken);
      }
    }
  }
}
