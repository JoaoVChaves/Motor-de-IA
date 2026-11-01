import { NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { beforeEach, describe, expect, it, jest, } from '@jest/globals';

describe('TenantsService', () => {
  let service: TenantsService;

  const prismaMock = {
    tenant: {
      findUnique: jest.fn<(args: { where: { id: string } }) => Promise<unknown>>(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new TenantsService(
      prismaMock as unknown as PrismaService,
    );
  });

  it('deve retornar um tenant quando ele existir', async () => {
    const tenantMock = {
      id: 'sol-nascente',
      nome_empresa: 'Sol Nascente Energia Solar',
    };

    prismaMock.tenant.findUnique.mockResolvedValue(tenantMock);

    const result = await service.findById('sol-nascente');

    expect(result).toEqual(tenantMock);

    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith({
      where: {
        id: 'sol-nascente',
      },
    });
  });

  it('deve lançar NotFoundException quando o tenant não existir', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);

    await expect(service.findById('tenant-inexistente')).rejects.toThrow(
      NotFoundException,
    );
  });
});