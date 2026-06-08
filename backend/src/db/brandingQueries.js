// Personalização (white-label) — linha única em glpi_n8n.app_branding.
import { pgQuery } from './postgres.js';

export async function getBranding() {
  const r = await pgQuery('SELECT org_nome, cor, logo, favicon, banner, login_img FROM glpi_n8n.app_branding WHERE id = 1');
  const x = r.rows[0] || {};
  return {
    orgNome: x.org_nome || '', cor: x.cor || '', logo: x.logo || '',
    favicon: x.favicon || '', banner: x.banner || '', loginImg: x.login_img || '',
  };
}

export async function saveBranding(b) {
  await pgQuery(
    `INSERT INTO glpi_n8n.app_branding (id, org_nome, cor, logo, favicon, banner, login_img, atualizado_em)
     VALUES (1, $1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET
       org_nome = $1, cor = $2, logo = $3, favicon = $4, banner = $5, login_img = $6, atualizado_em = now()`,
    [b.orgNome, b.cor, b.logo, b.favicon, b.banner, b.loginImg],
  );
}
