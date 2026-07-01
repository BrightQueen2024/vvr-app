import * as https from 'https';
import * as tls from 'tls';
import * as crypto from 'crypto';
import { IMtlsNetworkClient } from './IMtlsNetworkClient';
import { ChunkUploadPayload, UploadResult } from '../worker-sync/INetworkClient';

export class MtlsNetworkClientImpl implements IMtlsNetworkClient {
  private cert: Buffer | null = null;
  private key: Buffer | null = null;
  private pins: string[] = [];
  private initialized: boolean = false;

  // Custom handler to simulate socket connections and handshakes in unit tests
  private mockHandshakeRunner?: (
    clientCert: Buffer,
    clientKey: Buffer,
    serverPubKey: Buffer
  ) => Promise<UploadResult>;

  constructor(
    mockHandshakeRunner?: (
      clientCert: Buffer,
      clientKey: Buffer,
      serverPubKey: Buffer
    ) => Promise<UploadResult>
  ) {
    this.mockHandshakeRunner = mockHandshakeRunner;
  }

  /**
   * Configures client certificate credentials and server public key hashes.
   */
  public initializeMtls(
    clientCert: Buffer,
    clientKey: Buffer,
    pinnedServerHashes: string[]
  ): void {
    if (!clientCert || clientCert.length === 0) {
      throw new Error('mTLS Configuration Error: Client certificate buffer is empty or invalid.');
    }
    if (!clientKey || clientKey.length === 0) {
      throw new Error('mTLS Configuration Error: Client key buffer is empty or invalid.');
    }
    this.cert = clientCert;
    this.key = clientKey;
    this.pins = pinnedServerHashes;
    this.initialized = true;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('mTLS Handshake Error: Network client is uninitialized. Client credentials missing.');
    }
  }

  /**
   * Compares the SHA-256 hash of a server's public key (SPKI fingerprint)
   * against our strictly hardcoded/configured trust pins.
   */
  public verifyServerPublicKey(serverPubKey: Buffer): boolean {
    const hash = crypto.createHash('sha256').update(serverPubKey).digest('base64');
    const formattedPin = `sha256/${hash}`;
    return this.pins.includes(formattedPin);
  }

  /**
   * Performs a cryptographically pinned chunk upload.
   */
  public async uploadChunk(payload: ChunkUploadPayload): Promise<UploadResult> {
    this.assertInitialized();

    // 1. Check if mock handshake runner is defined (for test environments)
    if (this.mockHandshakeRunner) {
      // Simulate receiving a public key from the server during handshake
      const mockServerPubKey = Buffer.from('vvr-gateway-public-key-payload');

      // Enforce strict intermediate/root certificate pinning
      if (!this.verifyServerPublicKey(mockServerPubKey)) {
        throw new Error('mTLS Handshake Violation: Rogue certificate authority detected. Socket disconnected.');
      }

      // Delegate upload with active client credentials
      return this.mockHandshakeRunner(this.cert!, this.key!, mockServerPubKey);
    }

    // 2. Production Node-compatible https agent setup
    return new Promise((resolve, reject) => {
      const agent = new https.Agent({
        cert: this.cert!,
        key: this.key!,
        rejectUnauthorized: true, // Strict validation
        checkServerIdentity: (hostname, cert: any) => {
          // Perform standard hostname checks
          const hostnameError = tls.checkServerIdentity(hostname, cert);
          if (hostnameError) {
            return hostnameError;
          }

          // Extract Subject Public Key Info (SPKI)
          const pubKey = cert.pubkey;
          if (!pubKey) {
            return new Error('mTLS Handshake Error: Cannot extract SPKI public key from server certificate.');
          }

          // Verify pinning
          const hash = crypto.createHash('sha256').update(pubKey).digest('base64');
          const formattedPin = `sha256/${hash}`;

          if (!this.pins.includes(formattedPin)) {
            return new Error(`mTLS Certificate Pinning Violation: Connection to ${hostname} aborted.`);
          }

          return undefined; // Handshake accepted
        }
      });

      // Execute request with pinned agent config
      const req = https.request(
        {
          hostname: 'api.vvr-election.ng',
          port: 443,
          path: '/api/v1/media/upload-chunk',
          method: 'POST',
          agent: agent,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': payload.binaryData.length,
            'X-VVR-Chunk-Index': payload.chunkIndex.toString(),
            'X-VVR-SHA256': payload.sha256
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ success: true, statusCode: res.statusCode });
            } else {
              resolve({
                success: false,
                statusCode: res.statusCode,
                errorMessage: `Server responded with status ${res.statusCode}: ${data}`
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          success: false,
          errorMessage: `Network transport failure: ${err.message}`
        });
      });

      // Write binary chunk data and close request
      req.write(payload.binaryData);
      req.end();
    });
  }
}
