import { describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';

import { QueueModule } from './queue.module.js';
import { CONVERSATION_QUEUE } from './queue.constants.js';

describe('ConversationProcessor (integração)', () => {
  jest.setTimeout(20000);

  it('deve consumir um job enviado para a fila real', async () => {
    let moduleRef: TestingModule | undefined;
    let queueEvents: QueueEvents | undefined;

    try {
      moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ isGlobal: true }),
          QueueModule,
        ],
      }).compile();

      await moduleRef.init();

      const queue = moduleRef.get<Queue>(
        getQueueToken(CONVERSATION_QUEUE),
      );

      queueEvents = new QueueEvents(CONVERSATION_QUEUE, {
        connection: {
          host: process.env.REDIS_HOST ?? 'localhost',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      });

      await queueEvents.waitUntilReady();

      const job = await queue.add(
        'process-conversation',
        {
          tenantId: 'tenant-integration',
          conversationId: 'conversation-integration',
        },
        {
          jobId: `worker-integration-${Date.now()}`,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      await expect(
        job.waitUntilFinished(queueEvents, 10000),
      ).resolves.toBeNull();
    } finally {
      await queueEvents?.close();
      await moduleRef?.close();
    }
  });
});