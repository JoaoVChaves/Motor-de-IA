import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module.js';
import { CrmActionsModule } from '../crm-actions/crm-actions.module.js';
import { ToolExecutorService } from './tool-executor.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [CrmModule, CrmActionsModule, PrismaModule],
  providers: [ToolExecutorService],
  exports: [ToolExecutorService],
})
export class ToolExecutorModule {}