import { describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';

import { QueueModule } from './queue.module.js';
import { CONVERSATION_QUEUE } from './queue.constants.js';
import { PrismaModule } from '../prisma/prisma.module.js';

describe('ConversationProcessor (integração)', () => {
  jest.setTimeout(20000);

  it('deve consumir um job enviado para a fila real', async () => {
    let moduleRef: TestingModule | undefined;
    let queueEvents: QueueEvents | undefined;

    try {
      moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          PrismaModule,
          QueueModule,
        ],
      }).compile();

      await moduleRef.init();

      const queue = moduleRef.get<Queue>(
        getQueueToken(CONVERSATION_QUEUE),
      );

      queueEvents = new QueueEvents(CONVERSATION_QUEUE, {
        connection: queue.opts.connection,
      });

      await queueEvents.waitUntilReady();

      const job = await queue.add(
        'process-conversation',
        {
          tenantId: 'tenant-integration',
          conversationId: '00000000-0000-4000-8000-000000000001',
        },
        {
          jobId: `worker-integration-${Date.now()}`,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      
      await job.waitUntilFinished(queueEvents, 10000);

      expect(await job.getState()).toBe('completed');

    } finally {
      await queueEvents?.close();
      await moduleRef?.close();
    }
  });
});