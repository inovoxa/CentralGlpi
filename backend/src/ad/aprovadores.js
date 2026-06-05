// Gerência do grupo "Aprovadores GLPI" no AD via SSH/PowerShell (Gerenciar_Aprovadores.ps1).
import { runCommand } from './ssh.js';

const SCRIPT = process.env.AD_APROVADORES_SCRIPT || 'C:\\Scripts\\Gerenciar_Aprovadores.ps1';

function cmd(args) {
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "${SCRIPT}" ${args}`;
}
function parse(raw) {
  let obj;
  try { obj = JSON.parse((raw || '').trim()); } catch { throw new Error('resposta inválida do DC'); }
  if (obj && obj.erro) throw new Error(obj.erro);
  return obj;
}

export async function listAprovadores() {
  return parse(await runCommand(cmd('-Action List')));
}
export async function addAprovador(login) {
  return parse(await runCommand(cmd(`-Action Add -Login "${login.replace(/"/g, '')}"`)));
}
export async function removeAprovador(login) {
  return parse(await runCommand(cmd(`-Action Remove -Login "${login.replace(/"/g, '')}"`)));
}
