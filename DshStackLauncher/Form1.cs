using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Sockets;

namespace DshStackLauncher;

public partial class Form1 : Form
{
    private readonly JobObject _job = new();
    private readonly ManagedService _web;
    private readonly ManagedService _proxy;
    private readonly List<string> _log = new();
    private const int MaxLogLines = 1000;

    private TextBox _logBox = null!;
    private Panel _monitorPanel = null!;
    private Button _toggleMonitorBtn = null!;

    private Label _webStatus = null!, _webPid = null!, _webUptime = null!, _webExit = null!;
    private Label _proxyStatus = null!, _proxyPid = null!, _proxyUptime = null!, _proxyExit = null!;
    private Button _webStartStop = null!, _proxyStartStop = null!;

    public Form1()
    {
        InitializeComponent();

        string root = AppContext.BaseDirectory;
        // Support both layouts: the exe sitting at the deepseek-harness repo
        // root itself (apps/ is a direct child — the current repo layout,
        // where dsh-openai-proxy/ and DshStackLauncher/ are subfolders of the
        // harness repo), or an older layout where deepseek-harness/ is a
        // sibling folder next to the exe.
        string nestedHarnessDir = Path.Combine(root, "deepseek-harness");
        string harnessDir = File.Exists(Path.Combine(nestedHarnessDir, "apps", "cli", "lib", "bin.js"))
            ? nestedHarnessDir
            : root;
        string proxyDir = Path.Combine(root, "dsh-openai-proxy");
        string dshBin = Path.Combine(harnessDir, "apps", "cli", "lib", "bin.js");
        string proxyEntry = Path.Combine(proxyDir, "server.js");

        // Fork change: dsh web binds all interfaces here instead of upstream's
        // 127.0.0.1-only default, so it (and the proxy) are LAN-reachable with
        // no extra setup. dsh still checks the request's Host header against
        // an allowlist, so this machine's own LAN addresses go on
        // --trusted-host. No login on the web UI or the proxy — see
        // dsh-openai-proxy/README.md for the tradeoff this accepts.
        string webArgs = $"\"{dshBin}\" web --host 0.0.0.0";
        foreach (var ip in LocalLanAddresses()) webArgs += $" --trusted-host {ip}";

        _web = new ManagedService(
            "web", "http://127.0.0.1:3080",
            "node", webArgs, harnessDir,
            new Dictionary<string, string> { ["LMSTUDIO_API_KEY"] = "lm-studio" }, _job, AppendLog);

        _proxy = new ManagedService(
            "proxy", "http://127.0.0.1:8787/v1",
            "node", $"\"{proxyEntry}\"", proxyDir,
            new Dictionary<string, string> { ["LMSTUDIO_API_KEY"] = "lm-studio", ["BIND_HOST"] = "0.0.0.0" },
            _job, AppendLog);

        BuildUi();

        _web.Start();
        _proxy.Start();

        var timer = new System.Windows.Forms.Timer { Interval = 500 };
        timer.Tick += (_, _) => RefreshStatus();
        timer.Start();

        FormClosing += (_, _) =>
        {
            _web.Stop();
            _proxy.Stop();
            _job.Dispose();
        };
    }

    private void AppendLog(string line)
    {
        if (InvokeRequired) { BeginInvoke(() => AppendLog(line)); return; }
        _log.Add(line);
        if (_log.Count > MaxLogLines) _log.RemoveRange(0, _log.Count - MaxLogLines);
        _logBox.AppendText(line + Environment.NewLine);
    }

    /// <summary>This machine's LAN-facing IPv4 addresses, for dsh web's --trusted-host.</summary>
    private static IEnumerable<string> LocalLanAddresses()
    {
        try
        {
            return Dns.GetHostEntry(Dns.GetHostName()).AddressList
                .Where(ip => ip.AddressFamily == AddressFamily.InterNetwork)
                .Select(ip => ip.ToString())
                .Distinct();
        }
        catch
        {
            return [];
        }
    }

    private void RefreshStatus()
    {
        bool webRunning = _web.PollRunning();
        bool proxyRunning = _proxy.PollRunning();

        UpdateCard(_webStatus, _webPid, _webUptime, _webExit, _webStartStop, _web, webRunning);
        UpdateCard(_proxyStatus, _proxyPid, _proxyUptime, _proxyExit, _proxyStartStop, _proxy, proxyRunning);
    }

    private static void UpdateCard(
        Label status, Label pid, Label uptime, Label exit, Button startStop, ManagedService svc, bool running)
    {
        status.Text = running ? "● running" : "● stopped";
        status.ForeColor = running ? Color.FromArgb(46, 160, 67) : Color.FromArgb(200, 60, 60);
        pid.Text = $"PID: {(running ? svc.Process!.Id.ToString() : "-")}";
        uptime.Text = $"Uptime: {(running && svc.StartedAt is { } t ? FormatUptime(DateTime.Now - t) : "-")}";
        exit.Text = $"Last exit code: {(svc.LastExitCode?.ToString() ?? "-")}";
        startStop.Text = running ? "Stop" : "Start";
    }

