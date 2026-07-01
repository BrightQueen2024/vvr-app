import { INetworkClient } from '../worker-sync/INetworkClient';

export interface IMtlsNetworkClient extends INetworkClient {
  /**
   * Configures the client certificate, key, and server SPKI public key pins.
   * 
   * @param clientCert Buffer containing client PEM certificate payload.
   * @param clientKey Buffer containing client PEM private key payload.
   * @param pinnedServerHashes Array of Base64 SPKI SHA-256 hashes representing secure server certificates.
   */
  initializeMtls(
    clientCert: Buffer,
    clientKey: Buffer,
    pinnedServerHashes: string[]
  ): void;

  /**
   * Returns true if client certificates and pinning configurations are fully loaded.
   */
  isInitialized(): boolean;
}
