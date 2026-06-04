// Coletor de auditoria de AD: lê eventos do DC via SSH/PowerShell e grava no PostgreSQL.
// Incremental por RecordId (tabela auditoria_ad_cursor). Agendado por node-cron.
import cron from 'node-cron';
import { config } from '../config.js';
import { pgQuery } from '../db/postgres.js';
import { adEnabled, runCommand, psCommand } from './ssh.js';

const EVENTS = [4624, 4634, 4625, 4740];

async function getCursor(eventId) {
  const r = await pgQuery('SELECT last_record_id FROM glpi_n8n.auditoria_ad_cursor WHERE event_id = $1', [eventId]);
  return r.rows[0] ? Number(r.rows[0].last_record_id) : 0;
}
async function setCursor(eventId, recordId) {
  await pgQuery(
    `INSERT INTO glpi_n8n.auditoria_ad_cursor (event_id, last_record_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (event_id) DO UPDATE SET last_record_id = EXCLUDED.last_record_id, updated_at = NOW()`,
    [eventId, recordId],
  );
}

async function insertEvent(eventId, e) {
  if (eventId === 4624 || eventId === 4634) {
    await pgQuery(
      `INSERT INTO glpi_n8n.auditoria_ad_logon (record_id, tipo, usuario, computador, ip, logon_type, ocorrido_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (record_id, tipo) DO NOTHING`,
      [e.record_id, e.tipo || (eventId === 4624 ? 'logon' : 'logoff'), e.usuario || null, e.computador || null, e.ip || null, e.logon_type ? parseInt(e.logon_type, 10) : null, e.ocorrido_em || null],
    );
  } else if (eventId === 4625) {
    await pgQuery(
      `INSERT INTO glpi_n8n.auditoria_ad_falha (record_id, usuario, computador, ip, motivo, ocorrido_em)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (record_id) DO NOTHING`,
      [e.record_id, e.usuario || null, e.computador || null, e.ip || null, e.motivo || null, e.ocorrido_em || null],
    );
  } else if (eventId === 4740) {
    await pgQuery(
      `INSERT INTO glpi_n8n.auditoria_ad_bloqueio (record_id, usuario, origem, ocorrido_em)
       VALUES ($1,$2,$3,$4) ON CONFLICT (record_id) DO NOTHING`,
      [e.record_id, e.usuario || null, e.origem || null, e.ocorrido_em || null],
    );
  }
}

async function collectEvent(eventId) {
  const after = await getCursor(eventId);
  const raw = await runCommand(psCommand([`-EventId ${eventId}`, `-AfterRecordId ${after}`, '-Max 500']));
  let events = [];
  try { events = JSON.parse(raw.trim() || '[]'); } catch { throw new Error(`JSON inválido do DC (event ${eventId}): ${raw.slice(0, 120)}`); }
  if (!Array.isArray(events)) {
    if (events && events.erro) throw new Error(`DC retornou erro (event ${eventId}): ${events.erro}`);
    events = [];
  }
  let max = after;
  for (const e of events) {
    await insertEvent(eventId, e);
    if (Number(e.record_id) > max) max = Number(e.record_id);
  }
  if (max > after) await setCursor(eventId, max);
  return events.length;
}

let running = false;
export async function collectOnce(log) {
  if (!adEnabled() || running) return;
  running = true;
  try {
    for (const id of EVENTS) {
      try {
        const n = await collectEvent(id);
        if (n) log?.info(`[ad] evento ${id}: ${n} novo(s)`);
      } catch (err) {
        log?.error(`[ad] falha no evento ${id}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

// Lookup ao vivo do perfil de um usuário no AD (grupos, última troca de senha, etc.).
export async function userLookup(login) {
  const raw = await runCommand(psCommand([`-User "${login.replace(/"/g, '')}"`]));
  let obj = null;
  try { obj = JSON.parse(raw.trim()); } catch { throw new Error('resposta inválida do DC'); }
  if (obj && obj.erro) throw new Error(obj.erro);
  return obj;
}

export function startCollector(log) {
  if (!adEnabled()) { log?.info('[ad] coletor desativado (AD_SSH_HOST não definido)'); return; }
  if (!cron.validate(config.ad.collectorCron)) { log?.error(`[ad] cron inválido: ${config.ad.collectorCron}`); return; }
  cron.schedule(config.ad.collectorCron, () => collectOnce(log));
  log?.info(`[ad] coletor agendado: ${config.ad.collectorCron}`);
  // primeira coleta logo após subir
  setTimeout(() => collectOnce(log), 5000);
}
