using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
internal static class DesktopParityNativeHarness {
    [STAThread] private static void Main(string[] args) {
        string root = args[0];
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        using (var window = new NearbyWindow(directory => new DesktopUpdates(Path.Combine(root, "update-cache"), new UpdateFakeHttp()), null, file => File.AppendAllText(Path.Combine(root, "opened.txt"), file + "\n"))) {
            window.Opacity = 0; window.ShowInTaskbar = false; var handle = window.Handle;
            Task.Run(delegate { Console.ReadLine(); if (!window.IsDisposed) window.BeginInvoke((Action)delegate { window.Close(); }); });
            Application.Run(window);
        }
    }
}
