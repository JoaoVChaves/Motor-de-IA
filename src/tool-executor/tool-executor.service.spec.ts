
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { jest, describe, expect, it, beforeEach } from '@jest/globals';

import { ToolExecutorService } from './tool-executor.service.js';
import { CrmService } from '../crm/crm.service.js';
import { CrmActionsService } from '../crm-actions/crm-actions.service.js';

describe('ToolExecutorService', () => {
  let service: ToolExecutorService;

  const crmServiceMock = {
    atualizarFicha: jest.fn<(...args: any[]) => Promise<any>>(),
  };

  const crmActionsServiceMock = {
    adicionarTag: jest.fn<(...args: any[]) => Promise<any>>(),
    moverEstagio: jest.fn<(...args: any[]) => Promise<any>>(),
    consultarAgenda: jest.fn<(...args: any[]) => Promise<any>>(),
    marcarAgenda: jest.fn<(...args: any[]) => Promise<any>>(),
    notificarEquipe: jest.fn<(...args: any[]) => Promise<any>>(),
    transferirHumano: jest.fn<(...args: any[]) => Promise<any>>(),
  };

  const contexto = {
    tenantId: 'sol-nascente',
    conversaId: 'conversa-1',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolExecutorService,
        {
          provide: CrmService,
          useValue: crmServiceMock,
        },
        {
          provide: CrmActionsService,
          useValue: crmActionsServiceMock,
        },
      ],
    }).compile();

    service = module.get<ToolExecutorService>(ToolExecutorService);
  });

  it('deve criar o serviço', () => {
    expect(service).toBeDefined();
  });

  it('deve encaminhar atualizar_ficha ao CrmService', async () => {
    crmServiceMock.atualizarFicha.mockResolvedValue({
      nome: 'João',
    });

    const resultado = await service.executar(
      'atualizar_ficha',
      {
        campo: 'nome',
        valor: 'João',
      },
      contexto,
    );

    expect(crmServiceMock.atualizarFicha).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      { nome: 'João' },
    );

    expect(resultado).toEqual({
      sucesso: true,
      dados: { nome: 'João' },
    });
  });

  it('deve converter valor_conta para número antes de atualizar a ficha', async () => {
    crmServiceMock.atualizarFicha.mockResolvedValue({});

    await service.executar(
      'atualizar_ficha',
      {
        campo: 'valor_conta',
        valor: '250,50',
      },
      contexto,
    );

    expect(crmServiceMock.atualizarFicha).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      { valorConta: 250.5 },
    );
  });

  it('deve encaminhar adicionar_tag ao CrmActionsService', async () => {
    crmActionsServiceMock.adicionarTag.mockResolvedValue({
      tags: ['qualificado'],
    });

    await service.executar(
      'adicionar_tag',
      { tag: 'qualificado' },
      contexto,
    );

    expect(crmActionsServiceMock.adicionarTag).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      'qualificado',
      false,
    );
  });

  it('deve encaminhar mover_estagio ao CrmActionsService', async () => {
    crmActionsServiceMock.moverEstagio.mockResolvedValue({
      estagio_atual: 'Qualificado',
    });

    await service.executar(
      'mover_estagio',
      { estagio: 'Qualificado' },
      contexto,
    );

    expect(crmActionsServiceMock.moverEstagio).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      'Qualificado',
      false,
    );
  });

  it('deve encaminhar consultar_agenda ao CrmActionsService', async () => {
    crmActionsServiceMock.consultarAgenda.mockResolvedValue({
      horarios: [],
    });

    await service.executar(
      'consultar_agenda',
      {},
      contexto,
    );

    expect(crmActionsServiceMock.consultarAgenda).toHaveBeenCalledWith(
      'sol-nascente',
    );
  });

  it('deve encaminhar marcar_agenda ao CrmActionsService', async () => {
    crmActionsServiceMock.marcarAgenda.mockResolvedValue({
      sucesso: true,
    });

    await service.executar(
      'marcar_agenda',
      { codigo_horario: 'quinta-09' },
      contexto,
    );

    expect(crmActionsServiceMock.marcarAgenda).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      'quinta-09',
    );
  });

  it('deve encaminhar notificar_equipe ao CrmActionsService', async () => {
    crmActionsServiceMock.notificarEquipe.mockResolvedValue({
      sucesso: true,
    });

    await service.executar(
      'notificar_equipe',
      { resumo: 'Lead interessado em energia solar.' },
      contexto,
    );

    expect(crmActionsServiceMock.notificarEquipe).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      'Lead interessado em energia solar.',
      false,
    );
  });

  it('deve encaminhar transferir_humano ao CrmActionsService', async () => {
    crmActionsServiceMock.transferirHumano.mockResolvedValue({
      sucesso: true,
    });

    await service.executar(
      'transferir_humano',
      { motivo: 'Cliente solicitou atendimento humano.' },
      contexto,
    );

    expect(crmActionsServiceMock.transferirHumano).toHaveBeenCalledWith(
      'sol-nascente',
      'conversa-1',
      'Cliente solicitou atendimento humano.',
    );
  });

  it('deve aceitar cliente_antigo como argumento opcional', async () => {
    crmActionsServiceMock.transferirHumano.mockResolvedValue({
      sucesso: true,
    });

    await expect(
      service.executar(
        'transferir_humano',
        {
          motivo: 'Solicitação do cliente.',
          cliente_antigo: true,
        },
        contexto,
      ),
    ).resolves.toEqual({
      sucesso: true,
      dados: { sucesso: true },
    });

    expect(crmActionsServiceMock.transferirHumano).toHaveBeenCalled();
  });

  it('deve rejeitar ferramenta desconhecida', async () => {
    await expect(
      service.executar('ferramenta_inexistente', {}, contexto),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar argumentos que não sejam objetos', async () => {
    await expect(
      service.executar('consultar_agenda', 'inválido', contexto),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.executar('consultar_agenda', null, contexto),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar argumentos obrigatórios ausentes', async () => {
    await expect(
      service.executar('adicionar_tag', {}, contexto),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar argumentos não permitidos', async () => {
    await expect(
      service.executar(
        'adicionar_tag',
        {
          tag: 'qualificado',
          tenantId: 'outro-tenant',
        },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar uma tag inválida', async () => {
    await expect(
      service.executar(
        'adicionar_tag',
        { tag: 'tag-inexistente' },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar um campo de ficha inválido', async () => {
    await expect(
      service.executar(
        'atualizar_ficha',
        {
          campo: 'senha',
          valor: '123456',
        },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar valor vazio ao atualizar ficha', async () => {
    await expect(
      service.executar(
        'atualizar_ficha',
        {
          campo: 'nome',
          valor: '',
        },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar valor de conta não numérico', async () => {
    await expect(
      service.executar(
        'atualizar_ficha',
        {
          campo: 'valor_conta',
          valor: 'duzentos reais',
        },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar contexto sem tenantId', async () => {
    await expect(
      service.executar(
        'consultar_agenda',
        {},
        {
          tenantId: '',
          conversaId: 'conversa-1',
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar contexto sem conversaId', async () => {
    await expect(
      service.executar(
        'consultar_agenda',
        {},
        {
          tenantId: 'sol-nascente',
          conversaId: '',
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar cliente_antigo quando não for booleano', async () => {
    await expect(
      service.executar(
        'transferir_humano',
        {
          motivo: 'Solicitação do cliente.',
          cliente_antigo: 'sim',
        },
        contexto,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve rejeitar quando o modo de simulação não for booleano', async () => {
    await expect(
      service.executar(
        'adicionar_tag',
        { tag: 'qualificado' },
        {
          ...contexto,
          simulacao: 'sim' as unknown as boolean,
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
