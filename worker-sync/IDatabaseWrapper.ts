export interface VideoReportRecord {
  reportId: string;
  userId: string;
  stateCode: string;
  lgaCode: string;
  wardCode: string;
  pollingUnitId: string;
  caption?: string;
  filePath: string;
  totalChunks: number;
  status: 'PENDING' | 'UPLOADING' | 'COMPLETED' | 'FAILED';
}

export interface ChunkRecord {
  chunkId: string;
  reportId: string;
  chunkIndex: number;
  byteStart: number;
  byteEnd: number;
  uploadStatus: 'QUEUED' | 'PROCESSING' | 'VERIFIED';
  attemptCount: number;
}

export interface IDatabaseWrapper {
  /**
   * Retrieves all chunks that are currently 'QUEUED' or 'PROCESSING' and belong
   * to a video report that is still active ('PENDING' or 'UPLOADING').
   */
  getActiveChunks(): Promise<ChunkRecord[]>;

  /**
   * Retrieves a specific video report metadata by reportId.
   */
  getVideoReport(reportId: string): Promise<VideoReportRecord | null>;

  /**
   * Updates the status of a specific chunk record.
   */
  updateChunkStatus(chunkId: string, status: ChunkRecord['uploadStatus']): Promise<void>;

  /**
   * Reads the specific binary chunk from disk into memory.
   */
  readChunkBinary(reportId: string, chunkId: string): Promise<Buffer>;

  /**
   * Increments the attempt count for a specific chunk, returning the new count.
   */
  incrementAttemptCount(chunkId: string): Promise<number>;

  /**
   * Updates a chunk's status to VERIFIED within a secure transaction.
   * Also checks if all chunks for this report are verified, and if so,
   * updates the report status to COMPLETED.
   */
  markChunkVerifiedAtomic(reportId: string, chunkId: string): Promise<void>;

  /**
   * Executes a series of operations within a database transaction context.
   */
  executeTransaction<T>(action: () => Promise<T>): Promise<T>;
}
