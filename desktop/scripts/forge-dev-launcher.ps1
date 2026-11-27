# Abre o FORGE DEV pelo atalho do menu Iniciar: o mesmo que `npm run forge-dev`. A janela do PowerShell fica minimizada
# enquanto o FORGE DEV estiver aberto (os logs da montagem aparecem nela). Falhas viram um aviso na tela.
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Show-Aviso([string]$Texto) {
  Add-Type -AssemblyName System.Windows.Forms
  [void][System.Windows.Forms.MessageBox]::Show($Texto, 'FORGE DEV')
}

try {
  $Host.UI.RawUI.WindowTitle = 'FORGE DEV (feche o app, não esta janela)'
  Set-Location $Repo
  Write-Host 'Montando o FORGE DEV com o código atual. A janela abre em instantes...'
  $ErrorActionPreference = 'Continue' # avisos do npm no stderr não são falha
  & node (Join-Path $Repo 'scripts\forge-dev.mjs') app
  $Codigo = $LASTEXITCODE
} catch {
  Show-Aviso "Não foi possível abrir o FORGE DEV: $($_.Exception.Message)"
  exit 1
}

if ($Codigo -eq 3) { Show-Aviso 'O FORGE DEV já está aberto ou abrindo. Para carregar código novo, feche-o e abra de novo.' }
elseif ($Codigo -ne 0) { Show-Aviso "O FORGE DEV falhou (código $Codigo). Para ver o erro, abra um PowerShell em $Repo e rode: npm run forge-dev" }
exit $Codigo
