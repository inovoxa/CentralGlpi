// GET /api/sla — séries prontas para os 4 gráficos da tela SLA & Métricas.
import { slaMonthly, slaByCategory, distribution, weeklyTotals } from '../db/slaQueries.js';
import { avgResolutionMin, topTecnicos } from '../db/glpiQueries.js';
import { weeklyChannelLog } from '../db/overviewQueries.js';

const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
async function safe(p, fb) { try { return await p; } catch { return fb; } }
// Encurta "Pai > Filho > Neto" para o último segmento.
const short = (c) => (c ? String(c).split('>').pop().trim() : 'Sem categoria');

export default async function slaRoutes(fastify) {
  fastify.get('/api/sla', { preHandler: fastify.authenticate }, async () => {
    const now = new Date();
    const start6 = new Date(now - 182 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const [monthly, byCat, dist, wkTotals, wkLog, tempoMedioMin, tecnicos] = await Promise.all([
      safe(slaMonthly(), []),
      safe(slaByCategory(), []),
      safe(distribution(), []),
      safe(weeklyTotals(), [0, 0, 0, 0]),
      safe(weeklyChannelLog(), { wa: [0, 0, 0, 0], form: [0, 0, 0, 0] }),
      safe(avgResolutionMin(fmt(start6), fmt(now)), null),
      safe(topTecnicos(fmt(start6), fmt(now)), []),
    ]);
    const fmtDur = (min) => (min == null ? null : min < 60 ? `${min}min` : min < 1440 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`);

    // Evolução mensal do SLA
    const evolucao = {
      labels: monthly.map((m) => MES[Number(m.ym.split('-')[1]) - 1] || m.ym),
      data: monthly.map((m) => m.pct),
    };

    // SLA por categoria
    const categoria = { labels: byCat.map((c) => short(c.cat)), data: byCat.map((c) => c.pct) };

    // Distribuição: top 5 + Outros
    const top = dist.slice(0, 5);
    const outros = dist.slice(5).reduce((s, x) => s + x.total, 0);
    const distrib = {
      labels: [...top.map((x) => short(x.cat)), ...(outros > 0 ? ['Outros'] : [])],
      data: [...top.map((x) => x.total), ...(outros > 0 ? [outros] : [])],
    };

    // Semanal por canal: offset 3=S1 (mais antiga) .. 0=S4 (atual)
    const idx = [3, 2, 1, 0];
    const semanal = {
      labels: ['S1', 'S2', 'S3', 'S4'],
      whatsapp: idx.map((w) => wkLog.wa[w]),
      formulario: idx.map((w) => wkLog.form[w]),
      manual: idx.map((w) => Math.max(0, (wkTotals[w] || 0) - wkLog.wa[w] - wkLog.form[w])),
    };

    return {
      evolucao, categoria, distribuicao: distrib, semanal,
      tempoMedioResolucao: fmtDur(typeof tempoMedioMin === 'number' ? tempoMedioMin : null),
      topTecnicos: Array.isArray(tecnicos) ? tecnicos : [],
      generatedAt: new Date().toISOString(),
    };
  });
}
