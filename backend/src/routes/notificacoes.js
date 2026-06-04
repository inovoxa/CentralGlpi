// GET /api/notificacoes — alertas operacionais reais para a sineta do topo.
import { pgQuery } from '../db/postgres.js';
import { glpiQuery, glpiEnabled } from '../db/mysql.js';
import { bruteForce } from '../db/auditQueries.js';
import { can } from '../lib/rbac.js';

async function safe(p, fb) { try { return await p; } catch { return fb; } }
const rows = async (sql, p = []) => (await pgQuery(sql, p)).rows;

export default async function notificacoesRoutes(fastify) {
  fastify.get('/api/notificacoes', { preHandler: fastify.authenticate }, async (req) => {
    const items = [];

    // SLA estourado em aberto (GLPI) — resumo.
    if (glpiEnabled()) {
      const r = await safe(glpiQuery(
        `SELECT COUNT(*) AS c FROM glpi_tickets
          WHERE is_deleted = 0 AND time_to_resolve IS NOT NULL AND solvedate IS NULL AND time_to_resolve < NOW()`), []);
      const c = Number(r[0]?.c || 0);
      if (c > 0) items.push({ icon: 'ti-alert-triangle', color: 'red', text: `${c} chamado(s) com SLA estourado`, when: null });
    }

    // Execuções de AD concluídas nas últimas 24h.
    const ad = await safe(rows(
      `SELECT titulo, glpi_ticket_id, ad_executado_em FROM glpi_n8n.chamados_log
        WHERE ad_executado AND ad_executado_em >= now() - interval '24 hours'
        ORDER BY ad_executado_em DESC LIMIT 5`), []);
    for (const x of ad) items.push({ icon: 'ti-bolt', color: 'teal', text: `Execução AD concluída — ${x.titulo || '#' + x.glpi_ticket_id}`, when: x.ad_executado_em });

    // Itens de segurança apenas para quem tem auditoria.
    if (can(req.session.profile, 'view_audit')) {
      const bloq = await safe(rows(
        `SELECT usuario, ocorrido_em FROM glpi_n8n.auditoria_ad_bloqueio
          WHERE ocorrido_em >= now() - interval '24 hours' ORDER BY ocorrido_em DESC LIMIT 5`), []);
      for (const b of bloq) items.push({ icon: 'ti-lock', color: 'amber', text: `Conta bloqueada: ${b.usuario}`, when: b.ocorrido_em });

      const bf = await safe(bruteForce(), []);
      for (const b of bf) items.push({ icon: 'ti-shield-bolt', color: 'red', text: `Brute force: ${b.usuario} (${b.tentativas})`, when: b.ultimo });
    }

    // Ordena (mais recente primeiro; resumos sem data vão ao topo) e limita.
    items.sort((a, b) => (b.when ? new Date(b.when).getTime() : Infinity) - (a.when ? new Date(a.when).getTime() : Infinity));
    return { count: items.length, items: items.slice(0, 8) };
  });
}
