// Consultas da auditoria de AD (tabelas auditoria_ad_*, PostgreSQL).
import { pgQuery } from './postgres.js';
const rows = async (sql, p = []) => (await pgQuery(sql, p)).rows;

export const logonsHoje = async () =>
  Number((await rows(
    `SELECT COUNT(DISTINCT lower(usuario)) c FROM glpi_n8n.auditoria_ad_logon
      WHERE tipo='logon' AND usuario IS NOT NULL AND ocorrido_em >= date_trunc('day', now())`,
  ))[0]?.c || 0);

export const quemLogouHoje = () => rows(
  `SELECT usuario, MAX(ocorrido_em) AS ultimo, COUNT(*)::int AS total
     FROM glpi_n8n.auditoria_ad_logon
    WHERE tipo='logon' AND usuario IS NOT NULL AND ocorrido_em >= date_trunc('day', now())
    GROUP BY usuario ORDER BY ultimo DESC LIMIT 50`);

export const ultimosLogons = () => rows(
  `SELECT usuario, computador, ip, ocorrido_em
     FROM glpi_n8n.auditoria_ad_logon
    WHERE tipo='logon' AND usuario IS NOT NULL
    ORDER BY ocorrido_em DESC LIMIT 15`);

export const logonsSimultaneos = () => rows(
  `SELECT usuario, COUNT(DISTINCT computador)::int AS maquinas, MAX(ocorrido_em) AS ultimo
     FROM glpi_n8n.auditoria_ad_logon
    WHERE tipo='logon' AND usuario IS NOT NULL AND computador IS NOT NULL
      AND ocorrido_em >= now() - interval '12 hours'
    GROUP BY usuario HAVING COUNT(DISTINCT computador) > 1
    ORDER BY maquinas DESC LIMIT 20`);

export const bloqueiosRecentes = () => rows(
  `SELECT usuario, origem, ocorrido_em FROM glpi_n8n.auditoria_ad_bloqueio
    ORDER BY ocorrido_em DESC LIMIT 20`);

export const bloqueiosTotal7d = async () =>
  Number((await rows(
    `SELECT COUNT(*) c FROM glpi_n8n.auditoria_ad_bloqueio WHERE ocorrido_em >= now() - interval '7 days'`,
  ))[0]?.c || 0);

export const falhas24h = async () =>
  Number((await rows(
    `SELECT COUNT(*) c FROM glpi_n8n.auditoria_ad_falha WHERE ocorrido_em >= now() - interval '24 hours'`,
  ))[0]?.c || 0);

export const bruteForce = () => rows(
  `SELECT usuario, ip, COUNT(*)::int AS tentativas, MAX(ocorrido_em) AS ultimo
     FROM glpi_n8n.auditoria_ad_falha
    WHERE ocorrido_em >= now() - interval '1 hour' AND usuario IS NOT NULL
    GROUP BY usuario, ip HAVING COUNT(*) >= 5
    ORDER BY tentativas DESC LIMIT 20`);

// Perfil (parte vinda das tabelas locais).
export const perfilLocal = async (login) => {
  const ult = await rows(
    `SELECT computador, ip, ocorrido_em FROM glpi_n8n.auditoria_ad_logon
      WHERE tipo='logon' AND lower(usuario)=lower($1) ORDER BY ocorrido_em DESC LIMIT 1`, [login]);
  const bloq = await rows(
    `SELECT origem, ocorrido_em FROM glpi_n8n.auditoria_ad_bloqueio
      WHERE lower(usuario)=lower($1) ORDER BY ocorrido_em DESC LIMIT 10`, [login]);
  const fal = await rows(
    `SELECT COUNT(*) c FROM glpi_n8n.auditoria_ad_falha
      WHERE lower(usuario)=lower($1) AND ocorrido_em >= now() - interval '7 days'`, [login]);
  return {
    ultimoLogon: ult[0] || null,
    historicoBloqueios: bloq,
    falhas7d: Number(fal[0]?.c || 0),
  };
};

export const buscaUsuario = (q) => rows(
  `SELECT usuario, MAX(ocorrido_em) AS ultimo, COUNT(*)::int AS logons
     FROM glpi_n8n.auditoria_ad_logon
    WHERE tipo='logon' AND usuario ILIKE $1
    GROUP BY usuario ORDER BY ultimo DESC LIMIT 25`, ['%' + q + '%']);

export const buscaMaquina = (q) => rows(
  `SELECT computador, usuario, ip, ocorrido_em
     FROM glpi_n8n.auditoria_ad_logon
    WHERE computador ILIKE $1
    ORDER BY ocorrido_em DESC LIMIT 30`, ['%' + q + '%']);
