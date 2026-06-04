---
name: glpi-secret-audit
description: Auditar segredos hardcoded (App-Token, user_token, client_secret, senha) nos arquivos do projeto GLPI n8n. Use antes de commit/deploy ou quando perguntarem se há credencial exposta no código.
---

# Auditoria de segredos (GLPI n8n)

Os tokens/segredos devem viver **só** em `glpi_n8n.glpi_token_cache` e ser lidos em runtime — nunca embutidos em workflow JSON, `.sql` ou `.ps1` versionados.

## Como usar

```bash
python3 .claude/skills/glpi-secret-audit/audit_secrets.py
```

`OK` (exit 0) = limpo. Qualquer `[X]` (exit 1) é um segredo a remover.

## O que detecta
- **Detecção estrutural** (não depende de valores fixos — não fica obsoleta):
  - Headers `App-Token` / `Authorization` / `Session-Token` com valor literal em workflow `.json` (deveriam ser `={{ $json.app_token_v2 }}` ou equivalente).
  - `const appToken/userToken = '...'` em jsCode de Code nodes.
  - `client_secret` / `glpi_password` / `user_token` / `app_token` = `'literal'` em `.sql` e em queries de nós.
  - Atribuição literal a variável de credencial em `.ps1` (`$token = "..."`, `$senha_glpi = '...'`, etc.).
- **Denylist `KNOWN`** (sentinela): fragmentos de segredos *já vazados* para barrar reintrodução de backups antigos. Esvaziada em 2026-06-04 após rotação — ver abaixo.

Cobre `.json`, `.sql`, `.ps1`, `.md`, `.csv`. Ignora `.claude/` (as próprias skills) e `.git/`.

## Se achar algo
- **Workflow:** trocar o literal por leitura do banco — padrão do WF02 (`={{ $json.app_token_v2 }}`) e do nó `Carregar Tokens` dos WF19–26 (`$('Carregar Tokens').first().json.app_token`).
- **SQL:** usar variáveis `-v`/`:'var'` ou um `UPDATE` controlado fora do arquivo; nunca literal versionado.
- **PowerShell:** receber por `param(...)` ou ler de fonte externa; nunca embutir no `.ps1` versionado.
- **Sempre:** rotacionar o segredo exposto no GLPI/AD. Só *depois* da rotação, se quiser, cole um fragmento (8–12 chars) na denylist `KNOWN` para vigiar reintrodução — nunca adicione um segredo ainda válido (este arquivo é versionado).
