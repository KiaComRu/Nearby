using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Diagnostics;
using Microsoft.Win32;

internal static class ShellNativeHarness
{
    [STAThread]
    private static void Main(string[] files)
    {
        if (files.Length == 3 && files[0] == "--invoke-verb") {
            string verb = "Nearby.Send.Smoke." + Guid.NewGuid().ToString("N");
            string key = "Software\\Classes\\*\\shell\\" + verb;
            try {
                using (var entry = Registry.CurrentUser.CreateSubKey(key)) {
                    entry.SetValue("", "Nearby shell smoke test");
                    entry.SetValue("MultiSelectModel", "Player");
                    using (var command = entry.CreateSubKey("command")) command.SetValue("", "\"" + files[1] + "\" --send \"%1\"");
                }
                using (var activation = Process.Start(new ProcessStartInfo(files[2]) { UseShellExecute = true, Verb = verb, WindowStyle = ProcessWindowStyle.Hidden })) {
                    if (activation != null && (!activation.WaitForExit(15000) || activation.ExitCode != 0)) throw new Exception("Shell verb activation failed.");
                }
            } finally { Registry.CurrentUser.DeleteSubKeyTree(key, false); }
            return;
        }
        bool acquired;
        using (var mutex = new Mutex(true, "Local\\" + ShellInbox.Name, out acquired)) {
            if (!acquired) throw new InvalidOperationException("Close the test instance first.");
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new NearbyWindow()) {
                // Exercise the real WinForms/WebView2 launcher without a visible test window.
                window.Opacity = 0; window.ShowInTaskbar = false;
                var handle = window.Handle;
                using (var inbox = new ShellInbox(selection => window.BeginInvoke((Action)delegate { window.QueueShellFiles(selection); }))) {
                    window.QueueShellFiles(files);
                    Task.Run(delegate { Console.ReadLine(); if (!window.IsDisposed) window.BeginInvoke((Action)delegate { window.Close(); }); });
                    Application.Run(window);
                }
            }
        }
    }
}
