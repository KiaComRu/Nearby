using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class TrayNativeHarness
{
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr handle, int message, IntPtr wparam, IntPtr lparam);
    private static void TrayMouse(NotifyIcon tray, int message)
    {
        var notificationWindow = (NativeWindow)typeof(NotifyIcon).GetField("window", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(tray);
        // Deliver the same notification-window callback used by Explorer.
        SendMessage(notificationWindow.Handle, 0x800, IntPtr.Zero, new IntPtr(message));
    }
    private static object Field(NearbyWindow window, string name) { return typeof(NearbyWindow).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(window); }
    [STAThread] private static void Main(string[] args)
    {
        string root = args[0];
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        var notifications = new List<Dictionary<string, string>>();
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new NearbyWindow(directory => new DesktopUpdates(Path.Combine(root, "update-cache"), new UpdateFakeHttp()), null, file => { }, (title, text) => notifications.Add(new Dictionary<string, string> { { "title", title }, { "text", text } }))) {
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
                            else if (action == "icon") { TrayMouse(tray, 0x201); TrayMouse(tray, 0x202); }
                            else if (action == "double-click") { TrayMouse(tray, 0x203); TrayMouse(tray, 0x202); }
                            else if (action == "notification-click") typeof(NotifyIcon).GetMethod("OnBalloonTipClicked", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(tray, null);
                            else if (action == "shell") window.QueueShellFiles(new[] { (string)command["path"] });
                            else if (action == "reopen") window.QueueShellFiles(new string[0]);
                            else if (action == "exit") {
                                Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], exiting = true }));
                                ((ToolStripMenuItem)tray.ContextMenuStrip.Items["nearby-tray-exit"]).PerformClick(); return;
                            }
                            var engine = (Process)Field(window, "engine");
                            Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], visible = window.Visible, windowState = window.WindowState.ToString(), trayVisible = tray.Visible,
                                engineRunning = engine != null && !engine.HasExited, engineId = engine == null ? 0 : engine.Id, webReady = Field(window, "webReady"), receiveNotifications = Field(window, "receiveNotifications"), notifications = notifications.ToArray() }));
                        } catch (Exception error) { Console.WriteLine(new JavaScriptSerializer().Serialize(new { id = command["id"], error = error.Message })); }
                    });
                }
                if (!window.IsDisposed) window.BeginInvoke((Action)delegate { window.Close(); });
            });
            Application.Run(window);
        }
    }
}
