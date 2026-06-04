// Molda o usuário para o cliente, sem nunca expor hash de senha ou segredo TOTP.
import { PROFILES, can, ALLPERMS } from './rbac.js';

export function publicUser(u) {
  const profileMeta = PROFILES[u.profile] || null;
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    profile: u.profile,
    profileName: profileMeta?.name || u.profile,
    sector: u.sector,
    status: u.status,
    tel: u.tel || null,
    primeiro_acesso: u.primeiro_acesso,
    totp_enabled: u.totp_enabled,
    perms: ALLPERMS.filter((p) => can(u.profile, p)),
  };
}
