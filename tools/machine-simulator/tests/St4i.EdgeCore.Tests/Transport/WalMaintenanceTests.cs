using System.Text;
using System.Text.Json;
using St4i.EdgeCore.Transport;
using Xunit;

namespace St4i.EdgeCore.Tests.Transport;

/// <summary>
/// WS-C-T5 — <see cref="WalMaintenance"/>: the drop-oldest size guardrail for <see cref="WalOptions.MaxBytes"/>,
/// mirroring the platform's own "overflow drops the OLDEST — never silently: counted + warned" store-forward
/// policy (see the repo-root <c>.env.example</c>'s <c>OT_STORE_FORWARD_ENABLED</c> remarks) at the SDK-WAL
/// layer. These tests are isolated — a single writer, no concurrent SDK access — proving pure correctness of
/// the trim algorithm itself; the best-effort behavior under a REAL concurrent SDK writer is a documented,
/// accepted trade-off (see <see cref="WalMaintenance"/>'s own class doc), not something re-proven here.
/// </summary>
public sealed class WalMaintenanceTests
{
    private static string TempFile() =>
        Path.Combine(Directory.CreateTempSubdirectory("st4i-wal-maintenance-tests-").FullName, "M1.jsonl");

    private static string Record(int i, int padLength = 8) =>
        JsonSerializer.Serialize(new { i, pad = new string('x', padLength) });

    private static long LineBytes(string line) => Encoding.UTF8.GetByteCount(line) + 1;

    [Fact]
    public void FileUnderMaxBytes_IsNoOp_ReturnsZero_ContentUnchanged()
    {
        var path = TempFile();
        var lines = Enumerable.Range(0, 5).Select(i => Record(i)).ToArray();
        var original = string.Join("\n", lines) + "\n";
        File.WriteAllText(path, original);

        var dropped = WalMaintenance.TrimFileToMaxBytes(path, maxBytes: 10_000);

        Assert.Equal(0, dropped);
        Assert.Equal(original, File.ReadAllText(path));
    }

    [Fact]
    public void FileOverMaxBytes_DropsOldestLines_KeepsNewestInOrder_FileNowFitsBudget()
    {
        var path = TempFile();
        var lines = Enumerable.Range(0, 10).Select(i => Record(i)).ToArray();
        File.WriteAllText(path, string.Join("\n", lines) + "\n");

        // Budget room for exactly the newest 3 lines (all records are the same length via Record()).
        var maxBytes = LineBytes(lines[^1]) * 3;

        var dropped = WalMaintenance.TrimFileToMaxBytes(path, maxBytes);

        Assert.Equal(7, dropped);
        var remaining = File.ReadAllLines(path).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Equal(3, remaining.Length);
        // Newest retained, FIFO order intact — the LAST 3 of the original 10, in original order.
        Assert.Equal(lines[^3..], remaining);
        Assert.True(remaining.Sum(LineBytes) <= maxBytes);
    }

    [Fact]
    public void SingleNewestLineAloneExceedsMaxBytes_KeepsOnlyThatLine_DropsAllOlderOnes()
    {
        var path = TempFile();
        var small1 = Record(1);
        var small2 = Record(2);
        var huge = Record(3, padLength: 500);
        File.WriteAllText(path, string.Join("\n", new[] { small1, small2, huge }) + "\n");

        // Smaller than `huge` alone, so even keeping just the newest line blows the budget.
        var maxBytes = LineBytes(small1);

        var dropped = WalMaintenance.TrimFileToMaxBytes(path, maxBytes);

        Assert.Equal(2, dropped); // small1 + small2 dropped — never silently: the count says so.
        var remaining = File.ReadAllLines(path).Where(l => l.Trim().Length > 0).ToArray();
        Assert.Single(remaining);
        Assert.Equal(huge, remaining[0]); // the newest single (oversized) record survives, not discarded.
    }

    [Fact]
    public void MissingFile_ReturnsZero_NoThrow()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-wal-maintenance-tests-").FullName;
        var path = Path.Combine(dir, "missing.jsonl");

