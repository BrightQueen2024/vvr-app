import * as crypto from 'crypto';
import { ISyncStateMachine, StateMachineState } from './ISyncStateMachine';
import { IDatabaseWrapper, ChunkRecord } from './IDatabaseWrapper';
import { INetworkClient } from './INetworkClient';

export class SyncStateMachineImpl implements ISyncStateMachine {
  private db: IDatabaseWrapper;
  private network: INetworkClient;
  private state: StateMachineState = 'IDLE';
  private running: boolean = false;
  private loopPromise: Promise<void> | null = null;
  private currentSleepReject: ((err: any) => void) | null = null;

  // Configuration constants
  private readonly BASE_DELAY_MS = 10000;  // T_base = 10s
  private readonly MAX_DELAY_MS = 120000;   // T_max = 120s
  private readonly JITTER_MAX_MS = 5000;    // random_jitter = [0, 5000]ms

  constructor(db: IDatabaseWrapper, network: INetworkClient) {
    this.db = db;
    this.network = network;
  }

  public startSyncLoop(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.state = 'SYNCING';
    this.loopPromise = this.runLoop();
  }

  public async stopSyncLoop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.state = 'STOPPED';

    // If sleeping or cooling, interrupt the wait
    if (this.currentSleepReject) {
      this.currentSleepReject(new Error('STOPPED'));
      this.currentSleepReject = null;
    }

    try {
      if (this.loopPromise) {
        await this.loopPromise;
      }
    } catch (e) {
      // Ignore interrupt error
    } finally {
      this.loopPromise = null;
      this.state = 'IDLE';
    }
  }

  public getStatus(): StateMachineState {
    return this.state;
  }

  /**
   * Calculates the exponential backoff cooling delay with randomized jitter:
   * T_wait = min(T_max, T_base * 2^attempt) + random_jitter
   */
  public calculateBackoff(attempt: number): number {
    // Avoid arithmetic overflow with extremely high attempts by capping the exponent
    const exponent = Math.min(attempt, 15);
    const exponentialBackoff = this.BASE_DELAY_MS * Math.pow(2, exponent);
    const cappedBackoff = Math.min(this.MAX_DELAY_MS, exponentialBackoff);
    const randomJitter = Math.floor(Math.random() * (this.JITTER_MAX_MS + 1));
    return cappedBackoff + randomJitter;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        this.state = 'SYNCING';
        
        // Stage 1: Active Queue Evaluation
        const nextChunk = await this.db.executeTransaction(async () => {
          const activeChunks = await this.db.getActiveChunks();
          
          // Prioritize by chunk index to ensure sequential resumable uploads
          const sorted = activeChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
          const candidate = sorted.find(
            (c) => c.uploadStatus === 'QUEUED' || c.uploadStatus === 'PROCESSING'
          );

          if (candidate) {
            // Lock the chunk row by setting to PROCESSING
            await this.db.updateChunkStatus(candidate.chunkId, 'PROCESSING');
            return candidate;
          }
          return null;
        });

        if (!nextChunk) {
          // No active chunks found, sleep briefly before checking again
          await this.sleep(1000);
          continue;
        }

        // Stage 2: Resumable Chunk Streaming
        const success = await this.processChunk(nextChunk);

        if (!success) {
          // Stage 3: Mathematical Backoff with Jitter (Triggered on failures)
          this.state = 'COOLING';
          
          const newAttemptCount = await this.db.incrementAttemptCount(nextChunk.chunkId);
          const waitTime = this.calculateBackoff(newAttemptCount);
          
          // Revert current chunk state to QUEUED for retry
          await this.db.updateChunkStatus(nextChunk.chunkId, 'QUEUED');

          // Suspend execution for the cooling period
          await this.sleep(waitTime);
        }

      } catch (e: any) {
        if (e.message === 'STOPPED') {
          break;
        }
        // Catch-all to prevent uncaught background loop exceptions from crashing the process
        await this.sleep(2000);
      }
    }
  }

  private async processChunk(chunk: ChunkRecord): Promise<boolean> {
    try {
      // Retrieve target video report metadata to get the source file path
      const report = await this.db.getVideoReport(chunk.reportId);
      if (!report) {
        throw new Error(`Associated video report ${chunk.reportId} not found`);
      }

      // Read chunk binary slice into memory
      const binaryData = await this.db.readChunkBinary(chunk.reportId, chunk.chunkId);
      
      // Cryptographically calculate the SHA-256 hash of the binary block
      const sha256 = crypto.createHash('sha256').update(binaryData).digest('hex');

      // Execute network upload
      const uploadResult = await this.network.uploadChunk({
        reportId: chunk.reportId,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        byteStart: chunk.byteStart,
        byteEnd: chunk.byteEnd,
        sha256: sha256,
        binaryData: binaryData
      });

      if (uploadResult.success) {
        // Stage 4: Atomic State Management (HTTP 200 OK)
        await this.db.markChunkVerifiedAtomic(chunk.reportId, chunk.chunkId);
        return true;
      }

      // Handle server 5xx or general unsuccessful responses
      return false;

    } catch (error) {
      // Captures transport timeouts, socket drops, or unreachable exceptions safely
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.currentSleepReject = reject;
      const timer = setTimeout(() => {
        this.currentSleepReject = null;
        resolve();
      }, ms);

      // Clean up timer if rejected early (e.g. stopped)
      if (this.currentSleepReject) {
        const originalReject = this.currentSleepReject;
        this.currentSleepReject = (err) => {
          clearTimeout(timer);
          originalReject(err);
        };
      }
    });
  }
}
