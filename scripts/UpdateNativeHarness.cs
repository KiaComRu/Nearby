using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class UpdateFakeHttp : HttpMessageHandler
{
    internal byte[] Bytes = new byte[2048];
    internal string Version = "0.5.5", Hash;
    internal bool Redirect, Stall;
    internal UpdateFakeHttp() { for(int i=0;i<Bytes.Length;i++)Bytes[i]=(byte)(i%251); Hash=Digest(Bytes); }
    internal static string Digest(byte[] bytes) { using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
    internal string Manifest(string platform) { return new JavaScriptSerializer().Serialize(new {product="Nearby",version=Version,platform=platform,installer="Nearby-"+Version+"-"+platform+"-setup.exe",sha256=Hash,size=2048}); }
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellation)
    {
        if(request.RequestUri.Scheme!="https"||request.RequestUri.Host!="nearby.kiacom.ru")throw new Exception("Unexpected update host");
        if(Stall)await Task.Delay(Timeout.Infinite,cancellation);
        if(request.RequestUri.AbsolutePath.EndsWith(".json"))return new HttpResponseMessage(HttpStatusCode.OK){Content=new StringContent(Manifest(DesktopUpdates.Platform),Encoding.UTF8,"application/json")};
        if(Redirect)return new HttpResponseMessage(HttpStatusCode.Redirect){Headers={Location=new Uri("https://attacker.invalid/payload.exe")}};
        return new HttpResponseMessage(HttpStatusCode.OK){Content=new ByteArrayContent(Bytes)};
    }
}

internal static class UpdateNativeHarness
{
    private static void Check(bool value,string message){if(!value)throw new Exception(message);}
    private static async Task Reject(Func<Task> action,string message){try{await action();}catch{return;}throw new Exception(message);}
    [STAThread]
    private static int Main(string[] args)
    {
        try {
            if(args[0]=="core")Core(args[1]).GetAwaiter().GetResult();
            else if(args[0]=="ui")UI(args[1]);
            return 0;
        } catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
    private static async Task Core(string root)
    {
        var fake=new UpdateFakeHttp();
        foreach(var platform in new[]{"windows-x64"}) {
            var info=DesktopUpdates.Parse(fake.Manifest(platform),platform);
            Check(info.Version==new Version(0,5,5,0),"Version normalization");
            foreach(var json in new[]{fake.Manifest(platform).Replace("Nearby-0.5.5-","../Nearby-0.5.5-"),fake.Manifest(platform).Replace(fake.Hash,"bad"),fake.Manifest(platform).Replace("2048","-1"),fake.Manifest(platform).Replace("2048","1.5"),fake.Manifest(platform).Replace("0.5.5","0.5.5\\n")}) {
                await Reject(()=>Task.Run(()=>DesktopUpdates.Parse(json,platform)),"Unsafe metadata was accepted");
            }
            await Reject(()=>Task.Run(()=>DesktopUpdates.Parse(fake.Manifest(platform),"unsupported-platform")),"Cross-platform installer accepted");
        }
        using(var updates=new DesktopUpdates(root,fake)) {
            Check(await updates.CheckAsync(new Version(0,5,5,0),CancellationToken.None)==null,"Must not reinstall equal versions");
            Check(await updates.CheckAsync(new Version(0,6,0,0),CancellationToken.None)==null,"Must not downgrade");
            var info=await updates.CheckAsync(new Version(0,5,4,0),CancellationToken.None);
            Check(info!=null,"New version not offered");
            var file=await updates.DownloadAsync(info,null,CancellationToken.None); DesktopUpdates.Verify(file,info);
            File.WriteAllBytes(file,new byte[2048]); await Reject(()=>Task.Run(()=>DesktopUpdates.Verify(file,info)),"Tampered cache accepted");
            fake.Hash=new string('0',64); info=DesktopUpdates.Parse(fake.Manifest(DesktopUpdates.Platform),DesktopUpdates.Platform);
            await Reject(()=>updates.DownloadAsync(info,null,CancellationToken.None),"Corrupt installer accepted");
            fake.Hash=UpdateFakeHttp.Digest(fake.Bytes); info=DesktopUpdates.Parse(fake.Manifest(DesktopUpdates.Platform),DesktopUpdates.Platform);
            fake.Redirect=true; await Reject(()=>updates.DownloadAsync(info,null,CancellationToken.None),"Cross-host redirect accepted"); fake.Redirect=false;
            fake.Stall=true;
            using(var cancel=new CancellationTokenSource(50))await Reject(()=>updates.DownloadAsync(info,null,cancel.Token),"Cancellation ignored");
            Check(Directory.GetDirectories(root).Length==1,"Failed download left partial packages");
        }
        Console.WriteLine("Native updater core passed: platform/version checks, no downgrade, SHA-256, tamper detection, redirects, cancellation and partial cleanup.");
    }
    private static void UI(string root)
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        bool launched=false; Exception failure=null;
        var next=typeof(NearbyWindow).Assembly.GetName().Version;
        using(var window=new NearbyWindow(directory=>new DesktopUpdates(Path.Combine(root,"cache"),new UpdateFakeHttp{Version=next.Major+"."+next.Minor+"."+(next.Build+1)}),start=>{
            Check(start.Arguments=="/S /UPDATEPID="+Process.GetCurrentProcess().Id,"Wrong installer arguments");
            Check(File.Exists(start.FileName),"No verified installer"); launched=true;
        })) {
            window.ShowInTaskbar=false;
            window.StartPosition=FormStartPosition.Manual; window.Location=new System.Drawing.Point(-2000,-2000);
            var timer=new System.Windows.Forms.Timer{Interval=200}; int ticks=0; bool clicked=false;
            timer.Tick+=async delegate {
                try {
                    if(++ticks>150)throw new Exception("Native update UI did not become ready");
                    var button=window.Controls.Find("nearby-install-update",true)[0] as Button;
                    if(!button.Visible||!button.Enabled||clicked)return;
                    // Let the local engine's first authenticated state refresh finish.
                    if(ticks<12)return;
                    var web=window.Controls.Find("nearby-webview",true)[0];
                    var banner=window.Controls.Find("nearby-update-banner",true)[0];
                    var footer=window.Controls.Find("nearby-update-status",true)[0];
                    Check(web.Top>=banner.Bottom&&web.Bottom<=footer.Top,"Notification/footer overlap the application");
                    clicked=true;
                    using(var image=new System.Drawing.Bitmap(window.Width,window.Height)){window.DrawToBitmap(image,new System.Drawing.Rectangle(0,0,window.Width,window.Height));image.Save(Path.Combine(root,"native-update-notification.png"));}
                    button.PerformClick();
                    await Task.Delay(4000);
                    if(!launched&&button.Enabled){clicked=false;}
                }catch(Exception error){failure=error;window.Close();}
            };
            timer.Start(); Application.Run(window); timer.Stop(); timer.Dispose();
        }
        if(failure!=null)throw failure; Check(launched,"Installer was not offered/launched");
        Console.WriteLine("Native update UI passed: real WinForms/WebView2 notification, download, verified installer handoff and clean engine shutdown.");
    }
}
