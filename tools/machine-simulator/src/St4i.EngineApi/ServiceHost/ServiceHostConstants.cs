namespace St4i.EngineApi.ServiceHost;

/// <summary>WS-F1-T1 — the identity this exe registers under with the Windows Service Control Manager,
/// shared between two independent call sites that must never disagree: <c>Program.cs</c>'s
/// <c>builder.Services.AddWindowsService(o => o.ServiceName = ...)</c> (what the RUNNING process
/// identifies itself as to the SCM once started) and <see cref="ServiceInstallVerbs"/>'s
/// <c>sc.exe create</c>/<c>delete</c> arg builders (what gets REGISTERED/UNREGISTERED). A single shared
/// constant means an install always matches the name the running service reports, and vice versa.</summary>
public static class ServiceHostConstants
{
    /// <summary>The internal SCM service key (`sc.exe`'s <c>serviceName</c> argument, `services.msc`'s
    /// "Service name" column) — no spaces, matches the product's other internal identifiers.</summary>
    public const string ServiceName = "St4iEngineApi";

    /// <summary>The human-readable name shown in `services.msc`'s "Name" column and Task Manager's
    /// Services tab.</summary>
    public const string DisplayName = "ST4I Machine Simulator Engine";

    /// <summary>Shown in `services.msc`'s "Description" column — set via a follow-up
    /// <c>sc description</c> call at install time (sc.exe's <c>create</c> verb itself has no description
    /// switch).</summary>
    public const string Description =
        "Hosts the ST4I Machine Simulator engine (fleet simulation, historian, HTTP/WebSocket API for the web UI). "
        + "Runs continuously in the background; safe to stop/start via services.msc or `sc stop`/`sc start`.";
}
