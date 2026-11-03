
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { ConversationQueueService } from './conversation-queue.service.js';

describe('ConversationQueueService', () => {
  let service: ConversationQueueService;
  let queue: any;

  const tenantId = 'tenant-1';
  const conversationId = 'conversation-1';

  beforeEach(() => {
    queue = {
      getJob: jest.fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue(null),

      add: jest.fn<(...args: any[]) => Promise<any>>()
        .mockResolvedValue({ id: 'job-1' }),
    };

    service = new ConversationQueueService(queue);
  });

  it('deve criar um job quando não existir outro', async () => {
    await service.agendarProcessamento(tenantId, conversationId);

    expect(queue.add).toHaveBeenCalledWith(
      'process-conversation',
      {
        tenantId,
        conversationId,
      },
      expect.objectContaining({
        jobId: 'debounce-tenant-1-conversation-1',
        delay: 8000,
      }),
    );
  });

  it('deve substituir um job que ainda está aguardando', async () => {
    const jobExistente = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('delayed'),
      remove: jest.fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    queue.getJob.mockResolvedValue(jobExistente);

    await service.agendarProcessamento(tenantId, conversationId);

    expect(jobExistente.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('deve agendar o próximo turno quando o job principal estiver ativo', async () => {
    const jobExistente = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('active'),
      remove: jest.fn(),
    };

    queue.getJob.mockResolvedValueOnce(jobExistente);

    await service.agendarProcessamento(tenantId, conversationId);

    expect(queue.add).toHaveBeenCalledWith(
      'process-conversation',
      {
        tenantId,
        conversationId,
      },
      expect.objectContaining({
        jobId: 'debounce-next-tenant-1-conversation-1',
        delay: 8000,
      }),
    );
  });

  it('deve substituir um job do próximo turno que ainda está aguardando', async () => {
    const jobPrincipal = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('active'),
    };

    const jobProximoTurno = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('delayed'),
      remove: jest.fn<() => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    queue.getJob
      .mockResolvedValueOnce(jobPrincipal)
      .mockResolvedValueOnce(jobProximoTurno);

    await service.agendarProcessamento(tenantId, conversationId);

    expect(jobProximoTurno.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'process-conversation',
      {
        tenantId,
        conversationId,
      },
      expect.objectContaining({
        jobId: 'debounce-next-tenant-1-conversation-1',
        delay: 8000,
      }),
    );
  });

  it('deve lidar com nova mensagem quando o job do próximo turno estiver ativo', async () => {
    const jobPrincipal = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('active'),
    };

    const jobProximoTurno = {
      getState: jest.fn<() => Promise<string>>()
        .mockResolvedValue('active'),
    };

    queue.getJob
      .mockResolvedValueOnce(jobPrincipal)
      .mockResolvedValueOnce(jobProximoTurno);

    await service.agendarProcessamento(tenantId, conversationId);

    expect(queue.getJob).toHaveBeenCalledTimes(2);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
