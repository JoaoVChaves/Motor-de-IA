import { BadRequestException, NotFoundException, } from '@nestjs/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service.js';
import { CrmService } from './crm.service.js';

const txMock = {
  conversation: {
    findFirst: jest.fn<
      (args: {
        where: {
          id: string;
          tenant_id: string;
        };
        select: {
          id: true;
        };
      }) => Promise<{ id: string } | null>
    >(),
  },
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
};

const prismaMock = {
  $transaction: jest.fn<
    (callback: (tx: typeof txMock) => Promise<unknown>) => Promise<unknown>
  >(),
};

describe('CrmService', () => {
  let service: CrmService;

  beforeEach(() => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation((callback) =>
      callback(txMock),
    );

    service = new CrmService(
      prismaMock as unknown as PrismaService,
    );
  });

  describe('atualizarFicha', () => {
    it('deve atualizar somente os campos válidos e ignorar os vazios', async () => {
      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
      });

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
      );

      expect(resultado).toEqual(fichaAtualizada);

      expect(txMock.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'conversa-1',
          tenant_id: 'sol-nascente',
        },
        select: {
          id: true,
        },
      });

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
      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
      });

      txMock.leadSheet.upsert.mockResolvedValue({
        nome: 'João',
      });

      await service.atualizarFicha(
        'sol-nascente',
        'conversa-1',
        {
          nome: 'João',
        },
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
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('não deve atualizar quando a conversa não pertence ao tenant informado', async () => {
      txMock.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.atualizarFicha(
          'ecovolt-sul',
          'conversa-1',
          {
            nome: 'Maria',
          },
        ),
      ).rejects.toThrow(NotFoundException);

      expect(txMock.leadSheet.upsert).not.toHaveBeenCalled();
    });

    it('deve ignorar strings contendo apenas espaços', async () => {
      txMock.conversation.findFirst.mockResolvedValue({
        id: 'conversa-1',
      });

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
        ),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});