import { safeStorage } from 'electron';

export interface SensitiveValueCodec {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export function createSensitiveValueCodec(): SensitiveValueCodec {
  return {
    isAvailable(): boolean {
      return safeStorage.isEncryptionAvailable();
    },

    encrypt(value: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-backed secret encryption is unavailable');
      }

      return safeStorage.encryptString(value).toString('base64');
    },

    decrypt(value: string): string {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-backed secret decryption is unavailable');
      }

      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    },
  };
}
