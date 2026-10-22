using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: System.Reflection.AssemblyTitle("Nearby")]
[assembly: System.Reflection.AssemblyDescription("Передача файлов по локальной сети")]
[assembly: System.Reflection.AssemblyVersion("0.6.5.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.6.5.0")]
#if SERVER2016
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.6.2")]
#endif

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        string[] files = new string[0];
        if (args.Length > 0) {
            if (args[0] != "--send" || args.Length < 2 || args.Length > 101) {
                MessageBox.Show("Выберите до 100 файлов и используйте «Отправить через Nearby».", "Nearby"); return;
            }
            files = new string[args.Length - 1]; Array.Copy(args, 1, files, 0, files.Length);
        }
        bool acquired;
        using (var singleInstance = new Mutex(true, "Local\\" + ShellInbox.Name, out acquired))
        {
            if (!acquired)
            {
                if (!ShellInbox.Forward(files)) MessageBox.Show("Не удалось передать файлы открытому Nearby. Дождитесь запуска приложения и повторите команду.", "Nearby");
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new NearbyWindow()) {
                var handle = window.Handle;
                using (var inbox = new ShellInbox(selection => window.BeginInvoke((Action)delegate { window.QueueShellFiles(selection); }))) {
                    window.QueueShellFiles(files);
                    Application.Run(window);
                }
            }
        }
    }
}

internal sealed class NearbyWindow : Form
{
    private readonly WebView2 web = new WebView2();
    private readonly Label loading = new Label();
    private readonly StringBuilder errors = new StringBuilder();
    private Process engine;
    private bool shuttingDown;
    private bool engineStopping;
    private string origin;
    private bool webReady, applyingShellFiles;
    private readonly Action<string> openLocalFile;
    private readonly Dictionary<string, string> localFiles = new Dictionary<string, string>();
    private readonly List<string> shellFiles = new List<string>();
    private readonly System.Windows.Forms.Timer shellTimer = new System.Windows.Forms.Timer();
    private DateTime lastShellRequest;
    private readonly Panel updatePanel = new Panel();
    private readonly Label updateText = new Label();
    private readonly Button installUpdate = new Button();
    private readonly Button laterUpdate = new Button();
    private readonly ToolStripStatusLabel checkUpdate = new ToolStripStatusLabel("Проверить обновления");
    private readonly NotifyIcon updateNotification = new NotifyIcon();
    private readonly System.Windows.Forms.Timer updateTimer = new System.Windows.Forms.Timer();
    private readonly CancellationTokenSource updateCancellation = new CancellationTokenSource();
    private DesktopUpdates updater;
    private DesktopUpdateInfo availableUpdate;
    private bool checkingUpdate, downloadingUpdate;
    private string downloadedUpdate;
    private int activeDownloads;
    private bool engineUpdateUnavailable;
    private readonly Func<string, DesktopUpdates> updateFactory;
    private readonly Action<ProcessStartInfo> startInstaller;
    private readonly bool showNativeNotifications;

    internal void QueueShellFiles(string[] paths)
    {
        if (shuttingDown || !web.Enabled) return;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show(); Activate();
        foreach (string value in paths) {
            try {
                if (!Path.IsPathRooted(value) || !File.Exists(value)) throw new IOException();
                string file = Path.GetFullPath(value);
                if (!shellFiles.Exists(existing => String.Equals(existing, file, StringComparison.OrdinalIgnoreCase))) shellFiles.Add(file);
            } catch (Exception) { MessageBox.Show(this, "Файл недоступен или выбрана папка:\n" + value + "\n\nДля папки сначала создайте ZIP-архив.", "Nearby"); }
        }
        lastShellRequest = DateTime.UtcNow;
    }

