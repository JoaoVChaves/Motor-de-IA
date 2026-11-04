import { BadRequestException, Injectable, NotFoundException, ConflictException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualificationService } from '../qualification/qualification.service.js';
import { Prisma } from '../generated/prisma/client.js';

interface DadosExtraidos {
  nome?: unknown;
  cidade?: unknown;
  tipoImovel?: unknown;
  posseImovel?: unknown;
  valorConta?: unknown;
  formaPagamento?: unknown;
  situacaoEspecial?: unknown;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qualificationService: QualificationService,
  ) {}

  async atualizarFicha(
    tenantId: string,
    conversaId: string,
    dadosExtraidos: DadosExtraidos,
    expectedVersion: number,
    simulacao = false,
    transacao?: Prisma.TransactionClient,
  ) {
    const dadosValidos: Record<string, unknown> = {};

    const camposTexto = [
      'nome',
      'cidade',
      'situacaoEspecial',
    ] as const;

    for (const campo of camposTexto) {
      const valor = dadosExtraidos[campo];

      if (valor === null || valor === undefined) {
        continue;
      }

      if (typeof valor !== 'string') {
        throw new BadRequestException(
          `O campo "${campo}" deve ser um texto.`,
        );
      }

      const valorNormalizado = valor.trim();

      if (valorNormalizado === '') {
        continue;
      }

      const valoresIncertos = [
        'não informado',
        'desconhecido',
      ];

      if (valoresIncertos.includes(valorNormalizado.toLowerCase())) {
        throw new BadRequestException(
          `O campo "${campo}" contém um valor incerto.`,
        );
      }

      dadosValidos[
        campo === 'situacaoEspecial' ? 'situacao_especial' : campo
      ] = valorNormalizado;
    }

    const enums = {
      tipoImovel: ['CASA', 'APARTAMENTO'],
      posseImovel: ['PROPRIO', 'ALUGADO'],
      formaPagamento: ['FINANCIAMENTO', 'A_VISTA'],
    } as const;

    for (const [campo, valoresPermitidos] of Object.entries(enums)) {
      const valor = dadosExtraidos[campo as keyof typeof enums];

      if (valor === null || valor === undefined) {
        continue;
      }

      if (typeof valor === 'string' && valor.trim() === '') {
        continue;
      }

      if (
        typeof valor !== 'string' ||
        !valoresPermitidos.includes(valor as never)
      ) {
        throw new BadRequestException(
          `Valor inválido para o campo "${campo}".`,
        );
      }

      const camposBanco = {
        tipoImovel: 'tipo_imovel',
        posseImovel: 'posse_imovel',
        formaPagamento: 'forma_pagamento',
      } as const;        

      const campoBanco = camposBanco[campo];

        dadosValidos[campoBanco] = valor;
      }

    const valorConta = dadosExtraidos.valorConta;

    if (
      valorConta !== null &&
      valorConta !== undefined &&
      valorConta !== ''
    ) {
      if (
        typeof valorConta !== 'number' ||
        !Number.isFinite(valorConta) ||
        valorConta < 0
      ) {
        throw new BadRequestException(
          'O campo "valorConta" deve ser um número válido e não negativo.',
        );
      }

      dadosValidos.valor_conta = valorConta;
    }

    if (Object.keys(dadosValidos).length === 0) {
      throw new BadRequestException(
        'Nenhum dado válido foi fornecido para atualizar a ficha.',
      );
    }

    return this.executarTransacao(transacao, async (tx) => {
      const conversa = await tx.$queryRaw<
        { id: string; estado: string; version: number }[]
      >`
        SELECT id, estado, version
        FROM conversations
        WHERE id = ${conversaId}::uuid
          AND tenant_id = ${tenantId}
        FOR UPDATE
      `;

      if (conversa.length === 0) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

      if (
        conversa[0].estado !== 'PROCESSANDO' ||
        conversa[0].version !== expectedVersion
      ) {
        throw new ConflictException(
          'A conversa foi alterada ou assumida por um humano. A atualização da ficha foi bloqueada.',
        );
      }

      const tenant = await tx.tenant.findUnique({
        where: {
          id: tenantId,
        },
        select: {
          cidades_atendidas: true,
        },
      });

      if (!tenant) {
        throw new NotFoundException('Tenant não encontrado.');
      }

      if (simulacao) {
        const fichaAtual = await tx.leadSheet.findUnique({
          where: {
            conversation_id: conversaId,
          },
        });

        const fichaBase = fichaAtual ?? {
          id: '',
          conversation_id: conversaId,
          nome: null,
          cidade: null,
          tipo_imovel: null,
          posse_imovel: null,
          valor_conta: null,
          forma_pagamento: null,
          is_cliente_antigo: null,
          situacao_especial: null,
          dados_extras: null,
          updated_at: new Date(),
        };

        const fichaSimulada = {
          ...fichaBase,
          ...dadosValidos,
        } as Parameters<QualificationService['avaliar']>[0];

        const qualificacao = this.qualificationService.avaliar(
          fichaSimulada,
          tenant,
        );

        return {
          ficha: fichaSimulada,
          qualificacao,
        };
      }

      const ficha = await tx.leadSheet.upsert({
        where: {
          conversation_id: conversaId,
        },
        update: dadosValidos,
        create: {
          conversation_id: conversaId,
          ...dadosValidos,
        },
      });

      const qualificacao = this.qualificationService.avaliar(
        ficha,
        tenant,
      );

      return {
        ficha,
        qualificacao,
      };
    });
  }

  private executarTransacao<T>(
    transacao: Prisma.TransactionClient | undefined,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return transacao
      ? callback(transacao)
      : this.prisma.$transaction(callback);
  }
}