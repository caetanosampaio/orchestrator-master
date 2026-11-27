# Cria (ou refaz) o atalho "FORGE DEV" no menu Iniciar. Não toca no atalho nem nos arquivos do FORGE instalado.
# Uso: powershell -ExecutionPolicy Bypass -File desktop\scripts\make-dev-shortcut.ps1
$ErrorActionPreference = 'Stop'
$Desktop = Split-Path -Parent $PSScriptRoot
$Icon = Join-Path $Desktop 'build\icon-dev.ico'
$Launcher = Join-Path $PSScriptRoot 'forge-dev-launcher.ps1'
foreach ($f in $Icon, $Launcher) { if (-not (Test-Path $f)) { Write-Error "Não encontrei $f" } }

$Lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\FORGE DEV.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($Lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Minimized -File `"$Launcher`""
$s.WorkingDirectory = Split-Path -Parent $Desktop
$s.IconLocation = "$Icon,0"
$s.WindowStyle = 7 # minimizada
$s.Description = 'FORGE DEV: o FORGE rodando do código, para desenvolver o próprio FORGE'
$s.Save()

$Electron = Join-Path $Desktop 'node_modules\electron\dist\electron.exe'
if (Test-Path $Electron) {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $Electron -ArgumentList "`"$(Join-Path $PSScriptRoot 'set-shortcut-appid.cjs')`"", "`"$Lnk`"" -Wait -PassThru
  if ($p.ExitCode -ne 0) { Write-Warning 'O atalho funciona, mas fixado pode aparecer separado da janela.' }
}
Write-Host "Atalho criado: $Lnk"
