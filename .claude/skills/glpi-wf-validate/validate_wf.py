#!/usr/bin/env python3
"""Valida workflows n8n do projeto GLPI apos edicao.

Uso:
  python3 validate_wf.py                 # valida todos os *.json (workflows) no cwd
  python3 validate_wf.py 04_GLPI_...json # valida arquivos especificos

Checa: parse JSON; nos 'Log no Banco' parametrizados (sem {{}}, $N == elementos do
queryReplacement, sem .replace); fiacao do 'Carregar Tokens'; sem token literal;
conexoes apontam para nos existentes; avisa Postgres sem credencial.
Sai 1 se houver FAIL.
"""
import sys, re, json, glob

files = sys.argv[1:] or sorted(glob.glob('*.json'))
problems = 0

def fail(f, msg):
    global problems; problems += 1; print(f"  [FAIL] {f}: {msg}")
def warn(f, msg):
    print(f"  [warn] {f}: {msg}")

for f in files:
    try:
        d = json.load(open(f, encoding='utf-8'))
    except Exception as e:
        fail(f, f"JSON nao parseia: {e}"); continue
    if not isinstance(d, dict) or 'nodes' not in d:
        continue  # nao e workflow n8n
    nodes = d['nodes']; names = {n.get('name') for n in nodes}; conns = d.get('connections', {})
    # conexoes podem referenciar nos por nome (padrao) ou por id (ex.: WF02). Aceita ambos.
    ids = {n.get('id') for n in nodes}; refs = names | ids

    for n in nodes:
        p = n.get('parameters', {}); q = p.get('query', '') or ''
        if 'INSERT INTO glpi_n8n.chamados_log' in q:
            if '{{' in q:
                fail(f, f"no '{n['name']}': query INSERT ainda tem interpolacao {{...}}")
            qr = (p.get('options') or {}).get('queryReplacement', '') or ''
            params = set(int(x) for x in re.findall(r'\$(\d+)', q))
            maxp = max(params) if params else 0
            if qr:
                if '.replace(' in qr:
                    fail(f, f"no '{n['name']}': queryReplacement usa .replace() (escape manual)")
                try:
                    inner = qr[qr.index('[') + 1:qr.rindex(']')]
                    nels = len([x for x in inner.split(',\n') if x.strip()])
                    if nels != maxp:
                        fail(f, f"no '{n['name']}': {maxp} placeholders $N mas {nels} elementos no queryReplacement")
                except ValueError:
                    fail(f, f"no '{n['name']}': queryReplacement nao e array =[ ... ]")
            elif maxp > 0:
                fail(f, f"no '{n['name']}': usa $1..$N mas nao tem options.queryReplacement")

        js = p.get('jsCode', '') or ''
        if re.search(r"const\s+(appToken|userToken)\s*=\s*'[^']+'", js):
            fail(f, f"no '{n['name']}': token literal no jsCode (deveria ler de Carregar Tokens)")

        if n.get('type', '').endswith('.postgres') and not (n.get('credentials') or {}).get('postgres'):
            warn(f, f"no '{n['name']}': Postgres sem credencial selecionada")

    if 'Carregar Tokens' in names:
        pointed = any(c.get('node') == 'Carregar Tokens'
                      for v in conns.values() for grp in v.get('main', []) for c in (grp or []))
        out = bool(conns.get('Carregar Tokens', {}).get('main'))
        if not pointed: fail(f, "'Carregar Tokens' nao e alvo de nenhuma conexao (nao vai executar)")
        if not out:     fail(f, "'Carregar Tokens' nao aponta para nenhum no")

    for src, v in conns.items():
        if src not in refs:
            warn(f, f"conexao de origem inexistente: '{src}'")
        for grp in v.get('main', []):
            for c in (grp or []):
                if c.get('node') not in refs:
                    fail(f, f"conexao aponta para no inexistente: '{c.get('node')}'")

if problems:
    print(f"\n{problems} problema(s) encontrado(s)."); sys.exit(1)
print("OK - workflows validos."); sys.exit(0)
