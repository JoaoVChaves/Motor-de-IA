import { describe, expect, it, beforeEach } from '@jest/globals';
import { QualificationService } from './qualification.service.js';

describe('QualificationService', () => {
  let service: QualificationService;

  const tenantSolNascente = {
    cidades_atendidas: [
      'Recife',
      'Olinda',
      'Jaboatão dos Guararapes',
      'Caruaru',
    ],
  };

  const tenantEcoVolt = {
    cidades_atendidas: [
      'Curitiba',
      'São José dos Pinhais',
      'Londrina',
    ],
  };

  const fichaCompleta = {
    posse_imovel: 'PROPRIO' as const,
    tipo_imovel: 'CASA' as const,
    valor_conta: 250,
    cidade: 'Caruaru',
    is_cliente_antigo: false,
    situacao_especial: null,
  };

  beforeEach(() => {
    service = new QualificationService();
  });

  it('deve qualificar um lead que atende a todos os critérios', () => {
    expect(
      service.avaliar(fichaCompleta, tenantSolNascente),
    ).toBe('QUALIFICADO');
  });

  it('deve transferir cliente antigo para atendimento humano', () => {
    const ficha = {
      ...fichaCompleta,
      is_cliente_antigo: true,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('TRANSFERIR_HUMANO');
  });

  it('deve transferir quando existir uma situação especial', () => {
    const ficha = {
      ...fichaCompleta,
      situacao_especial: 'Imóvel em inventário',
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('TRANSFERIR_HUMANO');
  });

  it('deve priorizar transferência humana sobre desqualificação', () => {
    const ficha = {
      ...fichaCompleta,
      posse_imovel: 'ALUGADO' as const,
      is_cliente_antigo: true,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('TRANSFERIR_HUMANO');
  });

  it('deve desqualificar imóvel alugado', () => {
    const ficha = {
      ...fichaCompleta,
      posse_imovel: 'ALUGADO' as const,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('DESQUALIFICADO_IMOVEL');
  });

  it('deve desqualificar apartamento', () => {
    const ficha = {
      ...fichaCompleta,
      tipo_imovel: 'APARTAMENTO' as const,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('DESQUALIFICADO_IMOVEL');
  });

  it('deve desqualificar conta abaixo de R$ 250', () => {
    const ficha = {
      ...fichaCompleta,
      valor_conta: 249.99,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('DESQUALIFICADO_CONTA');
  });

  it('deve aceitar conta exatamente igual a R$ 250', () => {
    expect(
      service.avaliar(fichaCompleta, tenantSolNascente),
    ).toBe('QUALIFICADO');
  });

  it('deve desqualificar cidade fora da área atendida', () => {
    const ficha = {
      ...fichaCompleta,
      cidade: 'São Paulo',
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('DESQUALIFICADO_CIDADE');
  });

  it('deve comparar cidades ignorando acentos e maiúsculas', () => {
    const ficha = {
      ...fichaCompleta,
      cidade: 'SAO JOSE DOS PINHAIS',
    };

    expect(
      service.avaliar(ficha, tenantEcoVolt),
    ).toBe('QUALIFICADO');
  });

  it('deve considerar a lista de cidades do tenant correto', () => {
    expect(
      service.avaliar(fichaCompleta, tenantEcoVolt),
    ).toBe('DESQUALIFICADO_CIDADE');
  });

  it('deve retornar incompleto quando faltarem informações', () => {
    const ficha = {
      ...fichaCompleta,
      cidade: null,
      valor_conta: null,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('INCOMPLETO');
  });

  it('deve retornar incompleto quando a posse do imóvel estiver ausente', () => {
    const ficha = {
      ...fichaCompleta,
      posse_imovel: null,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('INCOMPLETO');
  });

  it('deve desqualificar por imóvel mesmo quando outros dados estiverem ausentes', () => {
    const ficha = {
      ...fichaCompleta,
      posse_imovel: 'ALUGADO' as const,
      cidade: null,
      valor_conta: null,
    };

    expect(
      service.avaliar(ficha, tenantSolNascente),
    ).toBe('DESQUALIFICADO_IMOVEL');
  });
});