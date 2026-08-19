using System.Text.Json;

namespace DshStackLauncher;

/// <summary>
/// Tunables the person running the stack may want to change without
/// recompiling — currently just how long the proxy waits for a `dsh`
/// headless run before killing it. Stored as JSON next to the exe so it
/// survives an update (a rebuild overwrites the exe, never this file).
/// </summary>
public sealed class LauncherSettings
{
    /// <summary>
    /// Milliseconds the proxy waits for one /v1 request before it kills the
    /// dsh subprocess. A long clinical-record analysis on a local 12B model
    /// can run well past a short default; 10 minutes is the starting point.
    /// </summary>
    public int ProxyTimeoutMs { get; set; } = 600_000;

    /// <summary>Read-only note written into the file so it explains itself when opened.</summary>
    public string GhiChuProxyTimeoutMs =>
        "Số mili-giây proxy chờ dsh trả lời trước khi huỷ yêu cầu. 600000 = 10 phút.";

    /// <summary>
    /// Load settings from <paramref name="path"/>, creating the file with
    /// defaults on first run. A missing or unreadable file falls back to
    /// defaults rather than stopping the launcher — a bad settings file must
    /// not be able to prevent the stack from starting.
    /// </summary>
    public static LauncherSettings Load(string path)
    {
        if (!File.Exists(path))
        {
            var defaults = new LauncherSettings();
            defaults.Save(path);
            return defaults;
        }

        try
        {
            string json = File.ReadAllText(path);
            var loaded = JsonSerializer.Deserialize<LauncherSettings>(json);
            if (loaded is null) return new LauncherSettings();
            if (loaded.ProxyTimeoutMs <= 0) loaded.ProxyTimeoutMs = new LauncherSettings().ProxyTimeoutMs;
            return loaded;
        }
        catch
        {
            return new LauncherSettings();
        }
    }

    /// <summary>Write settings back to disk, formatted for hand-editing.</summary>
    public void Save(string path)
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        File.WriteAllText(path, JsonSerializer.Serialize(this, options));
    }
}
