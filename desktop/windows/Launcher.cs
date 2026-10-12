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
[assembly: System.Reflection.AssemblyVersion("0.2.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.2.0.0")]

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        bool acquired;
        using (var singleInstance = new Mutex(true, "Local\\Nearby.Transfer.Windows", out acquired))
        {
            if (!acquired)
            {
                MessageBox.Show("Nearby уже запущен. Откройте его окно на панели задач.", "Nearby");
                return;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new NearbyWindow());
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

    public NearbyWindow()
    {
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
        Load += async delegate { await StartAsync(); };
        FormClosing += delegate { shuttingDown = true; StopEngine(); };
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
            if (await Task.WhenAny(line, Task.Delay(15000)) != line) throw new IOException("Превышено время запуска движка передачи.");
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
            web.CoreWebView2.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri target;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != origin) e.Cancel = true;
            };
            web.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e) { e.State = CoreWebView2PermissionState.Deny; };
            web.CoreWebView2.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs e) {
                var deferral = e.GetDeferral();
                try {
                    using (var dialog = new SaveFileDialog()) {
                        dialog.InitialDirectory = receive;
                        dialog.FileName = Path.GetFileName(e.ResultFilePath);
                        dialog.OverwritePrompt = true;
                        if (dialog.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = dialog.FileName;
                        else e.Cancel = true;
                    }
                } finally { deferral.Complete(); }
            };
            web.CoreWebView2.Navigate(address.AbsoluteUri);
            web.Visible = true; loading.Visible = false;
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
