import { BadRequestException, ForbiddenException, Injectable, NotFoundException, } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualificationService } from '../qualification/qualification.service.js';

type TagPermitida =
  | 'qualificado'
  | 'desqualificado'
  | 'cliente-antigo';

@Injectable()
export class CrmActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qualificationService: QualificationService,
  ) {}

  async adicionarTag(
    tenantId: string,
    conversaId: string,
    tag: TagPermitida,
    simulacao = false,
  ) {
    const resultado = await this.prisma.$transaction(async (tx) => {
      const conversa = await tx.conversation.findFirst({
        where: {
          id: conversaId,
          tenant_id: tenantId,
        },
        include: {
          lead_sheet: true,
          tenant: {
            select: {
              cidades_atendidas: true,
            },
          },
        },
      });

      if (!conversa) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

        if (!conversa.lead_sheet) {
          const motivoRejeicao =
            'Não existe ficha de lead para esta conversa.';

          await tx.auditLog.create({
            data: {
              tenant_id: tenantId,
              conversation_id: conversaId,
              acao: 'adicionar_tag',
              parametros: { tag },
              resultado: 'REJECTED_BY_POLICY',
              detalhes: motivoRejeicao,
              simulacao,
            },
          });

          return { motivoRejeicao };
        }

      if (conversa.estado !== 'PROCESSANDO') {
        const motivoRejeicao =
            `Ação não permitida para conversa no estado "${conversa.estado}".`;

        await tx.auditLog.create({
            data: {
            tenant_id: tenantId,
            conversation_id: conversaId,
            acao: 'adicionar_tag',
            parametros: { tag },
            resultado: 'REJECTED_BY_POLICY',
            detalhes: motivoRejeicao,
            simulacao,
        },
      });

      return { motivoRejeicao };
    }
      const resultadoQualificacao = this.qualificationService.avaliar(
        conversa.lead_sheet,
        conversa.tenant,
      );
      
      let motivoRejeicao: string | null = null;

      if (tag === 'qualificado' && resultadoQualificacao !== 'QUALIFICADO') {
        motivoRejeicao =
          `Não é possível adicionar a tag "${tag}". ` +
          `Status atual da qualificação: ${resultadoQualificacao}.`;
      }

      if (
        tag === 'desqualificado' &&
        !resultadoQualificacao.startsWith('DESQUALIFICADO_')
      ) {
        motivoRejeicao =
          `Não é possível adicionar a tag "${tag}". ` +
          `Status atual da qualificação: ${resultadoQualificacao}.`;
      }

      if (
        tag === 'cliente-antigo' &&
        (
          conversa.lead_sheet.is_cliente_antigo !== true ||
          resultadoQualificacao !== 'TRANSFERIR_HUMANO'
        )
      ) {
        motivoRejeicao =
          'A tag "cliente-antigo" exige que o campo ' +
          'is_cliente_antigo esteja marcado como true.';
      }

      if (motivoRejeicao) {
        await tx.auditLog.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversaId,
            acao: 'adicionar_tag',
            parametros: { tag },
            resultado: 'REJECTED_BY_POLICY',
            detalhes: motivoRejeicao,
            simulacao,
          },
        });

        return { motivoRejeicao };
      }

      if (!Array.isArray(conversa.tags)) {
        throw new BadRequestException(
          'As tags da conversa possuem um formato inválido.',
        );
      }

      const tagsAtuais = conversa.tags;

      if (
        !tagsAtuais.every(
          (item): item is string => typeof item === 'string',
        )
      ) {
        throw new BadRequestException(
          'A lista de tags contém valores inválidos.',
        );
      }

      const novasTags = tagsAtuais.includes(tag)
        ? tagsAtuais
        : [...tagsAtuais, tag];

      await tx.conversation.update({
        where: { id: conversaId },
        data: {
          tags: novasTags,
        },
      });

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'adicionar_tag',
          parametros: { tag },
          resultado: 'SUCCESS',
          detalhes: `Tag "${tag}" adicionada ou já existente.`,
          simulacao,
        },
      });

      return {
        tags: novasTags,
        resultadoQualificacao,
      };
    });

    if ('motivoRejeicao' in resultado) {
      throw new ForbiddenException(resultado.motivoRejeicao);
    }

    return resultado;
  }

  async moverEstagio(
    tenantId: string,
    conversaId: string,
    estagio: string,
    simulacao = false,
   ) {
    const resultado = await this.prisma.$transaction(async (tx) => {
        const conversa = await tx.conversation.findFirst({
        where: {
            id: conversaId,
            tenant_id: tenantId,
        },
        include: {
          tenant: {
            select: {
              estagios: true,
              cidades_atendidas: true,
            },
          },
          lead_sheet: true,
        },
    });

    if (!conversa) {
      throw new NotFoundException(
        'Conversa não encontrada para este tenant.',
      );
    }

    if (conversa.estado !== 'PROCESSANDO') {
      const motivoRejeicao =
        `Ação não permitida para conversa no estado "${conversa.estado}".`;

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    const estagiosConfigurados = conversa.tenant.estagios;

    if (!conversa.lead_sheet) {
      const motivoRejeicao =
        'Não existe ficha de lead para esta conversa.';

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    const resultadoQualificacao = this.qualificationService.avaliar(
      conversa.lead_sheet,
      conversa.tenant,
    );

    if (
      !Array.isArray(estagiosConfigurados) ||
      !estagiosConfigurados.every(
        (item): item is string => typeof item === 'string',
      )
    ) {
      const motivoRejeicao =
        'A configuração de estágios do tenant é inválida.';

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    const estagioNormalizado = estagio.trim();

    if (
      estagioNormalizado === '' ||
      !estagiosConfigurados.includes(estagioNormalizado)
    ) {
      const motivoRejeicao =
        `O estágio "${estagio}" não está configurado para este tenant.`;

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }
    
    if (['Agendado', 'Humano'].includes(estagioNormalizado)) {
      const motivoRejeicao =
        estagioNormalizado === 'Agendado'
          ? 'O estágio Agendado só pode ser definido pela operação marcarAgenda.'
          : 'O estágio Humano só pode ser definido pela operação transferirHumano.';

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio: estagioNormalizado },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    let estagioObrigatorio: string | null = null;

    if (resultadoQualificacao === 'QUALIFICADO') {
      estagioObrigatorio = 'Qualificado';
    } else if (resultadoQualificacao.startsWith('DESQUALIFICADO_')) {
      estagioObrigatorio = 'Desqualificado';
    } else if (resultadoQualificacao === 'TRANSFERIR_HUMANO') {
      estagioObrigatorio = 'Humano';
    }

    if (
      estagioObrigatorio !== null &&
      !['Novo', 'Qualificacao'].includes(estagioNormalizado) &&
      estagioNormalizado !== estagioObrigatorio
    ) {
      const motivoRejeicao =
        `A qualificação atual exige o estágio "${estagioObrigatorio}".`;

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    if (
      resultadoQualificacao === 'INCOMPLETO' &&
      ['Qualificado', 'Desqualificado', 'Humano'].includes(
        estagioNormalizado,
      )
    ) {
      const motivoRejeicao =
        'Não é possível mover para um estágio final com a qualificação incompleta.';

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio },
          resultado: 'REJECTED_BY_POLICY',
          detalhes: motivoRejeicao,
          simulacao,
        },
      });

      return { motivoRejeicao };
    }

    await tx.conversation.update({
      where: {
        id: conversaId,
      },
      data: {
        estagio_atual: estagioNormalizado,
      },
    });

    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        conversation_id: conversaId,
        acao: 'mover_estagio',
        parametros: { estagio: estagioNormalizado },
        resultado: 'SUCCESS',
        detalhes: `Estágio atualizado para "${estagioNormalizado}".`,
        simulacao,
      },
    });

    return {
      estagio_atual: estagioNormalizado,
    };
  });

  if ('motivoRejeicao' in resultado) {
    throw new ForbiddenException(resultado.motivoRejeicao);
  }

  return resultado;
}
}