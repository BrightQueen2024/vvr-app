import * as crypto from 'crypto';
import { IPassphraseManager } from './IPassphraseManager';
import { ISecureKeyring } from './ISecureKeyring';

export class PassphraseManagerImpl implements IPassphraseManager {
  private keyring: ISecureKeyring;
  private readonly KEY_ALIAS = 'vvr_secure_db_passphrase_alias';

  constructor(keyring: ISecureKeyring) {
    this.keyring = keyring;
  }

  /**
   * Dynamically retrieves the database encryption passphrase.
   * Generates a new 256-bit CSPRNG key on first run.
   */
  public async getOrCreateDatabasePassphrase(): Promise<Uint8Array> {
    // 1. Attempt to fetch existing passphrase from secure hardware keyring
    const existingKey = await this.keyring.getKey(this.KEY_ALIAS);
    if (existingKey) {
      return existingKey;
    }

    // 2. Initial Boot: Generate a new 256-bit cryptographically secure random key
    const newPassphrase = new Uint8Array(crypto.randomBytes(32));

    // 3. Deposit directly into the secure hardware keyring
    await this.keyring.saveKey(this.KEY_ALIAS, newPassphrase);

    return newPassphrase;
  }
}
