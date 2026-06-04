// GET /api/overview?period=7d|30d|90d&sector=<nome> — KPIs da Visão Geral.
// Cada métrica é defensiva: se a fonte falhar, vira null (o front mostra "—").
import { countTickets, slaCompliance, lastSlaBreach } from '../db/glpiQueries.js';
import { countExecucoesAD, lastDesativacao, lastExecucaoAD } from '../db/overviewQueries.js';

const DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;

const fmtMy = (d) => d.toISOString().slice(0, 19).replace('T', ' '); // MySQL datetime
async function safe(p) { try { return await p; } catch (e) { return { __err: e.message }; } }
const num = (v) => (typeof v === 'number' ? v : null);
const obj = (v) => (v && !v.__err ? v : null);
function trend(c, p) {
  c = num(c); p = num(p);
  if (c == null || p == null || p === 0) return null;
  return Math.round(((c - p) / p) * 100);
}

export default async function overviewRoutes(fastify) {
  fastify.get('/api/overview', { preHandler: fastify.authenticate }, async (req) => {
    const period = DAYS[req.query.period] ? req.query.period : '30d';
    const days = DAYS[period];
    const sector = req.query.sector && req.query.sector !== 'all' ? String(req.query.sector) : null;

    const now = new Date();
    const curStart = new Date(now - days * DAY_MS);
    const prevStart = new Date(now - 2 * days * DAY_MS);

    const [
      ticketsCur, ticketsPrev, sla, breach, adCur, adPrev, ultDes, ultExec,
    ] = await Promise.all([
      safe(countTickets(fmtMy(curStart), fmtMy(now))),
      safe(countTickets(fmtMy(prevStart), fmtMy(curStart))),
      safe(slaCompliance(fmtMy(curStart), fmtMy(now))),
      safe(lastSlaBreach()),
      safe(countExecucoesAD(curStart.toISOString(), now.toISOString(), sector)),
      safe(countExecucoesAD(prevStart.toISOString(), curStart.toISOString(), sector)),
      safe(lastDesativacao(sector)),
      safe(lastExecucaoAD(sector)),
    ]);

    const tCur = num(ticketsCur);
    const adC = num(adCur);
    let resolvidosIA = null;
    if (adC != null && tCur != null && tCur > 0) {
      resolvidosIA = Math.min(100, Math.round((adC / tCur) * 100));
    }

    return {
      period,
      sector,
      kpis: {
        chamados: { value: tCur, trendPct: trend(tCur, num(ticketsPrev)) },
        sla: { value: num(sla) },
        resolvidosIA: { value: resolvidosIA },
        execucoesAD: { value: adC, trendPct: trend(adC, num(adPrev)) },
      },
      destaques: {
        ultimaDesativacao: obj(ultDes),
        ultimaExecucaoAD: obj(ultExec),
        ultimoIncidenteSLA: obj(breach),
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
