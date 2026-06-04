#!/usr/bin/env python3
"""Verifica sincronia dos IDs de categoria GLPI entre os tres lugares que os declaram.

Uso: python3 check_categorias.py [diretorio]   (default: diretorio atual)
Saida: divergencias e codigo 1 se os conjuntos diferem; 0 se identicos.

Fontes (ver CLAUDE.md -> "GLPI Category Map"):
  1. setup_completo.sql                  -> tabela glpi_categorias (subtipos = com pai)
  2. formularios_definicoes.json         -> chave categoria_glpi (25 formularios)
  3. 22_GLPI_Reconfig_Destinations.json  -> constante MAPA (chave categoria_glpi)
"""
import sys, os, re, json

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

def path(*p): return os.path.join(ROOT, *p)

def from_sql():
    """Subtipos = linhas VALUES cujo 4o campo (categoria-pai) e numerico (nao NULL)."""
    txt = open(path('setup_completo.sql'), encoding='utf-8').read()
    ids = set()
    for ln in txt.splitlines():
        if ln.lstrip().startswith('--'):
            continue
        m = re.match(r"\(\s*(\d+)\s*,.*?,\s*(\d+|NULL)\s*,", ln)
        if m and m.group(2) != 'NULL':
            ids.add(int(m.group(1)))
    return ids

def from_form():
    d = json.load(open(path('formularios_definicoes.json'), encoding='utf-8'))
    ids = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k == 'categoria_glpi' and isinstance(v, int):
                    ids.add(v)
                walk(v)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(d)
    return ids

def from_wf22():
    d = json.load(open(path('22_GLPI_Reconfig_Destinations.json'), encoding='utf-8'))
    js = ''.join((n.get('parameters', {}).get('jsCode', '') or '') for n in d.get('nodes', []))
    return set(int(x) for x in re.findall(r'"categoria_glpi"\s*:\s*(\d+)', js))

try:
    sql, form, wf22 = from_sql(), from_form(), from_wf22()
except FileNotFoundError as e:
    print(f"[X] arquivo nao encontrado: {e.filename}")
    sys.exit(1)

print(f"SQL  (setup_completo.sql):     {len(sql):>2} ids  {sorted(sql)}")
print(f"FORM (formularios_def.json):   {len(form):>2} ids  {sorted(form)}")
print(f"WF22 (Reconfig_Destinations):  {len(wf22):>2} ids  {sorted(wf22)}")
print()

uni = sql | form | wf22
problems = 0
for cid in sorted(uni):
    falta = [nm for nm, s in (('SQL', sql), ('FORM', form), ('WF22', wf22)) if cid not in s]
    if falta:
        problems += 1
        print(f"  [X] categoria {cid} ausente em: {', '.join(falta)}")

if problems:
    print(f"\n{problems} divergencia(s). Sincronize os tres lugares.")
    sys.exit(1)
print(f"OK - os tres lugares tem os mesmos {len(uni)} ids de categoria.")
sys.exit(0)
