<#
.SYNOPSIS
  Lista/adiciona/remove membros do grupo do AD "Aprovadores GLPI".
  Chamado via SSH pelo backend da Central de Operações GLPI.

.USAGE
  Gerenciar_Aprovadores.ps1 -Action List
  Gerenciar_Aprovadores.ps1 -Action Add    -Login jsilva
  Gerenciar_Aprovadores.ps1 -Action Remove -Login jsilva

  Sempre retorna JSON com a lista ATUAL do grupo: { grupo, membros:[{login,nome,departamento,email,office,mobile,habilitado}] }
  Em erro: { erro: "..." }.

.NOTES
  Salvar como UTF-8 com BOM. Mesmo padrão de validação dos outros scripts do repo.
#>
param(
  [ValidateSet('List', 'Add', 'Remove')][string]$Action = 'List',
  [string]$Login,
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

try {
  Import-Module ActiveDirectory -ErrorAction Stop
  Get-ADGroup -Identity $Grupo -ErrorAction Stop | Out-Null

  if ($Action -eq 'Add') {
    Assert-Login $Login
    $u = Get-ADUser -Identity $Login -ErrorAction Stop
    Add-ADGroupMember -Identity $Grupo -Members $u -ErrorAction Stop
  }
  elseif ($Action -eq 'Remove') {
    Assert-Login $Login
    Remove-ADGroupMember -Identity $Grupo -Members $Login -Confirm:$false -ErrorAction Stop
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
  Write-Json @{ grupo = $Grupo; membros = $membros }
}
catch {
  Write-Json @{ erro = $_.Exception.Message }
}
