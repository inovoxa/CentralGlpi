-- Personalização (white-label): logo, favicon, banner, imagem de login, nome e cor.
-- Linha única (id=1). Imagens guardadas como data URI (base64) em texto.
CREATE TABLE IF NOT EXISTS glpi_n8n.app_branding (
  id            smallint PRIMARY KEY DEFAULT 1,
  org_nome      text,
  cor           text,
  logo          text,
  favicon       text,
  banner        text,
  login_img     text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_branding_one CHECK (id = 1)
);
INSERT INTO glpi_n8n.app_branding (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
