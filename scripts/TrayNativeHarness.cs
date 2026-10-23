using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class TrayNativeHarness
{
    private static object Field(NearbyWindow window, string name) { return typeof(NearbyWindow).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(window); }
    [STAThread] private static void Main(string[] args)
    {
        string root = args[0];
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new NearbyWindow(directory => new DesktopUpdates(Path.Combine(root, "update-cache"), new UpdateFakeHttp()), null, file => { })) {
            window.Opacity = 0; var handle = window.Handle;
            Task.Run(delegate {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    var command = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(line);
                    if (window.IsDisposed) break;
                    window.BeginInvoke((Action)delegate {
                        try {
                            string action = (string)command["command"];
                            var tray = (NotifyIcon)Field(window, "trayIcon");
                            if (action == "minimize") window.WindowState = FormWindowState.Minimized;
                            else if (action == "maximize") window.WindowState = FormWindowState.Maximized;
                            else if (action == "open") ((ToolStripMenuItem)tray.ContextMenuStrip.Items["nearby-tray-open"]).PerformClick();
                            else if (action == "shell") window.QueueShellFiles(new[] { (string)command["path"] });
                            else if (action == "reopen") window.QueueShellFiles(new string[0]);
                            else if (action == "exit") {
                                Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], exiting = true }));
                                ((ToolStripMenuItem)tray.ContextMenuStrip.Items["nearby-tray-exit"]).PerformClick(); return;
                            }
                            var engine = (Process)Field(window, "engine");
                            Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], visible = window.Visible, windowState = window.WindowState.ToString(), trayVisible = tray.Visible,
                                engineRunning = engine != null && !engine.HasExited, engineId = engine == null ? 0 : engine.Id, webReady = Field(window, "webReady") }));
                        } catch (Exception error) { Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], error = error.Message })); }
                    });
                }
                if (!window.IsDisposed) window.BeginInvoke((Action)delegate { window.Close(); });
            });
            Application.Run(window);
        }
    }
}
