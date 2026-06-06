// GET /api/sla?period=7d|30d|90d — séries dos gráficos da tela SLA & Métricas.
import { slaTrend, slaByCategory, distribution, weeklyTotals } from '../db/slaQueries.js';
import { avgResolutionMin, topTecnicos } from '../db/glpiQueries.js';
import { weeklyChannelLog } from '../db/overviewQueries.js';

const DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;
async function safe(p, fb) { try { return await p; } catch { return fb; } }
const short = (c) => (c ? String(c).split('>').pop().trim() : 'Sem categoria');
const pad = (n) => String(n).padStart(2, '0');
const ddmm = (x) => { const d = new Date(x); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
const fmtDur = (min) => (min == null ? null : min < 60 ? `${min}min` : min < 1440 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`);

export default async function slaRoutes(fastify) {
  fastify.get('/api/sla', { preHandler: fastify.authenticate }, async (req) => {
    const period = DAYS[req.query.period] ? req.query.period : '30d';
    const now = new Date();
    const start = new Date(now - DAYS[period] * DAY_MS);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const s = fmt(start); const e = fmt(now);

    const [trend, byCat, dist, wkTotals, wkLog, tempoMedioMin, tecnicos] = await Promise.all([
      safe(slaTrend(s, e), []),
      safe(slaByCategory(s, e), []),
      safe(distribution(s, e), []),
      safe(weeklyTotals(), [0, 0, 0, 0]),
      safe(weeklyChannelLog(), { wa: [0, 0, 0, 0], form: [0, 0, 0, 0] }),
      safe(avgResolutionMin(s, e), null),
      safe(topTecnicos(s, e), []),
    ]);

    const evolucao = { labels: trend.map((t) => ddmm(t.d)), data: trend.map((t) => t.pct) };
    const categoria = { labels: byCat.map((c) => short(c.cat)), data: byCat.map((c) => c.pct) };

    const top = dist.slice(0, 5);
    const outros = dist.slice(5).reduce((sum, x) => sum + x.total, 0);
    const distrib = {
      labels: [...top.map((x) => short(x.cat)), ...(outros > 0 ? ['Outros'] : [])],
      data: [...top.map((x) => x.total), ...(outros > 0 ? [outros] : [])],
    };

    const idx = [3, 2, 1, 0]; // S1 (mais antiga) .. S4 (atual)
    const semanal = {
      labels: ['S1', 'S2', 'S3', 'S4'],
      whatsapp: idx.map((w) => wkLog.wa[w]),
      formulario: idx.map((w) => wkLog.form[w]),
      manual: idx.map((w) => Math.max(0, (wkTotals[w] || 0) - wkLog.wa[w] - wkLog.form[w])),
    };

    return {
      period, evolucao, categoria, distribuicao: distrib, semanal,
      tempoMedioResolucao: fmtDur(typeof tempoMedioMin === 'number' ? tempoMedioMin : null),
      topTecnicos: Array.isArray(tecnicos) ? tecnicos : [],
      generatedAt: new Date().toISOString(),
    };
  });
}
