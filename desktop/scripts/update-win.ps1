# Atualiza o FORGE instalado em %LOCALAPPDATA%\Programs\FORGE com a main mais recente, mantendo o MESMO caminho
# (o ícone fixado na barra de tarefas continua valendo). Os dados ficam em %APPDATA%\FORGE e não são tocados.
# Uso: powershell -ExecutionPolicy Bypass -File desktop\scripts\update-win.ps1 [-SemPull]
param([switch]$SemPull)
$ErrorActionPreference = 'Stop'

$Desktop = Split-Path -Parent $PSScriptRoot
$Repo = Split-Path -Parent $Desktop
$Dest = Join-Path $env:LOCALAPPDATA 'Programs\FORGE'
$Src = Join-Path $Desktop 'release\win-unpacked'

# Substituir um app aberto corrompe a cópia e o servidor segura a trava do banco.
if (Get-Process -Name FORGE -ErrorAction SilentlyContinue) {
  Write-Error 'O FORGE está aberto. Feche-o (todas as janelas) e rode de novo.'
}

if (-not $SemPull) {
  Push-Location $Repo
  try { git pull --ff-only; if ($LASTEXITCODE -ne 0) { throw 'git pull falhou' } } finally { Pop-Location }
}

Push-Location $Desktop
try { npm run dir; if ($LASTEXITCODE -ne 0) { throw 'npm run dir falhou' } } finally { Pop-Location }

if (-not (Test-Path (Join-Path $Src 'FORGE.exe'))) { Write-Error "Build não gerou $Src\FORGE.exe" }

# /MIR atualiza no lugar (mesma pasta), sem apagar o app antes; códigos 0-7 do robocopy são sucesso.
robocopy $Src $Dest /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { Write-Error "robocopy falhou (código $LASTEXITCODE)" }

# Atalho no Menu Iniciar (só se faltar): é por ele que o app aparece na busca e pode ser fixado.
$Lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\FORGE.lnk'
if (-not (Test-Path $Lnk)) {
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($Lnk)
  $s.TargetPath = Join-Path $Dest 'FORGE.exe'; $s.WorkingDirectory = $Dest; $s.Save()
}
Write-Host "FORGE atualizado em $Dest"
