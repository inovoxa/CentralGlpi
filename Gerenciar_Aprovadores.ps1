<#
.SYNOPSIS
  Lista/adiciona/remove membros do grupo do AD "Aprovadores GLPI".
  Chamado via SSH pelo backend do Inovoxachat.

.USAGE
  Gerenciar_Aprovadores.ps1 -Action List
  Gerenciar_Aprovadores.ps1 -Action Add    -Login jsilva
  Gerenciar_Aprovadores.ps1 -Action Remove -Login jsilva
  Gerenciar_Aprovadores.ps1 -Action Sync   -AddList "a;b" -RemoveList "c;d"

  O modo Sync aplica varias adicoes/remocoes numa UNICA execucao (um so Import-Module)
  para caber no timeout HTTP. Retorna tambem "resultados":[{login,acao,ok,erro}].

  Sempre retorna JSON com a lista ATUAL do grupo:
    { grupo, membros:[{login,nome,departamento,email,office,mobile,habilitado}] }
  Em erro fatal: { erro: "..." }.

.NOTES
  Salvar como UTF-8 com BOM. Mesmo padrao de validacao dos outros scripts do repo.
#>
param(
  [ValidateSet('List', 'Add', 'Remove', 'Sync')][string]$Action = 'List',
  [string]$Login,
  [string]$AddList,
  [string]$RemoveList,
  [string]$Grupo = 'Aprovadores GLPI'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Json($obj) { $obj | ConvertTo-Json -Compress -Depth 5; exit 0 }
# Allowlist contra injeção em -Identity/-Members.
function Assert-Login([string]$v) {
  if ($v -notmatch '^[A-Za-z0-9._\-\\ ]{1,128}$') { throw "Login invalido." }
}
function Split-Lista([string]$s) {
  if ([string]::IsNullOrWhiteSpace($s)) { return @() }
  return @($s -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
}

try {
  Import-Module ActiveDirectory -ErrorAction Stop
  Get-ADGroup -Identity $Grupo -ErrorAction Stop | Out-Null

  $resultados = @()

  if ($Action -eq 'Add') {
    Assert-Login $Login
    $u = Get-ADUser -Identity $Login -ErrorAction Stop
    Add-ADGroupMember -Identity $Grupo -Members $u -ErrorAction Stop
  }
  elseif ($Action -eq 'Remove') {
    Assert-Login $Login
    Remove-ADGroupMember -Identity $Grupo -Members $Login -Confirm:$false -ErrorAction Stop
  }
  elseif ($Action -eq 'Sync') {
    foreach ($l in (Split-Lista $AddList)) {
      try {
        Assert-Login $l
        $u = Get-ADUser -Identity $l -ErrorAction Stop
        Add-ADGroupMember -Identity $Grupo -Members $u -ErrorAction Stop
        $resultados += @{ login = $l; acao = 'add'; ok = $true }
      }
      catch { $resultados += @{ login = $l; acao = 'add'; ok = $false; erro = $_.Exception.Message } }
    }
    foreach ($l in (Split-Lista $RemoveList)) {
      try {
        Assert-Login $l
        Remove-ADGroupMember -Identity $Grupo -Members $l -Confirm:$false -ErrorAction Stop
        $resultados += @{ login = $l; acao = 'remove'; ok = $true }
      }
      catch { $resultados += @{ login = $l; acao = 'remove'; ok = $false; erro = $_.Exception.Message } }
    }
  }

  $membros = @(
    Get-ADGroupMember -Identity $Grupo |
      Where-Object { $_.objectClass -eq 'user' } |
      ForEach-Object {
        $d = Get-ADUser -Identity $_.SamAccountName -Properties Department, Enabled, Mail, Office, MobilePhone
        @{
          login        = $d.SamAccountName
          nome         = $d.Name
          departamento = $d.Department
          email        = $d.Mail
          office       = $d.Office
          mobile       = $d.MobilePhone
          habilitado   = [bool]$d.Enabled
        }
      } | Sort-Object { $_.nome }
  )

  $out = @{ grupo = $Grupo; membros = $membros }
  if ($Action -eq 'Sync') { $out.resultados = @($resultados) }
  Write-Json $out
}
catch {
  Write-Json @{ erro = $_.Exception.Message }
}