        Assert.Equal(0, WalMaintenance.TrimFileToMaxBytes(path, maxBytes: 100));
    }

    [Fact]
    public void EmptyFile_ReturnsZero_NoThrow()
    {
        var path = TempFile();
        File.WriteAllText(path, string.Empty);

        Assert.Equal(0, WalMaintenance.TrimFileToMaxBytes(path, maxBytes: 1));
    }

    [Fact]
    public void WhitespaceOnlyFile_ReturnsZero_NoThrow()
    {
        var path = TempFile();
        File.WriteAllText(path, "   \n\n  \n");

        Assert.Equal(0, WalMaintenance.TrimFileToMaxBytes(path, maxBytes: 1));
    }

    [Fact]
    public void AfterTrim_RemainingFileIsValidJsonl_AndNoTempFileIsLeftBehind()
    {
        var path = TempFile();
        var lines = Enumerable.Range(0, 20).Select(i => Record(i)).ToArray();
        File.WriteAllText(path, string.Join("\n", lines) + "\n");
        var maxBytes = LineBytes(lines[^1]) * 5;

        var dropped = WalMaintenance.TrimFileToMaxBytes(path, maxBytes);

        Assert.True(dropped > 0);
        var remainingLines = File.ReadAllLines(path).Where(l => l.Trim().Length > 0).ToArray();
        Assert.NotEmpty(remainingLines);
        foreach (var line in remainingLines)
        {
            using var doc = JsonDocument.Parse(line); // throws on a partial/malformed line
            Assert.True(doc.RootElement.TryGetProperty("i", out _));
        }

        var dir = Path.GetDirectoryName(path)!;
        Assert.DoesNotContain(Directory.EnumerateFiles(dir), f => Path.GetFileName(f).Contains(".tmp-", StringComparison.Ordinal));
    }

    [Fact]
    public void TrimDirectory_TrimsEveryJsonlFile_ReturnsTotalDropped_AndOnlyTouchesJsonlFiles()
    {
        var dir = Directory.CreateTempSubdirectory("st4i-wal-maintenance-dir-tests-").FullName;

        var m1Lines = Enumerable.Range(0, 10).Select(i => Record(i)).ToArray();
        var m2Lines = Enumerable.Range(0, 2).Select(i => Record(i)).ToArray(); // stays under budget (2 lines < the 3-line budget below)
        var m1Path = Path.Combine(dir, "M1.jsonl");
        var m2Path = Path.Combine(dir, "M2.jsonl");
        var otherPath = Path.Combine(dir, "notes.txt");
        File.WriteAllText(m1Path, string.Join("\n", m1Lines) + "\n");
        File.WriteAllText(m2Path, string.Join("\n", m2Lines) + "\n");
        var otherOriginal = new string('y', 5000);
        File.WriteAllText(otherPath, otherOriginal);

        var maxBytes = LineBytes(m1Lines[^1]) * 3; // M1 way over, M2 comfortably under
        var options = new WalOptions { Directory = dir, MaxBytes = maxBytes };

        var totalDropped = WalMaintenance.TrimDirectory(options);

        Assert.Equal(7, totalDropped); // 10 - 3 kept from M1; M2 untouched (already under budget)
        Assert.Equal(3, File.ReadAllLines(m1Path).Count(l => l.Trim().Length > 0));
        Assert.Equal(2, File.ReadAllLines(m2Path).Count(l => l.Trim().Length > 0));
        Assert.Equal(otherOriginal, File.ReadAllText(otherPath)); // non-.jsonl file never touched
    }

    [Fact]
    public void TrimDirectory_MissingDirectory_ReturnsZero_NoThrow()
    {
        var options = new WalOptions
        {
            Directory = Path.Combine(Path.GetTempPath(), "st4i-wal-maintenance-missing-" + Guid.NewGuid().ToString("N")),
        };

        Assert.Equal(0, WalMaintenance.TrimDirectory(options));
    }
}
