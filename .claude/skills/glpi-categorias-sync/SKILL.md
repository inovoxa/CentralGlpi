---
name: glpi-categorias-sync
description: Verificar se os IDs de categoria GLPI estão idênticos nos três lugares que os declaram — setup_completo.sql, formularios_definicoes.json e o MAPA do WF22. Use ao adicionar, remover ou renumerar qualquer categoria/formulário.
---

# Sincronia de categorias GLPI

Os mesmos IDs de categoria vivem em **três lugares** e precisam bater exatamente
(ver CLAUDE.md → "GLPI Category Map"):

1. `setup_completo.sql` — tabela `glpi_n8n.glpi_categorias` (subtipos = linhas com categoria-pai).
2. `formularios_definicoes.json` — chave `categoria_glpi` de cada um dos 25 formulários.
3. `22_GLPI_Reconfig_Destinations.json` — constante `MAPA` (chave `categoria_glpi`).

Mexeu em um, tem que mexer nos três. Esta skill pega o descompasso antes de subir.

## Como usar

```bash
python3 .claude/skills/glpi-categorias-sync/check_categorias.py
```

`OK` (exit 0) = os três conjuntos são idênticos. Qualquer `[X]` (exit 1) lista
o que está em uns e falta em outros.

## Esperado hoje (2026-06-04)
25 subtipos: `15–20, 22, 23–40` (ID 21 foi removido; 1.7 = Transferência usa ID 22, não 21).
Contagem por menu: `1=7, 2=11, 3=3, 4=4`. O grupo-pai 11/12/13/14 não conta como subtipo.

## Notas
- Ao adicionar uma categoria: insira no `.sql` (com pai), no `formularios_definicoes.json` e no `MAPA` do WF22 — depois rode esta skill.
- Se mexeu em WF22, rode também `glpi-wf-validate`.
