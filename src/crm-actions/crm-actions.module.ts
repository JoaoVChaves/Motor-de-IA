import { Module } from '@nestjs/common';
import { CrmActionsService } from './crm-actions.service.js';
import { QualificationService } from '../qualification/qualification.service.js';

@Module({
  providers: [CrmActionsService, QualificationService],
  exports: [CrmActionsService],
})
export class CrmActionsModule {}