
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CrmActionsService } from './crm-actions.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualificationService } from '../qualification/qualification.service.js';
import { jest, describe, expect, it, beforeEach } from '@jest/globals';

describe('CrmActionsService', () => {
  let service: CrmActionsService;

  const txMock = {
    conversation: {
      findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
      update: jest.fn<(...args: any[]) => Promise<any>>(),
    },
    auditLog: {
      create: jest.fn<(...args: any[]) => Promise<any>>(),
    },
  };

  const prismaMock = {
    $transaction: jest.fn(
      async (callback: (tx: typeof txMock) => Promise<unknown>) => {
        return callback(txMock);
      },
    ),
  };

  const qualificationServiceMock = {
    avaliar: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmActionsService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: QualificationService,
          useValue: qualificationServiceMock,
        },
      ],
    }).compile();

    service = module.get<CrmActionsService>(CrmActionsService);
  });

  it('deve criar o serviço', () => {
    expect(service).toBeDefined();
  });

  it('deve adicionar uma tag válida e registrar auditoria de sucesso', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('QUALIFICADO');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.adicionarTag(
      'sol-nascente',
      'conversa-1',
      'qualificado',
    );

    expect(resultado).toEqual({
      tags: ['qualificado'],
      resultadoQualificacao: 'QUALIFICADO',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { tags: ['qualificado'] },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'sol-nascente',
        conversation_id: 'conversa-1',
        acao: 'adicionar_tag',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve rejeitar a tag qualificado quando a ficha está incompleta', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: null,
        tipo_imovel: null,
        posse_imovel: null,
        valor_conta: null,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('INCOMPLETO');
    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-1',
        'qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar a tag quando a conversa não está em processamento', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'IA_ATIVA',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-1',
        'qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar a tag quando a conversa não possui ficha de lead', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: null,
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-1',
        'qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'REJECTED_BY_POLICY',
        detalhes: 'Não existe ficha de lead para esta conversa.',
      }),
    });
  });

  it('deve rejeitar quando a conversa não existe para o tenant informado', async () => {
    txMock.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-inexistente',
        'qualificado',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
    expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
  });

  it('deve rejeitar a tag desqualificado quando o lead está qualificado', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('QUALIFICADO');
    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-1',
        'desqualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve adicionar a tag desqualificado quando o lead está desqualificado', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 200,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('DESQUALIFICADO_CONTA');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.adicionarTag(
      'sol-nascente',
      'conversa-1',
      'desqualificado',
    );

    expect(resultado).toEqual({
      tags: ['desqualificado'],
      resultadoQualificacao: 'DESQUALIFICADO_CONTA',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { tags: ['desqualificado'] },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve rejeitar a tag cliente-antigo quando o lead não é cliente antigo', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('QUALIFICADO');
    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.adicionarTag(
        'sol-nascente',
        'conversa-1',
        'cliente-antigo',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve adicionar a tag cliente-antigo quando o lead é cliente antigo', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tags: [],
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: true,
        situacao_especial: null,
      },
      tenant: {
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('TRANSFERIR_HUMANO');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.adicionarTag(
      'sol-nascente',
      'conversa-1',
      'cliente-antigo',
    );

    expect(resultado).toEqual({
      tags: ['cliente-antigo'],
      resultadoQualificacao: 'TRANSFERIR_HUMANO',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { tags: ['cliente-antigo'] },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve mover o lead qualificado para o estágio Qualificado e registrar auditoria', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('QUALIFICADO');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.moverEstagio(
      'sol-nascente',
      'conversa-1',
      'Qualificado',
    );

    expect(resultado).toEqual({
      estagio_atual: 'Qualificado',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { estagio_atual: 'Qualificado' },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'sol-nascente',
        conversation_id: 'conversa-1',
        acao: 'mover_estagio',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve rejeitar a movimentação para Qualificado quando o lead está desqualificado', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 200,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('DESQUALIFICADO_CONTA');
    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio(
        'sol-nascente',
        'conversa-1',
        'Qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve mover o lead desqualificado para o estágio Desqualificado', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 200,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('DESQUALIFICADO_CONTA');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.moverEstagio(
      'sol-nascente',
      'conversa-1',
      'Desqualificado',
    );

    expect(resultado).toEqual({
      estagio_atual: 'Desqualificado',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { estagio_atual: 'Desqualificado' },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve rejeitar mover diretamente para Humano quando a qualificação exige transferência', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: true,
        situacao_especial: null,
      },
    });

    txMock.auditLog.create.mockResolvedValue({});
    qualificationServiceMock.avaliar.mockReturnValue('TRANSFERIR_HUMANO');

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', 'Humano'),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar a movimentação para Qualificado quando a ficha está incompleta', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: null,
        tipo_imovel: null,
        posse_imovel: null,
        valor_conta: null,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('INCOMPLETO');
    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio(
        'sol-nascente',
        'conversa-1',
        'Qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve permitir mover para Qualificacao quando a ficha está incompleta', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: null,
        tipo_imovel: null,
        posse_imovel: null,
        valor_conta: null,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    qualificationServiceMock.avaliar.mockReturnValue('INCOMPLETO');
    txMock.conversation.update.mockResolvedValue({});
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.moverEstagio(
      'sol-nascente',
      'conversa-1',
      'Qualificacao',
    );

    expect(resultado).toEqual({
      estagio_atual: 'Qualificacao',
    });

    expect(txMock.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conversa-1' },
      data: { estagio_atual: 'Qualificacao' },
    });

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'SUCCESS',
      }),
    });
  });

  it('deve rejeitar a movimentação quando a conversa não está em processamento', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'IA_ATIVA',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio(
        'sol-nascente',
        'conversa-1',
        'Qualificado',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar a movimentação quando a conversa não possui ficha', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: null,
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', 'Qualificacao'),
    ).rejects.toThrow(ForbiddenException);

    expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar um estágio que não está configurado no tenant', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: ['Novo', 'Qualificacao', 'Qualificado'],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', 'Desqualificado'),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar um estágio vazio', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    txMock.auditLog.create.mockResolvedValue({});

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', '   '),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar mover diretamente para Agendado', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: [
          'Novo',
          'Qualificacao',
          'Qualificado',
          'Desqualificado',
          'Agendado',
          'Humano',
        ],
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    txMock.auditLog.create.mockResolvedValue({});
    qualificationServiceMock.avaliar.mockReturnValue('QUALIFICADO');

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', 'Agendado'),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
      }),
    });
  });

  it('deve rejeitar a movimentação quando a conversa não pertence ao tenant informado', async () => {
    txMock.conversation.findFirst.mockResolvedValue(null);

    await expect(
      service.moverEstagio(
        'ecovolt-sul',
        'conversa-1',
        'Qualificacao',
      ),
    ).rejects.toThrow(NotFoundException);

    expect(txMock.conversation.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('deve rejeitar quando a configuração de estágios do tenant é inválida', async () => {
    txMock.conversation.findFirst.mockResolvedValue({
      id: 'conversa-1',
      tenant_id: 'sol-nascente',
      estado: 'PROCESSANDO',
      tenant: {
        estagios: null,
        cidades_atendidas: ['Caruaru', 'Recife', 'Olinda'],
      },
      lead_sheet: {
        nome: 'João',
        cidade: 'Caruaru',
        tipo_imovel: 'CASA',
        posse_imovel: 'PROPRIO',
        valor_conta: 300,
        is_cliente_antigo: false,
        situacao_especial: null,
      },
    });

    await expect(
      service.moverEstagio('sol-nascente', 'conversa-1', 'Qualificado'),
    ).rejects.toThrow(ForbiddenException);

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'mover_estagio',
        resultado: 'REJECTED_BY_POLICY',
        detalhes: 'A configuração de estágios do tenant é inválida.',
      }),
    });
  });
});