    private async Task ApplyShellFiles()
    {
        if (!webReady || applyingShellFiles || shellFiles.Count == 0 || (DateTime.UtcNow - lastShellRequest).TotalMilliseconds < 500) return;
        applyingShellFiles = true;
        string[] files = shellFiles.GetRange(0, Math.Min(100, shellFiles.Count)).ToArray();
        shellFiles.RemoveRange(0, files.Length);
        try {
            var serializer = new JavaScriptSerializer();
            var document = serializer.Deserialize<Dictionary<string, object>>(await web.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
            var root = (Dictionary<string, object>)document["root"];
            var node = serializer.Deserialize<Dictionary<string, object>>(await web.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.querySelector", serializer.Serialize(new { nodeId = root["nodeId"], selector = "#shell-files" })));
            if (Convert.ToInt32(node["nodeId"]) == 0) throw new IOException("Перезапустите Nearby, чтобы открыть выбор получателя.");
            await web.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", serializer.Serialize(new { nodeId = node["nodeId"], files = files }));
            await web.CoreWebView2.ExecuteScriptAsync("document.dispatchEvent(new Event('nearby-shell-selection')); document.getElementById('shell-files').value = ''; ");
        } catch (Exception error) {
            MessageBox.Show(this, "Не удалось добавить файлы из Проводника. Повторите команду.\n\n" + error.Message, "Nearby");
        } finally { applyingShellFiles = false; }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHGetKnownFolderPath(ref Guid id, uint flags, IntPtr token, out IntPtr path);

    private static string DownloadsDirectory()
    {
        var id = new Guid("374DE290-123F-4565-9164-39C4925E467B");
        IntPtr pointer;
        if (SHGetKnownFolderPath(ref id, 0, IntPtr.Zero, out pointer) != 0)
            throw new IOException("Не удалось определить папку «Загрузки».");
        try { return Marshal.PtrToStringUni(pointer); }
        finally { Marshal.FreeCoTaskMem(pointer); }
    }

    public NearbyWindow() : this(null, null) { }

    internal NearbyWindow(Func<string, DesktopUpdates> updateFactory, Action<ProcessStartInfo> startInstaller) : this(updateFactory, startInstaller, null) { }

    internal NearbyWindow(Func<string, DesktopUpdates> updateFactory, Action<ProcessStartInfo> startInstaller, Action<string> openLocalFile)
    {
        this.openLocalFile = openLocalFile ?? (file => Process.Start(new ProcessStartInfo(file) { UseShellExecute = true }));
        this.updateFactory = updateFactory ?? (directory => new DesktopUpdates(directory));
        showNativeNotifications = updateFactory == null;
        this.startInstaller = startInstaller ?? (start => { if (Process.Start(start) == null) throw new IOException("Установщик не запустился."); });
        Text = "Nearby";
        Width = 1180; Height = 860;
        MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(245, 247, 241);
        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Nearby.ico");
        if (File.Exists(iconPath)) Icon = new Icon(iconPath);
        loading.Text = "Запускаем Nearby…";
        loading.Dock = DockStyle.Fill;
        loading.TextAlign = ContentAlignment.MiddleCenter;
        loading.Font = new Font("Segoe UI", 16);
        web.Dock = DockStyle.Fill;
        web.Visible = false;
        Controls.Add(web); Controls.Add(loading);
        BuildUpdateControls();
        web.BringToFront(); // Fill only the space left by the notification and status bar.
        Load += async delegate { await StartAsync(); };
        shellTimer.Interval = 300;
        shellTimer.Tick += async delegate { await ApplyShellFiles(); };
        shellTimer.Start();
        FormClosing += delegate {
            shuttingDown = true; updateCancellation.Cancel(); updateTimer.Stop(); updateTimer.Dispose();
            updateNotification.Dispose(); if (updater != null) updater.Dispose();
            shellTimer.Stop(); shellTimer.Dispose(); StopEngine();
        };
    }

    private void BuildUpdateControls()
    {
        var footer = new StatusStrip { Name = "nearby-update-status" };
        footer.Items.Add(new ToolStripStatusLabel("Nearby " + GetType().Assembly.GetName().Version.ToString(3)));
        footer.Items.Add(new ToolStripStatusLabel { Spring = true });
        checkUpdate.IsLink = true; checkUpdate.Click += async delegate { await CheckForUpdate(true); };
        footer.Items.Add(checkUpdate); Controls.Add(footer);
        updatePanel.Name = "nearby-update-banner";
        updatePanel.Dock = DockStyle.Top; updatePanel.Height = 66; updatePanel.Visible = false;
        web.Name = "nearby-webview";
        updatePanel.BackColor = Color.FromArgb(226, 241, 230); updatePanel.Padding = new Padding(12, 8, 12, 8);
        var actions = new FlowLayoutPanel { Dock = DockStyle.Right, Width = 210, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        installUpdate.Name = "nearby-install-update";
        installUpdate.Text = "Обновить"; installUpdate.Width = 100; installUpdate.Height = 34;
        laterUpdate.Text = "Позже"; laterUpdate.Width = 90; laterUpdate.Height = 34;
        actions.Controls.Add(installUpdate); actions.Controls.Add(laterUpdate);
        updateText.Dock = DockStyle.Fill; updateText.Font = new Font("Segoe UI", 10); updateText.TextAlign = ContentAlignment.MiddleLeft;
        updatePanel.Controls.Add(updateText); updatePanel.Controls.Add(actions); Controls.Add(updatePanel);
        updatePanel.BringToFront(); footer.BringToFront();
        installUpdate.Click += async delegate { await InstallAvailableUpdate(); };
        laterUpdate.Click += delegate { updatePanel.Visible = false; updateNotification.Visible = false; };
        updateNotification.Text = "Обновление Nearby";
        updateNotification.BalloonTipClicked += delegate { ShowUpdate(); };
        updateNotification.Click += delegate { ShowUpdate(); };
        updateTimer.Interval = 6 * 60 * 60 * 1000;
        updateTimer.Tick += async delegate { await CheckForUpdate(false); };
    }

    private void ShowUpdate()
    {
        if (shuttingDown) return;
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show(); Activate(); updatePanel.Visible = true;
    }

    private async Task CheckForUpdate(bool manual)
    {
        if (updater == null || checkingUpdate || downloadingUpdate || shuttingDown) return;
        checkingUpdate = true; checkUpdate.Enabled = false;
        try {
            var found = await updater.CheckAsync(GetType().Assembly.GetName().Version, updateCancellation.Token);
            if (shuttingDown) return;
            if (found == null) {
                if (manual) MessageBox.Show(this, "Установлена последняя версия Nearby.", "Обновление Nearby");
                return;
            }
            if (availableUpdate == null || availableUpdate.Version != found.Version) downloadedUpdate = null;
            availableUpdate = found;
            updateText.Text = "Доступна Nearby " + found.DisplayVersion + ".\nОбновитесь без удаления приложения и ваших файлов.";
            installUpdate.Text = downloadedUpdate == null ? "Обновить" : "Установить";
            updatePanel.Visible = true;
            if (showNativeNotifications) {
                updateNotification.Icon = Icon ?? SystemIcons.Information; updateNotification.Visible = true;
                updateNotification.ShowBalloonTip(8000, "Доступна Nearby " + found.DisplayVersion, "Нажмите, чтобы открыть предложение обновления.", ToolTipIcon.Info);
            }
        } catch (Exception) {
            if (manual && !shuttingDown) MessageBox.Show(this, "Не удалось проверить обновления. Проверьте интернет и повторите позже.", "Обновление Nearby");
        } finally { checkingUpdate = false; if (!shuttingDown) checkUpdate.Enabled = true; }
    }

    private async Task<bool> UpdateBusy()
    {
        if (!webReady || shellFiles.Count > 0 || applyingShellFiles || activeDownloads > 0) return true;
        return await web.CoreWebView2.ExecuteScriptAsync("Boolean(!window.nearbyUpdateBusy || window.nearbyUpdateBusy())") != "false";
    }

    private async Task<bool> PrepareEngineUpdate()
    {
        if (engineUpdateUnavailable) throw new IOException("Перезапустите Nearby и повторите обновление.");
        engine.StandardInput.WriteLine("prepare-update"); engine.StandardInput.Flush();
        var line = engine.StandardOutput.ReadLineAsync();
        if (await Task.WhenAny(line, Task.Delay(5000)) != line) {
            engineUpdateUnavailable = true;
            throw new IOException("Движок передачи не ответил. Перезапустите Nearby и повторите обновление.");
        }
        var reply = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(await line);
        return reply != null && reply.ContainsKey("updateReady") && (bool)reply["updateReady"];
    }

    private async Task InstallAvailableUpdate()
    {
        if (availableUpdate == null || downloadingUpdate || shuttingDown) return;
        downloadingUpdate = true; installUpdate.Enabled = false; laterUpdate.Enabled = false; checkUpdate.Enabled = false;
        bool frozen = false;
        try {
            if (downloadedUpdate == null) {
                var progress = new Progress<int>(value => { if (!shuttingDown) updateText.Text = value < 0 ? "Скачиваем обновление Nearby…" : "Скачиваем Nearby " + availableUpdate.DisplayVersion + ": " + value + "%"; });
                downloadedUpdate = await updater.DownloadAsync(availableUpdate, progress, updateCancellation.Token);
            }
            if (shuttingDown) return;
            if (await UpdateBusy()) {
                updateText.Text = "Обновление скачано. Завершите текущую передачу или отправку из Проводника, затем нажмите «Установить».";
                installUpdate.Text = "Установить"; return;
            }
            // Block new local gestures while the host atomically freezes incoming mutations.
            web.Enabled = false;
            frozen = true;
            if (!await PrepareEngineUpdate()) {
                frozen = false; web.Enabled = true;
                updateText.Text = "Обновление скачано. Дождитесь окончания передачи, затем нажмите «Установить».";
                installUpdate.Text = "Установить"; return;
            }
            await Task.Run(delegate { DesktopUpdates.Verify(downloadedUpdate, availableUpdate); }, updateCancellation.Token);
            if (shuttingDown) return;
            var start = new ProcessStartInfo(downloadedUpdate, "/S /UPDATEPID=" + Process.GetCurrentProcess().Id);
            start.UseShellExecute = false; start.CreateNoWindow = true; start.WorkingDirectory = Path.GetDirectoryName(downloadedUpdate);
            startInstaller(start);
            Close();
        } catch (Exception error) {
            if (!shuttingDown) {
                if (frozen) {
                    try { engine.StandardInput.WriteLine("cancel-update"); engine.StandardInput.Flush(); } catch { }
                }
                web.Enabled = true; downloadedUpdate = null;
                updateText.Text = "Обновление не установлено. Можно повторить попытку.";
                MessageBox.Show(this, "Не удалось обновить Nearby.\n\n" + error.Message, "Обновление Nearby");
            }
        } finally {
            downloadingUpdate = false;
            if (!shuttingDown) { installUpdate.Enabled = true; laterUpdate.Enabled = true; checkUpdate.Enabled = true; }
        }
    }

    private async Task StartAsync()
    {
        try
        {
            string basePath = AppDomain.CurrentDomain.BaseDirectory;
            string data = Environment.GetEnvironmentVariable("NEARBY_DATA_DIR");
            if (String.IsNullOrEmpty(data)) data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Nearby", "Data");
            string receive = Environment.GetEnvironmentVariable("NEARBY_RECEIVE_DIR");
            if (String.IsNullOrEmpty(receive)) receive = Path.Combine(DownloadsDirectory(), "Nearby");
            Directory.CreateDirectory(data); Directory.CreateDirectory(receive);
            updater = updateFactory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Nearby", "Updates"));
            try { updater.CleanOldDownloads(); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            updateTimer.Start();

            // Detect the runtime before starting a LAN listener.
            CoreWebView2Environment.GetAvailableBrowserVersionString();
            var start = new ProcessStartInfo(Path.Combine(basePath, "runtime", "node.exe"));
            start.Arguments = "\"" + Path.Combine(basePath, "app", "desktop", "windows", "host.mjs") + "\"";
            start.WorkingDirectory = Path.Combine(basePath, "app");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardOutput = true; start.RedirectStandardError = true; start.RedirectStandardInput = true;
            start.EnvironmentVariables["NEARBY_DATA_DIR"] = Path.GetFullPath(data);
            start.EnvironmentVariables["NEARBY_RECEIVE_DIR"] = Path.GetFullPath(receive);
            engine = new Process(); engine.StartInfo = start; engine.EnableRaisingEvents = true;
            engine.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
                if (e.Data != null) lock (errors) { if (errors.Length < 8000) errors.AppendLine(e.Data); }
            };
            engine.Exited += delegate {
                if (!shuttingDown && !engineStopping && IsHandleCreated && !IsDisposed)
                    BeginInvoke((Action)delegate { if (!shuttingDown && !engineStopping) { loading.Text = "Движок передачи остановлен. Закройте и снова откройте Nearby."; loading.Visible = true; loading.BringToFront(); } });
            };
            engine.Start(); engine.BeginErrorReadLine();
            Task<string> line = engine.StandardOutput.ReadLineAsync();
            if (await Task.WhenAny(line, Task.Delay(30000)) != line) throw new IOException("Превышено время запуска движка передачи.");
            string handshake = await line;
            if (String.IsNullOrEmpty(handshake)) throw new IOException("Движок не запустился. " + errors.ToString());
            var details = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(handshake);
            var address = new Uri((string)details["url"]);
            if (address.Scheme != "http" || address.Host != "127.0.0.1") throw new IOException("Некорректный адрес локального движка.");
            origin = address.GetLeftPart(UriPartial.Authority);
            var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "WebView2"));
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsPasswordAutosaveEnabled = false;
            web.CoreWebView2.Settings.IsGeneralAutofillEnabled = false;
            web.CoreWebView2.NavigationStarting += delegate { webReady = false; };
            web.CoreWebView2.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) { webReady = e.IsSuccess; };
            web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != origin) e.Cancel = true;
            };
            web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
                e.Handled = true;
                Uri target;
                if (e.IsUserInitiated && Uri.TryCreate(e.Uri, UriKind.Absolute, out target)
                    && target.Scheme == "https" && target.Host == "nearby.kiacom.ru" && target.Port == 443
                    && target.UserInfo == "" && target.AbsolutePath == "/web/" && target.Query == "" && (target.Fragment == "" || target.Fragment == "#mode=internet" || target.Fragment == "#mode=auto")) {
                    try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
                    catch (Exception) { MessageBox.Show(this, "Откройте https://nearby.kiacom.ru/web/ в браузере.", "Интернет-режим Nearby"); }
                }
            };
            web.CoreWebView2.WebMessageReceived += async delegate(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
                Uri source;
                if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.GetLeftPart(UriPartial.Authority) != origin || source.AbsolutePath != "/") return;
                try {
                    var serializer = new JavaScriptSerializer();
                    serializer.MaxJsonLength = 12 * 1024 * 1024;
                    var value = serializer.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                    string type = value.ContainsKey("type") ? value["type"] as string : null;
                    string id = value.ContainsKey("id") ? value["id"] as string : null;
                    if (String.IsNullOrEmpty(id) || id.Length > 100) return;
                    if (type == "nearby-register-file") {
                        bool ok = false;
                        string objectId = null;
                        try {
                            int index = Convert.ToInt32(value["index"]);
                            string input = value.ContainsKey("input") ? value["input"] as string : "files";
                            if (input != "files" && input != "shell-files") throw new InvalidOperationException();
                            if (index < 0 || index >= 10000 || localFiles.Count >= 2000) throw new InvalidOperationException();
                            var evaluated = serializer.Deserialize<Dictionary<string, object>>(await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.evaluate", serializer.Serialize(new { expression = "document.getElementById('" + input + "').files[" + index + "]" })));
                            var result = (Dictionary<string, object>)evaluated["result"];
                            objectId = result.ContainsKey("objectId") ? result["objectId"] as string : null;
                            if (objectId == null) throw new InvalidOperationException();
                            var info = serializer.Deserialize<Dictionary<string, object>>(await web.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getFileInfo", serializer.Serialize(new { objectId = objectId })));
                            string file = info["path"] as string;
                            if (!String.IsNullOrEmpty(file) && Path.IsPathRooted(file) && File.Exists(file)) { localFiles[id] = file; ok = true; }
                        } catch { /* Browser-only and drag-and-drop files retain their download fallback. */ }
                        if (objectId != null) try { await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.releaseObject", serializer.Serialize(new { objectId = objectId })); } catch {}
                        web.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { type = "nearby-file-registered", id = id, ok = ok }));
                    } else if (type == "nearby-file-preview") {
                        string base64 = null;
                        if (localFiles.ContainsKey(id)) {
                            string previewPath = localFiles[id];
                            base64 = await Task.Run(delegate {
                                try {
                                    string ext = Path.GetExtension(previewPath).ToLowerInvariant();
                                    if (Array.IndexOf(new string[] { ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp" }, ext) < 0) return null;
                                    using (var stream = new FileStream(previewPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) {
                                        if (stream.Length < 1 || stream.Length > 8 * 1024 * 1024) return null;
                                        byte[] bytes = new byte[(int)stream.Length]; int offset = 0;
                                        while (offset < bytes.Length) { int count = stream.Read(bytes, offset, bytes.Length - offset); if (count == 0) return null; offset += count; }
                                        return Convert.ToBase64String(bytes);
                                    }
                                } catch { return null; }
                            });
                        }
                        web.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new { type = "nearby-file-preview", id = id, base64 = base64 }));
                    } else if (type == "nearby-open-file" && localFiles.ContainsKey(id)) {
                        string file = localFiles[id];
                        if (!File.Exists(file)) throw new FileNotFoundException("Файл был перемещён или удалён.");
                        openLocalFile(file);
                    }
                } catch (Exception error) { MessageBox.Show(this, error.Message, "Открытие файла Nearby"); }
            };
            web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) {
                string recordId = null;
                Uri downloadUri;
                if (Uri.TryCreate(e.DownloadOperation.Uri, UriKind.Absolute, out downloadUri) && downloadUri.GetLeftPart(UriPartial.Authority) == origin
                    && (downloadUri.AbsolutePath == "/api/peer/download" || System.Text.RegularExpressions.Regex.IsMatch(downloadUri.AbsolutePath, @"^/api/shares/[a-f0-9-]{36}/download$"))) {
                    var match = System.Text.RegularExpressions.Regex.Match(downloadUri.Query, @"(?:[?&])nearbyFile=([a-f0-9-]{36})(?:&|$)");
                    Guid parsed;
                    if (match.Success && Guid.TryParse(match.Groups[1].Value, out parsed)) recordId = parsed.ToString();
                }
                string savedPath = null;
                activeDownloads++;
                bool finished = false;
                e.DownloadOperation.StateChanged += delegate {
                    if (!finished && e.DownloadOperation.State != CoreWebView2DownloadState.InProgress) {
                        finished = true; activeDownloads--;
                        if (recordId != null && savedPath != null && e.DownloadOperation.State == CoreWebView2DownloadState.Completed) {
                            if (localFiles.Count < 2000) localFiles[recordId] = savedPath;
                            web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new { type = "nearby-download-complete", id = recordId, ok = true }));
                        }
                    }
                };
                var deferral = e.GetDeferral();
                try {
                    // The connected device already has permission to exchange files.
                    // A unique destination prevents replacing an existing download.
                    Directory.CreateDirectory(receive);
                    e.ResultFilePath = Path.Combine(receive, Guid.NewGuid().ToString() + "-" + Path.GetFileName(e.ResultFilePath));
                    savedPath = e.ResultFilePath;
                    e.Handled = true;
                } finally { deferral.Complete(); }
            };
            web.CoreWebView2.Navigate(address.AbsoluteUri);
            web.Visible = true; loading.Visible = false;
            await CheckForUpdate(false);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            StopEngine();
            loading.Text = "Для работы нужен Microsoft Edge WebView2 Runtime.\n\nУстановите его с официального сайта Microsoft и снова откройте Nearby.";
            var link = new LinkLabel(); link.Text = "Открыть страницу Microsoft WebView2";
            link.Dock = DockStyle.Bottom; link.Height = 60; link.TextAlign = ContentAlignment.MiddleCenter;
            link.LinkClicked += delegate { Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/") { UseShellExecute = true }); };
            Controls.Add(link); link.BringToFront();
        }
        catch (Exception error)
        {
            StopEngine(); loading.Text = "Не удалось запустить Nearby.\n\n" + error.Message;
        }
    }

    private void StopEngine()
    {
        engineStopping = true;
        if (engine == null) return;
        try {
            if (!engine.HasExited) {
                engine.StandardInput.WriteLine("stop"); engine.StandardInput.Close();
                if (!engine.WaitForExit(3000)) engine.Kill();
            }
        } catch (InvalidOperationException) { }
        catch (IOException) { try { if (!engine.HasExited) engine.Kill(); } catch { } }
    }
}
