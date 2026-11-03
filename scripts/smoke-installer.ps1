param([Parameter(Mandatory=$true)][string]$Setup)
$ErrorActionPreference = 'Stop'
$Setup = (Resolve-Path $Setup).Path
$Installed = Join-Path $env:LOCALAPPDATA 'Programs\DooTTY'
$Preferences = Join-Path $env:APPDATA 'DooTTY'
$PortableRoot = Join-Path $env:TEMP ('DooTTY-test-' + [guid]::NewGuid().ToString('N'))
# Both parent and target are absent: normalization must not depend on existing directories.
$Portable = Join-Path $PortableRoot 'new parent\DooTTY portable'
$Registry = 'HKCU:\Software\DooSys\DooTTY'
if ((Test-Path $Installed) -or (Test-Path $Preferences) -or (Test-Path $Registry)) {
  throw 'Use a disposable Windows account without existing DooTTY data.'
}
function Execute([string]$File, [string]$Arguments, [int]$Expected = 0) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
  if (!$process.WaitForExit(120000)) { throw "Installer exceeded 120 seconds: $File" }
  if ($process.ExitCode -ne $Expected) { throw "$File failed: $($process.ExitCode)" }
}
function Assert([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}
try {
  Execute $Setup '/S /PORTABLE=relative' 1
  Execute $Setup "/S /PORTABLE=`"$Portable`""
  Assert (Test-Path "$Portable\DooTTY.portable") 'Portable marker missing'
  Assert (Test-Path "$Portable\data\config.json") 'Portable config missing'
  Assert (!(Test-Path $Registry)) 'Portable wrote install registry'
  Assert (!(Test-Path "$Portable\Uninstall.exe")) 'Portable wrote uninstaller'
  Assert (!(Test-Path "$Portable\licenses")) 'Fresh portable should use consolidated notices'
  Assert (Test-Path "$Portable\THIRD_PARTY_NOTICES.txt") 'Full offline notices missing'
  New-Item -ItemType Directory "$Portable\licenses" | Out-Null
  Set-Content "$Portable\licenses\windows-terminal-MIT.txt" 'Old installer-owned notice'
  Set-Content "$Portable\licenses\user-notes.txt" 'User file must survive update'
  $original = Get-Content "$Portable\data\config.json" -Raw | ConvertFrom-Json
  $original.language = 'en'
  $original.appearance.fontSize = 21
  $original | ConvertTo-Json -Depth 10 | Set-Content "$Portable\data\config.json" -Encoding utf8NoBOM
  $before = (Get-FileHash "$Portable\data\config.json").Hash
  Execute $Setup "/S /PORTABLE=`"$Portable`""
  Assert ($before -eq (Get-FileHash "$Portable\data\config.json").Hash) 'Portable preferences replaced'
  Assert (!(Test-Path "$Portable\licenses\windows-terminal-MIT.txt")) 'Obsolete owned notice survived update'
  Assert (Test-Path "$Portable\licenses\user-notes.txt") 'Update deleted a user-added file'
  Execute $Setup '/S'
  Assert (Test-Path "$Installed\DooTTY.exe") 'Installed binary missing'
  Assert (Test-Path "$Installed\Uninstall.exe") 'Uninstaller missing'
  Assert (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\DooTTY.lnk") 'Start shortcut missing'
  Assert (!(Test-Path "$Installed\DooTTY.portable")) 'Installed has portable marker'
  Execute $Setup "/S /PORTABLE=`"$Installed\.`"" 1
  $before = (Get-FileHash "$Preferences\config.json").Hash
  Execute $Setup '/S'
  Assert ($before -eq (Get-FileHash "$Preferences\config.json").Hash) 'Installed preferences replaced'
  Execute "$Installed\Uninstall.exe" "/S _?=$Installed"
  Assert (!(Test-Path $Registry)) 'Install registry survived uninstall'
  Assert (!(Test-Path "$Installed\DooTTY.exe")) 'Binary survived uninstall'
  Assert (Test-Path "$Preferences\config.json") 'Uninstall removed preferences without consent'
  Execute $Setup '/S'
  Execute "$Installed\Uninstall.exe" "/S /PURGE _?=$Installed"
  Assert (!(Test-Path "$Preferences\config.json")) 'Explicit preference deletion failed'
  Write-Host 'Installer smoke tests passed: portable, install, reinstall, preserved configuration, uninstall and explicit purge.'
} finally {
  # All paths below belong to this disposable test account and were absent before the test.
  Remove-Item $PortableRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Installed -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Preferences -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item $Registry -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\DooTTY' -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\DooTTY.lnk" -Force -ErrorAction SilentlyContinue
}
