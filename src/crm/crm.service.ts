import { BadRequestException, Injectable, NotFoundException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

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
  constructor(private readonly prisma: PrismaService) {}

  async atualizarFicha(
    tenantId: string,
    conversaId: string,
    dadosExtraidos: DadosExtraidos,
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

    return this.prisma.$transaction(async (tx) => {
      const conversa = await tx.conversation.findFirst({
        where: {
          id: conversaId,
          tenant_id: tenantId,
        },
        select: {
          id: true,
        },
      });

      if (!conversa) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

      return tx.leadSheet.upsert({
        where: {
          conversation_id: conversaId,
        },
        update: dadosValidos,
        create: {
          conversation_id: conversaId,
          ...dadosValidos,
        },
      });
    });
  }
}