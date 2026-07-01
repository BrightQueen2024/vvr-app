import { PassphraseManagerImpl } from '../core-database/PassphraseManagerImpl';
import { SecureDatabaseHelper, SimSqlCipherDriver } from '../core-database/SecureDatabaseHelper';
import { ISecureKeyring } from '../core-database/ISecureKeyring';
import { ChunkRecord, VideoReportRecord } from '../worker-sync/IDatabaseWrapper';

describe('SecureDatabase Encrypted Storage Unit Tests', () => {
  let mockKeyring: jest.Mocked<ISecureKeyring>;
  let passphraseManager: PassphraseManagerImpl;
  let driver: SimSqlCipherDriver;
  let dbHelper: SecureDatabaseHelper;

  const keyringStore = new Map<string, Uint8Array>();

  beforeEach(() => {
    keyringStore.clear();

    mockKeyring = {
      saveKey: jest.fn().mockImplementation((alias: string, secret: Uint8Array) => {
        keyringStore.set(alias, secret);
        return Promise.resolve();
      }),
      getKey: jest.fn().mockImplementation((alias: string) => {
        return Promise.resolve(keyringStore.get(alias) || null);
      }),
      deleteKey: jest.fn().mockImplementation((alias: string) => {
        keyringStore.delete(alias);
        return Promise.resolve();
      })
    };

    passphraseManager = new PassphraseManagerImpl(mockKeyring);
    driver = new SimSqlCipherDriver();
    dbHelper = new SecureDatabaseHelper(driver);
  });

  describe('Passphrase Lifecycle & CSPRNG', () => {
    it('should generate a 256-bit CSPRNG passphrase on initial boot and persist it', async () => {
      const key1 = await passphraseManager.getOrCreateDatabasePassphrase();

      expect(key1).toBeInstanceOf(Uint8Array);
      expect(key1.length).toBe(32); // 32 bytes = 256 bits
      expect(mockKeyring.saveKey).toHaveBeenCalledWith('vvr_secure_db_passphrase_alias', key1);

      // Verify subsequent retrieve fetches the same key
      const key2 = await passphraseManager.getOrCreateDatabasePassphrase();
      expect(key2).toEqual(key1);
      expect(mockKeyring.saveKey).toHaveBeenCalledTimes(1); // Should not save a new key
    });
  });

  describe('Volatile Memory Wiping (Key Sanitation)', () => {
    it('should zero-fill the passphrase Uint8Array immediately after keying SQLCipher', async () => {
      const originalKey = await passphraseManager.getOrCreateDatabasePassphrase();
      // Clone key to verify original was wiped
      const keyClone = new Uint8Array(originalKey);

      expect(driver.isKeyed()).toBe(false);

      // Initialize database
      await dbHelper.initializeDatabase(originalKey);

      // Verify SQLCipher driver was keyed successfully
      expect(driver.isKeyed()).toBe(true);

      // Verify the original key array in memory was completely wiped (zeroed)
      expect(originalKey.every(byte => byte === 0)).toBe(true);
      expect(originalKey).not.toEqual(keyClone);
    });

    it('should zero-fill the passphrase even when database schema deployment fails', async () => {
      const originalKey = await passphraseManager.getOrCreateDatabasePassphrase();
      
      // Force driver execution to fail
      jest.spyOn(driver, 'execute').mockRejectedValueOnce(new Error('Syntax Error'));

      await expect(dbHelper.initializeDatabase(originalKey)).rejects.toThrow('Syntax Error');

      // Verify that the passphrase is still wiped in the finally block
      expect(originalKey.every(byte => byte === 0)).toBe(true);
    });
  });

  describe('SQLCipher Schema Migration & Transactions', () => {
    it('should block queries if database is not keyed', async () => {
      await expect(dbHelper.getActiveChunks()).rejects.toThrow(
        'SQLCipher Error: Database is encrypted. File is not a database or PRAGMA key not set.'
      );
    });

    it('should execute schema creation and support transactional queries once keyed', async () => {
      const key = await passphraseManager.getOrCreateDatabasePassphrase();
      await dbHelper.initializeDatabase(key);

      const report: VideoReportRecord = {
        reportId: 'rep-s2',
        userId: 'usr-1',
        stateCode: 'ED',
        lgaCode: 'ORE',
        wardCode: 'WD9',
        pollingUnitId: 'PU88',
        caption: 'Tally sheet EC8A',
        filePath: '/storage/vid.h265',
        totalChunks: 2,
        status: 'PENDING'
      };

      const chunk1: ChunkRecord = {
        chunkId: 'chk-s2-1',
        reportId: 'rep-s2',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2000000,
        uploadStatus: 'QUEUED',
        attemptCount: 0
      };

      const chunk2: ChunkRecord = {
        chunkId: 'chk-s2-2',
        reportId: 'rep-s2',
        chunkIndex: 1,
        byteStart: 2000000,
        byteEnd: 4000000,
        uploadStatus: 'QUEUED',
        attemptCount: 0
      };

      // Insert records using helper
      await dbHelper.insertReport(report);
      await dbHelper.insertChunk(chunk1);
      await dbHelper.insertChunk(chunk2);

      // Verify active chunks lookup
      const active = await dbHelper.getActiveChunks();
      expect(active).toHaveLength(2);
      expect(active[0].chunkId).toBe('chk-s2-1');

      // Verify status updates
      await dbHelper.updateChunkStatus('chk-s2-1', 'PROCESSING');
      const activeAfterUpdate = await dbHelper.getActiveChunks();
      expect(activeAfterUpdate.find(c => c.chunkId === 'chk-s2-1')?.uploadStatus).toBe('PROCESSING');
    });

    it('should atomically transition report to COMPLETED when all child chunks are VERIFIED', async () => {
      const key = await passphraseManager.getOrCreateDatabasePassphrase();
      await dbHelper.initializeDatabase(key);

      const report: VideoReportRecord = {
        reportId: 'rep-s2',
        userId: 'usr-1',
        stateCode: 'ED',
        lgaCode: 'ORE',
        wardCode: 'WD9',
        pollingUnitId: 'PU88',
        caption: 'Tally sheet EC8A',
        filePath: '/storage/vid.h265',
        totalChunks: 2,
        status: 'PENDING'
      };

      const chunk1: ChunkRecord = {
        chunkId: 'chk-s2-1',
        reportId: 'rep-s2',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2000000,
        uploadStatus: 'QUEUED',
        attemptCount: 0
      };

      const chunk2: ChunkRecord = {
        chunkId: 'chk-s2-2',
        reportId: 'rep-s2',
        chunkIndex: 1,
        byteStart: 2000000,
        byteEnd: 4000000,
        uploadStatus: 'QUEUED',
        attemptCount: 0
      };

      await dbHelper.insertReport(report);
      await dbHelper.insertChunk(chunk1);
      await dbHelper.insertChunk(chunk2);

      // Verify parent status is initially PENDING
      let parent = await dbHelper.getVideoReport('rep-s2');
      expect(parent?.status).toBe('PENDING');

      // Verify chunk 1 -> VERIFIED (parent report should stay PENDING because chunk 2 is still QUEUED)
      await dbHelper.markChunkVerifiedAtomic('rep-s2', 'chk-s2-1');
      parent = await dbHelper.getVideoReport('rep-s2');
      expect(parent?.status).toBe('PENDING');

      // Verify chunk 2 -> VERIFIED (parent report must transition to COMPLETED)
      await dbHelper.markChunkVerifiedAtomic('rep-s2', 'chk-s2-2');
      parent = await dbHelper.getVideoReport('rep-s2');
      expect(parent?.status).toBe('COMPLETED');
    });
  });
});
