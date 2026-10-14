$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskStage = Join-Path $taskRoot 'dist\windows-x64'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskArgs = @('/nologo','/target:exe','/platform:x64','/main:ShellNativeHarness',"/out:$(Join-Path $taskStage 'ShellNativeHarness.exe')",'/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll',"/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.Core.dll')","/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.WinForms.dll')",(Join-Path $taskRoot 'desktop\windows\Launcher.cs'),(Join-Path $taskRoot 'desktop\windows\ShellIntegration.cs'),(Join-Path $PSScriptRoot 'ShellNativeHarness.cs'))
& $taskCompiler @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'Native shell smoke harness compilation failed.' }
Copy-Item -LiteralPath (Join-Path $taskStage 'Nearby.exe.config') -Destination (Join-Path $taskStage 'ShellNativeHarness.exe.config') -Force
