
import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { InterventionController } from './intervention.controller.js';
import { InterventionService } from './intervention.service.js';

@Module({
  imports: [TenantsModule],
  controllers: [InterventionController],
  providers: [InterventionService],
  exports: [InterventionService],
})
export class InterventionModule {}
