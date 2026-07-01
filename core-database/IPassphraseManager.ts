export interface IPassphraseManager {
  /**
   * Dynamically retrieves the database encryption passphrase from secure hardware storage.
   * If it doesn't exist (initial boot), generates a new 256-bit passphrase using a CSPRNG,
   * stores it in the secure keyring, and returns it.
   */
  getOrCreateDatabasePassphrase(): Promise<Uint8Array>;
}
