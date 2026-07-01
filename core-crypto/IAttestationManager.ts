export interface IAttestationManager {
  /**
   * Generates a cryptographically secure random value (CSPRNG) to be used
   * as a single-use verification nonce.
   */
  generateNonce(): string;

  /**
   * Captures platform attestation and returns the complete set of required
   * Zero-Trust security headers for outbound network synchronization.
   */
  getSecureHeaders(): Promise<Record<string, string>>;
}
