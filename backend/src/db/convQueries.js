// Liga conversas do Chatwoot a tickets/setor via chamados_log.conversa_id.
import { pgQuery } from './postgres.js';

// Retorna { conversaId: { ticket, secretaria } } para os ids informados.
export async function convLinks(conversaIds) {
  const ids = conversaIds.map(Number).filter(Boolean);
  if (!ids.length) return {};
  const r = await pgQuery(
    `SELECT conversa_id, glpi_ticket_id, secretaria
       FROM glpi_n8n.chamados_log
      WHERE conversa_id = ANY($1::bigint[])`,
    [ids],
  );
  const map = {};
  for (const row of r.rows) {
    map[Number(row.conversa_id)] = {
      ticket: row.glpi_ticket_id ? Number(row.glpi_ticket_id) : null,
      secretaria: row.secretaria || null,
    };
  }
  return map;
}
