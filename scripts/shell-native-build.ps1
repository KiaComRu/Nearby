$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskStage = Join-Path $taskRoot 'dist\windows-x64'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
# Both test executables use a separate pipe and mutex so the installed app can keep running.
$taskShellSource = [IO.File]::ReadAllText((Join-Path $taskRoot 'desktop\windows\ShellIntegration.cs'))
if (-not $taskShellSource.Contains('"Nearby.Transfer."')) { throw 'Native shell IPC name changed.' }
$taskIsolatedSource = Join-Path $taskStage ('ShellIntegration.Smoke.' + [Guid]::NewGuid().ToString('N') + '.cs')
try {
    [IO.File]::WriteAllText($taskIsolatedSource, $taskShellSource.Replace('"Nearby.Transfer."', '"Nearby.Transfer.Smoke."'))
    $taskArgs = @('/nologo','/platform:x64','/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/reference:System.Web.Extensions.dll','/reference:System.Net.Http.dll',"/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.Core.dll')","/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.WinForms.dll')",(Join-Path $taskRoot 'desktop\windows\Launcher.cs'),$taskIsolatedSource,(Join-Path $taskRoot 'desktop\windows\DesktopUpdates.cs'))
    $taskHarness = Join-Path $taskStage 'ShellNativeHarness.exe'
    & $taskCompiler '/target:exe' '/main:ShellNativeHarness' "/out:$taskHarness" @taskArgs (Join-Path $PSScriptRoot 'ShellNativeHarness.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Native shell smoke harness compilation failed.' }
    $taskActivation = Join-Path $taskStage 'ShellNativeActivation.exe'
    & $taskCompiler '/target:winexe' '/main:Program' "/out:$taskActivation" @taskArgs
    if ($LASTEXITCODE -ne 0) { throw 'Native shell smoke activation compilation failed.' }
    foreach ($taskExecutable in @($taskHarness, $taskActivation)) {
        Copy-Item -LiteralPath (Join-Path $taskStage 'Nearby.exe.config') -Destination ($taskExecutable + '.config') -Force
    }
} finally { Remove-Item -LiteralPath $taskIsolatedSource -Force -ErrorAction SilentlyContinue }
