-- ================================================================
-- SETUP COMPLETO - GLPI N8N V2 (NOVO GLPI: suporte.araraquara.sp.gov.br)
-- Instalação do zero: execute este único arquivo
-- Banco: Prefeitura_Municipal_de_Araraquara
-- ================================================================
-- Ordem interna:
--   1. Token cache OAuth2 (API V2)
--   2. Credenciais e tokens
--   3. Colunas de notificação (chamados_log)
--   4. Colunas de aprovação e execução AD (chamados_log)
--   5. Índices de performance
--   6. Categorias GLPI (30 categorias - estrutura nova)
--   7. Verificação final
-- ================================================================
--
-- CREDENCIAIS: nao ficam mais neste arquivo. Passe-as via -v na linha de
-- comando para que segredos nao sejam versionados em texto plano:
--
--   psql -U postgres -d Prefeitura_Municipal_de_Araraquara \
--     -v client_id='<OAuth2 client_id>' \
--     -v client_secret='<OAuth2 client_secret>' \
--     -v glpi_password='<senha do usuario Automacao>' \
--     -v user_token='<user_token API v1>' \
--     -v app_token='<App-Token da API REST v1 usado pelos WF19-24>' \
--     -v app_token_v2='<App-Token do OAuth2 v2 /token usado pelo WF02>' \
--     -v chatwoot_url='<base URL do Chatwoot, ex: https://chat.exemplo.com>' \
--     -v chatwoot_token='<api_access_token do Chatwoot (Perfil > Access Token)>' \
--     -f setup_completo.sql
--
-- ATENCAO: ha DOIS App-Tokens distintos no GLPI 11:
--   * app_token    -> API REST v1 (WF19-24 leem glpi_token_cache.app_token)
--   * app_token_v2 -> OAuth2 v2 /api.php/token (WF02 le glpi_token_cache.app_token_v2)
-- Passe cada um com seu valor correto; trocar um pelo outro quebra a autenticacao.
-- ================================================================

\c "Prefeitura_Municipal_de_Araraquara"

-- ════════════════════════════════════════════════════════════════
-- 1. TOKEN CACHE - MIGRAR PARA OAuth2 (API V2)
-- ════════════════════════════════════════════════════════════════

-- Renomear session_token → access_token (reutilizar coluna da V1)
-- (idempotente: só executa se a coluna antiga ainda existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'glpi_n8n'
      AND table_name = 'glpi_token_cache'
      AND column_name = 'session_token'
  ) THEN
    ALTER TABLE glpi_n8n.glpi_token_cache
      RENAME COLUMN session_token TO access_token;
  END IF;
END $$;

-- Adicionar campos OAuth2
ALTER TABLE glpi_n8n.glpi_token_cache
  ADD COLUMN IF NOT EXISTS client_id     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_secret TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS glpi_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS glpi_password TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS token_url     TEXT NOT NULL DEFAULT '';

-- Atualizar credenciais e URLs para o NOVO GLPI
-- URLs atualizadas em 2026-05-23: GLPI 11 passou a versionar (/api.php/v2.3, /api.php/v1).
-- API v1 antiga em /apirest.php foi descontinuada.
UPDATE glpi_n8n.glpi_token_cache
SET base_url      = 'https://suporte.araraquara.sp.gov.br/api.php/v2.3',
    access_token  = '',
    expires_at    = NOW() - INTERVAL '1 minute',
    client_id     = regexp_replace(:'client_id',     '\s', '', 'g'),
    client_secret = regexp_replace(:'client_secret', '\s', '', 'g'),
    token_url     = 'https://suporte.araraquara.sp.gov.br/api.php/v2.3/token'
WHERE id = 1;

-- Função de cache: obter token válido
CREATE OR REPLACE FUNCTION glpi_n8n.fn_get_token_cache()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_token TEXT;
BEGIN
  SELECT access_token INTO v_token
  FROM glpi_n8n.glpi_token_cache
  WHERE id=1 AND expires_at > NOW() AND access_token != '';
  RETURN v_token;
END; $$;

