import CryptoJS from 'crypto-js';

// Encrypt operator API keys at rest with AES-256 (key from VAULT_KEY env).
// Never store plaintext keys in the database.
export function encryptSecret(secret, vaultKey) {
  return CryptoJS.AES.encrypt(secret, vaultKey).toString();
}

export function decryptSecret(ciphertext, vaultKey) {
  return CryptoJS.AES.decrypt(ciphertext, vaultKey).toString(CryptoJS.enc.Utf8);
}

export function generateApiKey() {
  return `aeg_${CryptoJS.lib.WordArray.random(24).toString()}`;
}