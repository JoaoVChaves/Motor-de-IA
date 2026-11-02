
import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [TenantsModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
