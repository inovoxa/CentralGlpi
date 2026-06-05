// GET /api/live — atividade ao vivo: eventos do chamados_log (aberturas/execuções AD)
// + eventos recentes do GLPI (followups, tarefas, novos chamados). Polling do front.
import { recentEvents } from '../db/liveQueries.js';
import { recentEventsGlpi } from '../db/glpiQueries.js';
import { glpiEnabled } from '../db/mysql.js';

async function safe(p, fb) { try { return await p; } catch { return fb; } }
const iso = (x) => (x ? new Date(x).toISOString() : null);
const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export default async function liveRoutes(fastify) {
  fastify.get('/api/live', { preHandler: fastify.authenticate }, async () => {
    const base = await safe(recentEvents(40), []);
    const events = base.map((e) => ({ id: e.id, type: e.type, at: iso(e.at), msg: e.msg }));

    if (glpiEnabled()) {
      const g = await safe(recentEventsGlpi(), []);
      for (const e of Array.isArray(g) ? g : []) {
        const snip = strip(e.content).slice(0, 70);
        let msg;
        if (e.tipo === 'followup') msg = `Acompanhamento no #${e.ticket}: ${snip}`;
        else if (e.tipo === 'tarefa') msg = `Tarefa no #${e.ticket}: ${snip}`;
        else msg = `Novo chamado #${e.ticket}: ${snip}`;
        events.push({ id: e.id, type: e.tipo, at: iso(e.at), msg });
      }
    }

    events.sort((a, b) => ((b.at || '') < (a.at || '') ? -1 : (b.at || '') > (a.at || '') ? 1 : 0));
    return { events: events.slice(0, 40), generatedAt: new Date().toISOString() };
  });
}
