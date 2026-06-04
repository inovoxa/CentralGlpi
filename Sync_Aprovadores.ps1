<#
.SYNOPSIS
  Sincroniza o grupo do Active Directory "Aprovadores GLPI" com uma planilha CSV editada manualmente.

.DESCRIPTION
  Le um CSV contendo a lista oficial de aprovadores de chamado e ajusta o grupo
  no AD para refletir exatamente o conteudo da planilha:
    - Adiciona ao grupo quem esta na planilha e nao no grupo
    - Remove do grupo quem esta no grupo e nao na planilha (sync total)
    - Ignora silenciosamente logins do CSV que nao existem no AD

  Retorna JSON estruturado por stdout para o n8n (WF 25) parsear.

.PARAMETER CsvPath
  Caminho do CSV com colunas: nome_usuario, nome_completo, cargo, departamento.
  Default: C:\Scripts\aprovadores.csv

.PARAMETER GrupoAD
  Nome (SamAccountName ou Name) do grupo no AD que recebera a sync.
  Default: 'Aprovadores GLPI'
  Caminho no AD: pma.local/Prefeitura Municipal/Coordenadoria Executiva de Tecnologia da Informacao/Aprovadores GLPI
  DN: CN=Aprovadores GLPI,OU=Coordenadoria Executiva de Tecnologia da Informacao,OU=Prefeitura Municipal,DC=pma,DC=local
  (Pode-se passar o DN completo tambem; Get-ADGroup -Identity aceita Name, SamAccountName e DN)

.NOTES
  Este arquivo DEVE estar salvo com BOM UTF-8. Sem BOM, o Windows PowerShell 5.1 le
  como CP1252 e quebra acentos em mensagens/cargos. Mesmo cuidado do Executar_AD_Automatico.ps1.
#>

param(
    [string]$CsvPath = 'C:\Scripts\aprovadores.csv',
    [string]$GrupoAD = 'Aprovadores GLPI'
)

Import-Module ActiveDirectory -ErrorAction Stop
$ErrorActionPreference = 'Stop'

# Forca stdout em UTF-8 para o n8n receber acentos corretamente via SSH
# (PS 5.1 default usa o codepage do console, n8n le como UTF-8 = caracteres "")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Retornar-Json {
    param([hashtable]$dados, [int]$exitCode = 0)
    $dados | ConvertTo-Json -Compress -Depth 5
    exit $exitCode
}

# 1. Validar arquivo CSV
if (-not (Test-Path $CsvPath)) {
    Retornar-Json @{
        sucesso = $false
        erro    = "CSV nao encontrado em $CsvPath"
    } -exitCode 1
}

# 2. Validar grupo no AD
try {
    $grupo = Get-ADGroup -Identity $GrupoAD -ErrorAction Stop
} catch {
    Retornar-Json @{
        sucesso = $false
        erro    = "Grupo '$GrupoAD' nao encontrado no AD: $($_.Exception.Message)"
    } -exitCode 1
}

# 3. Ler planilha (UTF8 para acentos em cargo/nome_completo)
try {
    $planilha = Import-Csv -Path $CsvPath -Encoding UTF8
} catch {
    Retornar-Json @{
        sucesso = $false
        erro    = "Falha ao ler CSV: $($_.Exception.Message). Salve como 'CSV UTF-8 (delimitado por virgulas)' no Excel."
    } -exitCode 1
}

# Conjunto desejado (lowercase, deduplicado)
$desejados = @(
    $planilha |
        Where-Object { $_.nome_usuario } |
        ForEach-Object { $_.nome_usuario.Trim().ToLower() } |
        Where-Object { $_ } |
        Sort-Object -Unique
)

# 4. Membros atuais do grupo (apenas usuarios, ignora grupos aninhados)
$atuais = @(
    Get-ADGroupMember -Identity $grupo |
        Where-Object { $_.objectClass -eq 'user' } |
        ForEach-Object { $_.SamAccountName.ToLower() } |
        Sort-Object -Unique
)

# 5. Diff
$adicionar = @($desejados | Where-Object { $_ -notin $atuais })
$remover   = @($atuais   | Where-Object { $_ -notin $desejados })

# 6. Aplicar mudancas (tolerante a erros individuais)
$adicionados = @()
$removidos   = @()
$ignorados   = @()
$erros       = @()

foreach ($login in $adicionar) {
    try {
        $u = Get-ADUser -Identity $login -ErrorAction Stop
        Add-ADGroupMember -Identity $grupo -Members $u -ErrorAction Stop
        $adicionados += $login
    } catch {
        $ignorados += "$login (nao existe no AD ou erro: $($_.Exception.Message))"
    }
}

foreach ($login in $remover) {
    try {
        Remove-ADGroupMember -Identity $grupo -Members $login -Confirm:$false -ErrorAction Stop
        $removidos += $login
    } catch {
        $erros += "$login (falha na remocao: $($_.Exception.Message))"
    }
}

# 7. Resultado estruturado
Retornar-Json @{
    sucesso     = $true
    grupo       = $GrupoAD
    csv_path    = $CsvPath
    csv_total   = $desejados.Count
    ad_antes    = $atuais.Count
    ad_depois   = $atuais.Count + $adicionados.Count - $removidos.Count
    adicionados = $adicionados
    removidos   = $removidos
    ignorados   = $ignorados
    erros       = $erros
    timestamp   = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
}