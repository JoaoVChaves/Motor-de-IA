import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { CONVERSATION_QUEUE } from './queue.constants.js';
import { ConversationQueueService } from './conversation-queue.service.js';
import { ConversationProcessor } from './conversation.processor.js';
import { RedisLockService } from './redis-lock.service.js';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),

    BullModule.registerQueue({
      name: CONVERSATION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 15000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    }),
  ],
  providers: [ConversationQueueService,ConversationProcessor, RedisLockService],
  exports: [BullModule, ConversationQueueService,RedisLockService],
})
export class QueueModule {}