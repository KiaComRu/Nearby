using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed class DesktopUpdateInfo
{
    internal Version Version;
    internal string DisplayVersion, Installer, Sha256;
    internal long Size;
    internal Uri Download;
}

internal sealed class DesktopUpdates : IDisposable
{
    internal const string Website = "https://nearby.kiacom.ru";
    internal const string Platform = "windows-x64";
    internal const string Manifest = "windows-build.json";
    private const long MaximumInstaller = 256L * 1024 * 1024;
    private readonly HttpClient client;
    private readonly string directory;

    internal DesktopUpdates(string directory, HttpMessageHandler handler = null)
    {
        this.directory = Path.GetFullPath(directory);
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        client = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
        client.Timeout = TimeSpan.FromMinutes(15);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Nearby-Desktop/" + typeof(DesktopUpdates).Assembly.GetName().Version.ToString(3));
        client.DefaultRequestHeaders.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue { NoCache = true };
    }

    internal static DesktopUpdateInfo Parse(string json, string platform)
    {
        var serializer = new JavaScriptSerializer { MaxJsonLength = 65536, RecursionLimit = 8 };
        var data = serializer.Deserialize<Dictionary<string, object>>(json);
        if (data == null || !data.ContainsKey("product") || (string)data["product"] != "Nearby" ||
            !data.ContainsKey("platform") || (string)data["platform"] != platform ||
            platform != "windows-x64") throw new InvalidDataException("Неверная сборка обновления.");
        string version = data.ContainsKey("version") ? data["version"] as string : null;
        Version parsed;
        if (version == null || !Regex.IsMatch(version, @"\A[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}\z") || !Version.TryParse(version, out parsed))
            throw new InvalidDataException("Некорректная версия обновления.");
        string installer = "Nearby-" + version + "-" + platform + "-setup.exe";
        if (!data.ContainsKey("installer") || !String.Equals(data["installer"] as string, installer, StringComparison.Ordinal))
            throw new InvalidDataException("Некорректный адрес установщика.");
        string hash = data.ContainsKey("sha256") ? data["sha256"] as string : null;
        if (hash == null || !Regex.IsMatch(hash, @"\A[a-fA-F0-9]{64}\z")) throw new InvalidDataException("Нет контрольной суммы обновления.");
        long size = 0;
        if (data.ContainsKey("size")) {
            if (!(data["size"] is int) && !(data["size"] is long)) throw new InvalidDataException("Некорректный размер обновления.");
            size = Convert.ToInt64(data["size"]);
            if (size < 1024 || size > MaximumInstaller) throw new InvalidDataException("Некорректный размер обновления.");
        }
        return new DesktopUpdateInfo { Version = new Version(parsed.Major, parsed.Minor, parsed.Build, 0), DisplayVersion = version,
            Installer = installer, Sha256 = hash.ToLowerInvariant(), Size = size, Download = new Uri(Website + "/downloads/" + installer) };
    }

