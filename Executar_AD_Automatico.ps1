<#
.SYNOPSIS
  Execução automatizada de operações no Active Directory chamada pelo n8n (WF 14).
  Recebe parâmetros via linha de comando e retorna JSON para o n8n parsear.

.PARAMETER Acao
  Operação a executar: Criar, Reset, Reativar, Desativar, AcessoPasta, Transferir, CriarEmail

.PARAMETER DadosB64
  JSON string codificado em Base64 (UTF-8) com os dados da solicitação extraídos do chamado GLPI.
  Forma preferida — evita problemas de escape de aspas/acentos ao passar via SSH/shell.

.PARAMETER DadosJson
  JSON string com os dados da solicitação (forma legada, mantida por compatibilidade).
  Use -DadosB64 sempre que possível.
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('Criar','Reset','Reativar','Desativar','AcessoPasta','Transferir','CriarEmail')]
    [string]$Acao,

    [Parameter(Mandatory=$false)]
    [string]$DadosB64,

    [Parameter(Mandatory=$false)]
    [string]$DadosJson
)

Import-Module ActiveDirectory -ErrorAction Stop

$ErrorActionPreference = 'Stop'

# Forca stdout em UTF-8 para que acentos cheguem ao n8n sem corromper.
# Sem isto, o PowerShell 5.1 usa o code page do console (CP850/CP1252) e
# o n8n le como UTF-8, transformando "obrigatório" em "obrigat?rio" (U+FFFD).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ======================== FUNÇÕES UTILITÁRIAS ========================

function Format-NomeCompleto {
    param ([string]$nome)
    $preposicoes = 'da','de','do','das','dos'
    $palavras = $nome.Trim() -split '\s+'
    $resultado = foreach ($p in $palavras) {
        $palavra = $p.ToLower()
        if ($preposicoes -contains $palavra) { $palavra }
        else { $palavra.Substring(0,1).ToUpper() + $palavra.Substring(1) }
    }
    return ($resultado -join ' ')
}

# Remove diacríticos (João → Joao) usando decomposição Unicode (FormD).
# Necessário para comparar nomes vindos do GLPI (com acento) vs nomes no AD
# (frequentemente sem acento por restrição do SamAccountName).
function Remover-Acentos {
    param ([string]$texto)
    if ([string]::IsNullOrWhiteSpace($texto)) { return $texto }
    $normalizado = $texto.Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($c in $normalizado.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($c)
        }
    }
    return $sb.ToString().Normalize([Text.NormalizationForm]::FormC)
}

# Normaliza nome para comparação tolerante: sem acento, lowercase, espaços colapsados.
# Use para decidir se "João Silva" no GLPI é a mesma pessoa que "JOAO  SILVA" no AD.
function Normalizar-NomeParaComparacao {
    param ([string]$nome)
    if ([string]::IsNullOrWhiteSpace($nome)) { return "" }
    $semAcento = Remover-Acentos $nome
    return ($semAcento.ToLower().Trim() -replace '\s+', ' ')
}

# ==================== VALIDACAO DE IDENTIFICADORES (anti LDAP injection) ====================
# Os identificadores (login, perfil de referencia) vem do chamado GLPI, preenchido pelo
# solicitante. Sem validacao, valores como "*", "'" ou ") (objectClass=*" poderiam manipular
# o -Filter do Get-ADUser e fazer a automacao atuar sobre contas diferentes da pretendida.
# Bloqueamos qualquer caractere fora da allowlist ANTES de montar qualquer filtro/identidade.

# Login / SamAccountName: letras (inclui acento via \w Unicode), digitos, ponto, hifen, _
# Nao permite espaco, aspas, *, parenteses, barras, =, etc.
function Test-LoginSeguro {
    param ([string]$valor)
    if ([string]::IsNullOrWhiteSpace($valor)) { return $false }
    return ($valor -match '^[\w.\-]+$')
}

# Nome ou perfil de referencia (pode conter espaco, usado em -like '*nome*').
# Continua bloqueando aspas, *, parenteses e demais metacaracteres LDAP.
function Test-NomeOuLoginSeguro {
    param ([string]$valor)
    if ([string]::IsNullOrWhiteSpace($valor)) { return $false }
    return ($valor -match '^[\w.\- ]+$')
}

# Atalho: valida e, se invalido, retorna erro estruturado ao n8n e encerra.
function Assert-IdentificadorSeguro {
    param ([string]$valor, [string]$campo, [switch]$PermitirEspaco)
    $ok = if ($PermitirEspaco) { Test-NomeOuLoginSeguro $valor } else { Test-LoginSeguro $valor }
    if (-not $ok) {
        Retornar-Erro "Campo '$campo' contem caracteres invalidos. Use apenas letras, numeros, ponto, hifen e underscore."
    }
}

# Inteiro aleatorio criptograficamente seguro em [0, $max). Usa RNGCryptoServiceProvider
# em vez de Get-Random (PRNG nao seguro) para senhas provisorias.
function Get-IntCriptoSeguro {
    param ([int]$max)
    $bytes = New-Object 'System.Byte[]' 4
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $valor = [System.BitConverter]::ToUInt32($bytes, 0)
    return [int]($valor % [uint32]$max)
}

