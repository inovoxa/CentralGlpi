// Lista usuários do AD + último logon. Usa o coletor publicado (Coletar_Auditoria_AD.ps1
// -AllUsers) via -File — mesmo padrão dos outros scripts (EncodedCommand longo é
// rejeitado pelo OpenSSH do Windows). Resultado em cache curto (consulta pesada).
import { runCommand, adEnabled, psCommand } from './ssh.js';

let cache = null;
let cacheAt = 0;
const TTL = 5 * 60 * 1000;

export async function listarUsuariosLogon() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  if (!adEnabled()) return [];
  const out = await runCommand(psCommand(['-AllUsers']));
  let obj;
  try { obj = JSON.parse((out || '').trim()); } catch { throw new Error('resposta inválida do DC'); }
  if (obj && obj.erro) throw new Error(obj.erro);
  const arr = Array.isArray(obj.usuarios) ? obj.usuarios : (obj.usuarios ? [obj.usuarios] : []);
  cache = arr;
  cacheAt = Date.now();
  return arr;
}
