
import { Controller, Get, Param } from '@nestjs/common';
import { ConversationsService } from './conversations.service.js';

@Controller('conversas')
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get(':tenant_id/:telefone')
  async consultar(
    @Param('tenant_id') tenantId: string,
    @Param('telefone') telefone: string,
  ) {
    return this.conversationsService.consultar(tenantId, telefone);
  }
}
