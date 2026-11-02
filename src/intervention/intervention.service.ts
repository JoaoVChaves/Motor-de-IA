
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { InterventionDto } from './dto/intervention.dto.js';

@Injectable()
export class InterventionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantsService: TenantsService,
  ) {}

  async executar(dto: InterventionDto) {
    const { tenant_id, telefone, acao } = dto;

    await this.tenantsService.findById(tenant_id);

    const resultado = await this.prisma.$transaction(async (tx) => {
      const conversa = await tx.conversation.findUnique({
        where: {
          tenant_id_telefone: {
            tenant_id,
            telefone,
          },
        },
      });

      if (!conversa) {
        throw new NotFoundException(
          'Conversa não encontrada para este tenant.',
        );
      }

      const estadoAnterior = conversa.estado;

      if (acao === 'assumir' && estadoAnterior === 'HUMANO_ATIVO') {
        return {
          sucesso: true,
          estado: 'HUMANO_ATIVO',
          ja_estava_assumida: true,
        };
      }

      if (
        acao === 'religar' &&
        !['HUMANO_ATIVO', 'HUMANO_PENDENTE'].includes(estadoAnterior)
      ) {
        await tx.auditLog.create({
          data: {
            tenant_id,
            conversation_id: conversa.id,
            acao: 'intervencao_religar',
            parametros: { acao },
            resultado: 'REJECTED_BY_POLICY',
            detalhes: `Não é possível religar a IA a partir do estado "${estadoAnterior}".`,
          },
        });

        return {
          motivoRejeicao: `Não é possível religar a IA a partir do estado "${estadoAnterior}".`,
        };
      }

      const novoEstado =
        acao === 'assumir' ? 'HUMANO_ATIVO' : 'IA_ATIVA';

      const atualizacao = await tx.conversation.updateMany({
        where: {
          id: conversa.id,
          tenant_id,
          estado: estadoAnterior,
          version: conversa.version,
        },
        data: {
          estado: novoEstado,
          version: {
            increment: 1,
          },
        },
      });

      if (atualizacao.count !== 1) {
        throw new ConflictException(
          'A conversa foi modificada durante a intervenção. Tente novamente.',
        );
      }

      if (acao === 'assumir') {
        await tx.message.updateMany({
          where: {
            tenant_id,
            conversation_id: conversa.id,
            status: 'PENDING',
          },
          data: {
            status: 'IGNORED_HUMAN',
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenant_id,
          conversation_id: conversa.id,
          acao: `intervencao_${acao}`,
          parametros: {
            acao,
            estado_anterior: estadoAnterior,
            novo_estado: novoEstado,
          },
          resultado: 'SUCCESS',
          detalhes:
            acao === 'assumir'
              ? 'Atendimento assumido por um humano.'
              : 'Atendimento da IA religado.',
        },
      });

      return {
        sucesso: true,
        estado: novoEstado,
        version: conversa.version + 1,
      };
    });

    if ('motivoRejeicao' in resultado) {
      throw new ConflictException(resultado.motivoRejeicao);
    }

    return resultado;
  }
}
