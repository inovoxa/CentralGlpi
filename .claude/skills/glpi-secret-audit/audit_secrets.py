#!/usr/bin/env python3
"""Auditoria de segredos hardcoded no repo GLPI n8n.

Uso: python3 audit_secrets.py [diretorio]   (default: diretorio atual)
Saida: lista 'file:linha - motivo' e codigo 1 se achar segredo; 0 se limpo.

Regra do projeto: tokens/segredos vivem SO em glpi_n8n.glpi_token_cache e sao
lidos em runtime. Nunca embutidos em workflow JSON, .sql ou .ps1 versionados.
"""
import sys, os, re, json, glob

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

# Fragmentos de segredos JA vazados, mantidos so como sentinela contra
# reintroducao de um backup antigo. Limpa em 2026-06-04: as credenciais do
# hardening de 2026-05-29 foram rotacionadas, entao os valores antigos nao
# representam mais risco e foram removidos.
#
# Se um NOVO segredo vazar: rotacione-o PRIMEIRO no GLPI/AD e SO ENTAO cole
# aqui um fragmento dele (8-12 chars) para barrar reintroducao. Nunca coloque
# aqui um segredo ainda valido -- este arquivo e versionado.
KNOWN = []

findings = []
def add(f, ln, msg): findings.append((f, ln, msg))

def scan_known(path):
    for i, line in enumerate(open(path, encoding='utf-8', errors='ignore').read().splitlines(), 1):
        for k in KNOWN:
            if k in line:
                add(path, i, f"valor conhecido vazado: {k}")

def scan_sql(path):
    for i, line in enumerate(open(path, encoding='utf-8', errors='ignore').read().splitlines(), 1):
        if line.strip().startswith('--'):
            continue
        m = re.search(r"(client_secret|glpi_password|user_token|app_token(_v2)?)\s*=\s*'([^']+)'", line)
        if m:
            add(path, i, f"credencial literal no SQL: {m.group(1)} (use :'var' ou UPDATE controlado)")

def scan_ps1(path):
    # Atribuicao literal a uma variavel cujo nome sugere credencial:
    #   $token = "..."  /  $apiSecret = '...'  /  $senha_glpi = "..."
    # Ignora valor vazio "" e expressoes (Get-..., $outraVar, etc.).
    pat = re.compile(r"\$\w*(?:token|secret|senha|password|passwd|apikey|api_key)\w*"
                     r"\s*=\s*(['\"])([^'\"]+)\1", re.I)
    for i, line in enumerate(open(path, encoding='utf-8', errors='ignore').read().splitlines(), 1):
        if line.lstrip().startswith('#'):
            continue
        m = pat.search(line)
        if m:
            add(path, i, f"credencial literal no PowerShell: {m.group(0)[:48]}... (use param/leitura externa)")

def scan_json(path):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        return
    for n in d.get('nodes', []) if isinstance(d, dict) else []:
        name = n.get('name', '?'); p = n.get('parameters', {})
        for h in (p.get('headerParameters') or {}).get('parameters', []) or []:
            nm = (h.get('name') or '').lower(); val = str(h.get('value') or '')
            if nm in ('app-token', 'authorization', 'session-token') and val and not val.startswith('='):
                add(path, None, f"no '{name}': header {h.get('name')} com valor literal (deveria ser =expressao do banco)")
        js = p.get('jsCode') or ''
        for m in re.finditer(r"const\s+(appToken|userToken)\s*=\s*'[^']+'", js):
            add(path, None, f"no '{name}': {m.group(0)[:42]}... (token literal no jsCode)")
        q = p.get('query') or ''
        if re.search(r"(client_secret|glpi_password|user_token|app_token)\s*=\s*'[^']+'", q):
            add(path, None, f"no '{name}': credencial literal na query SQL")

for path in glob.glob(os.path.join(ROOT, '**', '*'), recursive=True):
    if not os.path.isfile(path):
        continue
    if (os.sep + '.claude') in path or (os.sep + '.git') in path:
        continue  # nao audita as proprias skills nem o .git
    low = path.lower()
    if low.endswith('.json'):
        scan_json(path); scan_known(path)
    elif low.endswith('.sql'):
        scan_sql(path); scan_known(path)
    elif low.endswith('.ps1'):
        scan_ps1(path); scan_known(path)
    elif low.endswith(('.md', '.csv')):
        scan_known(path)

if findings:
    print("SEGREDOS ENCONTRADOS:")
    for f, ln, msg in findings:
        print(f"  [X] {f + (':' + str(ln) if ln else '')} - {msg}")
    print(f"\nTotal: {len(findings)}")
    sys.exit(1)
print("OK - nenhum segredo hardcoded encontrado.")
sys.exit(0)
