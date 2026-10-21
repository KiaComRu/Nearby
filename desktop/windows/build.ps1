param([ValidateSet('Windows', 'Server2016')][string]$Target = 'Windows')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskTools = Join-Path $taskRoot '.build-tools'
$taskPlatform = if ($Target -eq 'Server2016') { 'windows-server-2016-x64' } else { 'windows-x64' }
$taskStage = Join-Path $taskRoot "dist\$taskPlatform"
$taskArtifacts = Join-Path $taskRoot 'artifacts'
$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskWebVersion = '1.0.4258.31'
$taskWebRoot = Join-Path $taskTools "webview2-$taskWebVersion"
$taskNsisArchiveRoot = Join-Path $taskTools 'nsis-3'
$taskNsisRoot = Join-Path $taskNsisArchiveRoot 'nsis-3.08'
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw 'Нужен .NET Framework 4.8 с системным компилятором C#.' }
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskNodeVersion = (& $taskNode --version).Trim()
if ([int]($taskNodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Нужен Node.js 22 или новее.' }
if ($Target -eq 'Server2016' -and [int]($taskNodeVersion.TrimStart('v').Split('.')[0]) -ne 24) { throw 'Для проверенного профиля Server 2016 нужен Node.js 24 x64.' }
if (-not [Environment]::Is64BitProcess) { throw 'Запустите сборку из 64-разрядного PowerShell.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# Always package a fresh payload; native test helpers and stale files must never ship.
$taskStageFull = [IO.Path]::GetFullPath($taskStage)
$taskDistFull = [IO.Path]::GetFullPath((Join-Path $taskRoot 'dist')) + [IO.Path]::DirectorySeparatorChar
if (-not $taskStageFull.StartsWith($taskDistFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Каталог сборки находится вне dist.' }
if (Test-Path -LiteralPath $taskStageFull) {
    if ((Resolve-Path -LiteralPath $taskStageFull).Path -ne $taskStageFull) { throw 'Некорректный путь каталога сборки.' }
    if (((Get-Item -LiteralPath $taskStageFull -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or (Get-ChildItem -LiteralPath $taskStageFull -Force -Recurse -Attributes ReparsePoint | Select-Object -First 1)) { throw 'Каталог сборки содержит ссылку; очистка отменена.' }
    Remove-Item -LiteralPath $taskStageFull -Recurse -Force
}
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

# Compile against the actual 4.6.2 API surface, not merely a changed runtime config.
if ($Target -eq 'Server2016') {
    $taskReferenceRoot = Join-Path $taskTools 'net462-1.0.3'
    $taskReferences = Join-Path $taskReferenceRoot 'build\.NETFramework\v4.6.2'
    if (-not (Test-Path -LiteralPath (Join-Path $taskReferences 'mscorlib.dll'))) {
        $taskReferenceArchive = Join-Path $taskTools 'net462.zip'
        Invoke-WebRequest -UseBasicParsing -Uri 'https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net462/1.0.3/microsoft.netframework.referenceassemblies.net462.1.0.3.nupkg' -OutFile $taskReferenceArchive
        [xml]$taskReferenceMetadata = (Invoke-WebRequest -UseBasicParsing -Uri "https://www.nuget.org/api/v2/Packages(Id='Microsoft.NETFramework.ReferenceAssemblies.net462',Version='1.0.3')").Content
        if ($taskReferenceMetadata.SelectSingleNode("//*[local-name()='PackageHashAlgorithm']").InnerText -ne 'SHA512') { throw 'Unsupported reference assembly checksum algorithm.' }
        $taskReferenceHasher = [Security.Cryptography.SHA512]::Create()
        $taskReferenceStream = [IO.File]::OpenRead($taskReferenceArchive)
        try { $taskReferenceHash = [Convert]::ToBase64String($taskReferenceHasher.ComputeHash($taskReferenceStream)) }
        finally { $taskReferenceStream.Dispose(); $taskReferenceHasher.Dispose() }
        if ($taskReferenceHash -ne $taskReferenceMetadata.SelectSingleNode("//*[local-name()='PackageHash']").InnerText) { throw 'Контрольная сумма .NET 4.6.2 reference assemblies не совпала.' }
        Expand-Archive -LiteralPath $taskReferenceArchive -DestinationPath $taskReferenceRoot -Force
    }
}

$taskApp = Join-Path $taskStage 'app'
$taskRuntime = Join-Path $taskStage 'runtime'
$taskLicenses = Join-Path $taskStage 'licenses'
New-Item -ItemType Directory -Force -Path $taskApp,$taskRuntime,$taskLicenses,(Join-Path $taskApp 'desktop\windows') | Out-Null
Copy-Item -LiteralPath (Join-Path $taskRoot 'server.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'transfer-statistics.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'lan-peer.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'lan-discovery.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'device-identity.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'lan-tls.mjs') -Destination $taskApp
Copy-Item -LiteralPath (Join-Path $taskRoot 'trusted-lan.mjs') -Destination $taskApp
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
$taskConfig = if ($Target -eq 'Server2016') { 'Nearby.Server2016.exe.config' } else { 'Nearby.exe.config' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $taskConfig) -Destination (Join-Path $taskStage 'Nearby.exe.config') -Force
& $taskNode (Join-Path $PSScriptRoot 'make-icon.mjs') (Join-Path $taskStage 'Nearby.ico')
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить значок.' }
$taskExe = Join-Path $taskStage 'Nearby.exe'
$taskCompilerArgs = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', "/out:$taskExe", "/win32icon:$(Join-Path $taskStage 'Nearby.ico')")
if ($Target -eq 'Server2016') {
    $taskCompilerArgs += @('/noconfig', '/nostdlib+', '/define:SERVER2016')
    foreach ($taskReference in @('mscorlib.dll', 'System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll', 'System.Net.Http.dll')) {
        $taskCompilerArgs += "/reference:$(Join-Path $taskReferences $taskReference)"
    }
} else {
    $taskCompilerArgs += @('/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', '/reference:System.Web.Extensions.dll', '/reference:System.Net.Http.dll')
}
$taskCompilerArgs += @("/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.Core.dll')", "/reference:$(Join-Path $taskStage 'Microsoft.Web.WebView2.WinForms.dll')", (Join-Path $PSScriptRoot 'Launcher.cs'), (Join-Path $PSScriptRoot 'ShellIntegration.cs'), (Join-Path $PSScriptRoot 'DesktopUpdates.cs'))
& $taskCompiler @taskCompilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Ошибка компиляции Windows-приложения.' }
if ([Diagnostics.FileVersionInfo]::GetVersionInfo($taskExe).FileVersion -ne "$taskVersion.0") { throw 'Версия Launcher.cs не совпадает с package.json.' }
$taskSetup = Join-Path $taskArtifacts "Nearby-$taskVersion-$taskPlatform-setup.exe"
$taskInstallerArgs = @('/V2', "/DVERSION=$taskVersion", "/DPAYLOAD=$taskStage", "/DOUTPUT=$taskSetup")
if ($Target -eq 'Server2016') { $taskInstallerArgs += '/DSERVER2016' }
$taskInstallerArgs += (Join-Path $PSScriptRoot 'installer.nsi')
& $taskMakensis @taskInstallerArgs
if ($LASTEXITCODE -ne 0) { throw 'Ошибка сборки установщика.' }
$taskSetupHasher = [Security.Cryptography.SHA256]::Create()
$taskSetupStream = [IO.File]::OpenRead($taskSetup)
try { $taskSetupHash = [BitConverter]::ToString($taskSetupHasher.ComputeHash($taskSetupStream)).Replace('-','').ToLowerInvariant() }
finally { $taskSetupStream.Dispose(); $taskSetupHasher.Dispose() }
$taskManifest = [ordered]@{
    product = 'Nearby'; version = $taskVersion; platform = $taskPlatform; node = $taskNodeVersion
    webView2Sdk = $taskWebVersion; builtAt = [DateTime]::UtcNow.ToString('o')
    installer = [IO.Path]::GetFileName($taskSetup)
    sha256 = $taskSetupHash
    size = (Get-Item -LiteralPath $taskSetup).Length
    signed = $false
}
$taskManifestName = 'windows-build.json'
if ($Target -eq 'Server2016') {
    $taskManifestName = 'windows-server-2016-build.json'
    $taskManifest['minimumOS'] = 'Windows Server 2016 x64, build 14393, Desktop Experience'
    $taskManifest['dotNetFramework'] = '4.6.2'
    $taskManifest['physicalServerVerified'] = $false
}
$taskManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskArtifacts $taskManifestName) -Encoding UTF8
Write-Output "Готово: $taskSetup"
