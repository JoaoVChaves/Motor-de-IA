import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: {
        id: tenantId,
      },
    });

    if (!tenant) {
      throw new NotFoundException(
        `Tenant com ID "${tenantId}" não encontrado.`,
      );
    }

    return tenant;
  }
}