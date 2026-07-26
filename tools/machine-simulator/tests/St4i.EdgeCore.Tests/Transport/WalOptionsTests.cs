using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// WS-C-T1 — <see cref="WalOptions"/>: default path resolution (WAL dir is a SIBLING of the historian
/// dir under <c>%ProgramData%\ST4I\sim\...</c>, never the same directory), deterministic queue-file
/// resolution (same inputs -&gt; same path, which is what lets a later RebuildLive preserve the on-disk
/// backlog), machineCode sanitization (no path traversal / invalid filename chars survive into the
/// resolved file name), the <c>ST4I_WAL_*</c> environment-variable overrides, and the reject-before-return
/// guardrail contract (<see cref="ArgumentOutOfRangeException"/>, never a silent clamp).
/// </summary>
public sealed class WalOptionsTests
{
    [Fact]
    public void ResolveDir_Default_EndsWithSt4iSimWal()
    {
        var options = new WalOptions();

        var dir = options.ResolveDir();

        Assert.EndsWith(Path.Combine("ST4I", "sim", "wal"), dir);
    }

    [Fact]
    public void ResolveQueueFile_Default_CombinesDirAndSanitizedNameWithJsonlExtension()
    {
        var options = new WalOptions();

        var file = options.ResolveQueueFile("SCRW-01");

        Assert.Equal(Path.Combine(options.ResolveDir(), "SCRW-01.jsonl"), file);
    }

    [Fact]
    public void ResolveQueueFile_CalledTwice_IsDeterministic()
    {
        var first = new WalOptions().ResolveQueueFile("AOI-01");
        var second = new WalOptions().ResolveQueueFile("AOI-01");

        Assert.Equal(first, second);
    }

    [Fact]
    public void ResolveQueueFile_MachineCodeWithInvalidFileNameChars_IsSanitizedToASingleFileSegment()
    {
        var options = new WalOptions();

        var file = options.ResolveQueueFile("A/B:C");

        // No path traversal / extra segments: the resolved file must live directly under ResolveDir(),
        // and none of the invalid characters may survive into the file name.
        Assert.Equal(options.ResolveDir(), Path.GetDirectoryName(file));
        var fileName = Path.GetFileName(file);
        Assert.DoesNotContain('/', fileName);
        Assert.DoesNotContain(':', fileName);
        Assert.EndsWith(".jsonl", fileName);
    }

    [Fact]
    public void ResolveDir_EnvOverride_ReturnsConfiguredDirectory()
    {
        var previous = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        try
        {
            var tempDir = Path.Combine(Path.GetTempPath(), "st4i-wal-tests-" + Guid.NewGuid().ToString("N"));
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", tempDir);

            var options = WalOptions.FromEnvironment();

            Assert.Equal(tempDir, options.ResolveDir());
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", previous);
        }
    }

    [Fact]
    public void FromEnvironment_WalEnabledFalse_DisablesWal()
    {
        var previous = Environment.GetEnvironmentVariable("ST4I_WAL_ENABLED");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_ENABLED", "false");

            var options = WalOptions.FromEnvironment();

            Assert.False(options.Enabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_ENABLED", previous);
        }
    }

