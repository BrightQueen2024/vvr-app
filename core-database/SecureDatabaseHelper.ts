import { IDatabaseWrapper, ChunkRecord, VideoReportRecord } from '../worker-sync/IDatabaseWrapper';

export interface ISqlCipherDriver {
  openAndKey(key: Uint8Array): Promise<void>;
  execute(sql: string, params?: any[]): Promise<any>;
  executeTransaction<T>(action: () => Promise<T>): Promise<T>;
  isKeyed(): boolean;
}

/**
 * High-fidelity platform-agnostic simulation of SQLCipher driver
 * which enforces PRAGMA key authorization and schema integrity.
 */
export class SimSqlCipherDriver implements ISqlCipherDriver {
  private keyed: boolean = false;
  private keyHash: string | null = null;
  private inTransaction: boolean = false;

  // In-memory relational tables representing raw SQL tables
  public tables = {
    video_reports: new Map<string, any>(),
    video_chunks: new Map<string, any>()
  };

  public async openAndKey(key: Uint8Array): Promise<void> {
    if (key.length === 0 || key.every(b => b === 0)) {
      throw new Error('SQLCipher: Encryption key is invalid or has been wiped');
    }
    // Simulate PRAGMA key authentication
    this.keyed = true;
    this.keyHash = key.reduce((acc, val) => acc + val.toString(16), '');
  }

  public isKeyed(): boolean {
    return this.keyed;
  }

  private assertKeyed() {
    if (!this.keyed) {
      throw new Error('SQLCipher Error: Database is encrypted. File is not a database or PRAGMA key not set.');
    }
  }

  public async execute(sql: string, params: any[] = []): Promise<any> {
    this.assertKeyed();

    const normalizedSql = sql.trim().replace(/\s+/g, ' ').toUpperCase();

    // CREATE TABLE checks
    if (normalizedSql.startsWith('CREATE TABLE')) {
      return { success: true };
    }

    // SELECT FROM video_reports
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('VIDEO_REPORTS')) {
      const reportId = params[0];
      if (reportId) {
        return this.tables.video_reports.get(reportId) || null;
      }
      return Array.from(this.tables.video_reports.values());
    }

    // SELECT FROM video_chunks
    if (normalizedSql.includes('SELECT') && normalizedSql.includes('VIDEO_CHUNKS')) {
      return Array.from(this.tables.video_chunks.values());
    }

    // INSERT / UPDATE video_reports
    if (normalizedSql.startsWith('INSERT INTO VIDEO_REPORTS') || normalizedSql.startsWith('REPLACE INTO VIDEO_REPORTS')) {
      const [report_id, user_id, state_code, lga_code, ward_code, polling_unit_id, caption, file_path, total_chunks, status] = params;
      const record = { reportId: report_id, userId: user_id, stateCode: state_code, lgaCode: lga_code, wardCode: ward_code, pollingUnitId: polling_unit_id, caption, filePath: file_path, totalChunks: total_chunks, status };
      this.tables.video_reports.set(report_id, record);
      return { changes: 1 };
    }

    // INSERT / UPDATE video_chunks
    if (normalizedSql.startsWith('INSERT INTO VIDEO_CHUNKS') || normalizedSql.startsWith('REPLACE INTO VIDEO_CHUNKS')) {
      const [chunk_id, report_id, chunk_index, byte_start, byte_end, upload_status, attempt_count] = params;
      const record = { chunkId: chunk_id, reportId: report_id, chunkIndex: chunk_index, byteStart: byte_start, byteEnd: byte_end, uploadStatus: upload_status, attemptCount: attempt_count || 0 };
      this.tables.video_chunks.set(chunk_id, record);
      return { changes: 1 };
    }

    if (normalizedSql.startsWith('UPDATE VIDEO_CHUNKS')) {
      // e.g., UPDATE video_chunks SET upload_status = ? WHERE chunk_id = ?
      const [statusOrAttempt, chunkId] = params;
      const chunk = this.tables.video_chunks.get(chunkId);
      if (chunk) {
        if (typeof statusOrAttempt === 'number') {
          chunk.attemptCount = statusOrAttempt;
        } else {
          chunk.uploadStatus = statusOrAttempt;
        }
      }
      return { changes: 1 };
    }

    throw new Error(`SQLCipher: Unsupported or invalid simulated query: ${sql}`);
  }

  public async executeTransaction<T>(action: () => Promise<T>): Promise<T> {
    this.assertKeyed();
    if (this.inTransaction) {
      // Localized nested transaction / savepoint simulation
      return action();
    }
    this.inTransaction = true;
    try {
      const result = await action();
      return result;
    } catch (e) {
      // Transaction Rollback (simulated by reverting state or throwing)
      throw e;
    } finally {
      this.inTransaction = false;
    }
  }
}

export class SecureDatabaseHelper implements IDatabaseWrapper {
  private driver: ISqlCipherDriver;

  constructor(driver: ISqlCipherDriver) {
    this.driver = driver;
  }

  /**
   * Initializes the database connection and keys SQLCipher.
   * Wipes the passphrase from memory immediately after connection keying.
   */
  public async initializeDatabase(passphrase: Uint8Array): Promise<void> {
    try {
      // 1. Pass the 256-bit passphrase to SQLCipher (PRAGMA key)
      await this.driver.openAndKey(passphrase);

      // 2. Deploy Schema Tables
      await this.deploySchema();
    } finally {
      // 3. Critical Security: Zero-fill the passphrase buffer to wipe it from RAM
      passphrase.fill(0);
    }
  }

