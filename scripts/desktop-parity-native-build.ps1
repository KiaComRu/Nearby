param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
$nativeParityRoot = Split-Path $PSScriptRoot -Parent
$nativeParityStage = Join-Path $nativeParityRoot 'dist/windows-x64'
$nativeParityCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$nativeParityArgs = @('/nologo','/target:exe','/platform:x64','/main:DesktopParityNativeHarness',"/out:$Output",'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll',"/reference:$(Join-Path $nativeParityStage 'Microsoft.Web.WebView2.Core.dll')","/reference:$(Join-Path $nativeParityStage 'Microsoft.Web.WebView2.WinForms.dll')",(Join-Path $nativeParityRoot 'desktop/windows/Launcher.cs'),(Join-Path $nativeParityRoot 'desktop/windows/ShellIntegration.cs'),(Join-Path $nativeParityRoot 'desktop/windows/DesktopUpdates.cs'),(Join-Path $PSScriptRoot 'UpdateNativeHarness.cs'),(Join-Path $PSScriptRoot 'DesktopParityNativeHarness.cs'))
& $nativeParityCompiler @nativeParityArgs
if ($LASTEXITCODE -ne 0) { throw 'Desktop file actions native harness compilation failed.' }
Copy-Item -LiteralPath (Join-Path $nativeParityStage 'Nearby.exe.config') -Destination ($Output + '.config') -Force
