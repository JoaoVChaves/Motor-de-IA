import { Module } from '@nestjs/common';
import { CrmService } from './crm.service.js';
import { QualificationService } from '../qualification/qualification.service.js';

@Module({
  providers: [CrmService, QualificationService],
  exports: [CrmService],
})
export class CrmModule {}