    internal async Task<DesktopUpdateInfo> CheckAsync(Version current, CancellationToken cancellation)
    {
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using (var response = await client.GetAsync(Website + "/downloads/" + Manifest + "?check=" + DateTime.UtcNow.Ticks, HttpCompletionOption.ResponseHeadersRead, timeout.Token)) {
                if (response.StatusCode != HttpStatusCode.OK) throw new IOException("Сервер обновлений временно недоступен.");
                if (response.Content.Headers.ContentLength > 65536) throw new InvalidDataException("Слишком большой ответ сервера.");
                using (var stream = await response.Content.ReadAsStreamAsync())
                using (var bytes = new MemoryStream()) {
                    var buffer = new byte[4096]; int read;
                    while ((read = await stream.ReadAsync(buffer, 0, buffer.Length, timeout.Token)) != 0) {
                        if (bytes.Length + read > 65536) throw new InvalidDataException("Слишком большой ответ сервера.");
                        bytes.Write(buffer, 0, read);
                    }
                    var info = Parse(Encoding.UTF8.GetString(bytes.ToArray()).TrimStart('\uFEFF'), Platform);
                    return info.Version > current ? info : null;
                }
            }
        }
    }

    internal static void Verify(string file, DesktopUpdateInfo info)
    {
        using (var stream = File.OpenRead(file)) {
            if (stream.Length < 1024 || stream.Length > MaximumInstaller || (info.Size != 0 && stream.Length != info.Size))
                throw new InvalidDataException("Размер обновления не совпал. Повторите загрузку.");
            using (var hash = SHA256.Create()) {
                var actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (!String.Equals(actual, info.Sha256, StringComparison.Ordinal)) throw new InvalidDataException("Проверка обновления не пройдена. Повторите загрузку.");
            }
        }
    }

    internal async Task<string> DownloadAsync(DesktopUpdateInfo info, IProgress<int> progress, CancellationToken cancellation)
    {
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
            timeout.CancelAfter(TimeSpan.FromMinutes(15));
            return await DownloadCoreAsync(info, progress, timeout.Token);
        }
    }

    private async Task<string> DownloadCoreAsync(DesktopUpdateInfo info, IProgress<int> progress, CancellationToken cancellation)
    {
        // A fresh private cache folder also prevents mistaking an old partial file for an installer.
        string folder = Path.Combine(directory, "package-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(folder);
        string final = Path.Combine(folder, info.Installer), partial = final + ".part";
        try {
            using (var response = await client.GetAsync(info.Download, HttpCompletionOption.ResponseHeadersRead, cancellation)) {
                if (response.StatusCode != HttpStatusCode.OK) throw new IOException("Не удалось скачать обновление.");
                long announced = response.Content.Headers.ContentLength ?? 0;
                if (announced > MaximumInstaller || (info.Size != 0 && announced != 0 && announced != info.Size)) throw new InvalidDataException("Размер обновления не совпал.");
                using (var source = await response.Content.ReadAsStreamAsync())
                using (var destination = new FileStream(partial, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, true)) {
                    var buffer = new byte[65536]; long total = 0; int read;
                    while ((read = await source.ReadAsync(buffer, 0, buffer.Length, cancellation)) != 0) {
                        total += read;
                        if (total > MaximumInstaller || (info.Size != 0 && total > info.Size)) throw new InvalidDataException("Обновление превышает заявленный размер.");
                        await destination.WriteAsync(buffer, 0, read, cancellation);
                        long expected = info.Size != 0 ? info.Size : announced;
                        if (progress != null) progress.Report(expected > 0 ? (int)Math.Min(99, total * 100 / expected) : -1);
                    }
                }
            }
            await Task.Run(delegate { Verify(partial, info); }, cancellation);
            cancellation.ThrowIfCancellationRequested();
            File.Move(partial, final);
            if (progress != null) progress.Report(100);
            return final;
        } catch {
            try { File.Delete(partial); File.Delete(final); Directory.Delete(folder, false); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            throw;
        }
    }

    internal void CleanOldDownloads()
    {
        if (!Directory.Exists(directory)) return;
        foreach (string folder in Directory.GetDirectories(directory, "package-*")) {
            try {
                if (!Regex.IsMatch(Path.GetFileName(folder), @"^package-[a-f0-9]{32}$") ||
                    (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0 || Directory.GetLastWriteTimeUtc(folder) > DateTime.UtcNow.AddDays(-7)) continue;
                foreach (string file in Directory.GetFiles(folder)) {
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0 && Regex.IsMatch(Path.GetFileName(file), @"^Nearby-\d+\.\d+\.\d+-windows-x64-setup\.exe(?:\.part)?$")) File.Delete(file);
                }
                if (Directory.GetFileSystemEntries(folder).Length == 0) Directory.Delete(folder, false);
            } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
    }
    public void Dispose() { client.Dispose(); }
}
