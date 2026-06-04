// Cliente mínimo da API REST v1 do GLPI (apirest) para ESCRITA de tickets.
// Padrão idêntico ao usado pelos workflows n8n (WF19–26):
//   initSession (App-Token + Authorization: user_token <token>) -> Session-Token
//   PUT /Ticket/:id  { input: { status } }
//   killSession
// Tokens vêm de glpi_n8n.glpi_token_cache (nunca hardcoded).
import { config } from '../config.js';
import { pgQuery } from '../db/postgres.js';

async function loadTokens() {
  const r = await pgQuery(
    'SELECT user_token, app_token FROM glpi_n8n.glpi_token_cache WHERE id = 1',
  );
  const t = r.rows[0];
  if (!t || !t.app_token || !t.user_token) {
    throw new Error('Tokens da API v1 ausentes em glpi_token_cache.');
  }
  return t;
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

// Atualiza o status de um ticket no GLPI. Retorna { ok, status, body }.
export async function updateTicketStatus(ticketId, status) {
  const base = config.glpi.apiV1Url;
  const { app_token, user_token } = await loadTokens();

  const init = await jsonFetch(`${base}/initSession`, {
    method: 'GET',
    headers: { 'App-Token': app_token, Authorization: `user_token ${user_token}` },
  });
  const sessionToken = init.body && init.body.session_token;
  if (!init.ok || !sessionToken) {
    throw new Error(`initSession falhou (${init.status}): ${JSON.stringify(init.body)}`);
  }

  const H = { 'App-Token': app_token, 'Session-Token': sessionToken, 'Content-Type': 'application/json' };
  try {
    const upd = await jsonFetch(`${base}/Ticket/${ticketId}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ input: { id: ticketId, status } }),
    });
    if (!upd.ok) throw new Error(`PUT /Ticket/${ticketId} falhou (${upd.status}): ${JSON.stringify(upd.body)}`);
    return upd;
  } finally {
    // encerra a sessão mesmo se o PUT falhar
    await jsonFetch(`${base}/killSession`, { method: 'GET', headers: H }).catch(() => {});
  }
}