    [Fact]
    public void FromEnvironment_WalMaxBytes_ParsesConfiguredValue()
    {
        var previous = Environment.GetEnvironmentVariable("ST4I_WAL_MAX_BYTES");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", "1048576");

            var options = WalOptions.FromEnvironment();

            Assert.Equal(1_048_576L, options.MaxBytes);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", previous);
        }
    }

    [Fact]
    public void FromEnvironment_NoEnvVarsSet_UsesDefaults()
    {
        var previousDir = Environment.GetEnvironmentVariable("ST4I_WAL_DIR");
        var previousEnabled = Environment.GetEnvironmentVariable("ST4I_WAL_ENABLED");
        var previousMaxBytes = Environment.GetEnvironmentVariable("ST4I_WAL_MAX_BYTES");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", null);
            Environment.SetEnvironmentVariable("ST4I_WAL_ENABLED", null);
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", null);

            var options = WalOptions.FromEnvironment();

            Assert.True(options.Enabled);
            Assert.Equal(64L * 1024 * 1024, options.MaxBytes);
            Assert.Equal(WalOptions.DefaultRoot(), options.ResolveDir());
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_DIR", previousDir);
            Environment.SetEnvironmentVariable("ST4I_WAL_ENABLED", previousEnabled);
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", previousMaxBytes);
        }
    }

    [Fact]
    public void Validate_MaxBytesZero_ThrowsArgumentOutOfRangeException()
    {
        var options = new WalOptions { MaxBytes = 0 };

        Assert.Throws<ArgumentOutOfRangeException>(() => options.Validate());
    }

    [Fact]
    public void Validate_NegativeMinRetentionHours_ThrowsArgumentOutOfRangeException()
    {
        var options = new WalOptions { MinRetentionHours = -1 };

        Assert.Throws<ArgumentOutOfRangeException>(() => options.Validate());
    }

    [Fact]
    public void Validate_MaxAgeHoursZeroOrNegative_ThrowsArgumentOutOfRangeException()
    {
        var options = new WalOptions { MaxAgeHours = 0 };

        Assert.Throws<ArgumentOutOfRangeException>(() => options.Validate());
    }

    [Fact]
    public void FromEnvironment_WalMaxBytesZero_ThrowsArgumentOutOfRangeException()
    {
        var previous = Environment.GetEnvironmentVariable("ST4I_WAL_MAX_BYTES");
        try
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", "0");

            Assert.Throws<ArgumentOutOfRangeException>(() => WalOptions.FromEnvironment());
        }
        finally
        {
            Environment.SetEnvironmentVariable("ST4I_WAL_MAX_BYTES", previous);
        }
    }

    // C-1 (Critical, WS-C final-review fix wave) — WalOptions.ResolveDir/ResolveQueueFile are pure path
    // arithmetic (see their own doc comments) and never touch disk; EnsureDir() is the one method that
    // actually creates the directory, mirroring CredentialStore.Save/SqliteHistorianStore's own
    // Directory.CreateDirectory idiom. Without it, a fresh install's first offline write throws
    // DirectoryNotFoundException (see TransportCoordinatorWalTests' end-to-end regression test for the
    // full failure chain) — this test covers EnsureDir() itself, directly and cheaply.
    [Fact]
    public void EnsureDir_DirectoryDoesNotExist_CreatesItAndReturnsResolvedPath()
    {
        var root = Directory.CreateTempSubdirectory("st4i-wal-ensuredir-tests-").FullName;
        var freshDir = Path.Combine(root, "not-created-yet");
        var options = new WalOptions { Directory = freshDir };
        Assert.False(Directory.Exists(freshDir));

        var result = options.EnsureDir();

        Assert.Equal(options.ResolveDir(), result);
        Assert.True(Directory.Exists(freshDir));
    }

    [Fact]
    public void EnsureDir_DirectoryAlreadyExists_IsANoOpAndDoesNotThrow()
    {
        var root = Directory.CreateTempSubdirectory("st4i-wal-ensuredir-tests-").FullName;
        var options = new WalOptions { Directory = root };

        var result = options.EnsureDir();

        Assert.Equal(root, result);
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void DefaultRoot_IsSiblingOfHistorianDefaultDir_NotTheSameDirectory()
    {
        var historianDefaultRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ST4I", "sim", "historian");

        var walDefaultRoot = WalOptions.DefaultRoot();

        Assert.NotEqual(historianDefaultRoot, walDefaultRoot);
        // Sibling: same parent ("ST4I\sim"), different leaf directory.
        Assert.Equal(Path.GetDirectoryName(historianDefaultRoot), Path.GetDirectoryName(walDefaultRoot));
    }
}
