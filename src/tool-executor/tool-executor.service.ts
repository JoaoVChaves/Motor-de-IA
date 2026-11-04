
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '../generated/prisma/client.js';
import { CrmService } from '../crm/crm.service.js';
import { CrmActionsService } from '../crm-actions/crm-actions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface ToolContext {
  tenantId: string;
  conversaId: string;
  expectedVersion: number;
  turnId: string;
  stepIndex: number;
  callIndex: number;
  simulacao?: boolean;
}

type CampoFicha =
  | 'nome'
  | 'cidade'
  | 'tipo_imovel'
  | 'posse_imovel'
  | 'valor_conta'
  | 'forma_pagamento'
  | 'situacao_especial';

@Injectable()
export class ToolExecutorService {
  constructor(
    private readonly crmService: CrmService,
    private readonly crmActionsService: CrmActionsService,
    private readonly prisma: PrismaService,
  ) {}

    async executar(
    nomeFerramenta: string,
    argumentos: unknown,
    contexto: ToolContext,
  ) {
    this.validarContexto(contexto);

    const args = this.validarObjeto(argumentos);

    const chave = {
      tenant_id_turn_id_step_index_call_index: {
        tenant_id: contexto.tenantId,
        turn_id: contexto.turnId,
        step_index: contexto.stepIndex,
        call_index: contexto.callIndex,
      },
    };

    // 1. Consulta antes de validar novamente o estado da conversa.
    const existente = await this.prisma.toolExecution.findUnique({
      where: chave,
    });

    if (existente) {
      return this.reproduzirResultado(
        existente,
        nomeFerramenta,
        args,
        contexto,
      );
    }

    try {
      // 2. Executa e persiste tudo na mesma transação.
      const resultado = await this.prisma.$transaction(async (tx) => {
        // Reconsulta dentro da transação para cobrir execuções concorrentes.
        const registro = await tx.toolExecution.findUnique({
          where: chave,
        });

        if (registro) {
          return this.reproduzirResultado(
            registro,
            nomeFerramenta,
            args,
            contexto,
          );
        }

        let resultadoFerramenta: {
          sucesso: boolean;
          dados: unknown;
        };

        try {
          resultadoFerramenta = await this.executarFerramenta(
            nomeFerramenta,
            args,
            contexto,
            tx,
          );
        } catch (error) {
          // Somente rejeições de política são resultados definitivos.
          if (!(error instanceof ForbiddenException)) {
            throw error;
          }

          const resultadoErro = {
            __toolExecutionError: true,
            status: 403,
            message: error.message,
          };

          await tx.toolExecution.create({
            data: {
              tenant_id: contexto.tenantId,
              conversation_id: contexto.conversaId,
              turn_id: contexto.turnId,
              step_index: contexto.stepIndex,
              call_index: contexto.callIndex,
              tool_name: nomeFerramenta,
              arguments: args as Prisma.InputJsonValue,
              result: resultadoErro,
              simulacao: contexto.simulacao ?? false,
            },
          });

          return resultadoErro;
        }

        await tx.toolExecution.create({
          data: {
            tenant_id: contexto.tenantId,
            conversation_id: contexto.conversaId,
            turn_id: contexto.turnId,
            step_index: contexto.stepIndex,
            call_index: contexto.callIndex,
            tool_name: nomeFerramenta,
            arguments: args as Prisma.InputJsonValue,
            result: resultadoFerramenta as Prisma.InputJsonValue,
            simulacao: contexto.simulacao ?? false,
          },
        });

        return resultadoFerramenta;
      });

      return this.reproduzirErroSeNecessario(resultado);
    } catch (error) {
      // 3. Outra execução pode ter vencido a disputa pela chave única.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const vencedor = await this.prisma.toolExecution.findUnique({
          where: chave,
        });

