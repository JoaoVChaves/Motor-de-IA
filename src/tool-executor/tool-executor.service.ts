import { BadRequestException, Injectable } from '@nestjs/common';
import { CrmService } from '../crm/crm.service.js';
import { CrmActionsService } from '../crm-actions/crm-actions.service.js';

interface ToolContext {
  tenantId: string;
  conversaId: string;
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
  ) {}

  async executar(
    nomeFerramenta: string,
    argumentos: unknown,
    contexto: ToolContext,
  ) {
    this.validarContexto(contexto);

    const args = this.validarObjeto(argumentos);

    switch (nomeFerramenta) {
      case 'atualizar_ficha':
        return {
          sucesso: true,
          dados: await this.atualizarFicha(
            args,
            contexto,
          ),
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
            contexto.simulacao ?? false,
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
            contexto.simulacao ?? false,
          ),
        };

      case 'consultar_agenda':
        this.validarChaves(args, []);

        return {
          sucesso: true,
          dados: await this.crmActionsService.consultarAgenda(
            contexto.tenantId,
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
            contexto.simulacao ?? false,
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
          ),
        };

      default:
        throw new BadRequestException(
          `Ferramenta desconhecida: "${nomeFerramenta}".`,
        );
    }
  }

  private async atualizarFicha(
    args: Record<string, unknown>,
    contexto: ToolContext,
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