    private static string FormatUptime(TimeSpan span)
    {
        if (span.TotalHours >= 1) return $"{(int)span.TotalHours}h {span.Minutes}m {span.Seconds}s";
        if (span.TotalMinutes >= 1) return $"{span.Minutes}m {span.Seconds}s";
        return $"{span.Seconds}s";
    }

    private void BuildUi()
    {
        Text = "DeepSeek Harness Stack";
        ClientSize = new Size(780, 540);
        MinimumSize = new Size(600, 400);

        var header = new Label
        {
            Text = "DeepSeek Harness Stack",
            Font = new Font(Font.FontFamily, 14, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(12, 10),
        };
        Controls.Add(header);

        _toggleMonitorBtn = new Button
        {
            Text = "Ẩn màn hình theo dõi",
            AutoSize = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
        };
        _toggleMonitorBtn.Location = new Point(ClientSize.Width - _toggleMonitorBtn.Width - 12, 12);
        _toggleMonitorBtn.Click += (_, _) => ToggleMonitor();
        Controls.Add(_toggleMonitorBtn);

        var webCard = BuildServiceCard("dsh web UI", _web, 12, out _webStatus, out _webPid, out _webUptime, out _webExit, out _webStartStop);
        var proxyCard = BuildServiceCard("OpenAI proxy", _proxy, 396, 46, out _proxyStatus, out _proxyPid, out _proxyUptime, out _proxyExit, out _proxyStartStop);
        Controls.Add(webCard);
        Controls.Add(proxyCard);

        var vaultLink = new LinkLabel { Text = "Nạp kiến thức vào vault (upload .docx/.pdf)", AutoSize = true, Location = new Point(12, 178) };
        vaultLink.Click += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo("http://127.0.0.1:8787/vault") { UseShellExecute = true }); } catch { /* ignore */ }
        };
        Controls.Add(vaultLink);

        _monitorPanel = new Panel
        {
            Location = new Point(12, 206),
            Size = new Size(ClientSize.Width - 24, ClientSize.Height - 216),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
        };
        var logLabel = new Label { Text = "Logs:", AutoSize = true, Location = new Point(0, 0) };
        _logBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Font = new Font(FontFamily.GenericMonospace, 9),
            Location = new Point(0, 20),
            Size = new Size(_monitorPanel.Width, _monitorPanel.Height - 20),
            Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right,
        };
        _monitorPanel.Controls.Add(logLabel);
        _monitorPanel.Controls.Add(_logBox);
        Controls.Add(_monitorPanel);
    }

    private Panel BuildServiceCard(
        string title, ManagedService svc, int x, out Label status, out Label pid, out Label uptime, out Label exit, out Button startStop)
        => BuildServiceCard(title, svc, x, 46, out status, out pid, out uptime, out exit, out startStop);

    private Panel BuildServiceCard(
        string title, ManagedService svc, int x, int y,
        out Label status, out Label pid, out Label uptime, out Label exit, out Button startStop)
    {
        var panel = new Panel
        {
            BorderStyle = BorderStyle.FixedSingle,
            Location = new Point(x, y),
            Size = new Size(372, 130),
        };

        var titleLabel = new Label { Text = title, Font = new Font(Font, FontStyle.Bold), AutoSize = true, Location = new Point(8, 6) };
        status = new Label { Text = "● stopped", AutoSize = true, Location = new Point(8, 26) };
        var link = new LinkLabel { Text = svc.Url, AutoSize = true, Location = new Point(8, 46) };
        link.Click += (_, _) =>
        {
            try { Process.Start(new ProcessStartInfo(svc.Url) { UseShellExecute = true }); } catch { /* ignore */ }
        };
        pid = new Label { Text = "PID: -", AutoSize = true, Location = new Point(8, 66) };
        uptime = new Label { Text = "Uptime: -", AutoSize = true, Location = new Point(140, 66) };
        exit = new Label { Text = "Last exit code: -", AutoSize = true, Location = new Point(8, 84) };

        var button = new Button { Text = "Stop", AutoSize = true, Location = new Point(8, 104) };
        button.Click += (_, _) =>
        {
            if (svc.IsRunning) svc.Stop(); else svc.Start();
            RefreshStatus();
        };
        startStop = button;

        panel.Controls.Add(titleLabel);
        panel.Controls.Add(status);
        panel.Controls.Add(link);
        panel.Controls.Add(pid);
        panel.Controls.Add(uptime);
        panel.Controls.Add(exit);
        panel.Controls.Add(button);
        return panel;
    }

    private void ToggleMonitor()
    {
        _monitorPanel.Visible = !_monitorPanel.Visible;
        _toggleMonitorBtn.Text = _monitorPanel.Visible ? "Ẩn màn hình theo dõi" : "Hiện màn hình theo dõi";
    }
}