        if (vencedor) {
          return this.reproduzirResultado(
            vencedor,
            nomeFerramenta,
            args,
            contexto,
          );
        }
      }

      throw error;
    }
  }

  private async executarFerramenta(
    nomeFerramenta: string,
    args: Record<string, unknown>,
    contexto: ToolContext,
    tx: Prisma.TransactionClient,
  ) {
    switch (nomeFerramenta) {
      case 'atualizar_ficha':
        return {
          sucesso: true,
          dados: await this.atualizarFicha(args, contexto, tx),
        };

      case 'adicionar_tag':
        this.validarChaves(args, ['tag']);

        if (
          !['qualificado', 'desqualificado', 'cliente-antigo'].includes(
            args.tag as string,
          )
        ) {
          throw new BadRequestException('Tag inválida.');
        }

        return {
          sucesso: true,
          dados: await this.crmActionsService.adicionarTag(
            contexto.tenantId,
            contexto.conversaId,
            args.tag as 'qualificado' | 'desqualificado' | 'cliente-antigo',
            contexto.expectedVersion,
            contexto.simulacao ?? false,
            tx,
          ),
        };

      case 'mover_estagio':
        this.validarChaves(args, ['estagio']);
        this.validarTexto(args.estagio, 'estagio');

        return {
          sucesso: true,
          dados: await this.crmActionsService.moverEstagio(
            contexto.tenantId,
            contexto.conversaId,
            args.estagio as string,
            contexto.expectedVersion,
            contexto.simulacao ?? false,
            tx,
          ),
        };

      case 'consultar_agenda':
        this.validarChaves(args, []);

        return {
          sucesso: true,
          dados: await this.crmActionsService.consultarAgenda(
            contexto.tenantId,
            tx,
          ),
        };

      case 'marcar_agenda':
        this.validarChaves(args, ['codigo_horario']);
        this.validarTexto(args.codigo_horario, 'codigo_horario');

        return {
          sucesso: true,
          dados: await this.crmActionsService.marcarAgenda(
            contexto.tenantId,
            contexto.conversaId,
            args.codigo_horario as string,
            contexto.expectedVersion,
            contexto.simulacao ?? false,
            tx,
          ),
        };

      case 'notificar_equipe':
        this.validarChaves(args, ['resumo']);
        this.validarTexto(args.resumo, 'resumo');

        return {
          sucesso: true,
          dados: await this.crmActionsService.notificarEquipe(
            contexto.tenantId,
            contexto.conversaId,
            args.resumo as string,
            contexto.expectedVersion,
            contexto.simulacao ?? false,
            tx,
          ),
        };

      case 'transferir_humano':
        this.validarChaves(args, ['motivo'], ['cliente_antigo']);
        this.validarTexto(args.motivo, 'motivo');

        if (
          args.cliente_antigo !== undefined &&
          typeof args.cliente_antigo !== 'boolean'
        ) {
          throw new BadRequestException(
            'O campo "cliente_antigo" deve ser booleano.',
          );
        }

        return {
          sucesso: true,
          dados: await this.crmActionsService.transferirHumano(
            contexto.tenantId,
            contexto.conversaId,
            args.motivo as string,
            contexto.expectedVersion,
            contexto.simulacao ?? false,
            tx,
          ),
        };

      default:
        throw new BadRequestException(
          `Ferramenta desconhecida: "${nomeFerramenta}".`,
        );
    }
  }

  private reproduzirResultado(
    registro: {
      conversation_id: string;
      tool_name: string;
      arguments: Prisma.JsonValue;
      simulacao: boolean;
      result: Prisma.JsonValue;
    },
    nomeFerramenta: string,
    args: Record<string, unknown>,
    contexto: ToolContext,
  ) {
    if (
      registro.conversation_id !== contexto.conversaId ||
      registro.tool_name !== nomeFerramenta ||
      !isDeepStrictEqual(registro.arguments, args) ||
      registro.simulacao !== (contexto.simulacao ?? false)
    ) {
      throw new ConflictException(
        'A chave de idempotência já foi utilizada com dados diferentes.',
      );
    }

    return this.reproduzirErroSeNecessario(registro.result);
  }

  private reproduzirErroSeNecessario(resultado: unknown) {
    if (
      typeof resultado === 'object' &&
      resultado !== null &&
      !Array.isArray(resultado) &&
      '__toolExecutionError' in resultado &&
      resultado.__toolExecutionError === true
    ) {
      const mensagem =
        'message' in resultado && typeof resultado.message === 'string'
          ? resultado.message
          : 'A ferramenta foi rejeitada por uma regra de negócio.';

      throw new ForbiddenException(mensagem);
    }

    return resultado;
  }

  private async atualizarFicha(
    args: Record<string, unknown>,
    contexto: ToolContext,
    tx: Prisma.TransactionClient,
  ) {
    this.validarChaves(args, ['campo', 'valor']);

    const camposPermitidos: CampoFicha[] = [
      'nome',
      'cidade',
      'tipo_imovel',
      'posse_imovel',
      'valor_conta',
      'forma_pagamento',
      'situacao_especial',
    ];

    if (
      typeof args.campo !== 'string' ||
      !camposPermitidos.includes(args.campo as CampoFicha)
    ) {
      throw new BadRequestException(
        'Campo de ficha inválido.',
      );
    }

    if (
      args.valor === null ||
      args.valor === undefined ||
      args.valor === ''
    ) {
      throw new BadRequestException(
        'O valor informado não pode ser vazio ou nulo.',
      );
    }

    const campo = args.campo as CampoFicha;

    const camposInternos = {
      nome: 'nome',
      cidade: 'cidade',
      tipo_imovel: 'tipoImovel',
      posse_imovel: 'posseImovel',
      valor_conta: 'valorConta',
      forma_pagamento: 'formaPagamento',
      situacao_especial: 'situacaoEspecial',
    } as const;

    let valor: unknown = args.valor;

    if (campo === 'valor_conta' && typeof valor === 'string') {
      const valorNormalizado = valor.trim();

      if (
        valorNormalizado === '' ||
        !/^\d+([.,]\d+)?$/.test(valorNormalizado)
      ) {
        throw new BadRequestException(
          'O valor da conta deve ser numérico.',
        );
      }

      valor = Number(valorNormalizado.replace(',', '.'));
    }

    const dadosExtraidos = {
      [camposInternos[campo]]: valor,
    } as Parameters<CrmService['atualizarFicha']>[2];

    return this.crmService.atualizarFicha(
      contexto.tenantId,
      contexto.conversaId,
      dadosExtraidos,
      contexto.expectedVersion,
      contexto.simulacao ?? false,
      tx,
    );
  }

  private validarContexto(contexto: ToolContext) {
    if (
      !contexto ||
      typeof contexto.tenantId !== 'string' ||
      !contexto.tenantId.trim() ||
      typeof contexto.conversaId !== 'string' ||
      !contexto.conversaId.trim()
    ) {
      throw new BadRequestException(
        'Contexto de execução inválido.',
      );
    }

    if (
      !Number.isInteger(contexto.expectedVersion) ||
      contexto.expectedVersion < 0
    ) {
      throw new BadRequestException(
        'A versão esperada da conversa deve ser um número inteiro não negativo.',
      );
    }

    if (
      typeof contexto.turnId !== 'string' ||
      !contexto.turnId.trim()
    ) {
      throw new BadRequestException(
        'O identificador do turno é obrigatório.',
      );
    }

    if (
      !Number.isInteger(contexto.stepIndex) ||
      contexto.stepIndex < 0
    ) {
      throw new BadRequestException(
        'O índice da etapa deve ser um número inteiro não negativo.',
      );
    }

    if (
      !Number.isInteger(contexto.callIndex) ||
      contexto.callIndex < 0
    ) {
      throw new BadRequestException(
        'O índice da chamada deve ser um número inteiro não negativo.',
      );
    }

    if (
      contexto.simulacao !== undefined &&
      typeof contexto.simulacao !== 'boolean'
    ) {
      throw new BadRequestException(
        'O modo de simulação deve ser booleano.',
      );
    }
  }

  private validarObjeto(
    argumentos: unknown,
  ): Record<string, unknown> {
    if (
      typeof argumentos !== 'object' ||
      argumentos === null ||
      Array.isArray(argumentos)
    ) {
      throw new BadRequestException(
        'Os argumentos da ferramenta devem ser um objeto.',
      );
    }

    return argumentos as Record<string, unknown>;
  }

  private validarChaves(
    args: Record<string, unknown>,
    obrigatorias: string[],
    opcionais: string[] = [],
  ) {
    const permitidas = [...obrigatorias, ...opcionais];
    const recebidas = Object.keys(args);

    const inesperadas = recebidas.filter(
      (chave) => !permitidas.includes(chave),
    );

    const ausentes = obrigatorias.filter(
      (chave) => !(chave in args),
    );

    if (inesperadas.length > 0 || ausentes.length > 0) {
      throw new BadRequestException(
        `Argumentos inválidos. Ausentes: ${ausentes.join(', ') || 'nenhum'}. ` +
          `Não permitidos: ${inesperadas.join(', ') || 'nenhum'}.`,
      );
    }
  }

  private validarTexto(valor: unknown, campo: string) {
    if (typeof valor !== 'string' || !valor.trim()) {
      throw new BadRequestException(
        `O campo "${campo}" deve ser um texto não vazio.`,
      );
    }
  }
}
