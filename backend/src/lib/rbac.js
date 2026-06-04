// Definições de perfis e permissões — fonte da verdade no servidor.
// Espelha o que o index.html usava em memória, agora autoritativo no backend.
export const PERMS = [
  { g: 'Operação', items: [
    ['view_all', 'Ver todos os chamados'],
    ['view_sector', 'Ver chamados do setor'],
    ['move_kanban', 'Mover cards no Kanban'],
    ['assume', 'Assumir conversas'],
    ['send_msg', 'Responder no chat'],
    ['update_status', 'Atualizar status'],
  ]},
  { g: 'Aprovação & Execução', items: [
    ['approve', 'Aprovar chamados'],
    ['execute_ad', 'Executar no AD/Exchange'],
    ['edit_sla', 'Editar SLAs'],
  ]},
  { g: 'Gestão', items: [
    ['manage_users', 'Cadastrar usuários do sistema'],
    ['manage_profiles', 'Gerenciar perfis'],
    ['manage_sectors', 'Gerenciar setores'],
    ['config', 'Configurações do sistema'],
  ]},
  { g: 'Auditoria', items: [
    ['view_audit', 'Ver auditoria'],
    ['export', 'Exportar relatórios/logs'],
  ]},
];

export const ALLPERMS = PERMS.flatMap((x) => x.items.map((i) => i[0]));

export const PROFILES = {
  admin: {
    name: 'Admin',
    desc: 'Acesso total ao sistema, incluindo cadastros e configuração',
    color: 'var(--p)',
    perms: [...ALLPERMS],
  },
  coord: {
    name: 'Coordenador TI',
    desc: 'Aprova, executa, edita SLAs e vê auditoria',
    color: 'var(--s)',
    perms: ['view_all', 'move_kanban', 'assume', 'send_msg', 'update_status', 'approve', 'execute_ad', 'edit_sla', 'view_audit', 'export', 'manage_users', 'manage_sectors'],
  },
  tecnico: {
    name: 'Técnico',
    desc: 'Atende chamados atribuídos e a fila geral',
    color: 'var(--a)',
    perms: ['view_all', 'move_kanban', 'assume', 'send_msg', 'update_status'],
  },
  gestor: {
    name: 'Gestor de Setor',
    desc: 'Aprova chamados do próprio setor, sem ações técnicas',
    color: 'var(--warn)',
    perms: ['view_sector', 'approve'],
  },
  auditor: {
    name: 'Auditor',
    desc: 'Somente leitura — consulta e exporta logs',
    color: '#9db4ff',
    perms: ['view_all', 'view_audit', 'export'],
  },
};

export function profileExists(p) {
  return Object.prototype.hasOwnProperty.call(PROFILES, p);
}

export function can(profile, perm) {
  return !!PROFILES[profile]?.perms.includes(perm);
}

// Forma enviada ao front em /api/me (perfis + permissões + catálogo de perms).
export function rbacCatalog() {
  return { profiles: PROFILES, perms: PERMS, allperms: ALLPERMS };
}
