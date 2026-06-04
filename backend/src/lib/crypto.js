// Cifragem do segredo TOTP em repouso (AES-256-GCM).
// A chave vem de TOTP_ENC_KEY (32 bytes em hex). Formato armazenado:
//   v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
import crypto from 'node:crypto';
import { config } from '../config.js';

function key() {
  const k = Buffer.from(config.totpEncKey, 'hex');
  if (k.length !== 32) {
    throw new Error('TOTP_ENC_KEY inválida: precisa de 32 bytes em hex (64 chars).');
  }
  return k;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(stored) {
  const [v, ivB64, tagB64, ctB64] = String(stored).split(':');
  if (v !== 'v1') throw new Error('Formato de segredo TOTP desconhecido.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