-- Função de cache: salvar token
CREATE OR REPLACE FUNCTION glpi_n8n.fn_set_token_cache(p_token TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE glpi_n8n.glpi_token_cache
  SET access_token=p_token, obtained_at=NOW(),
      expires_at=NOW()+INTERVAL '55 minutes'
  WHERE id=1;
END; $$;

-- ════════════════════════════════════════════════════════════════
-- 2. CREDENCIAIS GLPI + TOKENS DE API (NOVO GLPI)
-- ════════════════════════════════════════════════════════════════

-- Colunas para autenticação alternativa via user_token.
--   app_token    = App-Token da API REST v1  (usado por WF19-24)
--   app_token_v2 = App-Token do endpoint OAuth2 v2 /api.php/token (usado por WF02)
-- Os dois tokens SAO DIFERENTES no GLPI 11 — nao reaproveite um pelo outro.
ALTER TABLE glpi_n8n.glpi_token_cache
  ADD COLUMN IF NOT EXISTS user_token   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS app_token    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS app_token_v2 TEXT DEFAULT '';

-- Credenciais do Chatwoot (usadas pelo WF20 para o aviso de aprovação ao superior).
--   chatwoot_url   = base URL do Chatwoot (sem barra final)
--   chatwoot_token = api_access_token de um usuario do Chatwoot (Perfil > Access Token)
ALTER TABLE glpi_n8n.glpi_token_cache
  ADD COLUMN IF NOT EXISTS chatwoot_url   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS chatwoot_token TEXT DEFAULT '';

-- Credenciais reais do novo GLPI (suporte.araraquara.sp.gov.br)
UPDATE glpi_n8n.glpi_token_cache
-- regexp_replace remove espacos/quebras de linha que entram por colagem no -v
-- (cabecalhos HTTP nao aceitam \n; nao limpa glpi_password, que pode conter espacos).
SET glpi_username  = 'Automacao',
    glpi_password  = :'glpi_password',
    user_token     = regexp_replace(:'user_token',    '\s', '', 'g'),
    app_token      = regexp_replace(:'app_token',     '\s', '', 'g'),
    app_token_v2   = regexp_replace(:'app_token_v2',  '\s', '', 'g'),
    chatwoot_url   = regexp_replace(:'chatwoot_url',  '\s', '', 'g'),
    chatwoot_token = regexp_replace(:'chatwoot_token','\s', '', 'g')
WHERE id = 1;

-- ════════════════════════════════════════════════════════════════
-- 3. CHAMADOS_LOG - COLUNAS DE NOTIFICAÇÃO E AD
-- ════════════════════════════════════════════════════════════════

-- Rastrear último followup notificado via WhatsApp
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS last_notified_followup_id INTEGER DEFAULT 0;

-- Rastrear última validação (aprovação/recusa) notificada
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS last_notified_validation_id INTEGER DEFAULT 0;

-- Dados originais da solicitação em JSON (salvo na abertura, usado pelo WF 14)
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS dados_solicitacao JSONB DEFAULT NULL;

-- Controle de execução AD (idempotência)
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS ad_executado BOOLEAN DEFAULT FALSE;

ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS ad_resultado JSONB DEFAULT NULL;

ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS ad_executado_em TIMESTAMPTZ DEFAULT NULL;

-- Timestamp de criação
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- WhatsApp do superior imediato (forms 1.1-1.7) - usado pelo WF20 para enviar
-- o aviso de aprovação pendente ao superior
ALTER TABLE glpi_n8n.chamados_log
  ADD COLUMN IF NOT EXISTS superior_whatsapp TEXT DEFAULT NULL;

-- ════════════════════════════════════════════════════════════════
-- 4. ÍNDICES DE PERFORMANCE
-- ════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_fila_mensagens_telefone
  ON public.n8n_fila_mensagens(telefone);

CREATE INDEX IF NOT EXISTS idx_historico_session
  ON public.n8n_historico_mensagens(session_id);

CREATE INDEX IF NOT EXISTS idx_status_session
  ON public.n8n_status_atendimento(session_id);

-- ════════════════════════════════════════════════════════════════
-- 5. CATEGORIAS GLPI - ESTRUTURA NOVA
-- ════════════════════════════════════════════════════════════════
-- Mudanças vs. estrutura antiga:
--   • E-mail (era 38) virou 20 — antes de Transferência
--   • Transferência (era 37) virou 22
--   • Suporte de Informática deslocado +3 (20-30 → 23-33)
--   • Sistemas da Saúde deslocado +3 (31-33 → 34-36); 3.2 mudou de "Erros no Sistema" para "Novo acesso"
--   • Telefonia deslocado +3 (34-36 → 37-40); 4.3 "Celular e Chip" — NOVO; "Outros" virou 4.4
-- ════════════════════════════════════════════════════════════════

DELETE FROM glpi_n8n.glpi_categorias;

INSERT INTO glpi_n8n.glpi_categorias
  (glpi_category_id, nome, nome_completo, menu_numero, subtipo, ativo)
VALUES
-- ── USR – Usuários e Acessos (categoria pai ID 11) ──────────────
(11, 'Usuários e Acessos',                'Usuários e Acessos',                                NULL, NULL,           true),
(15, 'USR-01 Criação de Usuário',         'Usuários e Acessos > Criação de usuário',           1,    'criacao',      true),
(16, 'USR-02 Reset de Senha Usuário',     'Usuários e Acessos > Reset de senha usuário',       1,    'reset',        true),
(17, 'USR-03 Reativação de Usuário',      'Usuários e Acessos > Reativação de usuário',        1,    'reativacao',   true),
(18, 'USR-04 Desativação de Usuário',     'Usuários e Acessos > Desativação de usuário',       1,    'desativacao',  true),
(19, 'USR-05 Acesso à Pasta de Rede',     'Usuários e Acessos > Acesso à pasta de rede',       1,    'pasta',        true),
(20, 'USR-06 Criação de E-mail',          'Usuários e Acessos > Criação de E-mail',            1,    'email',        true),
(22, 'USR-07 Transferência de Setor',     'Usuários e Acessos > Transferência de Setor',       1,    'transferencia',true),
-- ── SUP – Suporte de Informática (categoria pai ID 12) ──────────
(12, 'Suporte de Informática',            'Suporte de Informática',                            NULL, NULL,           true),
(23, 'SUP-01 Manutenção Impressoras',     'Suporte de Informática > Manutenção de impressoras',2,    '2.1',          true),
(24, 'SUP-02 Manutenção Computador',      'Suporte de Informática > Manutenção de computador', 2,    '2.2',          true),
(25, 'SUP-03 Instalação Software',        'Suporte de Informática > Instalação de software',   2,    '2.3',          true),
(26, 'SUP-04 Atualização Software',       'Suporte de Informática > Atualização de software',  2,    '2.4',          true),
(27, 'SUP-05 Reparação Software',         'Suporte de Informática > Reparação de software',    2,    '2.5',          true),
(28, 'SUP-06 Internet Lenta',             'Suporte de Informática > Internet lenta ou instável',2,   '2.6',          true),
(29, 'SUP-07 Sem Conexão Internet',       'Suporte de Informática > Sem conexão com a internet',2,   '2.7',          true),
(30, 'SUP-08 Acesso Wi-Fi',               'Suporte de Informática > Acesso Wi-Fi',             2,    '2.8',          true),
(31, 'SUP-09 VPN / Acesso Remoto',        'Suporte de Informática > VPN ou Acesso remoto',     2,    '2.9',          true),
(32, 'SUP-10 Outros Rede',                'Suporte de Informática > Outros assuntos de rede',  2,    '2.10',         true),
(33, 'SUP-11 Cartucho / Toner',           'Suporte de Informática > Cartucho ou toner',        2,    '2.11',         true),
-- ── SSA – Sistemas da Saúde (categoria pai ID 13) ───────────────
(13, 'Sistemas da Saúde',                 'Sistemas da Saúde',                                 NULL, NULL,           true),
(34, 'SSA-01 Problemas de Acesso',        'Sistemas da Saúde > Problemas de acesso sistema',   3,    '3.1',          true),
(35, 'SSA-02 Novo Acesso',                'Sistemas da Saúde > Novo acesso',                   3,    '3.2',          true),
(36, 'SSA-03 Solicitações Gerais',        'Sistemas da Saúde > Solicitações gerais',           3,    '3.3',          true),
-- ── TEL – Telefonia (categoria pai ID 14) ───────────────────────
(14, 'Telefonia',                         'Telefonia',                                         NULL, NULL,           true),
(37, 'TEL-01 Problemas com Ramal',        'Telefonia > Problemas com ramal',                   4,    '4.1',          true),
(38, 'TEL-02 Aparelho Telefônico',        'Telefonia > Aparelho telefônico',                   4,    '4.2',          true),
(39, 'TEL-03 Celular e Chip',             'Telefonia > Celular e Chip',                        4,    '4.3',          true),
(40, 'TEL-04 Outros Telefonia',           'Telefonia > Outros',                                4,    '4.4',          true);

-- ════════════════════════════════════════════════════════════════
-- 6. VERIFICAÇÃO FINAL
-- ════════════════════════════════════════════════════════════════

-- Token cache
SELECT id, glpi_username,
       left(access_token,20)||'...' AS access_token,
       left(client_id,20)||'...' AS client_id,
       left(user_token,10)||'...' AS user_token,
       left(app_token,10)||'...' AS app_token,
       base_url, token_url
FROM glpi_n8n.glpi_token_cache WHERE id = 1;

-- Chamados log - colunas
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'glpi_n8n' AND table_name = 'chamados_log'
ORDER BY ordinal_position;

-- Categorias (esperado: 29 linhas — 4 pais + 7 USR + 11 SUP + 3 SSA + 4 TEL)
SELECT glpi_category_id AS id, nome_completo, menu_numero, subtipo
FROM glpi_n8n.glpi_categorias
ORDER BY glpi_category_id;

-- Validação rápida: contagem por menu
SELECT menu_numero,
       COUNT(*) FILTER (WHERE menu_numero IS NOT NULL) AS subtipos
FROM glpi_n8n.glpi_categorias
WHERE menu_numero IS NOT NULL
GROUP BY menu_numero
ORDER BY menu_numero;
-- Esperado: 1=7, 2=11, 3=3, 4=4
