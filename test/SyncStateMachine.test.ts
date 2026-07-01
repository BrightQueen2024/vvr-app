import { SyncStateMachineImpl } from '../worker-sync/SyncStateMachineImpl';
import { IDatabaseWrapper, ChunkRecord, VideoReportRecord } from '../worker-sync/IDatabaseWrapper';
import { INetworkClient, ChunkUploadPayload, UploadResult } from '../worker-sync/INetworkClient';

describe('SyncStateMachine Engine Unit Tests', () => {
  let mockDb: jest.Mocked<IDatabaseWrapper>;
  let mockNetwork: jest.Mocked<INetworkClient>;
  let stateMachine: SyncStateMachineImpl;
  let sampleChunks: ChunkRecord[];

  const sampleReport: VideoReportRecord = {
    reportId: 'rep-101',
    userId: 'usr-999',
    stateCode: 'LA',
    lgaCode: 'IKD',
    wardCode: 'WD1',
    pollingUnitId: 'PU001',
    caption: 'Tally validation report',
    filePath: '/mock/path/video.h265',
    totalChunks: 2,
    status: 'PENDING'
  };

  beforeEach(() => {
    jest.useFakeTimers();

    // Re-initialize chunks array per test to avoid pollution
    sampleChunks = [
      {
        chunkId: 'chk-01',
        reportId: 'rep-101',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2097152, // 2MB
        uploadStatus: 'QUEUED',
        attemptCount: 0
      },
      {
        chunkId: 'chk-02',
        reportId: 'rep-101',
        chunkIndex: 1,
        byteStart: 2097152,
        byteEnd: 4194304,
        uploadStatus: 'QUEUED',
        attemptCount: 0
      }
    ];

    // Mock database wrapper with mutable state behavior
    mockDb = {
      getActiveChunks: jest.fn().mockImplementation(() => {
        // Return only queued or processing chunks
        const active = sampleChunks.filter(c => c.uploadStatus !== 'VERIFIED');
        return Promise.resolve(active);
      }),
      getVideoReport: jest.fn().mockResolvedValue(sampleReport),
      updateChunkStatus: jest.fn().mockImplementation((chunkId: string, status: any) => {
        const chunk = sampleChunks.find(c => c.chunkId === chunkId);
        if (chunk) {
          chunk.uploadStatus = status;
        }
        return Promise.resolve();
      }),
      readChunkBinary: jest.fn().mockResolvedValue(Buffer.from('mock binary data slice')),
      incrementAttemptCount: jest.fn().mockImplementation((chunkId: string) => {
        const chunk = sampleChunks.find(c => c.chunkId === chunkId);
        if (chunk) {
          chunk.attemptCount++;
          return Promise.resolve(chunk.attemptCount);
        }
        return Promise.resolve(1);
      }),
      markChunkVerifiedAtomic: jest.fn().mockImplementation((reportId: string, chunkId: string) => {
        const chunk = sampleChunks.find(c => c.chunkId === chunkId);
        if (chunk) {
          chunk.uploadStatus = 'VERIFIED';
        }
        return Promise.resolve();
      }),
      executeTransaction: jest.fn().mockImplementation((action: any) => action())
    };

    // Mock network client
    mockNetwork = {
      uploadChunk: jest.fn().mockResolvedValue({ success: true })
    };

    stateMachine = new SyncStateMachineImpl(mockDb, mockNetwork);
  });

  afterEach(async () => {
    await stateMachine.stopSyncLoop();
    jest.useRealTimers();
  });

  describe('Stage 3: Exponential Backoff & Jitter Mathematics', () => {
    it('should correctly calculate exponential backoff capped at 120s plus jitter', () => {
      // T_base = 10s (10000ms), T_max = 120s (120000ms), jitter = [0, 5000]ms
      // attempt 0 -> 10000 * 2^0 = 10000ms -> min(120000, 10000) = 10000ms + [0, 5000]ms
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(0);
        expect(delay).toBeGreaterThanOrEqual(10000);
        expect(delay).toBeLessThanOrEqual(15000);
      }

      // attempt 1 -> 10000 * 2^1 = 20000ms -> min(120000, 20000) = 20000ms + [0, 5000]ms
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(1);
        expect(delay).toBeGreaterThanOrEqual(20000);
        expect(delay).toBeLessThanOrEqual(25000);
      }

      // attempt 2 -> 10000 * 2^2 = 40000ms -> min(120000, 40000) = 40000ms + [0, 5000]ms
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(2);
        expect(delay).toBeGreaterThanOrEqual(40000);
        expect(delay).toBeLessThanOrEqual(45000);
      }

      // attempt 3 -> 10000 * 2^3 = 80000ms -> min(120000, 80000) = 80000ms + [0, 5000]ms
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(3);
        expect(delay).toBeGreaterThanOrEqual(80000);
        expect(delay).toBeLessThanOrEqual(85000);
      }

      // attempt 4 -> 10000 * 2^4 = 160000ms -> min(120000, 160000) = 120000ms + [0, 5000]ms
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(4);
        expect(delay).toBeGreaterThanOrEqual(120000);
        expect(delay).toBeLessThanOrEqual(125000);
      }

      // attempt 10 (overflow prevention & cap verification)
      for (let i = 0; i < 50; i++) {
        const delay = stateMachine.calculateBackoff(10);
        expect(delay).toBeGreaterThanOrEqual(120000);
        expect(delay).toBeLessThanOrEqual(125000);
      }
    });
  });

  describe('Sync Execution Loop & Flow Control', () => {
    it('should process chunks sequentially and update status atomically', async () => {
      mockNetwork.uploadChunk.mockResolvedValue({ success: true });

      stateMachine.startSyncLoop();
      expect(stateMachine.getStatus()).toBe('SYNCING');

      // Fast-forward timers to let both chunks be processed sequentially
      await jest.advanceTimersByTimeAsync(0);

      // Verify Stage 1 & Stage 2 details for chunk 1
      expect(mockDb.getActiveChunks).toHaveBeenCalled();
      expect(mockDb.readChunkBinary).toHaveBeenCalledWith('rep-101', 'chk-01');
      expect(mockNetwork.uploadChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          reportId: 'rep-101',
          chunkId: 'chk-01',
          chunkIndex: 0,
          sha256: expect.any(String)
        })
      );
      expect(mockDb.markChunkVerifiedAtomic).toHaveBeenCalledWith('rep-101', 'chk-01');

      // Verify Stage 1 & Stage 2 details for chunk 2
      expect(mockDb.readChunkBinary).toHaveBeenCalledWith('rep-101', 'chk-02');
      expect(mockNetwork.uploadChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          reportId: 'rep-101',
          chunkId: 'chk-02',
          chunkIndex: 1,
          sha256: expect.any(String)
        })
      );
      expect(mockDb.markChunkVerifiedAtomic).toHaveBeenCalledWith('rep-101', 'chk-02');
    });

    it('should handle network timeouts, revert status to QUEUED, increment attempt, and suspend during cooling', async () => {
      // Setup network to fail
      mockNetwork.uploadChunk.mockResolvedValue({ success: false, errorMessage: 'Timeout' });

      stateMachine.startSyncLoop();

      // Trigger first iteration
      await jest.advanceTimersByTimeAsync(0);

      // Verify the chunk was updated to PROCESSING then back to QUEUED after failure
      expect(mockDb.updateChunkStatus).toHaveBeenCalledWith('chk-01', 'PROCESSING');
      expect(mockDb.updateChunkStatus).toHaveBeenCalledWith('chk-01', 'QUEUED');
      expect(mockDb.incrementAttemptCount).toHaveBeenCalledWith('chk-01');

      // Ensure state is now COOLING
      expect(stateMachine.getStatus()).toBe('COOLING');

      // Check that it's waiting/sleeping for the backoff duration (min 10s + jitter = at least 10000ms)
      // If we advance 5000ms, it should still be COOLING
      await jest.advanceTimersByTimeAsync(5000);
      expect(stateMachine.getStatus()).toBe('COOLING');

      // Advance by 12000ms (more than the backoff duration for attempt 1), it should retry
      await jest.advanceTimersByTimeAsync(12000);
    });

    it('should catch transport exceptions without crashing the background service', async () => {
      // Mock network client throwing socket disconnect exception
      mockNetwork.uploadChunk.mockRejectedValue(new Error('Socket hung up'));

      stateMachine.startSyncLoop();

      // Advance loop - should process but fail and enter backoff
      await jest.advanceTimersByTimeAsync(0);

      expect(mockDb.updateChunkStatus).toHaveBeenCalledWith('chk-01', 'QUEUED');
      expect(stateMachine.getStatus()).toBe('COOLING');
    });
  });
});