# Gera senha provisoria forte: >=14 chars com pelo menos uma minuscula, uma maiuscula,
# um digito e um simbolo. Garante complexidade para passar no GPO do AD e usa RNG
# criptografico. Evita aspas, crase, $ e barras que poderiam quebrar shell/JSON/AD.
function Gerar-Senha {
    $minusculas = 'abcdefghijkmnpqrstuvwxyz'   # sem l/o (confusao visual)
    $maiusculas = 'ABCDEFGHJKLMNPQRSTUVWXYZ'   # sem I/O
    $digitos    = '23456789'                   # sem 0/1
    $simbolos   = '!@#%&*+-=?'
    $todos      = $minusculas + $maiusculas + $digitos + $simbolos
    $comprimento = 14

    # Garante ao menos um de cada classe.
    $chars = New-Object System.Collections.Generic.List[char]
    $chars.Add($minusculas[(Get-IntCriptoSeguro $minusculas.Length)])
    $chars.Add($maiusculas[(Get-IntCriptoSeguro $maiusculas.Length)])
    $chars.Add($digitos[(Get-IntCriptoSeguro $digitos.Length)])
    $chars.Add($simbolos[(Get-IntCriptoSeguro $simbolos.Length)])

    while ($chars.Count -lt $comprimento) {
        $chars.Add($todos[(Get-IntCriptoSeguro $todos.Length)])
    }

    # Embaralha (Fisher-Yates) para nao fixar a posicao das classes obrigatorias.
    for ($i = $chars.Count - 1; $i -gt 0; $i--) {
        $j = Get-IntCriptoSeguro ($i + 1)
        $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
    }

    return -join $chars
}

function Gerar-Login {
    param ([string]$nomeFormatado)
    $preposicoes = 'da','de','do','das','dos'
    $palavras = $nomeFormatado -split '\s+'
    $iniciais = @()
    $ultimoSobrenome = $palavras[-1]
    for ($i = 0; $i -lt $palavras.Length - 1; $i++) {
        if ($preposicoes -notcontains $palavras[$i].ToLower()) {
            $iniciais += $palavras[$i][0]
        }
    }
    return ($iniciais -join '') + $ultimoSobrenome
}

function Retornar-Json {
    param ([hashtable]$dados)
    $dados | ConvertTo-Json -Compress -Depth 5
    exit 0
}

function Retornar-Erro {
    param ([string]$mensagem)
    @{ sucesso = $false; erro = $mensagem } | ConvertTo-Json -Compress
    exit 1
}

# Busca ate 5 logins parecidos no AD para sugerir quando o login informado nao existe.
# Estrategia: tenta prefixo, contem, e por nome (firstname/realname).
function Buscar-LoginsSimilares {
    param ([string]$Login, [string]$Nome)
    $sugestoes = New-Object System.Collections.Generic.List[hashtable]
    $vistos = New-Object System.Collections.Generic.HashSet[string]

    function Adicionar([object]$u) {
        if (-not $u) { return }
        $sam = $u.SamAccountName
        if ([string]::IsNullOrWhiteSpace($sam)) { return }
        if ($vistos.Contains($sam.ToLower())) { return }
        $vistos.Add($sam.ToLower()) | Out-Null
        $sugestoes.Add(@{
            login    = $sam
            nome     = $u.Name
            ativo    = [bool]$u.Enabled
        }) | Out-Null
    }

    # 1) Tenta prefixo do login (3+ chars)
    if ($Login -and $Login.Length -ge 3) {
        $prefixo = $Login.Substring(0, [Math]::Min(4, $Login.Length))
        try {
            Get-ADUser -Filter "SamAccountName -like '$prefixo*'" -Properties Name, Enabled, SamAccountName -ResultSetSize 10 -ErrorAction SilentlyContinue |
                ForEach-Object { Adicionar $_ }
        } catch { }
    }
    # 2) Contem o login no meio
    if ($sugestoes.Count -lt 5 -and $Login -and $Login.Length -ge 3) {
        try {
            Get-ADUser -Filter "SamAccountName -like '*$Login*'" -Properties Name, Enabled, SamAccountName -ResultSetSize 10 -ErrorAction SilentlyContinue |
                ForEach-Object { if ($sugestoes.Count -lt 10) { Adicionar $_ } }
        } catch { }
    }
    # 3) Busca por primeiro nome (se fornecido)
    if ($sugestoes.Count -lt 5 -and -not [string]::IsNullOrWhiteSpace($Nome)) {
        $primeiro = ($Nome.Trim() -split '\s+')[0]
        if ($primeiro.Length -ge 3) {
            try {
                Get-ADUser -Filter "GivenName -like '$primeiro*'" -Properties Name, Enabled, SamAccountName -ResultSetSize 10 -ErrorAction SilentlyContinue |
                    ForEach-Object { if ($sugestoes.Count -lt 10) { Adicionar $_ } }
            } catch { }
        }
    }

    # Limita a 5
    return @($sugestoes | Select-Object -First 5)
}

# Retorna JSON estruturado para o n8n quando usuario nao for encontrado, incluindo sugestoes.
function Retornar-UsuarioNaoEncontrado {
    param ([string]$LoginInformado, [string]$NomeInformado, [string]$Acao)
    $sugestoes = Buscar-LoginsSimilares -Login $LoginInformado -Nome $NomeInformado
    Retornar-Json @{
        sucesso          = $false
        acao_real        = 'usuario_nao_encontrado'
        login_informado  = $LoginInformado
        nome_informado   = $NomeInformado
        acao_solicitada  = $Acao
        sugestoes        = $sugestoes
        dominio          = 'pma.local'
        erro             = "Usuario '$LoginInformado' nao encontrado no Active Directory."
        mensagem         = "O login '$LoginInformado' nao foi localizado no AD. Verifique se foi digitado corretamente."
    }
}

# Variante para perfil de referencia (usuario modelo) nao encontrado.
function Retornar-PerfilReferenciaNaoEncontrado {
    param ([string]$PerfilInformado, [string]$Acao)
    $sugestoes = Buscar-LoginsSimilares -Login $PerfilInformado -Nome $PerfilInformado
    Retornar-Json @{
        sucesso             = $false
        acao_real           = 'perfil_referencia_nao_encontrado'
        perfil_informado    = $PerfilInformado
        acao_solicitada     = $Acao
        sugestoes           = $sugestoes
        dominio             = 'pma.local'
        erro                = "Perfil de referencia '$PerfilInformado' nao encontrado no Active Directory."
        mensagem            = "O perfil de referencia '$PerfilInformado' nao foi localizado no AD. Informe o login de um colega que ja possua o perfil desejado."
    }
}

