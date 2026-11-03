import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module.js';
import { QueueModule } from '../queue/queue.module.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

@Module({
  imports: [TenantsModule, QueueModule],
  controllers: [WebhookController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}