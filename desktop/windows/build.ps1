$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskTools = Join-Path $taskRoot '.build-tools'
$taskStage = Join-Path $taskRoot 'dist\windows-x64'
$taskArtifacts = Join-Path $taskRoot 'artifacts'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskWebVersion = '1.0.4258.31'
$taskWebRoot = Join-Path $taskTools "webview2-$taskWebVersion"
$taskNsisArchiveRoot = Join-Path $taskTools 'nsis-3'
$taskNsisRoot = Join-Path $taskNsisArchiveRoot 'nsis-3.08'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw 'Нужен .NET Framework 4.8 с системным компилятором C#.' }
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskNodeVersion = (& $taskNode --version).Trim()
if ([int]($taskNodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Нужен Node.js 22 или новее.' }
if (-not [Environment]::Is64BitProcess) { throw 'Запустите сборку из 64-разрядного PowerShell.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $taskTools,$taskStage,$taskArtifacts | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $taskWebRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    $taskWebArchive = Join-Path $taskTools 'webview2.zip'
    $taskWebUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$taskWebVersion/microsoft.web.webview2.$taskWebVersion.nupkg"
    Invoke-WebRequest -UseBasicParsing -Uri $taskWebUrl -OutFile $taskWebArchive
    [xml]$taskMetadata = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.nuget.org/api/v2/Packages(Id='Microsoft.Web.WebView2',Version='$taskWebVersion')").Content
    $taskExpected = $taskMetadata.SelectSingleNode("//*[local-name()='PackageHash']").InnerText
    if ($taskMetadata.SelectSingleNode("//*[local-name()='PackageHashAlgorithm']").InnerText -ne 'SHA512') { throw 'Unsupported NuGet checksum algorithm.' }
    $taskHasher = [Security.Cryptography.SHA512]::Create()
    $taskStream = [IO.File]::OpenRead($taskWebArchive)
    try { $taskActual = [Convert]::ToBase64String($taskHasher.ComputeHash($taskStream)) }
    finally { $taskStream.Dispose(); $taskHasher.Dispose() }
    if ($taskActual -ne $taskExpected) { throw 'Контрольная сумма WebView2 SDK не совпала.' }
    Expand-Archive -LiteralPath $taskWebArchive -DestinationPath $taskWebRoot -Force
}
if (-not (Test-Path -LiteralPath (Join-Path $taskNsisRoot 'Bin\makensis.exe'))) {
    $taskNsisArchive = Join-Path $taskTools 'nsis.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3/nsis-3.zip' -OutFile $taskNsisArchive
    Expand-Archive -LiteralPath $taskNsisArchive -DestinationPath $taskNsisArchiveRoot -Force
}
$taskMakensis = Join-Path $taskNsisRoot 'Bin\makensis.exe'
if (-not (Test-Path -LiteralPath $taskMakensis)) { throw 'NSIS compiler was not found.' }
$env:NSISDIR = $taskNsisRoot

$taskApp = Join-Path $taskStage 'app'
$taskRuntime = Join-Path $taskStage 'runtime'
$taskLicenses = Join-Path $taskStage 'licenses'
New-Item -ItemType Directory -Force -Path $taskApp,$taskRuntime,$taskLicenses,(Join-Path $taskApp 'desktop\windows') | Out-Null
Copy-Item -LiteralPath (Join-Path $taskRoot 'server.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'public') -Destination $taskApp -Recurse -Force
Copy-Item -LiteralPath (Join-Path $taskRoot 'package.json'),(Join-Path $taskRoot 'package-lock.json') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'host.mjs') -Destination (Join-Path $taskApp 'desktop\windows')
& npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund --prefix $taskApp
if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить production-зависимости.' }
Copy-Item -LiteralPath $taskNode -Destination (Join-Path $taskRuntime 'node.exe') -Force
Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/nodejs/node/$taskNodeVersion/LICENSE" -OutFile (Join-Path $taskLicenses 'Node-LICENSE.txt')
Get-ChildItem -LiteralPath $taskWebRoot -Filter '*LICENSE*' | Copy-Item -Destination $taskLicenses -Force
foreach ($taskLib in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll')) {
    Copy-Item -LiteralPath (Join-Path $taskWebRoot "lib\net462\$taskLib") -Destination $taskStage -Force
}
Copy-Item -LiteralPath (Join-Path $taskWebRoot 'runtimes\win-x64\native\WebView2Loader.dll') -Destination $taskStage -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Nearby.exe.config') -Destination $taskStage -Force
& $taskNode (Join-Path $PSScriptRoot 'make-icon.mjs') (Join-Path $taskStage 'Nearby.ico')
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить значок.' }
$taskExe = Join-Path $taskStage 'Nearby.exe'
& $taskCompiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$taskExe" "/win32icon:$(Join-Path $taskStage 'Nearby.ico')" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.Core.dll')" "/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.WinForms.dll')" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Ошибка компиляции Windows-приложения.' }
$taskSetup = Join-Path $taskArtifacts 'Nearby-0.2.0-windows-x64-setup.exe'
& $taskMakensis /V2 "/DPAYLOAD=$taskStage" "/DOUTPUT=$taskSetup" (Join-Path $PSScriptRoot 'installer.nsi')
if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки установщика.' }
$taskSetupHasher = [Security.Cryptography.SHA256]::Create()
$taskSetupStream = [IO.File]::OpenRead($taskSetup)
try { $taskSetupHash = [BitConverter]::ToString($taskSetupHasher.ComputeHash($taskSetupStream)).Replace('-','').ToLowerInvariant() }
finally { $taskSetupStream.Dispose(); $taskSetupHasher.Dispose() }
$taskManifest = [ordered]@{
    product = 'Nearby'; version = '0.2.0'; platform = 'windows-x64'; node = $taskNodeVersion
    webView2Sdk = $taskWebVersion; builtAt = [DateTime]::UtcNow.ToString('o')
    installer = [IO.Path]::GetFileName($taskSetup)
    sha256 = $taskSetupHash
    signed = $false
}
$taskManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskArtifacts 'windows-build.json') -Encoding UTF8
Write-Output "Готово: $taskSetup"
