export interface ISecureKeyring {
  /**
   * Securely saves a binary secret (e.g. database passphrase) associated with a given alias.
   */
  saveKey(alias: string, secret: Uint8Array): Promise<void>;

  /**
   * Retrieves the binary secret associated with the given alias from the secure hardware.
   * Returns null if no key is stored.
   */
  getKey(alias: string): Promise<Uint8Array | null>;

  /**
   * Deletes the secret associated with the given alias.
   */
  deleteKey(alias: string): Promise<void>;
}
