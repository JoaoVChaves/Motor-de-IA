
import { Processor, WorkerHost, InjectQueue, OnWorkerEvent, } from '@nestjs/bullmq';
import { Inject, 
  Logger, 
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  LLM_PROVIDER,
} from '../llm/llm.module.js';
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { CONVERSATION_QUEUE } from './queue.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisLockService } from './redis-lock.service.js';
import type {
  LlmChatMessage,
  LlmProvider,
  LlmToolDefinition,
  LlmCompletionResponse,
} from '../llm/interfaces/llm-provider.interface.js';
import { PromptBuilderService } from '../llm/prompt-builder.service.js';
import { TurnStepService } from '../llm/turn-step.service.js';
import { ToolExecutorService } from '../tool-executor/tool-executor.service.js';

interface ConversationJobData {
  tenantId: string;
  conversationId: string;
}

interface ConversationBatch {
  version: number;
  turnId: string | null;
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

  private readonly ferramentas: LlmToolDefinition[] = [
    {
      name: 'atualizar_ficha',
      description:
        'Atualiza um campo da ficha do lead usando somente informações fornecidas por ele.',
      parameters: {
        type: 'object',
        properties: {
          campo: {
            type: 'string',
            enum: [
              'nome',
              'cidade',
              'tipo_imovel',
              'posse_imovel',
              'valor_conta',
              'forma_pagamento',
              'situacao_especial',
            ],
          },
          valor: {
            type: ['string', 'number'],
          },
        },
        required: ['campo', 'valor'],
        additionalProperties: false,
      },
    },
    {
      name: 'adicionar_tag',
      description:
        'Adiciona uma tag ao lead. Utilize somente quando houver evidência suficiente para classificar o lead.',
      parameters: {
        type: 'object',
        properties: {
          tag: {
            type: 'string',
            enum: ['qualificado', 'desqualificado', 'cliente-antigo'],
          },
        },
        required: ['tag'],
        additionalProperties: false,
      },
    },
    {
      name: 'mover_estagio',
      description:
        'Move o lead para um estágio compatível com sua situação atual.',
      parameters: {
        type: 'object',
        properties: {
          estagio: {
            type: 'string',
            description: 'Nome exato do estágio configurado no CRM.',
          },
        },
        required: ['estagio'],
        additionalProperties: false,
      },
    },
    {
      name: 'consultar_agenda',
      description:
        'Consulta os horários disponíveis. Deve ser chamada antes de informar disponibilidade ao lead.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: 'marcar_agenda',
      description:
        'Reserva um horário escolhido pelo lead, utilizando o código retornado pela consulta da agenda.',
      parameters: {
        type: 'object',
        properties: {
          codigo_horario: {
            type: 'string',
            description: 'Código exato do horário disponível.',
          },
        },
        required: ['codigo_horario'],
        additionalProperties: false,
      },
    },
    {
      name: 'notificar_equipe',
      description:
        'Registra uma notificação para a equipe sobre um lead qualificado.',
      parameters: {
        type: 'object',
        properties: {
          resumo: {
            type: 'string',
            description: 'Resumo objetivo do lead e do motivo da notificação.',
          },
        },
        required: ['resumo'],
        additionalProperties: false,
      },
    },
    {
      name: 'transferir_humano',
      description:
        'Transfere o atendimento para um humano quando houver necessidade de intervenção humana.',
      parameters: {
        type: 'object',
        properties: {
          motivo: {
            type: 'string',
            description: 'Motivo da transferência.',
          },
        },
        required: ['motivo'],
        additionalProperties: false,
      },
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisLock: RedisLockService,
    private readonly promptBuilder: PromptBuilderService,
    private readonly turnStepService: TurnStepService,
    @Inject(LLM_PROVIDER)
    private readonly llmProvider: LlmProvider,
    private readonly toolExecutor: ToolExecutorService,
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
        `Lote assumido | Tenant: ${tenantId} | Conversa: ${conversationId} | Turno: ${batch.turnId} | Mensagens: ${batch.messages.length} | Simulação: ${simulacao} | Versão: ${batch.version}`,
      );

      const historico = await this.montarHistorico(
        tenantId,
        conversationId,
        batch,
      );

      if (!batch.turnId) {
        throw new Error(
          `Turno sem identificador para a conversa ${conversationId}.`,
        );
      }

      const inicioProcessamento = Date.now();

      const resultado = await this.executarLoopFerramentas({
        tenantId,
        conversationId,
        turnId: batch.turnId,
        expectedVersion: batch.version,
        simulacao,
        historico,
      });

      if (lockPerdido) {
        throw new Error(
          `Lock perdido antes da finalização da conversa ${conversationId}.`,
        );
      }

      await this.finalizarTurno({
        tenantId,
        conversationId,
        turnId: batch.turnId,
        expectedVersion: batch.version,
        simulacao,
        resposta: resultado.resposta,
        transferido: resultado.transferido,
        acoesExecutadas: resultado.acoesExecutadas,
        metricas: resultado.metricas,
        latencyMs: Date.now() - inicioProcessamento,
      });

      this.logger.log(
        `Turno finalizado | Conversa: ${conversationId} | Turno: ${batch.turnId} | Transferido: ${resultado.transferido} | Ações: ${resultado.acoesExecutadas.join(', ')}`,
      );

      this.logger.log(
        `Histórico montado | Conversa: ${conversationId} | Mensagens no contexto: ${historico.length}`,
      );
      
    } finally {
      clearInterval(lockRenewal);
      await this.redisLock.liberar(lockKey, lockToken);
    }
  }

  private async montarHistorico(
    tenantId: string,
    conversationId: string,
    batch: ConversationBatch,
  ): Promise<LlmChatMessage[]> {
    // Recupera o histórico de mensagens já concluídas.
    const mensagensHistorico = await this.prisma.message.findMany({
      where: {
        tenant_id: tenantId,
        conversation_id: conversationId,
        status: 'PROCESSED',
      },
      orderBy: [
        { message_timestamp: 'asc' },
        { created_at: 'asc' },
      ],
      select: {
        id: true,
        texto: true,
        autor: true,
      },
    });

    const historico: LlmChatMessage[] = mensagensHistorico.map(
      (message) => {
        if (message.autor === 'ia') {
          return {
            role: 'assistant',
            content: message.texto,
          };
        }

        if (message.autor === 'humano') {
          return {
            role: 'user',
            content: `[Mensagem enviada por atendente humano]: ${message.texto}`,
          };
        }

        return {
          role: 'user',
          content: message.texto,
        };
      },
    );

    // Agrupa todas as mensagens do lote atual em uma única mensagem.
    const mensagemAgrupada = batch.messages
      .map((message) => message.texto.trim())
      .filter((texto) => texto.length > 0)
      .join('\n');

    if (mensagemAgrupada) {
      historico.push({
        role: 'user',
        content: mensagemAgrupada,
      });
    }

    return historico;
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

      if (!conversa) {
        return null;
      }

      // Recupera uma transferência executada antes de uma interrupção.
      if (conversa.estado === 'HUMANO_PENDENTE') {
        const mensagensEmProcessamento = await tx.message.findMany({
          where: {
            conversation_id: conversationId,
            tenant_id: tenantId,
            autor: 'lead',
            status: 'PROCESSING',
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
            turn_id: true,
          },
        });

        if (mensagensEmProcessamento.length === 0) {
          return null;
        }

        const turnIds = [
          ...new Set(
            mensagensEmProcessamento
              .map((message) => message.turn_id)
              .filter((id): id is string => id !== null),
          ),
        ];

        if (
          turnIds.length !== 1 ||
          mensagensEmProcessamento.some((message) => message.turn_id === null)
        ) {
          throw new Error(
            `Não foi possível recuperar o turno transferido da conversa ${conversationId}.`,
          );
        }

        this.logger.warn(
          `Recuperando turno após transferência | Conversa: ${conversationId} | Turno: ${turnIds[0]}`,
        );

        return {
          // A transferência já incrementou a versão.
          // O finalizador espera a versão anterior como expectedVersion.
          version: conversa.version - 1,
          turnId: turnIds[0],
          simulacao: mensagensEmProcessamento.some(
            (message) => message.simulacao,
          ),
          messages: mensagensEmProcessamento.map((message) => ({
            id: message.id,
            texto: message.texto,
            autor: message.autor,
            simulacao: message.simulacao,
          })),
        };
      }

      if (!['IA_ATIVA', 'PROCESSANDO'].includes(conversa.estado)) {
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

      // 1. Primeiro verifica se existe um turno interrompido.
      const mensagensEmProcessamento = await tx.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          autor: 'lead',
          status: 'PROCESSING',
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
          turn_id: true,
        },
      });

      if (mensagensEmProcessamento.length > 0) {
        const turnIds = [
          ...new Set(
            mensagensEmProcessamento
              .map((message) => message.turn_id)
              .filter((id): id is string => id !== null),
          ),
        ];

        if (turnIds.length > 1) {
          throw new Error(
            `Foram encontrados múltiplos turn_id em mensagens PROCESSING da conversa ${conversationId}.`,
          );
        }

        // Reutiliza o identificador anterior ou recupera mensagens legadas.
        const turnId = turnIds[0] ?? randomUUID();

        const mensagensSemTurno = mensagensEmProcessamento
          .filter((message) => message.turn_id === null)
          .map((message) => message.id);

        if (mensagensSemTurno.length > 0) {
          await tx.message.updateMany({
            where: {
              id: {
                in: mensagensSemTurno,
              },
              tenant_id: tenantId,
              status: 'PROCESSING',
              turn_id: null,
            },
            data: {
              turn_id: turnId,
            },
          });
        }

        return {
          version: novaVersao,
          turnId,
          simulacao: mensagensEmProcessamento.some(
            (message) => message.simulacao,
          ),
          messages: mensagensEmProcessamento.map((message) => ({
            id: message.id,
            texto: message.texto,
            autor: message.autor,
            simulacao: message.simulacao,
          })),
        };
      }

      // 2. Não existe turno interrompido: assume somente PENDING.
      const mensagensPendentes = await tx.message.findMany({
        where: {
          conversation_id: conversationId,
          tenant_id: tenantId,
          autor: 'lead',
          status: 'PENDING',
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

      if (mensagensPendentes.length === 0) {
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
          turnId: null,
          simulacao: false,
          messages: [],
        };
      }

      const turnId = randomUUID();

      const ids = mensagensPendentes.map((message) => message.id);

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
          turn_id: turnId,
        },
      });

      if (atualizacao.count !== mensagensPendentes.length) {
        throw new Error(
          'Não foi possível assumir todas as mensagens pendentes.',
        );
      }

      return {
        version: novaVersao,
        turnId,
        simulacao: mensagensPendentes.some(
          (message) => message.simulacao,
        ),
        messages: mensagensPendentes,
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

  private async obterRespostaLlm(params: {
    tenantId: string;
    conversationId: string;
    turnId: string;
    stepIndex: number;
    historico: LlmChatMessage[];
    ferramentas: LlmToolDefinition[];
  }): Promise<LlmCompletionResponse> {
    const {
      tenantId,
      conversationId,
      turnId,
      stepIndex,
      historico,
      ferramentas,
    } = params;

    // Recupera a resposta caso essa etapa já tenha sido executada.
    const respostaExistente = await this.turnStepService.buscar(
      tenantId,
      turnId,
      stepIndex,
    );

    if (respostaExistente) {
      this.logger.log(
        `Etapa LLM recuperada | Turno: ${turnId} | Etapa: ${stepIndex}`,
      );

      return respostaExistente;
    }

    const systemPrompt = await this.promptBuilder.build(
      tenantId,
      conversationId,
    );

    const resposta = await this.llmProvider.generateTurn({
      systemPrompt,
      messages: historico,
      tools: ferramentas,
      temperature: 0.2,
    });

    return this.turnStepService.salvar({
      tenantId,
      conversationId,
      turnId,
      stepIndex,
      response: resposta,
    });
  }

  private async executarLoopFerramentas(params: {
    tenantId: string;
    conversationId: string;
    turnId: string;
    expectedVersion: number;
    simulacao: boolean;
    historico: LlmChatMessage[];
  }): Promise<{
    resposta: LlmCompletionResponse | null;
    transferido: boolean;
    acoesExecutadas: string[];
    metricas: {
      provider: string;
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
      estimatedCostUsd: number | null;
    };
  }> {
    const {
      tenantId,
      conversationId,
      turnId,
      expectedVersion,
      simulacao,
      historico,
    } = params;

    const limiteEtapas = 5;
    const acoesExecutadas: string[] = [];

    let provider = 'mock';
    let model = 'unknown';
    let promptTokens: number | null = 0;
    let completionTokens: number | null = 0;
    let estimatedCostUsd: number | null = 0;

    for (let stepIndex = 0; stepIndex < limiteEtapas; stepIndex++) {
      const resposta = await this.obterRespostaLlm({
        tenantId,
        conversationId,
        turnId,
        stepIndex,
        historico,
        ferramentas: this.ferramentas,
      });

      provider = resposta.provider;
      model = resposta.model;

      promptTokens =
        promptTokens === null || resposta.usage.promptTokens === null
          ? null
          : promptTokens + resposta.usage.promptTokens;

      completionTokens =
        completionTokens === null || resposta.usage.completionTokens === null
          ? null
          : completionTokens + resposta.usage.completionTokens;

      estimatedCostUsd =
        estimatedCostUsd === null ||
        resposta.usage.estimatedCostUsd === null
          ? null
          : estimatedCostUsd + resposta.usage.estimatedCostUsd;

      if (resposta.toolCalls.length === 0) {
        if (!resposta.content?.trim()) {
          throw new Error(
            `O LLM retornou uma resposta vazia no turno ${turnId}.`,
          );
        }

        const acoesObrigatorias = [
          'adicionar_tag',
          'mover_estagio',
        ];

        const acoesPendentes = acoesObrigatorias.filter(
          (acao) => !acoesExecutadas.includes(acao),
        );

        if (acoesPendentes.length > 0) {
          historico.push({
            role: 'user',
            content:
              `Antes de responder ao lead, execute as ações obrigatórias ` +
              `de CRM que ainda faltam: ${acoesPendentes.join(', ')}. ` +
              `Use somente informações confirmadas na conversa e na ficha. ` +
              `Não invente classificações ou estágios.`,
          });

          continue;
        }

        return {
          resposta,
          transferido: false,
          acoesExecutadas,
          metricas: {
            provider,
            model,
            promptTokens,
            completionTokens,
            estimatedCostUsd,
          },
        };
      }

      historico.push({
        role: 'assistant',
        content: resposta.content ?? '',
        tool_calls: resposta.toolCalls,
      });

      for (
        let callIndex = 0;
        callIndex < resposta.toolCalls.length;
        callIndex++
      ) {
        const chamada = resposta.toolCalls[callIndex];

        let resultado: unknown;

        try {
          resultado = await this.toolExecutor.executar(
            chamada.name,
            chamada.arguments,
            {
              tenantId,
              conversaId: conversationId,
              expectedVersion,
              turnId,
              stepIndex,
              callIndex,
              simulacao,
            },
          );

          acoesExecutadas.push(chamada.name);
        } catch (error) {
          if (
            error instanceof BadRequestException ||
            error instanceof ForbiddenException
          ) {
            resultado = {
              sucesso: false,
              erro: error.message,
            };
          } else {
            throw error;
          }
        }

        historico.push({
          role: 'tool',
          tool_call_id: chamada.id,
          tool_name: chamada.name,
          content: JSON.stringify(resultado),
        });

        if (
          chamada.name === 'transferir_humano' &&
          !simulacao &&
          typeof resultado === 'object' &&
          resultado !== null &&
          'sucesso' in resultado &&
          resultado.sucesso === true
        ) {
          return {
            resposta: null,
            transferido: true,
            acoesExecutadas,
            metricas: {
              provider,
              model,
              promptTokens,
              completionTokens,
              estimatedCostUsd,
            },
          };
        }
      }
    }

    throw new Error(
      `Limite de ${limiteEtapas} etapas LLM atingido no turno ${turnId}.`,
    );
  }

  private async finalizarTurno(params: {
    tenantId: string;
    conversationId: string;
    turnId: string;
    expectedVersion: number;
    simulacao: boolean;
    resposta: LlmCompletionResponse | null;
    transferido: boolean;
    acoesExecutadas: string[];
    metricas: {
      provider: string;
      model: string;
      promptTokens: number | null;
      completionTokens: number | null;
      estimatedCostUsd: number | null;
    };
    latencyMs: number;
  }): Promise<void> {
    const {
      tenantId,
      conversationId,
      turnId,
      expectedVersion,
      simulacao,
      resposta,
      transferido,
      acoesExecutadas,
      metricas,
      latencyMs,
    } = params;

    await this.prisma.$transaction(async (tx) => {
      if (transferido) {
        const conversa = await tx.conversation.findFirst({
          where: {
            id: conversationId,
            tenant_id: tenantId,
            estado: 'HUMANO_PENDENTE',
            version: expectedVersion + 1,
          },
          select: {
            id: true,
          },
        });

        if (!conversa) {
          throw new Error(
            `Estado da conversa inválido após transferência: ${conversationId}.`,
          );
        }
      } else {
        if (!resposta?.content?.trim()) {
          throw new Error(
            `Não existe resposta final para o turno ${turnId}.`,
          );
        }

        const transicao = await tx.conversation.updateMany({
          where: {
            id: conversationId,
            tenant_id: tenantId,
            estado: 'PROCESSANDO',
            version: expectedVersion,
          },
          data: {
            estado: 'IA_ATIVA',
            version: {
              increment: 1,
            },
          },
        });

        if (transicao.count !== 1) {
          throw new Error(
            `Não foi possível finalizar a conversa ${conversationId}: estado ou versão alterados.`,
          );
        }

        await tx.message.upsert({
          where: {
            tenant_id_external_message_id: {
              tenant_id: tenantId,
              external_message_id: `ia:${turnId}`,
            },
          },
          create: {
            external_message_id: `ia:${turnId}`,
            tenant_id: tenantId,
            conversation_id: conversationId,
            autor: 'ia',
            texto: resposta.content,
            status: 'PROCESSED',
            simulacao,
            turn_id: turnId,
            message_timestamp: new Date(),
          },
          update: {},
        });
      }

      await tx.message.updateMany({
        where: {
          tenant_id: tenantId,
          conversation_id: conversationId,
          turn_id: turnId,
          autor: 'lead',
          status: 'PROCESSING',
        },
        data: {
          status: 'PROCESSED',
        },
      });

      await tx.turnMetric.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversationId,
          turn_id: turnId,
          provider: metricas.provider,
          model: metricas.model,
          prompt_tokens: metricas.promptTokens,
          completion_tokens: metricas.completionTokens,
          estimated_cost_usd: metricas.estimatedCostUsd,
          latency_ms: latencyMs,
          acoes_executadas: acoesExecutadas,
          simulacao,
        },
      });
    });
  }
}
