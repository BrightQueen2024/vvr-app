export interface INativeAttestationBridge {
  /**
   * Identifies the current running platform ('android', 'ios', or 'unsupported').
   */
  getPlatformName(): 'android' | 'ios' | 'unsupported';

  /**
   * Interacts with the platform native hardware attestation framework to fetch
   * a cryptographically signed integrity token.
   * @param nonce Cryptographic single-use nonce to bind to the attestation request.
   */
  fetchHardwareToken(nonce: string): Promise<string>;
}
