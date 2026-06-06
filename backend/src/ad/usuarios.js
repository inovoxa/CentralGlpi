// Lista usuários do AD + último logon, via PowerShell remoto (EncodedCommand evita
// problemas de aspas no SSH). Resultado em cache curto (Get-ADUser -Filter * é pesado).
import { runCommand, adEnabled } from './ssh.js';

const PS = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
try {
  Import-Module ActiveDirectory
  $us = Get-ADUser -Filter 'Enabled -eq $true' -Properties LastLogonDate,Department | ForEach-Object {
    [pscustomobject]@{
      login = $_.SamAccountName
      nome = $_.Name
      departamento = $_.Department
      ultimoLogon = $(if ($_.LastLogonDate) { $_.LastLogonDate.ToString('o') } else { $null })
    }
  }
  (@{ usuarios = @($us) } | ConvertTo-Json -Compress -Depth 5)
} catch { (@{ erro = $_.Exception.Message } | ConvertTo-Json -Compress) }`;

function encode(s) { return Buffer.from(s, 'utf16le').toString('base64'); }

let cache = null;
let cacheAt = 0;
const TTL = 5 * 60 * 1000;

export async function listarUsuariosLogon() {
  if (cache && Date.now() - cacheAt < TTL) return cache;
  if (!adEnabled()) return [];
  const out = await runCommand(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encode(PS)}`);
  let obj;
  try { obj = JSON.parse((out || '').trim()); } catch { throw new Error('resposta inválida do DC'); }
  if (obj && obj.erro) throw new Error(obj.erro);
  const arr = Array.isArray(obj.usuarios) ? obj.usuarios : (obj.usuarios ? [obj.usuarios] : []);
  cache = arr;
  cacheAt = Date.now();
  return arr;
}