# Salvar dados do servidor no AD (campos extras: Description, Mobile, E-mail, Organization, etc.)
function Atualizar-DadosAD {
    param (
        [string]$Login,
        [hashtable]$Dados
    )

    $params = @{}

    # Description = Número do processo administrativo (se informado)
    if (-not [string]::IsNullOrWhiteSpace($Dados.numero_processo)) {
        $params['Description'] = $Dados.numero_processo
    }

    # Telephones → Mobile = celular (WhatsApp)
    if (-not [string]::IsNullOrWhiteSpace($Dados.celular)) {
        $params['MobilePhone'] = $Dados.celular
    }

    # General → E-mail: NAO sobrescrever. Quando o usuario possui mailbox no Exchange,
    # o EmailAddress do AD ja contem o e-mail institucional (ex: usuario@araraquara.sp.gov.br).
    # Gravar email_pessoal aqui quebraria o roteamento do Outlook/OWA.
    # email_pessoal fica apenas no chamado GLPI (descritivo).

    # Organization → Title = CBO/Cargo
    if (-not [string]::IsNullOrWhiteSpace($Dados.cbo)) {
        $params['Title'] = $Dados.cbo
    }

    # Organization → Company = Secretaria
    if (-not [string]::IsNullOrWhiteSpace($Dados.secretaria)) {
        $params['Company'] = $Dados.secretaria
    }

    # Organization → Department = Coordenadoria
    if (-not [string]::IsNullOrWhiteSpace($Dados.coordenadoria)) {
        $params['Department'] = $Dados.coordenadoria
    }

    # General → Office = Unidade
    if (-not [string]::IsNullOrWhiteSpace($Dados.unidade)) {
        $params['Office'] = $Dados.unidade
    }

    # Address → City = Araraquara (fixo, contexto municipal)
    $params['City'] = 'Araraquara'
    $params['State'] = 'SP'
    $params['Country'] = 'BR'

    # EmployeeID = Matrícula
    if (-not [string]::IsNullOrWhiteSpace($Dados.matricula)) {
        $params['EmployeeID'] = $Dados.matricula
    }

    # EmployeeNumber = CPF
    if (-not [string]::IsNullOrWhiteSpace($Dados.cpf)) {
        $params['EmployeeNumber'] = $Dados.cpf
    }

    # Organization → Manager (superior imediato)
    # Aceita tanto email institucional ("rbayona@araraquara.sp.gov.br") quanto
    # login puro do AD ("rbayona"). O superior pode nao ter conta de email.
    # O split '@' resolve ambos: com @ pega a parte da esquerda; sem @ devolve o valor todo.
    # Se nao encontrar no AD, ignora silenciosamente (campo opcional).
    if (-not [string]::IsNullOrWhiteSpace($Dados.email_superior)) {
        $loginSuperior = ($Dados.email_superior -split '@')[0].Trim()
        if ((-not [string]::IsNullOrWhiteSpace($loginSuperior)) -and (Test-LoginSeguro $loginSuperior)) {
            try {
                $mgr = Get-ADUser -Identity $loginSuperior -ErrorAction Stop
                if ($mgr) {
                    $params['Manager'] = $mgr.DistinguishedName
                }
            } catch {
                # Superior nao encontrado ou digitado errado: ignora e segue o fluxo
                Write-Warning "Aviso: superior imediato '$loginSuperior' nao encontrado no AD, campo Manager nao sera atualizado."
            }
        }
    }

    if ($params.Count -gt 0) {
        try {
            Set-ADUser -Identity $Login @params -ErrorAction Stop
        } catch {
            # Não falha a operação principal se não conseguir salvar dados extras
            Write-Warning "Aviso: falha ao salvar dados extras no AD para '$Login': $_"
        }
    }
}

# ======================== AÇÃO: CRIAR USUÁRIO ========================
# Lógica especial (comparação de nome é tolerante a acento/case via Normalizar-NomeParaComparacao):
#   1. Gera login a partir do nome
#   2. Verifica se login já existe no AD
#   3. Se existe E mesmo nome E desativado → REATIVA (habilita, reset senha, recopia perfil/grupos/OU do modelo)
#   4. Se existe E mesmo nome E ativo       → ATUALIZA (reset senha, recopia perfil/grupos/OU do modelo, atualiza dados extras)
#                                              Mantém a conta ativa — não cria duplicado.
#   5. Se existe E nome é prefixo (casamento/divórcio) → Retorna 'possivel_mesmo_usuario' para revisão humana
#   6. Se existe E nome totalmente diferente → Tenta próximo login (login1, login2...) por homônimo
#   7. Se não existe → Cria novo

