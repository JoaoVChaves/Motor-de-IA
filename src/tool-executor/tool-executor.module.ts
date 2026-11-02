import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module.js';
import { CrmActionsModule } from '../crm-actions/crm-actions.module.js';
import { ToolExecutorService } from './tool-executor.service.js';

@Module({
  imports: [CrmModule, CrmActionsModule],
  providers: [ToolExecutorService],
  exports: [ToolExecutorService],
})
export class ToolExecutorModule {}