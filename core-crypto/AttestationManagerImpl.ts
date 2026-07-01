import * as crypto from 'crypto';
import { IAttestationManager } from './IAttestationManager';
import { INativeAttestationBridge } from './INativeAttestationBridge';

export class AttestationManagerImpl implements IAttestationManager {
  private bridge: INativeAttestationBridge;
  private lastTimestamp: number = 0;

  constructor(bridge: INativeAttestationBridge) {
    this.bridge = bridge;
  }

  /**
   * Generates a cryptographically secure, high-entropy 256-bit nonce (32 bytes)
   * represented as a hexadecimal string.
   */
  public generateNonce(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Captures platform attestation and returns the complete set of required
   * Zero-Trust security headers.
   */
  public async getSecureHeaders(): Promise<Record<string, string>> {
    const platform = this.bridge.getPlatformName();
    if (platform === 'unsupported') {
      throw new Error('Zero-Trust Policy Violation: Current hardware platform is unsupported.');
    }

    // 1. Generate single-use nonce
    const nonce = this.generateNonce();

    // 2. Fetch platform-native hardware attestation token bound to this nonce
    let attestationToken: string;
    try {
      attestationToken = await this.bridge.fetchHardwareToken(nonce);
      if (!attestationToken || attestationToken.trim() === '') {
        throw new Error('Empty attestation token received from hardware bridge');
      }
    } catch (e: any) {
      throw new Error(`Device attestation failed: ${e.message || e}`);
    }

    // 3. Monotonic rising timestamp implementation (replay protection)
    let timestamp = Date.now();
    if (timestamp <= this.lastTimestamp) {
      // Force strict monotonicity even for high-frequency requests
      timestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = timestamp;

    // 4. Construct finalized security header object
    return {
      'X-VVR-Attestation-Token': attestationToken,
      'X-VVR-Nonce': nonce,
      'X-VVR-Timestamp': timestamp.toString(),
      'X-VVR-Platform': platform
    };
  }
}
