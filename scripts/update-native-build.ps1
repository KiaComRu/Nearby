param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$updateTaskRoot = Split-Path $PSScriptRoot -Parent
$updateTaskStage = Join-Path $updateTaskRoot 'dist/windows-x64'
$updateTaskCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$updateTaskArgs = @('/nologo','/target:exe','/platform:x64','/main:UpdateNativeHarness',"/out:$Output",'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll',"/reference:$(Join-Path $updateTaskStage 'Microsoft.Web.WebView2.Core.dll')","/reference:$(Join-Path $updateTaskStage 'Microsoft.Web.WebView2.WinForms.dll')",(Join-Path $updateTaskRoot 'desktop/windows/Launcher.cs'),(Join-Path $updateTaskRoot 'desktop/windows/ShellIntegration.cs'),(Join-Path $updateTaskRoot 'desktop/windows/DesktopUpdates.cs'),(Join-Path $PSScriptRoot 'UpdateNativeHarness.cs'))
& $updateTaskCompiler @updateTaskArgs
if ($LASTEXITCODE -ne 0) { throw 'Updater native harness compilation failed.' }
Copy-Item -LiteralPath (Join-Path $updateTaskStage 'Nearby.exe.config') -Destination ($Output + '.config') -Force
