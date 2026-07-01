import * as crypto from 'crypto';
import { MtlsNetworkClientImpl } from '../core-network/MtlsNetworkClientImpl';
import { ChunkUploadPayload } from '../worker-sync/INetworkClient';

describe('MtlsNetworkClient Security Unit Tests', () => {
  let clientCert: Buffer;
  let clientKey: Buffer;
  let serverPubKey: Buffer;
  let serverPin: string;

  beforeEach(() => {
    // Generate mock PEM buffers and public key footprints
    clientCert = Buffer.from('-----BEGIN CERTIFICATE-----\nCLIENT_CERT_PEM\n-----END CERTIFICATE-----');
    clientKey = Buffer.from('-----BEGIN PRIVATE KEY-----\nCLIENT_KEY_PEM\n-----END PRIVATE KEY-----');
    serverPubKey = Buffer.from('vvr-gateway-public-key-payload');

    // Pre-calculate SHA-256 SPKI fingerprint for the matching server public key
    const hash = crypto.createHash('sha256').update(serverPubKey).digest('base64');
    serverPin = `sha256/${hash}`;
  });

  describe('Handshake Initialization', () => {
    it('should throw an error if upload is attempted before initializing client certs', async () => {
      const client = new MtlsNetworkClientImpl();
      const payload: ChunkUploadPayload = {
        reportId: 'rep-1',
        chunkId: 'chk-1',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2000,
        sha256: 'mocksha',
        binaryData: Buffer.from('binary-data')
      };

      await expect(client.uploadChunk(payload)).rejects.toThrow(
        'mTLS Handshake Error: Network client is uninitialized. Client credentials missing.'
      );
    });

    it('should reject initialization with empty client cert or key', () => {
      const client = new MtlsNetworkClientImpl();
      expect(() => client.initializeMtls(Buffer.alloc(0), clientKey, [serverPin])).toThrow(
        'mTLS Configuration Error: Client certificate buffer is empty or invalid.'
      );
      expect(() => client.initializeMtls(clientCert, Buffer.alloc(0), [serverPin])).toThrow(
        'mTLS Configuration Error: Client key buffer is empty or invalid.'
      );
    });
  });

  describe('Mutual TLS & SPKI Pinning Handshake', () => {
    it('should complete upload successfully if server public key matches pinned hashes', async () => {
      const mockUploadHandler = jest.fn().mockResolvedValue({ success: true, statusCode: 200 });
      const client = new MtlsNetworkClientImpl(mockUploadHandler);

      client.initializeMtls(clientCert, clientKey, [serverPin]);

      const payload: ChunkUploadPayload = {
        reportId: 'rep-1',
        chunkId: 'chk-1',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2000,
        sha256: 'mocksha',
        binaryData: Buffer.from('binary-data')
      };

      const result = await client.uploadChunk(payload);

      expect(mockUploadHandler).toHaveBeenCalledWith(clientCert, clientKey, serverPubKey);
      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('should abort connection immediately and drop the socket if server certificate pin does not match', async () => {
      const mockUploadHandler = jest.fn().mockResolvedValue({ success: true });
      const client = new MtlsNetworkClientImpl(mockUploadHandler);

      // Initialize with a wrong pin (simulating intermediate certificate substitution / MITM proxy)
      const wrongPin = 'sha256/mismatchedfingerprint1234567890abcdef=';
      client.initializeMtls(clientCert, clientKey, [wrongPin]);

      const payload: ChunkUploadPayload = {
        reportId: 'rep-1',
        chunkId: 'chk-1',
        chunkIndex: 0,
        byteStart: 0,
        byteEnd: 2000,
        sha256: 'mocksha',
        binaryData: Buffer.from('binary-data')
      };

      // Assert connection failure
      await expect(client.uploadChunk(payload)).rejects.toThrow(
        'mTLS Handshake Violation: Rogue certificate authority detected. Socket disconnected.'
      );

      // Verify that no request payload was transmitted
      expect(mockUploadHandler).not.toHaveBeenCalled();
    });
  });
});
