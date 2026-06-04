// Cliente mínimo da API do Chatwoot. Credenciais: env CHATWOOT_* ou, em fallback,
// glpi_n8n.glpi_token_cache (chatwoot_url / chatwoot_token). account_id só por env.
import { config } from '../config.js';
import { pgQuery } from '../db/postgres.js';

let cached = null;
async function getConfig() {
  if (cached) return cached;
  let { url, token, accountId } = config.chatwoot;
  if (!url || !token) {
    try {
      const r = await pgQuery('SELECT chatwoot_url, chatwoot_token FROM glpi_n8n.glpi_token_cache WHERE id = 1');
      url = url || r.rows[0]?.chatwoot_url || '';
      token = token || r.rows[0]?.chatwoot_token || '';
    } catch { /* sem DB: segue sem credenciais */ }
  }
  cached = { url: (url || '').replace(/\/+$/, ''), token: token || '', accountId: accountId || '' };
  return cached;
}

export async function chatwootReady() {
  const c = await getConfig();
  return !!(c.url && c.token && c.accountId);
}

async function cw(path, opts = {}) {
  const c = await getConfig();
  if (!c.url || !c.token || !c.accountId) {
    throw new Error('Chatwoot não configurado (defina CHATWOOT_URL/TOKEN/ACCOUNT_ID).');
  }
  const url = `${c.url}/api/v1/accounts/${c.accountId}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: { api_access_token: c.token, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`Chatwoot ${path} (${res.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

export async function listConversations({ status = 'open', page = 1 } = {}) {
  const body = await cw(`/conversations?status=${encodeURIComponent(status)}&assignee_type=all&page=${page}`);
  return body?.data?.payload || body?.payload || [];
}

export async function getMessages(conversationId) {
  const body = await cw(`/conversations/${conversationId}/messages`);
  return body?.payload || body?.data?.payload || [];
}

export async function sendMessage(conversationId, content) {
  return cw(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, message_type: 'outgoing' }),
  });
}

// Agentes da conta (para mapear o usuário do painel a um agente do Chatwoot por e-mail).
export async function findAgentByEmail(email) {
  if (!email) return null;
  const agents = await cw('/agents');
  const list = Array.isArray(agents) ? agents : agents?.payload || [];
  return list.find((a) => (a.email || '').toLowerCase() === email.toLowerCase()) || null;
}

export async function assignConversation(conversationId, assigneeId) {
  return cw(`/conversations/${conversationId}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ assignee_id: assigneeId }),
  });
}
