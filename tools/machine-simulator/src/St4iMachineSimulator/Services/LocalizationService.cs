using System.Linq;
using System.Windows;

namespace St4iMachineSimulator.Services;

/// <summary>
/// Task 20 — vi/en localization. Owns which <c>i18n/Strings.&lt;code&gt;.xaml</c> ResourceDictionary is
/// merged into <see cref="Application.Resources"/>'s <c>MergedDictionaries</c>. Every visible-chrome
/// string in the shell/screens (nav titles, top-bar labels, screen headers, primary buttons) is a
/// <c>{DynamicResource Str_*}</c> lookup in XAML against that dictionary — WPF's DynamicResource
/// re-evaluates automatically the instant the merged dictionary changes, so most of the UI needs no
/// extra plumbing at all once <see cref="SetLanguage"/> swaps it.
///
/// This class exists for the two things a bare DynamicResource swap can't do on its own:
/// <list type="bullet">
/// <item>tracking which language is active right now (<see cref="CurrentLanguage"/>) — read by
/// <c>SettingsViewModel.Language</c> and by <c>--selftest</c>;</item>
/// <item><see cref="LanguageChanged"/> + <see cref="GetString"/> for the handful of strings that are set
/// once in C#, not bound live in XAML — <c>KpiViewModel.Label</c> (built by <c>FleetViewModel</c>) and
/// <c>NavItem.Title</c> (built by <c>AppShellViewModel</c>'s <c>Nav</c> collection) both re-pull their
/// text through this on every language switch.</item>
/// </list>
///
/// A plain static class (like <see cref="Infrastructure.DispatcherHelper"/>) rather than a DI service —
/// nothing here holds per-instance state beyond "which language is active", and every call site
/// (ViewModels constructed well before/after each other, XAML markup extensions) needs the SAME answer
/// regardless of DI resolution order.
/// </summary>
public static class LocalizationService
{
    /// <summary>Vietnamese is the exhibit's primary language (doc 62 §10) — every fallback in this class
    /// resolves here, and <see cref="Initialize"/> merges this dictionary first.</summary>
    public const string DefaultLanguage = "vi";

    private const string DictionaryPathFormat = "i18n/Strings.{0}.xaml";

    public static string CurrentLanguage { get; private set; } = DefaultLanguage;

    /// <summary>Fires once a language switch has fully applied (merged dictionary swapped,
    /// <see cref="CurrentLanguage"/> updated). NOT raised by <see cref="Initialize"/>'s own first merge —
    /// nothing has constructed a Nav/Kpi collection to refresh yet at that point, and every such
    /// collection already builds its INITIAL text straight off <see cref="GetString"/> anyway.</summary>
    public static event Action<string>? LanguageChanged;

    /// <summary>Merges the default-language dictionary. Called once, at the very top of
    /// <c>App.OnStartup</c> — before <c>ConfigureServices</c>/<c>BuildServiceProvider</c> constructs
    /// anything that reads a string resource (every ViewModel's Nav/Kpi text, every screen's XAML) — so
    /// both the real UI and the headless <c>--selftest</c> path always find a Strings dictionary
    /// present.</summary>
    public static void Initialize() => Apply(DefaultLanguage, raiseEvent: false);

    /// <summary>Swaps the merged Strings dictionary to <paramref name="code"/> ("en" case-insensitively;
    /// anything else — including "vi", an empty string, or a typo — falls back to
    /// <see cref="DefaultLanguage"/>). Idempotent: re-applying the language that's already active is a
    /// cheap no-op (matters because <c>SettingsViewModel.Language</c>'s ComboBox binding can call this
    /// more than once for the same selection).</summary>
    public static void SetLanguage(string code) => Apply(code, raiseEvent: true);

    private static void Apply(string code, bool raiseEvent)
    {
        var normalized = string.Equals(code, "en", StringComparison.OrdinalIgnoreCase) ? "en" : DefaultLanguage;
        var app = Application.Current;
        if (app is null)
        {
            // No Application instance (e.g. a future unit test constructing this in isolation, outside
            // any WPF host) — still track the intended language so GetString's fallback behaves
            // predictably, but there is no ResourceDictionary to swap.
            CurrentLanguage = normalized;
            return;
        }

        var merged = app.Resources.MergedDictionaries;
        if (normalized == CurrentLanguage && merged.Any(IsStringsDictionary))
        {
            return; // already applied — skip the teardown/rebuild + DynamicResource re-evaluation churn
        }

        var newDict = new ResourceDictionary
        {
            Source = new Uri(string.Format(DictionaryPathFormat, normalized), UriKind.Relative),
        };

        for (var i = merged.Count - 1; i >= 0; i--)
        {
            if (IsStringsDictionary(merged[i])) merged.RemoveAt(i);
        }

        merged.Add(newDict);
        CurrentLanguage = normalized;

        if (raiseEvent) LanguageChanged?.Invoke(normalized);
    }

    private static bool IsStringsDictionary(ResourceDictionary dict) =>
        dict.Source?.OriginalString.Contains("i18n/Strings.", StringComparison.OrdinalIgnoreCase) == true;

    /// <summary>Looks up a <c>Str_*</c> resource for code-side owners that can't use
    /// <c>{DynamicResource}</c> directly (see class remarks). Falls back to the key itself rather than
    /// throwing or returning null — a missing/typo'd key then shows up as visibly wrong text
    /// ("Str_Kpi_Whatever" on screen) instead of crashing the shell.</summary>
    public static string GetString(string key) => Application.Current?.Resources[key] as string ?? key;
}
