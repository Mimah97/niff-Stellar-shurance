import { Test, TestingModule } from '@nestjs/testing';
import { TxSubmitQueue } from '../tx-submit.queue';
import { TxSubmitWorker } from '../tx-submit.worker';
import { ConfigService } from '@nestjs/config';

// Mock BullMQ Queue
const mockJob = { id: 'job-1', returnvalue: null, failedReason: undefined, getState: jest.fn() };
const mockQueue = {
  add: jest.fn().mockResolvedValue(mockJob),
  getJob: jest.fn(),
};
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueue),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
  Job: jest.fn(),
}));
jest.mock('../../redis/client', () => ({ getBullMQConnection: jest.fn().mockReturnValue({}) }));

describe('TxSubmitQueue', () => {
  let queue: TxSubmitQueue;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TxSubmitQueue, { provide: ConfigService, useValue: { get: jest.fn() } }],
    }).compile();
    queue = module.get(TxSubmitQueue);
  });

  afterEach(() => jest.clearAllMocks());

  it('enqueue returns jobId immediately (queued status)', async () => {
    const jobId = await queue.enqueue({ signed_xdr: 'AAAA==' });
    expect(jobId).toBe('job-1');
    expect(mockQueue.add).toHaveBeenCalledWith('submit', { signed_xdr: 'AAAA==', idempotency_key: undefined }, {});
  });

  it('enqueue uses idempotency_key as jobId', async () => {
    await queue.enqueue({ signed_xdr: 'AAAA==', idempotency_key: 'uuid-123' });
    expect(mockQueue.add).toHaveBeenCalledWith('submit', expect.any(Object), { jobId: 'idem:uuid-123' });
  });

  it('getStatus returns queued for waiting job', async () => {
    mockJob.getState.mockResolvedValue('waiting');
    mockQueue.getJob.mockResolvedValue(mockJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('queued');
  });

  it('getStatus returns completed with result', async () => {
    const completedJob = { ...mockJob, returnvalue: { hash: 'abc123', status: 'PENDING' }, getState: jest.fn().mockResolvedValue('completed') };
    mockQueue.getJob.mockResolvedValue(completedJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('completed');
    expect(result.result?.hash).toBe('abc123');
  });

  it('getStatus returns failed with reason', async () => {
    const failedJob = { ...mockJob, failedReason: 'TX_BAD_SEQ: bad seq', getState: jest.fn().mockResolvedValue('failed') };
    mockQueue.getJob.mockResolvedValue(failedJob);
    const result = await queue.getStatus('job-1');
    expect(result.status).toBe('failed');
    expect(result.failedReason).toContain('TX_BAD_SEQ');
  });

  it('getStatus returns unknown for missing job', async () => {
    mockQueue.getJob.mockResolvedValue(undefined);
    const result = await queue.getStatus('nonexistent');
    expect(result.status).toBe('unknown');
  });
});

describe('TxSubmitWorker', () => {
  it('initializes worker on module init', async () => {
    const { Worker } = await import('bullmq');
    const module: TestingModule = await Test.createTestingModule({
      providers: [TxSubmitWorker, { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://rpc') } }],
    }).compile();
    const worker = module.get(TxSubmitWorker);
    worker.onModuleInit();
    expect(Worker).toHaveBeenCalled();
  });
});