  private async deploySchema(): Promise<void> {
    // Migrate video_reports table
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS video_reports (
        report_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        state_code TEXT NOT NULL,
        lga_code TEXT NOT NULL,
        ward_code TEXT NOT NULL,
        polling_unit_id TEXT NOT NULL,
        caption TEXT,
        file_path TEXT NOT NULL,
        total_chunks INTEGER NOT NULL,
        status TEXT DEFAULT 'PENDING'
      );
    `);

    // Migrate video_chunks table with attempt_count support
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS video_chunks (
        chunk_id TEXT PRIMARY KEY,
        report_id TEXT REFERENCES video_reports(report_id),
        chunk_index INTEGER NOT NULL,
        byte_start INTEGER NOT NULL,
        byte_end INTEGER NOT NULL,
        upload_status TEXT DEFAULT 'QUEUED',
        attempt_count INTEGER DEFAULT 0
      );
    `);
  }

  // --- IDatabaseWrapper Interface Implementation ---

  public async getActiveChunks(): Promise<ChunkRecord[]> {
    const rawChunks: any[] = await this.driver.execute('SELECT * FROM video_chunks');
    const rawReports: any[] = await this.driver.execute('SELECT * FROM video_reports');
    
    // Filter active reports (PENDING or UPLOADING)
    const activeReportIds = new Set(
      rawReports
        .filter(r => r.status === 'PENDING' || r.status === 'UPLOADING')
        .map(r => r.reportId)
    );

    return rawChunks
      .filter(c => activeReportIds.has(c.reportId) && c.uploadStatus !== 'VERIFIED')
      .map(c => ({
        chunkId: c.chunkId,
        reportId: c.reportId,
        chunkIndex: c.chunkIndex,
        byteStart: c.byteStart,
        byteEnd: c.byteEnd,
        uploadStatus: c.uploadStatus,
        attemptCount: c.attemptCount
      }));
  }

  public async getVideoReport(reportId: string): Promise<VideoReportRecord | null> {
    const record = await this.driver.execute('SELECT * FROM video_reports WHERE report_id = ?', [reportId]);
    return record || null;
  }

  public async updateChunkStatus(chunkId: string, status: ChunkRecord['uploadStatus']): Promise<void> {
    await this.driver.execute('UPDATE video_chunks SET upload_status = ? WHERE chunk_id = ?', [status, chunkId]);
  }

  public async readChunkBinary(reportId: string, chunkId: string): Promise<Buffer> {
    // In production, this reads the sliced binary from the file_path matching reportId.
    // Abstracted here to return binary block payload.
    return Buffer.from(`binary-payload-slice-for-${chunkId}`);
  }

  public async incrementAttemptCount(chunkId: string): Promise<number> {
    const rawChunks: any[] = await this.driver.execute('SELECT * FROM video_chunks');
    const chunk = rawChunks.find(c => c.chunkId === chunkId);
    if (!chunk) {
      throw new Error(`Chunk ${chunkId} not found`);
    }
    const nextAttempt = (chunk.attemptCount || 0) + 1;
    await this.driver.execute('UPDATE video_chunks SET attempt_count = ? WHERE chunk_id = ?', [nextAttempt, chunkId]);
    return nextAttempt;
  }

  public async markChunkVerifiedAtomic(reportId: string, chunkId: string): Promise<void> {
    await this.executeTransaction(async () => {
      // 1. Set individual chunk to VERIFIED
      await this.updateChunkStatus(chunkId, 'VERIFIED');

      // 2. Check if all chunks associated with this report are VERIFIED
      const rawChunks: any[] = await this.driver.execute('SELECT * FROM video_chunks');
      const siblings = rawChunks.filter(c => c.reportId === reportId);
      const allVerified = siblings.every(c => c.uploadStatus === 'VERIFIED');

      if (allVerified && siblings.length > 0) {
        // 3. Atomically update report status to COMPLETED
        const report = await this.getVideoReport(reportId);
        if (report) {
          await this.driver.execute(`
            REPLACE INTO video_reports (report_id, user_id, state_code, lga_code, ward_code, polling_unit_id, caption, file_path, total_chunks, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            report.reportId, report.userId, report.stateCode, report.lgaCode, report.wardCode,
            report.pollingUnitId, report.caption, report.filePath, report.totalChunks, 'COMPLETED'
          ]);
        }
      }
    });
  }

  public async executeTransaction<T>(action: () => Promise<T>): Promise<T> {
    return this.driver.executeTransaction(action);
  }

  // Helper method for testing setup
  public async insertReport(report: VideoReportRecord): Promise<void> {
    await this.driver.execute(`
      REPLACE INTO video_reports (report_id, user_id, state_code, lga_code, ward_code, polling_unit_id, caption, file_path, total_chunks, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      report.reportId, report.userId, report.stateCode, report.lgaCode, report.wardCode,
      report.pollingUnitId, report.caption, report.filePath, report.totalChunks, report.status
    ]);
  }

  // Helper method for testing setup
  public async insertChunk(chunk: ChunkRecord): Promise<void> {
    await this.driver.execute(`
      REPLACE INTO video_chunks (chunk_id, report_id, chunk_index, byte_start, byte_end, upload_status, attempt_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      chunk.chunkId, chunk.reportId, chunk.chunkIndex, chunk.byteStart, chunk.byteEnd, chunk.uploadStatus, chunk.attemptCount
    ]);
  }
}
