import { Injectable } from '@nestjs/common';

export type QualificationStatus =
  | 'INCOMPLETO'
  | 'QUALIFICADO'
  | 'DESQUALIFICADO_IMOVEL'
  | 'DESQUALIFICADO_CONTA'
  | 'DESQUALIFICADO_CIDADE'
  | 'TRANSFERIR_HUMANO';

interface FichaLead {
  posse_imovel: 'PROPRIO' | 'ALUGADO' | null;
  tipo_imovel: 'CASA' | 'APARTAMENTO' | null;
  valor_conta: number | { toNumber(): number } | null;
  cidade: string | null;
  is_cliente_antigo: boolean | null;
  situacao_especial: string | null;
}

interface DadosTenant {
  cidades_atendidas: unknown;
}

@Injectable()
export class QualificationService {
  private normalizarTexto(valor: string): string {
    return valor
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  private cidadeAtendida(
    cidade: string,
    cidadesAtendidas: unknown,
  ): boolean {
    if (!Array.isArray(cidadesAtendidas)) {
      return false;
    }

    return cidadesAtendidas.some(
      (cidadeAtendida) =>
        typeof cidadeAtendida === 'string' &&
        this.normalizarTexto(cidadeAtendida) ===
          this.normalizarTexto(cidade),
    );
  }

  avaliar(
    ficha: FichaLead,
    tenant: DadosTenant,
  ): QualificationStatus {
    // 1. Transferência humana tem prioridade.
    if (
      ficha.is_cliente_antigo === true ||
      ficha.situacao_especial !== null
    ) {
      return 'TRANSFERIR_HUMANO';
    }

    // 2. Desqualificações já comprovadas.
    if (
      ficha.posse_imovel === 'ALUGADO' ||
      ficha.tipo_imovel === 'APARTAMENTO'
    ) {
      return 'DESQUALIFICADO_IMOVEL';
    }

    const valorConta =
      ficha.valor_conta === null
        ? null
        : typeof ficha.valor_conta === 'number'
          ? ficha.valor_conta
          : ficha.valor_conta.toNumber();

    if (valorConta !== null && valorConta < 250) {
      return 'DESQUALIFICADO_CONTA';
    }

    if (
      ficha.cidade !== null &&
      ficha.cidade.trim() !== '' &&
      !this.cidadeAtendida(ficha.cidade, tenant.cidades_atendidas)
    ) {
      return 'DESQUALIFICADO_CIDADE';
    }

    // 3. Sem motivo de desqualificação, verificamos os dados faltantes.
    const dadosObrigatoriosPresentes =
      ficha.posse_imovel !== null &&
      ficha.tipo_imovel !== null &&
      valorConta !== null &&
      ficha.cidade !== null &&
      ficha.cidade.trim() !== '';

    if (!dadosObrigatoriosPresentes) {
      return 'INCOMPLETO';
    }

    // 4. Todos os critérios foram atendidos.
    return 'QUALIFICADO';
  }
}