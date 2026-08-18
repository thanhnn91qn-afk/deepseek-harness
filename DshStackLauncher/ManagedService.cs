using System.Diagnostics;

namespace DshStackLauncher;

/// <summary>One child process (node web UI or node proxy) with its own status.</summary>
sealed class ManagedService
{
    public string Label { get; }
    public string Url { get; }
    public Process? Process { get; private set; }
    public DateTime? StartedAt { get; private set; }
    public int? LastExitCode { get; private set; }

    private readonly string _fileName;
    private readonly string _arguments;
    private readonly string _workingDirectory;
    private readonly IReadOnlyDictionary<string, string> _env;
    private readonly JobObject _job;
    private readonly Action<string> _onLogLine;

    public ManagedService(
        string label, string url, string fileName, string arguments, string workingDirectory,
        IReadOnlyDictionary<string, string> env, JobObject job, Action<string> onLogLine)
    {
        Label = label;
        Url = url;
        _fileName = fileName;
        _arguments = arguments;
        _workingDirectory = workingDirectory;
        _env = env;
        _job = job;
        _onLogLine = onLogLine;
    }

    public bool IsRunning => Process is { HasExited: false };

    /// <summary>Reconciles cached state with the OS; call once per UI tick.</summary>
    public bool PollRunning()
    {
        if (Process is null) return false;
        if (!Process.HasExited) return true;

        LastExitCode = Process.ExitCode;
        Process = null;
        StartedAt = null;
        return false;
    }

    public void Start()
    {
        if (PollRunning()) return;

        var psi = new ProcessStartInfo
        {
            FileName = _fileName,
            Arguments = _arguments,
            WorkingDirectory = _workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var (key, value) in _env) psi.Environment[key] = value;

        var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) _onLogLine($"[{Label}] {e.Data}"); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) _onLogLine($"[{Label}] {e.Data}"); };

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            _onLogLine($"[{Label}] failed to start: {ex.Message}");
            return;
        }

        _job.Assign(process);
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        Process = process;
        StartedAt = DateTime.Now;
        _onLogLine($"[{Label}] started (pid {process.Id})");
    }

    public void Stop()
    {
        if (Process is null) return;
        try
        {
            if (!Process.HasExited) Process.Kill(entireProcessTree: true);
            Process.WaitForExit(3000);
        }
        catch
        {
            // Process may have already exited between the check and the kill.
        }
        Process = null;
        StartedAt = null;
        _onLogLine($"[{Label}] stopped");
    }
}
