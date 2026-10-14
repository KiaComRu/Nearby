using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// One private IPC endpoint per Windows user/session. No file paths or owner
// credentials are exposed on the LAN or written to an activation file.
internal sealed class ShellInbox : IDisposable
{
    internal static readonly string Name = "Nearby.Transfer." + WindowsIdentity.GetCurrent().User.Value + "." + Process.GetCurrentProcess().SessionId;
    private const int MaximumMessage = 1024 * 1024;
    private readonly Action<string[]> receive;
    private volatile bool disposed;
    private NamedPipeServerStream current;
    private readonly object gate = new object();

    internal ShellInbox(Action<string[]> receive)
    {
        this.receive = receive;
        Task.Run((Func<Task>)Listen);
    }

    internal static bool Forward(string[] files)
    {
        try {
            using (var pipe = new NamedPipeClientStream(".", Name, PipeDirection.InOut)) {
                pipe.Connect(10000);
                var reader = new BinaryReader(pipe, Encoding.UTF8, true);
                var writer = new BinaryWriter(pipe, Encoding.UTF8, true);
                int processId = reader.ReadInt32();
                AllowSetForegroundWindow(processId);
                byte[] data = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(files));
                if (data.Length > MaximumMessage) return false;
                writer.Write(data.Length); writer.Write(data); writer.Flush();
                return reader.ReadBoolean();
            }
        } catch (IOException) { return false; }
        catch (TimeoutException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool AllowSetForegroundWindow(int processId);

    private async Task Listen()
    {
        while (!disposed) {
            bool retry = false;
            try {
                var security = new PipeSecurity();
                var user = WindowsIdentity.GetCurrent().User;
                security.SetOwner(user);
                security.SetAccessRuleProtection(true, false);
                security.AddAccessRule(new PipeAccessRule(user, PipeAccessRights.FullControl, AccessControlType.Allow));
                using (var pipe = new NamedPipeServerStream(Name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous, 4096, 4096, security)) {
                    lock (gate) { if (disposed) return; current = pipe; }
                    await pipe.WaitForConnectionAsync();
                    Task read = Task.Run(delegate {
                        var reader = new BinaryReader(pipe, Encoding.UTF8, true);
                        var writer = new BinaryWriter(pipe, Encoding.UTF8, true);
                        writer.Write(Process.GetCurrentProcess().Id); writer.Flush();
                        int length = reader.ReadInt32();
                        if (length < 2 || length > MaximumMessage) throw new IOException("Invalid activation length.");
                        byte[] data = reader.ReadBytes(length);
                        if (data.Length != length) throw new IOException("Incomplete activation.");
                        var files = new JavaScriptSerializer().Deserialize<string[]>(new UTF8Encoding(false, true).GetString(data));
                        if (files == null || files.Length > 100) throw new IOException("Too many files.");
                        foreach (string file in files) if (String.IsNullOrWhiteSpace(file) || file.Length > 32767 || file.IndexOf('\0') >= 0) throw new IOException("Invalid file path.");
                        receive(files);
                        writer.Write(true); writer.Flush();
                    });
                    // A broken client must not hold the single-instance endpoint.
                    if (await Task.WhenAny(read, Task.Delay(5000)) != read) pipe.Dispose();
                    try { await read; } catch (Exception) { }
                }
            } catch (IOException) { retry = true; }
            catch (ObjectDisposedException) { }
            catch (UnauthorizedAccessException) { return; }
            finally { lock (gate) { current = null; } }
            if (retry && !disposed) await Task.Delay(100);
        }
    }

    public void Dispose()
    {
        lock (gate) { disposed = true; if (current != null) current.Dispose(); }
    }
}
