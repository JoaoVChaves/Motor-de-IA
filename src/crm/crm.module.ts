import { Module } from '@nestjs/common';
import { CrmService } from './crm.service.js';

@Module({
  providers: [CrmService],
  exports: [CrmService],
})
export class CrmModule {}