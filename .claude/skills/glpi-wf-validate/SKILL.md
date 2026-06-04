---
name: glpi-wf-validate
description: Validar workflows n8n do projeto GLPI após editá-los — checa parse JSON, parametrização SQL dos nós Log no Banco, fiação do Carregar Tokens, conexões e credenciais. Use depois de qualquer mudança em arquivo de workflow .json e antes de reimportar no n8n.
---

# Validar workflows n8n (GLPI)

Rode o validador antes de considerar uma edição de workflow concluída.

## Como usar

```bash
# todos os workflows do diretório
python3 .claude/skills/glpi-wf-validate/validate_wf.py

# um arquivo específico
python3 .claude/skills/glpi-wf-validate/validate_wf.py 04_GLPI_Criar_Usuario.json
```

`OK` (exit 0) = válido. Qualquer `[FAIL]` (exit 1) precisa ser corrigido antes de subir. `[warn]` é alerta (ex.: Postgres sem credencial — comum logo após importar).

## O que checa
- JSON parseia.
- Nós com `INSERT INTO glpi_n8n.chamados_log`: sem interpolação `{{ }}` na query; nº de `$N` == nº de elementos do `queryReplacement`; sem `.replace()` (escape manual).
- Se existe nó `Carregar Tokens`: está conectado (entra **e** sai) — senão não executa e os tokens chegam vazios.
- Sem `const appToken/userToken = '...'` literal no jsCode.
- Conexões apontam para nós existentes; avisa Postgres sem credencial.

## Notas do projeto
- O `queryReplacement` deve ser array de expressão: `={{ [ ... ] }}`, **um elemento por `$N`**, na ordem das colunas do INSERT.
- Workflows com schema próprio: 09/09B/10 não têm `dados_solicitacao` e a categoria vem de `$('Criar Chamado GLPI').category`; 16 (e-mail) tem colunas reduzidas. Ao mexer neles, preserve a estrutura original.
- Projeto tem **26 workflows** (01–26). WF25 (`Sync_Aprovadores`) roda só via SSH/AD + CSV — não usa Postgres nem `chamados_log`, então a maioria das checagens não se aplica. WF26 (`Inspecionar_Respostas_Form`) usa o nó `Carregar Tokens` (a checagem de fiação vale).
- Depois de validar, rode também a skill `glpi-secret-audit`. Se mexeu em categoria, rode `glpi-categorias-sync`.
