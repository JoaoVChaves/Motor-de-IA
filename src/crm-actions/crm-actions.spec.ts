
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
        updateMany: jest.fn<(...args: any[]) => Promise<any>>(),
      },
      message: {
        findFirst: jest.fn<(...args: any[]) => Promise<any>>(),
      },
      scheduleSlot: {
        findMany: jest.fn<(...args: any[]) => Promise<any>>(),
        updateMany: jest.fn<(...args: any[]) => Promise<any>>(),
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

  const configurarCenarioAgendamento = () => {
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

    txMock.message.findFirst.mockResolvedValue({
      texto: 'Quero reservar o horário quinta-09.',
    });

    txMock.scheduleSlot.updateMany.mockResolvedValue({
      count: 1,
    });

    txMock.conversation.updateMany.mockResolvedValue({
      count: 1,
    });

    txMock.auditLog.create.mockResolvedValue({});
  };

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

  it('não deve persistir a tag quando adicionarTag estiver em modo simulação', async () => {
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

    const resultado = await service.adicionarTag(
      'sol-nascente',
      'conversa-1',
      'qualificado',
      true,
    );

    expect(resultado).toEqual({
      tags: ['qualificado'],
      resultadoQualificacao: 'QUALIFICADO',
    });

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        acao: 'adicionar_tag',
        resultado: 'SUCCESS',
        simulacao: true,
        detalhes: expect.stringContaining('[SIMULACAO]'),
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

  it('não deve persistir a mudança de estágio quando estiver em modo simulação', async () => {
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
    txMock.auditLog.create.mockResolvedValue({});

    const resultado = await service.moverEstagio(
      'sol-nascente',
      'conversa-1',
      'Qualificado',
      true,
    );

    expect(resultado).toEqual({
      estagio_atual: 'Qualificado',
    });

    expect(txMock.conversation.update).not.toHaveBeenCalled();

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'sol-nascente',
        conversation_id: 'conversa-1',
        acao: 'mover_estagio',
        resultado: 'SUCCESS',
        simulacao: true,
        detalhes: expect.stringContaining('[SIMULACAO]'),
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

  describe('marcarAgenda', () => {
    it('deve reservar um horário para lead qualificado e registrar auditoria', async () => {
      configurarCenarioAgendamento();

      const resultado = await service.marcarAgenda(
        'sol-nascente',
        'conversa-1',
        'quinta-09',
      );

      expect(resultado).toEqual({
        sucesso: true,
        codigo_horario: 'quinta-09',
        estagio_atual: 'Agendado',
      });

      expect(txMock.message.findFirst).toHaveBeenCalledWith({
        where: {
          conversation_id: 'conversa-1',
          tenant_id: 'sol-nascente',
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

      expect(txMock.scheduleSlot.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'sol-nascente',
          codigo_horario: 'quinta-09',
          disponivel: true,
        },
        data: expect.objectContaining({
          disponivel: false,
          booked_conversation_id: 'conversa-1',
          booked_at: expect.any(Date),
        }),
      });

      expect(txMock.conversation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'conversa-1',
          tenant_id: 'sol-nascente',
          estado: 'PROCESSANDO',
        },
        data: {
          estagio_atual: 'Agendado',
        },
      });

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'sol-nascente',
          conversation_id: 'conversa-1',
          acao: 'marcar_agenda',
          resultado: 'SUCCESS',
        }),
      });
    });

    it('deve rejeitar quando a conversa não está em processamento', async () => {
      configurarCenarioAgendamento();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'IA_ATIVA',
        tenant: {
          estagios: ['Novo', 'Qualificacao', 'Agendado'],
          cidades_atendidas: ['Caruaru'],
        },
        lead_sheet: {},
      });

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acao: 'marcar_agenda',
          resultado: 'REJECTED_BY_POLICY',
        }),
      });
    });

    it('deve rejeitar quando a conversa não possui ficha de lead', async () => {
      configurarCenarioAgendamento();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
        tenant: {
          estagios: ['Novo', 'Qualificacao', 'Agendado'],
          cidades_atendidas: ['Caruaru'],
        },
        lead_sheet: null,
      });

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando o lead não está qualificado', async () => {
      configurarCenarioAgendamento();

      qualificationServiceMock.avaliar.mockReturnValue(
        'DESQUALIFICADO_CONTA',
      );

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando não existe mensagem do cliente', async () => {
      configurarCenarioAgendamento();

      txMock.message.findFirst.mockResolvedValue(null);

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando a última mensagem não contém o código solicitado', async () => {
      configurarCenarioAgendamento();

      txMock.message.findFirst.mockResolvedValue({
        texto: 'Prefiro conversar outro dia.',
      });

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando o horário não está disponível', async () => {
      configurarCenarioAgendamento();

      txMock.scheduleSlot.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando a conversa não pertence ao tenant informado', async () => {
      configurarCenarioAgendamento();

      txMock.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.marcarAgenda(
          'ecovolt-sul',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.scheduleSlot.updateMany).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando o estado da conversa muda durante a reserva', async () => {
      configurarCenarioAgendamento();

      txMock.conversation.updateMany.mockResolvedValue({
        count: 0,
      });

      await expect(
        service.marcarAgenda(
          'sol-nascente',
          'conversa-1',
          'quinta-09',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.scheduleSlot.updateMany).toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('consultarAgenda', () => {
    it('deve retornar somente os horários disponíveis do tenant e registrar auditoria', async () => {
      const horarios = [
        {
          codigo_horario: 'quinta-09',
          descricao: 'Quinta-feira - 09:00 (Manhã)',
        },
        {
          codigo_horario: 'quinta-10',
          descricao: 'Quinta-feira - 10:00 (Manhã)',
        },
      ];

      txMock.scheduleSlot.findMany.mockResolvedValue(horarios);
      txMock.auditLog.create.mockResolvedValue({});

      const resultado = await service.consultarAgenda('sol-nascente');

      expect(resultado).toEqual({ horarios });

      expect(txMock.scheduleSlot.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'sol-nascente',
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

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'sol-nascente',
          acao: 'consultar_agenda',
          resultado: 'SUCCESS',
        }),
      });
    });

    it('deve retornar lista vazia quando não existem horários disponíveis', async () => {
      txMock.scheduleSlot.findMany.mockResolvedValue([]);
      txMock.auditLog.create.mockResolvedValue({});

      const resultado = await service.consultarAgenda('sol-nascente');

      expect(resultado).toEqual({ horarios: [] });

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'sol-nascente',
          acao: 'consultar_agenda',
          resultado: 'SUCCESS',
          detalhes: expect.stringContaining('0 horário(s)'),
        }),
      });
    });

    it('deve consultar somente os horários do tenant informado', async () => {
      txMock.scheduleSlot.findMany.mockResolvedValue([]);
      txMock.auditLog.create.mockResolvedValue({});

      await service.consultarAgenda('ecovolt-sul');

      expect(txMock.scheduleSlot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'ecovolt-sul',
            disponivel: true,
          },
        }),
      );

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'ecovolt-sul',
        }),
      });
    });

    it('não deve retornar horários se a consulta ao banco falhar', async () => {
      txMock.scheduleSlot.findMany.mockRejectedValue(
        new Error('Erro ao consultar agenda'),
      );

      await expect(
        service.consultarAgenda('sol-nascente'),
      ).rejects.toThrow('Erro ao consultar agenda');

      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

  
  describe('notificarEquipe', () => {
    const configurarCenarioNotificacao = () => {
      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
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
    };

    it('deve registrar notificação simulada sem envio externo', async () => {
      configurarCenarioNotificacao();

      const resultado = await service.notificarEquipe(
        'sol-nascente',
        'conversa-1',
        'Lead interessado em energia solar.',
        true,
      );

      expect('sucesso' in resultado).toBe(true);

      if ('sucesso' in resultado) {
        expect(resultado.sucesso).toBe(true);
        expect(resultado.simulacao).toBe(true);
        expect(resultado.resultado).toBe('SUCCESS');
        expect(resultado.statusNotificacao).toBe('SIMULADA');
      }

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: 'sol-nascente',
          conversation_id: 'conversa-1',
          acao: 'notificar_equipe',
          simulacao: true,
          resultado: 'SUCCESS',
          detalhes: expect.stringContaining('[SIMULACAO]'),
        }),
      });
    });

    it('deve registrar notificação pendente quando não está em simulação', async () => {
      configurarCenarioNotificacao();

      const resultado = await service.notificarEquipe(
        'sol-nascente',
        'conversa-1',
        'Lead interessado em energia solar.',
        false,
      );

      expect('sucesso' in resultado).toBe(true);

      if ('sucesso' in resultado) {
        expect(resultado.sucesso).toBe(true);
        expect(resultado.simulacao).toBe(false);
        expect(resultado.resultado).toBe('SUCCESS');
        expect(resultado.statusNotificacao).toBe('PENDENTE');
      }

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          simulacao: false,
          resultado: 'SUCCESS',
          detalhes: expect.stringContaining('[PENDENTE]'),
        }),
      });
    });

    it('deve rejeitar notificação para lead desqualificado', async () => {
      configurarCenarioNotificacao();

      qualificationServiceMock.avaliar.mockReturnValue(
        'DESQUALIFICADO_CONTA',
      );

      await expect(
        service.notificarEquipe(
          'sol-nascente',
          'conversa-1',
          'Lead interessado.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acao: 'notificar_equipe',
          resultado: 'REJECTED_BY_POLICY',
        }),
      });
    });

    it('deve rejeitar quando a conversa não está em processamento', async () => {
      configurarCenarioNotificacao();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'IA_ATIVA',
        lead_sheet: {},
        tenant: {
          cidades_atendidas: ['Caruaru'],
        },
      });

      await expect(
        service.notificarEquipe(
          'sol-nascente',
          'conversa-1',
          'Lead interessado.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando não existe ficha de lead', async () => {
      configurarCenarioNotificacao();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
        lead_sheet: null,
        tenant: {
          cidades_atendidas: ['Caruaru'],
        },
      });

      await expect(
        service.notificarEquipe(
          'sol-nascente',
          'conversa-1',
          'Lead interessado.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(qualificationServiceMock.avaliar).not.toHaveBeenCalled();
    });

    it('deve rejeitar resumo vazio', async () => {
      configurarCenarioNotificacao();

      await expect(
        service.notificarEquipe(
          'sol-nascente',
          'conversa-1',
          '   ',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resultado: 'REJECTED_BY_POLICY',
        }),
      });
    });

    it('deve rejeitar conversa inexistente ou de outro tenant', async () => {
      configurarCenarioNotificacao();

      txMock.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.notificarEquipe(
          'ecovolt-sul',
          'conversa-1',
          'Lead interessado.',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

  
  describe('transferirHumano', () => {
    const configurarCenarioTransferencia = () => {
      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
        estagio_atual: 'Qualificacao',
        version: 1,
        tags: ['origem-site'],
        lead_sheet: {
          is_cliente_antigo: false,
        },
        tenant: {
          estagios: [
            'Novo',
            'Qualificacao',
            'Qualificado',
            'Desqualificado',
            'Agendado',
            'Humano',
          ],
        },
      });

      txMock.conversation.updateMany.mockResolvedValue({ count: 1 });
      txMock.auditLog.create.mockResolvedValue({});
    };

    it('deve transferir conversa para atendimento humano', async () => {
      configurarCenarioTransferencia();

      const resultado = await service.transferirHumano(
        'sol-nascente',
        'conversa-1',
        'Cliente solicitou atendimento humano.',
      );

      expect('sucesso' in resultado).toBe(true);

      if ('sucesso' in resultado) {
        expect(resultado.sucesso).toBe(true);
        expect(resultado.estado).toBe('HUMANO_PENDENTE');
        expect(resultado.estagio_atual).toBe('Humano');
        expect(resultado.motivo_transferencia).toBe(
          'Cliente solicitou atendimento humano.',
        );
      }

      expect(txMock.conversation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'conversa-1',
          tenant_id: 'sol-nascente',
          estado: 'PROCESSANDO',
          version: 1,
        },
        data: {
          estado: 'HUMANO_PENDENTE',
          estagio_atual: 'Humano',
          motivo_transferencia: 'Cliente solicitou atendimento humano.',
          tags: ['origem-site'],
          version: { increment: 1 },
        },
      });

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acao: 'transferir_humano',
          resultado: 'SUCCESS',
        }),
      });
    });

    it('deve adicionar automaticamente a tag cliente-antigo na transferência', async () => {
      configurarCenarioTransferencia();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
        estagio_atual: 'Qualificacao',
        version: 1,
        tags: ['origem-site'],
        lead_sheet: {
          is_cliente_antigo: true,
        },
        tenant: {
          estagios: [
            'Novo',
            'Qualificacao',
            'Qualificado',
            'Desqualificado',
            'Agendado',
            'Humano',
          ],
        },
      });

      await service.transferirHumano(
        'sol-nascente',
        'conversa-1',
        'Cliente solicitou atendimento humano.',
      );

      expect(txMock.conversation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'conversa-1',
          tenant_id: 'sol-nascente',
          estado: 'PROCESSANDO',
          version: 1,
        },
        data: {
          estado: 'HUMANO_PENDENTE',
          estagio_atual: 'Humano',
          motivo_transferencia: 'Cliente solicitou atendimento humano.',
          tags: ['origem-site', 'cliente-antigo'],
          version: { increment: 1 },
        },
      });

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          acao: 'transferir_humano',
          resultado: 'SUCCESS',
          detalhes: expect.stringContaining('Tag cliente-antigo aplicada.'),
        }),
      });
    });

    it('deve rejeitar conversa que não está em processamento', async () => {
      configurarCenarioTransferencia();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'IA_ATIVA',
        version: 1,
        tenant: { estagios: ['Humano'] },
      });

      await expect(
        service.transferirHumano(
          'sol-nascente',
          'conversa-1',
          'Solicitação do cliente.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.conversation.updateMany).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resultado: 'REJECTED_BY_POLICY',
        }),
      });
    });

    it('deve rejeitar motivo vazio', async () => {
      configurarCenarioTransferencia();

      await expect(
        service.transferirHumano('sol-nascente', 'conversa-1', '   '),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando o estágio Humano não está configurado', async () => {
      configurarCenarioTransferencia();

      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
        tenant_id: 'sol-nascente',
        estado: 'PROCESSANDO',
        version: 1,
        tenant: { estagios: ['Novo', 'Qualificacao'] },
      });

      await expect(
        service.transferirHumano(
          'sol-nascente',
          'conversa-1',
          'Solicitação do cliente.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.conversation.updateMany).not.toHaveBeenCalled();
    });

    it('deve rejeitar quando a versão da conversa foi alterada', async () => {
      configurarCenarioTransferencia();

      txMock.conversation.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.transferirHumano(
          'sol-nascente',
          'conversa-1',
          'Solicitação do cliente.',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(txMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resultado: 'REJECTED_BY_POLICY',
          detalhes: expect.stringContaining('modificada'),
        }),
      });
    });

    it('deve rejeitar conversa inexistente ou de outro tenant', async () => {
      configurarCenarioTransferencia();

      txMock.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.transferirHumano(
          'ecovolt-sul',
          'conversa-1',
          'Solicitação do cliente.',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.conversation.updateMany).not.toHaveBeenCalled();
      expect(txMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

});