function Executar-CriarUsuario {
    param ($dados)

    $nomeFormatado = Format-NomeCompleto $dados.nome_completo
    Assert-IdentificadorSeguro $nomeFormatado 'nome_completo' -PermitirEspaco
    $perfilReferencia = $dados.perfil_referencia

    if ([string]::IsNullOrWhiteSpace($perfilReferencia)) {
        Retornar-Erro "Campo perfil_referencia é obrigatório para criação de usuário."
    }
    Assert-IdentificadorSeguro $perfilReferencia 'perfil_referencia' -PermitirEspaco

    # Buscar usuário modelo
    $usuarioModelo = $null
    try {
        $usuarioModelo = Get-ADUser -Filter "SamAccountName -eq '$perfilReferencia' -or Name -like '*$perfilReferencia*'" `
            -Properties SamAccountName, Name, DistinguishedName, MemberOf, ProfilePath, HomeDirectory, HomeDrive, ScriptPath `
            -ErrorAction Stop | Select-Object -First 1
    } catch { }

    if (-not $usuarioModelo) {
        Retornar-PerfilReferenciaNaoEncontrado -PerfilInformado $perfilReferencia -Acao 'Criar'
    }

    # Determinar prefixo pelo tipo de usuário
    $prefixo = ""
    if ($dados.usuario_estagiario -eq $true -or $dados.usuario_estagiario -eq 'true' -or $dados.usuario_estagiario -eq 'Sim') {
        $prefixo = "ESTG."
    }

    $loginBase = Gerar-Login $nomeFormatado
    $loginSugerido = "$prefixo$loginBase"
    $loginFinal = $loginSugerido
    $contador = 0
    $reativou = $false

    # Loop de verificação: login existe? comparar nome, verificar status
    while ($true) {
        $usuarioExistente = $null
        try {
            $usuarioExistente = Get-ADUser -Filter "SamAccountName -eq '$loginFinal'" `
                -Properties Name, Enabled, DistinguishedName, MemberOf, LastLogonDate `
                -ErrorAction SilentlyContinue
        } catch { }

        if (-not $usuarioExistente) {
            # Login livre — sair do loop para criar
            break
        }

        # Login existe — comparar nome tolerante a acento/case
        # ("Marina Damha Hipólito Veiga" vs "Marina Damha Hipolito Veiga" devem casar)
        $nomeExistenteNorm  = Normalizar-NomeParaComparacao $usuarioExistente.Name
        $nomeSolicitadoNorm = Normalizar-NomeParaComparacao $nomeFormatado

        if ($nomeExistenteNorm -eq $nomeSolicitadoNorm) {
            # Mesmo nome (normalizado) — login pertence à mesma pessoa
            $senhaGerada = Gerar-Senha
            $ehDesativado = -not $usuarioExistente.Enabled

            # 1. Se desativado, habilita. Se ativo, segue direto.
            if ($ehDesativado) {
                Enable-ADAccount -Identity $usuarioExistente.SamAccountName
            }

            # 2. Reset de senha (ambos os casos — ativo ganha senha nova também,
            #    conforme regra "atualizar informações" + segurança ao reaproveitar conta).
            Set-ADAccountPassword -Identity $usuarioExistente.SamAccountName `
                -NewPassword (ConvertTo-SecureString $senhaGerada -AsPlainText -Force) -Reset
            Set-ADUser -Identity $usuarioExistente.SamAccountName -ChangePasswordAtLogon $true

            # 3. Limpar grupos antigos (exceto Domain Users) — perfil é recopiado do modelo
            foreach ($grupo in $usuarioExistente.MemberOf) {
                if ($grupo -notlike "*CN=Domain Users*") {
                    Remove-ADGroupMember -Identity $grupo -Members $usuarioExistente.SamAccountName `
                        -Confirm:$false -ErrorAction SilentlyContinue
                }
            }

            # 4. Copiar perfil e grupos do modelo
            Set-ADUser -Identity $usuarioExistente.SamAccountName `
                -ProfilePath $usuarioModelo.ProfilePath `
                -HomeDirectory $usuarioModelo.HomeDirectory `
                -HomeDrive $usuarioModelo.HomeDrive `
                -ScriptPath $usuarioModelo.ScriptPath

            foreach ($grupo in $usuarioModelo.MemberOf) {
                try {
                    Add-ADGroupMember -Identity $grupo -Members $usuarioExistente.SamAccountName -ErrorAction Stop
                } catch { }
            }

            # 5. Mover para OU do modelo
            $ouDestino = ($usuarioModelo.DistinguishedName -split ",",2)[1]
            try {
                Move-ADObject -Identity $usuarioExistente.DistinguishedName -TargetPath $ouDestino
            } catch { }

            # 6. Salvar dados extras no AD (Description, Mobile, Cargo, Secretaria, Manager, etc.)
            $dadosHash = @{}
            $dados.PSObject.Properties | ForEach-Object { $dadosHash[$_.Name] = $_.Value }
            Atualizar-DadosAD -Login $usuarioExistente.SamAccountName -Dados $dadosHash

            # 7. Se o nome do AD diferia apenas em acento/case, corrigir para a forma canônica do GLPI
            $nomeSplit = $nomeFormatado -split '\s+'
            if ($usuarioExistente.Name -cne $nomeFormatado) {
                try {
                    Set-ADUser -Identity $usuarioExistente.SamAccountName `
                        -DisplayName $nomeFormatado `
                        -GivenName $nomeSplit[0] `
                        -Surname $nomeSplit[-1]
                    Rename-ADObject -Identity $usuarioExistente.DistinguishedName -NewName $nomeFormatado -ErrorAction SilentlyContinue
                } catch {
                    Write-Warning "Aviso: nao foi possivel padronizar o nome no AD: $_"
                }
            }

            $acaoReal = if ($ehDesativado) { "reativado" } else { "atualizado" }
            $msg = if ($ehDesativado) {
                "Usuario reativado (existia desativado com mesmo nome). Login: $($usuarioExistente.SamAccountName)"
            } else {
                "Usuario ja existia ativo com mesmo nome - dados atualizados e nova senha gerada. Login: $($usuarioExistente.SamAccountName)"
            }

            Retornar-Json @{
                sucesso       = $true
                acao_real     = $acaoReal
                login         = $usuarioExistente.SamAccountName
                senha         = $senhaGerada
                dominio       = "pma.local"
                ou            = $ouDestino
                mensagem      = $msg
            }
            $reativou = $true
            break
        }
        else {
            # Nome diferente — pode ser homônimo OU mudança de nome (casamento/divórcio)
            # Casamento: adiciona sobrenome no final (ex: "Miguel" → "Miguel Silva")
            # Divórcio: remove sobrenome do final (ex: "Miguel Silva" → "Miguel")
            # Lógica: verificar se um nome é prefixo do outro (ignorando preposições)
            $preposicoes = 'da','de','do','das','dos'
            $partesExistente = @(($nomeExistenteNorm -split '\s+') | Where-Object { $preposicoes -notcontains $_ })
            $partesSolicitado = @(($nomeSolicitadoNorm -split '\s+') | Where-Object { $preposicoes -notcontains $_ })

            # Determinar qual é o menor e qual é o maior
            $menor = if ($partesExistente.Length -le $partesSolicitado.Length) { $partesExistente } else { $partesSolicitado }
            $maior = if ($partesExistente.Length -le $partesSolicitado.Length) { $partesSolicitado } else { $partesExistente }

            # Verificar se o menor é prefixo do maior (todas as partes coincidem em ordem)
            $ehPrefixo = $true
            for ($i = 0; $i -lt $menor.Length; $i++) {
                if ($menor[$i] -ne $maior[$i]) {
                    $ehPrefixo = $false
                    break
                }
            }

            if ($ehPrefixo -and $menor.Length -ne $maior.Length) {
                # Um nome é prefixo do outro → provável casamento ou divórcio
                $ultimoLogon = "Nunca"
                if ($usuarioExistente.LastLogonDate) {
                    $ultimoLogon = $usuarioExistente.LastLogonDate.ToString("dd/MM/yyyy")
                }

                $tipoMudanca = if ($partesSolicitado.Length -gt $partesExistente.Length) { "casamento (sobrenome adicionado)" } else { "divórcio (sobrenome removido)" }

                Retornar-Json @{
                    sucesso            = $false
                    acao_real          = "possivel_mesmo_usuario"
                    login              = $usuarioExistente.SamAccountName
                    nome_existente     = $usuarioExistente.Name
                    nome_solicitado    = $nomeFormatado
                    ultimo_logon       = $ultimoLogon
                    dominio            = "pma.local"
                    erro               = "Login '$loginFinal' já existe com nome diferente: '$($usuarioExistente.Name)'. Possível $tipoMudanca."
                    mensagem           = "ATENÇÃO: O login '$loginFinal' já existe no AD com o nome '$($usuarioExistente.Name)' (último acesso: $ultimoLogon). O nome solicitado é '$nomeFormatado'. Isso pode indicar $tipoMudanca. Por favor, verifique com o solicitante se é a mesma pessoa. Se for, contate a equipe de TI para atualizar o nome na conta existente."
                }
            }
            else {
                # Nomes diferentes (não é prefixo) — homônimo real, tentar próximo login
                $contador++
                $loginFinal = "$loginSugerido$contador"
            }
        }
    }

    if ($reativou) { return }

    # === CRIAR NOVO USUÁRIO ===
    $nomeSplit = $nomeFormatado -split '\s+'
    $primeiroNome = $nomeSplit[0]
    $sobrenome = $nomeSplit[-1]
    $ouDestino = ($usuarioModelo.DistinguishedName -split ",",2)[1]
    $dominio = "pma.local"
    $senhaGerada = Gerar-Senha

    try {
        New-ADUser `
            -Name $nomeFormatado `
            -SamAccountName $loginFinal `
            -UserPrincipalName "$loginFinal@$dominio" `
            -DisplayName $nomeFormatado `
            -GivenName $primeiroNome `
            -Surname $sobrenome `
            -AccountPassword (ConvertTo-SecureString $senhaGerada -AsPlainText -Force) `
            -Enabled $true `
            -ChangePasswordAtLogon $true `
            -Path $ouDestino
    } catch {
        Retornar-Erro "Falha ao criar usuário no AD: $_"
    }

    # Copiar perfil do modelo
    Set-ADUser -Identity $loginFinal `
        -ProfilePath $usuarioModelo.ProfilePath `
        -HomeDirectory $usuarioModelo.HomeDirectory `
        -HomeDrive $usuarioModelo.HomeDrive `
        -ScriptPath $usuarioModelo.ScriptPath

    # Copiar grupos do modelo
    foreach ($grupo in $usuarioModelo.MemberOf) {
        try {
            Add-ADGroupMember -Identity $grupo -Members $loginFinal -ErrorAction Stop
        } catch { }
    }

    # Salvar dados extras no AD (Description, Mobile, Organization, etc.)
    $dadosHash = @{}
    $dados.PSObject.Properties | ForEach-Object { $dadosHash[$_.Name] = $_.Value }
    Atualizar-DadosAD -Login $loginFinal -Dados $dadosHash

    Retornar-Json @{
        sucesso   = $true
        acao_real = "criado"
        login     = $loginFinal
        senha     = $senhaGerada
        dominio   = $dominio
        ou        = $ouDestino
        mensagem  = "Usuario criado com sucesso. Login: $loginFinal"
    }
}

# ======================== AÇÃO: RESET DE SENHA ========================

function Executar-ResetSenha {
    param ($dados)

    $login = $dados.login_usuario_reset
    if ([string]::IsNullOrWhiteSpace($login)) {
        Retornar-Erro "Campo login_usuario_reset é obrigatório."
    }
    Assert-IdentificadorSeguro $login 'login_usuario_reset'

    $usuario = $null
    try {
        $usuario = Get-ADUser -Identity $login -Properties SamAccountName, Name, Enabled -ErrorAction Stop
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'Reset'
    }

    if (-not $usuario.Enabled) {
        Retornar-Erro "Usuário '$login' está DESATIVADO. Não é possível resetar a senha."
    }

    $senhaGerada = Gerar-Senha
    Set-ADAccountPassword -Identity $usuario.SamAccountName `
        -NewPassword (ConvertTo-SecureString $senhaGerada -AsPlainText -Force) -Reset
    Set-ADUser -Identity $usuario.SamAccountName -ChangePasswordAtLogon $true

    Retornar-Json @{
        sucesso  = $true
        acao_real = "reset_senha"
        login    = $usuario.SamAccountName
        senha    = $senhaGerada
        dominio  = "pma.local"
        mensagem = "Senha resetada com sucesso para o usuario $($usuario.SamAccountName)."
    }
}

# ======================== AÇÃO: REATIVAR USUÁRIO ========================

function Executar-ReativarUsuario {
    param ($dados)

    $loginReativar = $dados.login_usuario_reativar
    $loginReferencia = $dados.perfil_referencia

    if ([string]::IsNullOrWhiteSpace($loginReativar)) {
        Retornar-Erro "Campo login_usuario_reativar é obrigatório."
    }
    if ([string]::IsNullOrWhiteSpace($loginReferencia)) {
        Retornar-Erro "Campo perfil_referencia é obrigatório para reativação."
    }
    Assert-IdentificadorSeguro $loginReativar 'login_usuario_reativar'
    Assert-IdentificadorSeguro $loginReferencia 'perfil_referencia' -PermitirEspaco

    # Buscar usuário a reativar
    $usuario = $null
    try {
        $usuario = Get-ADUser -Identity $loginReativar `
            -Properties MemberOf, DistinguishedName, Enabled -ErrorAction Stop
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $loginReativar -NomeInformado $dados.nome_completo -Acao 'Reativar'
    }

    # Buscar modelo
    $usuarioModelo = $null
    try {
        $usuarioModelo = Get-ADUser -Filter "SamAccountName -eq '$loginReferencia' -or Name -like '*$loginReferencia*'" `
            -Properties MemberOf, ProfilePath, HomeDirectory, HomeDrive, ScriptPath, DistinguishedName `
            -ErrorAction Stop | Select-Object -First 1
    } catch { }

    if (-not $usuarioModelo) {
        Retornar-PerfilReferenciaNaoEncontrado -PerfilInformado $loginReferencia -Acao 'Reativar'
    }

    # 1. Habilitar
    Enable-ADAccount -Identity $usuario.SamAccountName

    # 2. Senha provisória
    $senhaGerada = Gerar-Senha
    Set-ADAccountPassword -Identity $usuario.SamAccountName `
        -NewPassword (ConvertTo-SecureString $senhaGerada -AsPlainText -Force) -Reset
    Set-ADUser -Identity $usuario.SamAccountName -ChangePasswordAtLogon $true

    # 3. Limpar grupos antigos
    foreach ($grupo in $usuario.MemberOf) {
        if ($grupo -notlike "*CN=Domain Users*") {
            Remove-ADGroupMember -Identity $grupo -Members $usuario.SamAccountName `
                -Confirm:$false -ErrorAction SilentlyContinue
        }
    }

    # 4. Copiar grupos e perfil do modelo
    foreach ($grupo in $usuarioModelo.MemberOf) {
        try { Add-ADGroupMember -Identity $grupo -Members $usuario.SamAccountName -ErrorAction Stop } catch { }
    }

    Set-ADUser -Identity $usuario.SamAccountName `
        -ProfilePath $usuarioModelo.ProfilePath `
        -HomeDirectory $usuarioModelo.HomeDirectory `
        -HomeDrive $usuarioModelo.HomeDrive `
        -ScriptPath $usuarioModelo.ScriptPath

    # 5. Mover para OU do modelo
    $ouDestino = ($usuarioModelo.DistinguishedName -split ",",2)[1]
    try { Move-ADObject -Identity $usuario.DistinguishedName -TargetPath $ouDestino } catch { }

    # 6. Salvar dados extras no AD (Description, Mobile, Organization, etc.)
    $dadosHash = @{}
    $dados.PSObject.Properties | ForEach-Object { $dadosHash[$_.Name] = $_.Value }
    Atualizar-DadosAD -Login $usuario.SamAccountName -Dados $dadosHash

    Retornar-Json @{
        sucesso   = $true
        acao_real = "reativado"
        login     = $usuario.SamAccountName
        senha     = $senhaGerada
        dominio   = "pma.local"
        ou        = $ouDestino
        mensagem  = "Usuario reativado com sucesso. Login: $($usuario.SamAccountName)"
    }
}

# ======================== AÇÃO: DESATIVAR USUÁRIO ========================

function Executar-DesativarUsuario {
    param ($dados)

    $login = $dados.login_usuario_desativar
    if ([string]::IsNullOrWhiteSpace($login)) {
        Retornar-Erro "Campo login_usuario_desativar é obrigatório."
    }
    Assert-IdentificadorSeguro $login 'login_usuario_desativar' -PermitirEspaco

    $usuario = $null
    try {
        $usuario = Get-ADUser -Filter "SamAccountName -eq '$login' -or Name -eq '$login'" `
            -Properties SamAccountName, Name, MemberOf, DistinguishedName, Enabled `
            -ErrorAction Stop | Select-Object -First 1
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'Desativar'
    }

    if (-not $usuario) {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'Desativar'
    }

    if (-not $usuario.Enabled) {
        Retornar-Json @{
            sucesso   = $true
            acao_real = "ja_desativado"
            login     = $usuario.SamAccountName
            mensagem  = "Usuario '$($usuario.SamAccountName)' ja estava desativado."
        }
    }

    # 1. Salvar dados extras no AD antes de desativar (Description com nº processo, etc.)
    $dadosHash = @{}
    $dados.PSObject.Properties | ForEach-Object { $dadosHash[$_.Name] = $_.Value }
    Atualizar-DadosAD -Login $usuario.SamAccountName -Dados $dadosHash

    # 2. Desativar
    Disable-ADAccount -Identity $usuario.SamAccountName

    # 3. Remover grupos (exceto Domain Users)
    foreach ($grupo in $usuario.MemberOf) {
        if ($grupo -notlike "*CN=Domain Users*") {
            try {
                Remove-ADGroupMember -Identity $grupo -Members $usuario.SamAccountName `
                    -Confirm:$false -ErrorAction Stop
            } catch { }
        }
    }

    # 4. Limpar perfil
    Set-ADUser -Identity $usuario.SamAccountName `
        -ProfilePath $null -HomeDirectory $null -HomeDrive $null -ScriptPath $null

    # 5. Mover para OU Desativados
    $ouDesativados = "OU=Desativados,OU=Prefeitura Municipal,DC=pma,DC=local"
    try {
        Move-ADObject -Identity $usuario.DistinguishedName -TargetPath $ouDesativados
    } catch { }

    Retornar-Json @{
        sucesso   = $true
        acao_real = "desativado"
        login     = $usuario.SamAccountName
        mensagem  = "Usuario '$($usuario.SamAccountName)' desativado, grupos removidos e movido para OU Desativados."
    }
}

# ======================== AÇÃO: ACESSO A PASTA ========================

function Executar-AcessoPasta {
    param ($dados)

    $caminhoPasta = $dados.caminho_pasta
    $login = $dados.login_solicitante

    if ([string]::IsNullOrWhiteSpace($caminhoPasta)) {
        Retornar-Erro "Campo caminho_pasta é obrigatório."
    }
    if ([string]::IsNullOrWhiteSpace($login)) {
        Retornar-Erro "Campo login_solicitante é obrigatório para acesso à pasta."
    }
    Assert-IdentificadorSeguro $login 'login_solicitante'

    # Verificar se o usuário existe
    $usuario = $null
    try {
        $usuario = Get-ADUser -Identity $login -ErrorAction Stop
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'AcessoPasta'
    }

    # Verificar se a pasta existe
    if (-not (Test-Path $caminhoPasta)) {
        Retornar-Erro "Pasta '$caminhoPasta' não encontrada no servidor."
    }

    # Conceder permissão de leitura+execução
    try {
        $acl = Get-Acl $caminhoPasta
        $regra = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "PMA\$login", "ReadAndExecute", "ContainerInherit,ObjectInherit", "None", "Allow"
        )
        $acl.AddAccessRule($regra)
        Set-Acl -Path $caminhoPasta -AclObject $acl
    } catch {
        Retornar-Erro "Falha ao conceder acesso à pasta: $_"
    }

    Retornar-Json @{
        sucesso   = $true
        acao_real = "acesso_pasta"
        login     = $login
        pasta     = $caminhoPasta
        mensagem  = "Acesso de leitura concedido ao usuario '$login' na pasta '$caminhoPasta'."
    }
}

# ======================== AÇÃO: TRANSFERÊNCIA DE SETOR ========================
# Lógica: Desativar acessos antigos → Reativar com perfil do novo setor
#   1. Verificar que o login existe e está ativo
#   2. Desativar (remover grupos, limpar perfil, mover para OU Desativados)
#   3. Reativar com perfil_referencia do novo setor (copiar grupos, perfil, OU)
#   4. Gerar nova senha provisória

function Executar-TransferirSetor {
    param ($dados)

    $login = $dados.login_usuario_transferir
    $perfilReferencia = $dados.perfil_referencia

    if ([string]::IsNullOrWhiteSpace($login)) {
        Retornar-Erro "Campo login_usuario_transferir é obrigatório."
    }
    if ([string]::IsNullOrWhiteSpace($perfilReferencia)) {
        Retornar-Erro "Campo perfil_referencia é obrigatório para transferência."
    }
    Assert-IdentificadorSeguro $login 'login_usuario_transferir'
    Assert-IdentificadorSeguro $perfilReferencia 'perfil_referencia' -PermitirEspaco

    # 1. Buscar usuário a transferir
    $usuario = $null
    try {
        $usuario = Get-ADUser -Identity $login `
            -Properties SamAccountName, Name, MemberOf, DistinguishedName, Enabled `
            -ErrorAction Stop
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'Transferir'
    }

    if (-not $usuario.Enabled) {
        Retornar-Erro "Usuário '$login' está DESATIVADO. Para transferir, o usuário deve estar ativo. Use Reativar primeiro."
    }

    # 2. Buscar usuário modelo do novo setor
    $usuarioModelo = $null
    try {
        $usuarioModelo = Get-ADUser -Filter "SamAccountName -eq '$perfilReferencia' -or Name -like '*$perfilReferencia*'" `
            -Properties SamAccountName, Name, DistinguishedName, MemberOf, ProfilePath, HomeDirectory, HomeDrive, ScriptPath `
            -ErrorAction Stop | Select-Object -First 1
    } catch { }

    if (-not $usuarioModelo) {
        Retornar-PerfilReferenciaNaoEncontrado -PerfilInformado $perfilReferencia -Acao 'Transferir'
    }

    # === FASE 1: DESATIVAR acessos antigos ===

    # Remover todos os grupos (exceto Domain Users)
    foreach ($grupo in $usuario.MemberOf) {
        if ($grupo -notlike "*CN=Domain Users*") {
            try {
                Remove-ADGroupMember -Identity $grupo -Members $usuario.SamAccountName `
                    -Confirm:$false -ErrorAction Stop
            } catch { }
        }
    }

    # Limpar perfil antigo
    Set-ADUser -Identity $usuario.SamAccountName `
        -ProfilePath $null -HomeDirectory $null -HomeDrive $null -ScriptPath $null

    # === FASE 2: REATIVAR com perfil do novo setor ===

    # Gerar nova senha
    $senhaGerada = Gerar-Senha
    Set-ADAccountPassword -Identity $usuario.SamAccountName `
        -NewPassword (ConvertTo-SecureString $senhaGerada -AsPlainText -Force) -Reset
    Set-ADUser -Identity $usuario.SamAccountName -ChangePasswordAtLogon $true

    # Copiar perfil do modelo do novo setor
    Set-ADUser -Identity $usuario.SamAccountName `
        -ProfilePath $usuarioModelo.ProfilePath `
        -HomeDirectory $usuarioModelo.HomeDirectory `
        -HomeDrive $usuarioModelo.HomeDrive `
        -ScriptPath $usuarioModelo.ScriptPath

    # Copiar grupos do modelo do novo setor
    foreach ($grupo in $usuarioModelo.MemberOf) {
        try {
            Add-ADGroupMember -Identity $grupo -Members $usuario.SamAccountName -ErrorAction Stop
        } catch { }
    }

    # Mover para a OU do modelo do novo setor
    $ouDestino = ($usuarioModelo.DistinguishedName -split ",",2)[1]
    try {
        Move-ADObject -Identity $usuario.DistinguishedName -TargetPath $ouDestino
    } catch { }

    # Salvar dados extras no AD (Description com processo, Mobile, Organization do novo setor, etc.)
    $dadosHash = @{}
    $dados.PSObject.Properties | ForEach-Object { $dadosHash[$_.Name] = $_.Value }
    Atualizar-DadosAD -Login $usuario.SamAccountName -Dados $dadosHash

    Retornar-Json @{
        sucesso       = $true
        acao_real     = "transferido"
        login         = $usuario.SamAccountName
        senha         = $senhaGerada
        dominio       = "pma.local"
        ou            = $ouDestino
        novo_setor    = $dados.novo_setor
        novo_local    = $dados.novo_local
        mensagem      = "Usuario '$($usuario.SamAccountName)' transferido com sucesso. Acessos antigos removidos e novos acessos aplicados conforme perfil '$perfilReferencia'."
    }
}

