
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

      if (!simulacao) {
        await tx.conversation.update({
          where: { id: conversaId },
          data: {
            tags: novasTags,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'adicionar_tag',
          parametros: { tag },
          resultado: 'SUCCESS',
          detalhes: simulacao
            ? `[SIMULACAO] A tag "${tag}" seria adicionada ou já existe.`
            : `Tag "${tag}" adicionada ou já existente.`,
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

      if (!simulacao) {
        await tx.conversation.update({
          where: {
            id: conversaId,
          },
          data: {
            estagio_atual: estagioNormalizado,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'mover_estagio',
          parametros: { estagio: estagioNormalizado },
          resultado: 'SUCCESS',
          detalhes: simulacao
            ? `[SIMULACAO] O estágio seria atualizado para "${estagioNormalizado}".`
            : `Estágio atualizado para "${estagioNormalizado}".`,
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

  async marcarAgenda(
    tenantId: string,
    conversaId: string,
    codigoHorario: string,
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
              estagios: true,
            },
          },
        },
      });

      if (!conversa) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

      const rejeitar = async (motivo: string) => {
        await tx.auditLog.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversaId,
            acao: 'marcar_agenda',
            parametros: { codigo_horario: codigoHorario },
            resultado: 'REJECTED_BY_POLICY',
            detalhes: motivo,
          },
        });

        return { motivoRejeicao: motivo };
      };

      if (conversa.estado !== 'PROCESSANDO') {
        return rejeitar(
          `Agendamento não permitido para conversa no estado "${conversa.estado}".`,
        );
      }

      if (!conversa.lead_sheet) {
        return rejeitar(
          'Não existe ficha de lead para esta conversa.',
        );
      }

      const resultadoQualificacao = this.qualificationService.avaliar(
        conversa.lead_sheet,
        conversa.tenant,
      );

      if (resultadoQualificacao !== 'QUALIFICADO') {
        return rejeitar(
          `Agendamento permitido somente para leads qualificados. Status atual: ${resultadoQualificacao}.`,
        );
      }

      if (
        !Array.isArray(conversa.tenant.estagios) ||
        !conversa.tenant.estagios.includes('Agendado')
      ) {
        return rejeitar(
          'O estágio Agendado não está configurado para este tenant.',
        );
      }

      const ultimaMensagemCliente = await tx.message.findFirst({
        where: {
          conversation_id: conversaId,
          tenant_id: tenantId,
          autor: 'lead',
        },
        orderBy: [
          { message_timestamp: 'desc' },
          { created_at: 'desc' },
        ],
        select: {
          texto: true,
        },
      });

      if (!ultimaMensagemCliente) {
        return rejeitar(
          'Não foi encontrada uma mensagem do cliente confirmando o horário.',
        );
      }

      const codigoEscapado = codigoHorario.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&',
      );

      const regexCodigo = new RegExp(
        `(^|[^a-z0-9-])${codigoEscapado}($|[^a-z0-9-])`,
        'i',
      );

      if (!regexCodigo.test(ultimaMensagemCliente.texto)) {
        return rejeitar(
          'A última mensagem do cliente não confirma o código de horário solicitado.',
        );
      }

      const reserva = await tx.scheduleSlot.updateMany({
        where: {
          tenant_id: tenantId,
          codigo_horario: codigoHorario,
          disponivel: true,
        },
        data: {
          disponivel: false,
          booked_conversation_id: conversaId,
          booked_at: new Date(),
        },
      });

      if (reserva.count !== 1) {
        return rejeitar(
          'Horário não encontrado ou indisponível para este tenant.',
        );
      }

      const conversaAtualizada = await tx.conversation.updateMany({
        where: {
          id: conversaId,
          tenant_id: tenantId,
          estado: 'PROCESSANDO',
        },
        data: {
          estagio_atual: 'Agendado',
        },
      });

      if (conversaAtualizada.count !== 1) {
        throw new ForbiddenException(
          'O estado da conversa foi alterado durante o agendamento. A reserva foi cancelada.',
        );
      }

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'marcar_agenda',
          parametros: { codigo_horario: codigoHorario },
          resultado: 'SUCCESS',
          detalhes: `Horário "${codigoHorario}" reservado com sucesso.`,
        },
      });

      return {
        sucesso: true,
        codigo_horario: codigoHorario,
        estagio_atual: 'Agendado',
      };
    });

    if ('motivoRejeicao' in resultado) {
      throw new ForbiddenException(resultado.motivoRejeicao);
    }

    return resultado;
  }

  async consultarAgenda(tenantId: string) {
    return this.prisma.$transaction(async (tx) => {
      const horarios = await tx.scheduleSlot.findMany({
        where: {
          tenant_id: tenantId,
          disponivel: true,
        },
        select: {
          codigo_horario: true,
          descricao: true,
        },
        orderBy: {
          codigo_horario: 'asc',
        },
      });

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          acao: 'consultar_agenda',
          parametros: {},
          resultado: 'SUCCESS',
          detalhes: `Consulta realizada. ${horarios.length} horário(s) disponível(is).`,
        },
      });

      return {
        horarios,
      };
    });
  }

  async notificarEquipe(
    tenantId: string,
    conversaId: string,
    resumo: string,
    simulacao = false,
  ) {
    const resultadoTransacao = await this.prisma.$transaction(async (tx) => {
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

      const rejeitar = async (motivo: string) => {
        await tx.auditLog.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversaId,
            acao: 'notificar_equipe',
            parametros: { resumo },
            resultado: 'REJECTED_BY_POLICY',
            simulacao,
            detalhes: motivo,
          },
        });

        return { motivoRejeicao: motivo };
      };

      if (conversa.estado !== 'PROCESSANDO') {
        return rejeitar(
          `Notificação não permitida para conversa no estado "${conversa.estado}".`,
        );
      }

      if (!conversa.lead_sheet) {
        return rejeitar(
          'Não existe ficha de lead para esta conversa.',
        );
      }

      const resultadoQualificacao = this.qualificationService.avaliar(
        conversa.lead_sheet,
        conversa.tenant,
      );

      if (resultadoQualificacao !== 'QUALIFICADO') {
        return rejeitar(
          `Notificação permitida somente para leads qualificados. Status atual: ${resultadoQualificacao}.`,
        );
      }

      if (!resumo || !resumo.trim()) {
        return rejeitar('O resumo da notificação não pode ser vazio.');
      }

      const resultado = 'SUCCESS';
      const statusNotificacao = simulacao ? 'SIMULADA' : 'PENDENTE';

      const detalhes = simulacao
        ? `[SIMULACAO] Notificação registrada. Nenhum envio externo foi realizado. Resumo: ${resumo.trim()}`
        : `[PENDENTE] Notificação registrada, mas não enviada por ausência de integração externa. Resumo: ${resumo.trim()}`;

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'notificar_equipe',
          parametros: { resumo: resumo.trim() },
          resultado,
          simulacao,
          detalhes,
        },
      });

      return {
        sucesso: true,
        simulacao,
        resultado,
        statusNotificacao,
        detalhes,
      };
    });

    if ('motivoRejeicao' in resultadoTransacao) {
      throw new ForbiddenException(resultadoTransacao.motivoRejeicao);
    }

    return resultadoTransacao

  }

  
  async transferirHumano(
    tenantId: string,
    conversaId: string,
    motivo: string,
  ) {
    const resultadoTransacao = await this.prisma.$transaction(async (tx) => {
      const conversa = await tx.conversation.findFirst({
        where: {
          id: conversaId,
          tenant_id: tenantId,
        },
        include: {
          lead_sheet: true,
          tenant: {
            select: {
              estagios: true,
            },
          },
        },
      });

      if (!conversa) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

      const rejeitar = async (motivoRejeicao: string) => {
        await tx.auditLog.create({
          data: {
            tenant_id: tenantId,
            conversation_id: conversaId,
            acao: 'transferir_humano',
            parametros: { motivo },
            resultado: 'REJECTED_BY_POLICY',
            detalhes: motivoRejeicao,
          },
        });

        return { motivoRejeicao };
      };

      if (conversa.estado !== 'PROCESSANDO') {
        return rejeitar(
          `Transferência não permitida para conversa no estado "${conversa.estado}".`,
        );
      }

      if (typeof motivo !== 'string' || !motivo.trim()) {
        return rejeitar('O motivo da transferência não pode ser vazio.');
      }

      if (
        !Array.isArray(conversa.tenant.estagios) ||
        !conversa.tenant.estagios.includes('Humano')
      ) {
        return rejeitar(
          'O estágio Humano não está configurado para este tenant.',
        );
      }

      const tagsAtuais = Array.isArray(conversa.tags)
        ? conversa.tags
        : [];

      if (!tagsAtuais.every((tag) => typeof tag === 'string')) {
        return rejeitar('As tags atuais da conversa possuem um formato inválido.');
      }

      const clienteAntigo = conversa.lead_sheet?.is_cliente_antigo === true;

      const novasTags =
        clienteAntigo && !tagsAtuais.includes('cliente-antigo')
          ? [...tagsAtuais, 'cliente-antigo']
          : tagsAtuais;

      const atualizacao = await tx.conversation.updateMany({
        where: {
          id: conversaId,
          tenant_id: tenantId,
          estado: 'PROCESSANDO',
          version: conversa.version,
        },
        data: {
          estado: 'HUMANO_PENDENTE',
          estagio_atual: 'Humano',
          motivo_transferencia: motivo.trim(),
          tags: novasTags,
          version: {
            increment: 1,
          },
        },
      });

      if (atualizacao.count !== 1) {
        return rejeitar(
          'A conversa foi modificada durante a transferência. Tente novamente.',
        );
      }

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          conversation_id: conversaId,
          acao: 'transferir_humano',
          parametros: { motivo: motivo.trim() },
          resultado: 'SUCCESS',
          detalhes: clienteAntigo
            ? `Conversa transferida para atendimento humano. Tag cliente-antigo aplicada. Motivo: ${motivo.trim()}`
            : `Conversa transferida para atendimento humano. Motivo: ${motivo.trim()}`,
        },
      });

      return {
        sucesso: true,
        estado: 'HUMANO_PENDENTE',
        estagio_atual: 'Humano',
        motivo_transferencia: motivo.trim(),
      };
    });

    if ('motivoRejeicao' in resultadoTransacao) {
      throw new ForbiddenException(resultadoTransacao.motivoRejeicao);
    }

    return resultadoTransacao;
  }
}
