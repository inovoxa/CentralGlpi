<#
.SYNOPSIS
  Coletor de auditoria de Active Directory para a Central de Operações GLPI.
  Roda no Domain Controller, chamado via SSH pelo backend (WF/coletor node-cron).

.DESCRIPTION
  Dois modos:

  1) Eventos (incremental por RecordId):
       Coletar_Auditoria_AD.ps1 -EventId 4624 -AfterRecordId 12345 -Max 500
     Retorna JSON (array) dos eventos do log de Segurança com RecordId > AfterRecordId.
     IDs suportados: 4624 (logon), 4634 (logoff), 4625 (falha), 4740 (lockout).

  2) Perfil de um usuário:
       Coletar_Auditoria_AD.ps1 -User jsilva
     Retorna JSON (objeto) com dados do Get-ADUser (grupos, última troca de senha, etc.).

.NOTES
  Salvar como UTF-8 com BOM. Forçar stdout UTF-8 para o n8n/SSH (mesmo padrão dos
  outros scripts deste repo). Saída sempre JSON; em erro, objeto { erro: ... }.
#>
param(
  [int]$EventId,
  [long]$AfterRecordId = 0,
  [int]$Max = 500,
  [string]$User,
  [switch]$AllUsers
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Json($obj) { $obj | ConvertTo-Json -Compress -Depth 6; exit 0 }

# Allowlist contra injeção em -Identity/-Filter (mesmo princípio do Executar_AD).
function Assert-IdentificadorSeguro([string]$v) {
  if ($v -notmatch '^[A-Za-z0-9._\-\\ ]{1,128}$') { throw "Identificador invalido." }
}

try {
  # ---------- Modo perfil ----------
  if ($User) {
    Assert-IdentificadorSeguro $User
    Import-Module ActiveDirectory -ErrorAction Stop
    $u = Get-ADUser -Identity $User -Properties Department,Title,PasswordLastSet,LastLogonDate,LockedOut,Enabled,MemberOf
    $grupos = @($u.MemberOf | ForEach-Object { ($_ -split ',')[0] -replace '^CN=', '' })
    Write-Json @{
      login              = $u.SamAccountName
      nome               = $u.Name
      departamento       = $u.Department
      cargo              = $u.Title
      habilitado         = [bool]$u.Enabled
      bloqueado          = [bool]$u.LockedOut
      ultima_troca_senha = if ($u.PasswordLastSet) { $u.PasswordLastSet.ToString('o') } else { $null }
      ultimo_logon_ad    = if ($u.LastLogonDate)   { $u.LastLogonDate.ToString('o') }   else { $null }
      grupos             = $grupos
    }
  }

  # ---------- Modo todos os usuários (para "Quem logou / Não logaram") ----------
  if ($AllUsers) {
    Import-Module ActiveDirectory -ErrorAction Stop
    $us = Get-ADUser -Filter 'Enabled -eq $true' -Properties LastLogonDate, Department | ForEach-Object {
      [pscustomobject]@{
        login        = $_.SamAccountName
        nome         = $_.Name
        departamento = $_.Department
        ultimoLogon  = $(if ($_.LastLogonDate) { $_.LastLogonDate.ToString('o') } else { $null })
      }
    }
    Write-Json @{ usuarios = @($us) }
  }

  # ---------- Modo eventos ----------
  if (-not $EventId) { Write-Json @{ erro = 'informe -EventId, -User ou -AllUsers' } }

  $ignorar = '^(SYSTEM|ANONYMOUS LOGON|LOCAL SERVICE|NETWORK SERVICE|DWM-\d+|UMFD-\d+)$'
  $eventos = @()
  try {
    $eventos = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = $EventId } -MaxEvents 4000 -ErrorAction Stop
  } catch {
    Write-Json @()  # sem eventos do tipo
  }

  $out = New-Object System.Collections.ArrayList
  foreach ($e in ($eventos | Where-Object { $_.RecordId -gt $AfterRecordId } | Sort-Object RecordId | Select-Object -First $Max)) {
    $x = [xml]$e.ToXml()
    $f = @{}
    foreach ($d in $x.Event.EventData.Data) { $f[$d.Name] = $d.'#text' }
    $usuario = $f['TargetUserName']
    if ($usuario -and ($usuario -match '\$$' -or $usuario -match $ignorar)) { continue }
    $row = @{
      record_id   = [long]$e.RecordId
      ocorrido_em = $e.TimeCreated.ToString('o')
      usuario     = $usuario
    }
    switch ($EventId) {
      4624 { $row.tipo = 'logon';  $row.computador = $f['WorkstationName']; $row.ip = $f['IpAddress']; $row.logon_type = $f['LogonType'] }
      4634 { $row.tipo = 'logoff'; $row.logon_type = $f['LogonType'] }
      4625 { $row.computador = $f['WorkstationName']; $row.ip = $f['IpAddress']; $row.motivo = $f['Status'] }
      4740 { $row.origem = $f['TargetDomainName'] }  # em 4740, o "Caller Computer Name" fica neste campo
    }
    [void]$out.Add($row)
  }
  Write-Json @($out)
} catch {
  Write-Json @{ erro = $_.Exception.Message }
}