# ======================== AÇÃO: CRIAR E-MAIL INSTITUCIONAL ========================
# Lógica baseada em Crie_email_AD.ps1:
#   1. Busca usuário no AD pelo nome_usuario (SamAccountName)
#   2. Verifica se já possui mailbox no Exchange
#   3. Se não possui, cria mailbox no Exchange (Small Database)

function Executar-CriarEmail {
    param ($dados)

    $login = $dados.nome_usuario
    if ([string]::IsNullOrWhiteSpace($login)) {
        Retornar-Erro "Campo nome_usuario é obrigatório para criação de e-mail."
    }
    Assert-IdentificadorSeguro $login 'nome_usuario'

    # Buscar usuário no AD
    $usuarioAD = $null
    try {
        $usuarioAD = Get-ADUser -Filter "SamAccountName -eq '$login'" -Properties SamAccountName, Name -ErrorAction Stop
    } catch {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'CriarEmail'
    }

    if (-not $usuarioAD) {
        Retornar-UsuarioNaoEncontrado -LoginInformado $login -NomeInformado $dados.nome_completo -Acao 'CriarEmail'
    }

    $loginFinal = $usuarioAD.SamAccountName
    $nome = $usuarioAD.Name
    $database = "Small Database"

    # Carregar ferramentas do Exchange
    if (!(Get-Command Enable-Mailbox -ErrorAction SilentlyContinue)) {
        $ExchangePath = "C:\Program Files\Microsoft\Exchange Server\V15\Bin\RemoteExchange.ps1"
        if (Test-Path $ExchangePath) {
            . $ExchangePath
        } else {
            try {
                $Session = New-PSSession -ConfigurationName Microsoft.Exchange -ConnectionUri http://PMA-EX-01.pma.local/PowerShell/ -Authentication Kerberos -ErrorAction Stop
                Import-PSSession $Session -DisableNameChecking -AllowClobber | Out-Null
            } catch {
                Retornar-Erro "Falha ao conectar ao Exchange Server: $_"
            }
        }
    }

    # Verificar se já possui mailbox
    $checkMailbox = $null
    try {
        $checkMailbox = Get-Recipient -Identity $loginFinal -ErrorAction SilentlyContinue
    } catch { }

    if ($checkMailbox) {
        Retornar-Json @{
            sucesso   = $true
            acao_real = "email_ja_existe"
            login     = $loginFinal
            email     = $checkMailbox.PrimarySmtpAddress
            mensagem  = "Usuário '$loginFinal' já possui e-mail ativo: $($checkMailbox.PrimarySmtpAddress)"
        }
        return
    }

    # Criar mailbox no Exchange (Out-Null suprime output do cmdlet que polui o stdout do JSON final)
    try {
        Enable-Mailbox -Identity $loginFinal -Alias $loginFinal -Database $database -ErrorAction Stop | Out-Null
    } catch {
        Retornar-Erro "Falha ao criar mailbox no Exchange: $_"
    }

    $emailCriado = "$loginFinal@araraquara.sp.gov.br"

    # Limpar sessão Exchange se foi criada
    if ($Session) { Remove-PSSession $Session }

    Retornar-Json @{
        sucesso   = $true
        acao_real = "email_criado"
        login     = $loginFinal
        email     = $emailCriado
        database  = $database
        mensagem  = "E-mail institucional criado com sucesso: $emailCriado (Database: $database)"
    }
}

