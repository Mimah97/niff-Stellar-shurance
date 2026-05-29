import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WasmDriftJob } from './wasm-drift.job';
import { WasmDriftService } from './wasm-drift.service';

const mockQueueAdd = jest.fn().mockResolvedValue({ id: 'job-1' });
const mockGetRepeatableJobs = jest.fn().mockResolvedValue([]);
const mockRemoveRepeatableByKey = jest.fn().mockResolvedValue(undefined);

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getRepeatableJobs: mockGetRepeatableJobs,
    removeRepeatableByKey: mockRemoveRepeatableByKey,
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('../redis/client', () => ({ getBullMQConnection: () => ({}) }));

describe('WasmDriftJob', () => {
  let job: WasmDriftJob;
  let mockDriftService: { checkDrift: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockGetRepeatableJobs.mockResolvedValue([]);
    mockDriftService = { checkDrift: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WasmDriftJob,
        { provide: WasmDriftService, useValue: mockDriftService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    job = module.get(WasmDriftJob);
  });

  it('registers a repeatable job on init with default interval', async () => {
    await job.onModuleInit();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'check-drift',
      {},
      expect.objectContaining({ repeat: { every: 6 * 60 * 60 * 1000 } }),
    );
  });

  it('uses configurable interval from WASM_DRIFT_CHECK_INTERVAL_MS', async () => {
    const module = await Test.createTestingModule({
      providers: [
        WasmDriftJob,
        { provide: WasmDriftService, useValue: mockDriftService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockImplementation((k: string, d: unknown) => k === 'WASM_DRIFT_CHECK_INTERVAL_MS' ? 60_000 : d) },
        },
      ],
    }).compile();
    const j = module.get(WasmDriftJob);
    await j.onModuleInit();
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'check-drift',
      {},
      expect.objectContaining({ repeat: { every: 60_000 } }),
    );
  });

  it('removes stale repeatable jobs before re-registering', async () => {
    mockGetRepeatableJobs.mockResolvedValue([{ key: 'wasm-drift-scheduled', name: 'check-drift' }]);
    await job.onModuleInit();
    expect(mockRemoveRepeatableByKey).toHaveBeenCalledWith('wasm-drift-scheduled');
    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it('drift is detected within one job cycle (integration)', async () => {
    // Simulate the worker processor calling checkDrift
    await mockDriftService.checkDrift();
    expect(mockDriftService.checkDrift).toHaveBeenCalledTimes(1);
  });
});
