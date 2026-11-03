
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service.js';
import { CrmService } from './crm.service.js';
import { QualificationService } from '../qualification/qualification.service.js';

const txMock = {
  $queryRaw: jest.fn<
    (...args: any[]) => Promise<
      { id: string; estado: string; version: number }[]
    >
  >(),

  leadSheet: {
    upsert: jest.fn<
      (args: {
        where: {
          conversation_id: string;
        };
        update: Record<string, unknown>;
        create: {
          conversation_id: string;
        } & Record<string, unknown>;
      }) => Promise<unknown>
    >(),
  },

  tenant: {
    findUnique: jest.fn<
      (args: {
        where: { id: string };
        select: { cidades_atendidas: true };
      }) => Promise<{ cidades_atendidas: unknown } | null>
    >(),
  },
};

const prismaMock = {
  $transaction: jest.fn<
    (callback: (tx: typeof txMock) => Promise<unknown>) => Promise<unknown>
  >(),
};

describe('CrmService', () => {
  let service: CrmService;

  const expectedVersion = 2;

  const mockConversaValida = () => {
    txMock.$queryRaw.mockResolvedValue([
      {
        id: 'conversa-1',
        estado: 'PROCESSANDO',
        version: expectedVersion,
      },
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation((callback) =>
      callback(txMock),
    );

    txMock.tenant.findUnique.mockResolvedValue({
      cidades_atendidas: ['Caruaru'],
    });

    service = new CrmService(
      prismaMock as unknown as PrismaService,
      {
        avaliar: jest.fn().mockReturnValue('INCOMPLETO'),
      } as unknown as QualificationService,
    );
  });

  describe('atualizarFicha', () => {
    it('deve atualizar somente os campos válidos e ignorar os vazios', async () => {
      mockConversaValida();

      const fichaAtualizada = {
        nome: 'Maria',
        posse_imovel: 'PROPRIO',
      };

      txMock.leadSheet.upsert.mockResolvedValue(fichaAtualizada);

      const resultado = await service.atualizarFicha(
        'sol-nascente',
        'conversa-1',
        {
          nome: 'Maria',
          cidade: null,
          valorConta: undefined,
          posseImovel: 'PROPRIO',
        },
        expectedVersion,
      );

      expect(resultado).toEqual({
        ficha: fichaAtualizada,
        qualificacao: 'INCOMPLETO',
      });

      expect(txMock.$queryRaw).toHaveBeenCalledTimes(1);

      expect(txMock.leadSheet.upsert).toHaveBeenCalledWith({
        where: {
          conversation_id: 'conversa-1',
        },
        update: {
          nome: 'Maria',
          posse_imovel: 'PROPRIO',
        },
        create: {
          conversation_id: 'conversa-1',
          nome: 'Maria',
          posse_imovel: 'PROPRIO',
        },
      });
    });

    it('deve criar a ficha quando ela ainda não existe', async () => {
      mockConversaValida();

      txMock.leadSheet.upsert.mockResolvedValue({
        nome: 'João',
      });

      await service.atualizarFicha(
        'sol-nascente',
        'conversa-1',
        {
          nome: 'João',
        },
        expectedVersion,
      );

      expect(txMock.leadSheet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversation_id: 'conversa-1',
          },
          create: {
            conversation_id: 'conversa-1',
            nome: 'João',
          },
        }),
      );
    });

    it('deve rejeitar valor de enum inválido', async () => {
      await expect(
        service.atualizarFicha(
          'sol-nascente',
          'conversa-1',
          {
            posseImovel: 'CEDIDO',
          },
          expectedVersion,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('deve rejeitar valor de conta que não seja numérico', async () => {
      await expect(
        service.atualizarFicha(
          'sol-nascente',
          'conversa-1',
          {
            valorConta: '350',
          },
          expectedVersion,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('não deve atualizar quando a conversa não pertence ao tenant informado', async () => {
      txMock.$queryRaw.mockResolvedValue([]);

      await expect(
        service.atualizarFicha(
          'ecovolt-sul',
          'conversa-1',
          {
            nome: 'Maria',
          },
          expectedVersion,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.leadSheet.upsert).not.toHaveBeenCalled();
    });

    it('deve ignorar strings contendo apenas espaços', async () => {
      mockConversaValida();

      txMock.leadSheet.upsert.mockResolvedValue({
        nome: 'Maria',
      });

      await service.atualizarFicha(
        'sol-nascente',
        'conversa-1',
        {
          nome: 'Maria',
          cidade: '   ',
        },
        expectedVersion,
      );

      expect(txMock.leadSheet.upsert).toHaveBeenCalledWith({
        where: {
          conversation_id: 'conversa-1',
        },
        update: {
          nome: 'Maria',
        },
        create: {
          conversation_id: 'conversa-1',
          nome: 'Maria',
        },
      });
    });

    it('deve rejeitar valores incertos sem persistir dados', async () => {
      await expect(
        service.atualizarFicha(
          'sol-nascente',
          'conversa-1',
          {
            nome: 'não informado',
          },
          expectedVersion,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('deve bloquear a atualização quando o estado ou a versão forem diferentes', async () => {
      txMock.$queryRaw.mockResolvedValue([
        {
          id: 'conversa-1',
          estado: 'HUMANO_ATIVO',
          version: 3,
        },
      ]);

      await expect(
        service.atualizarFicha(
          'sol-nascente',
          'conversa-1',
          {
            nome: 'Maria',
          },
          expectedVersion,
        ),
      ).rejects.toThrow(ConflictException);

      expect(txMock.leadSheet.upsert).not.toHaveBeenCalled();
      expect(txMock.tenant.findUnique).not.toHaveBeenCalled();
    });
  });
});