# ======================== DISPATCHER ========================

# Decodifica DadosB64 (preferido) ou usa DadosJson (legado).
# Pelo menos um dos dois é obrigatório.
if (-not [string]::IsNullOrWhiteSpace($DadosB64)) {
    try {
        $DadosJson = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($DadosB64))
    } catch {
        Retornar-Erro "Falha ao decodificar DadosB64 (Base64 inválido): $_"
    }
} elseif ([string]::IsNullOrWhiteSpace($DadosJson)) {
    Retornar-Erro "Parâmetro obrigatório ausente: informe -DadosB64 (preferido) ou -DadosJson."
}

try {
    $dados = $DadosJson | ConvertFrom-Json
} catch {
    Retornar-Erro "JSON de entrada inválido: $_"
}

switch ($Acao) {
    'Criar'       { Executar-CriarUsuario    -dados $dados }
    'Reset'       { Executar-ResetSenha      -dados $dados }
    'Reativar'    { Executar-ReativarUsuario  -dados $dados }
    'Desativar'   { Executar-DesativarUsuario -dados $dados }
    'AcessoPasta' { Executar-AcessoPasta     -dados $dados }
    'Transferir'  { Executar-TransferirSetor  -dados $dados }
    'CriarEmail'  { Executar-CriarEmail      -dados $dados }
    default       { Retornar-Erro "Ação desconhecida: $Acao" }
}
