import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  CONVERSATION_QUEUE,
  DEBOUNCE_WINDOW_MS,
} from './queue.constants.js';

interface ConversationJobData {
  tenantId: string;
  conversationId: string;
}

@Injectable()
export class ConversationQueueService {
  constructor(
    @InjectQueue(CONVERSATION_QUEUE)
    private readonly queue: Queue<ConversationJobData>,
  ) {}

  async agendarProcessamento(
    tenantId: string,
    conversationId: string,
  ) {
    const jobId = `debounce-${tenantId}-${conversationId}`;

    const jobExistente = await this.queue.getJob(jobId);

    if (jobExistente) {
      const estado = await jobExistente.getState();

      if (estado === 'active') {
        return this.agendarProximoTurno(tenantId, conversationId);
      }

      await jobExistente.remove();
    }

    return this.criarJob(jobId, tenantId, conversationId);
  }

  private async agendarProximoTurno(
    tenantId: string,
    conversationId: string,
  ) {
    const jobId = `debounce-next-${tenantId}-${conversationId}`;

    const jobExistente = await this.queue.getJob(jobId);

    if (jobExistente) {
      const estado = await jobExistente.getState();

      if (estado === 'active') {
        return jobExistente;
      }

      await jobExistente.remove();
    }

    return this.criarJob(jobId, tenantId, conversationId);
  }

  private async criarJob(
    jobId: string,
    tenantId: string,
    conversationId: string,
  ) {
    return this.queue.add(
      'process-conversation',
      {
        tenantId,
        conversationId,
      },
      {
        jobId,
        delay: DEBOUNCE_WINDOW_MS,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 15000,
        },
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    );
  }

  async cancelarProcessamento(
    tenantId: string,
    conversationId: string,
  ) {
    const jobIds = [
      `debounce-${tenantId}-${conversationId}`,
      `debounce-next-${tenantId}-${conversationId}`,
    ];

    for (const jobId of jobIds) {
      const job = await this.queue.getJob(jobId);

      if (!job) continue;

      const estado = await job.getState();

      // Jobs ativos não podem ser removidos com segurança.
      // O Processor deve detectar a intervenção pela versão e pelo estado.
      if (estado === 'active') continue;

      await job.remove();
    }
  }
}