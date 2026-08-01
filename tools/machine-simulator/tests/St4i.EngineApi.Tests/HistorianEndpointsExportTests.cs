using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using St4i.EdgeCore.Historian;
using St4i.EngineApi.Endpoints;
using St4i.EngineApi.Fleet;
using Xunit;

namespace St4i.EngineApi.Tests;

/// <summary>
/// Task 10 (WS-A) — endpoint coverage for the CSV export surface (<c>GET
/// /v1/historian/results/export.csv</c>), calling the <c>internal</c> handler method directly, same
/// "hand-construct the exact store type, no TestServer" pattern <see cref="HistorianEndpointsReadTests"/>
/// already established for the historian read surface. Because the handler returns a hand-rolled
/// <c>IResult</c> that writes headers/bytes straight onto <see cref="HttpContext.Response"/> (never a
/// built-in <c>Results.File</c>/<c>FileContentHttpResult</c> — that type requires
/// <c>HttpContext.RequestServices</c> to resolve an <c>ILoggerFactory</c>, which a hand-built
/// <see cref="DefaultHttpContext"/> never has), these tests execute the returned <c>IResult</c> against a
/// hand-built <see cref="DefaultHttpContext"/> (mirroring <see cref="MachineSettingsEndpointsTests"/>'s own
/// hand-built-context convention, just applied to the response side instead of the request side) to read
/// back the actual <c>Content-Type</c>/<c>Content-Disposition</c> headers and body bytes.
/// </summary>
public sealed class HistorianEndpointsExportTests
{
    private static string TempDir() => Directory.CreateTempSubdirectory("st4i-historian-export-tests-").FullName;

    private static SqliteHistorianStore NewStore() => new(TempDir());

    private static HistorianResultRecord MakeRecord(
        string machineCode, string serialNumber, string verdict, DateTimeOffset eventTimeUtc,
        string? recipeCode = "RC-A") =>
        new(
            MachineCode: machineCode, DeviceClass: "AoiAvi", MachineType: "AOI", ReadingKind: "ProcessResult",
            CycleCounter: 1, SerialNumber: serialNumber, Verdict: verdict,
            RecipeCode: recipeCode, RecipeVersion: "1",
            KeyMetricName: "Exposure", KeyMetricValue: 120.5, KeyMetricUnit: "us",
            NgCount: verdict == "Fail" ? 1 : 0, PointCount: 6,
            AckSuccess: true, AckDuplicate: false, AckQueued: false,
            GenealogyJson: null, MeasurementsJson: null,
            EventTimeUtc: eventTimeUtc, IngestedAtUtc: eventTimeUtc,
            TelemetrySamples: Array.Empty<TelemetrySampleRecord>());

    /// <summary>Executes the <c>IResult</c> the handler returned against a fresh <see cref="DefaultHttpContext"/>
    /// (<c>Response.Body</c> a seekable <see cref="MemoryStream"/>) and returns the decoded CSV text plus
    /// the response headers actually written — the only way to observe this endpoint's
    /// <c>Content-Type</c>/<c>Content-Disposition</c> without a TestServer.</summary>
    private static async Task<(string Csv, string? ContentType, string? ContentDisposition)> ExecuteAsync(IResult result)
    {
        var context = new DefaultHttpContext();
        using var body = new MemoryStream();
        context.Response.Body = body;

        await result.ExecuteAsync(context);

        body.Position = 0;
        var csv = Encoding.UTF8.GetString(body.ToArray());
        return (csv, context.Response.ContentType, context.Response.Headers.ContentDisposition.ToString());
    }

    private static ApiErrorDto ExpectBadRequest(IResult result)
    {
        var bad = Assert.IsType<BadRequest<ApiErrorDto>>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, bad.StatusCode);
        Assert.NotNull(bad.Value);
        return bad.Value!;
    }

    // ─────────────────────────────────────────────────────────────────────
    // GET /v1/historian/results/export.csv
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Export_escapes_a_field_containing_comma_quote_and_newline_per_RFC_4180()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;

        // r2's RecipeCode carries a comma, an embedded double-quote, AND a newline — the one field this
        // test exists to exercise. RFC-4180: the whole field must be wrapped in double-quotes and every
        // embedded double-quote doubled.
        var trickyRecipe = "Recipe, \"Special\"\nEdition";
        var r1 = MakeRecord("AOI-01", "SN-100", "Pass", now.AddMinutes(-30));
        var r2 = MakeRecord("AOI-01", "SN-101", "Fail", now.AddMinutes(-20), recipeCode: trickyRecipe);
        var r3 = MakeRecord("AOI-01", "SN-102", "Pass", now.AddMinutes(-10));

        await store.AppendResultsAsync(new[] { r1 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r2 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r3 }, CancellationToken.None);

        var result = await HistorianEndpoints.ExportResultsCsvAsync(
            machine: "AOI-01", from: null, to: null, serial: null, verdict: null, kind: null,
            store, CancellationToken.None);

        var (csv, _, _) = await ExecuteAsync(result);

        // RFC-4180 escaping: comma + embedded quote (doubled) + embedded newline, whole field quoted.
        var expectedEscapedField = "\"Recipe, \"\"Special\"\"\nEdition\"";
        Assert.Contains(expectedEscapedField, csv);

        // Sanity: the two plain rows are present too, unescaped (no special characters in their fields).
        Assert.Contains("SN-100", csv);
        Assert.Contains("SN-102", csv);
    }

    [Fact]
    public async Task Export_honors_the_machine_filter_and_sets_csv_headers()
    {
        var store = NewStore();
        var now = DateTimeOffset.UtcNow;

        var r1 = MakeRecord("AOI-01", "SN-200", "Pass", now.AddMinutes(-30));
        var r2 = MakeRecord("SCRW-01", "SN-201", "Pass", now.AddMinutes(-20)); // different machine — excluded

        await store.AppendResultsAsync(new[] { r1 }, CancellationToken.None);
        await store.AppendResultsAsync(new[] { r2 }, CancellationToken.None);

        var result = await HistorianEndpoints.ExportResultsCsvAsync(
            machine: "AOI-01", from: null, to: null, serial: null, verdict: null, kind: null,
            store, CancellationToken.None);

        var (csv, contentType, contentDisposition) = await ExecuteAsync(result);

        Assert.NotNull(contentType);
        Assert.StartsWith("text/csv", contentType);
        Assert.NotNull(contentDisposition);
        Assert.StartsWith("attachment", contentDisposition);

        var lines = csv.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(
            "id,machineCode,deviceClass,machineType,readingKind,cycleCounter,serialNumber,verdict,recipeCode,recipeVersion,keyMetricName,keyMetricValue,keyMetricUnit,ngCount,pointCount,ackSuccess,ackDuplicate,ackQueued,eventTimeUtc,ingestedAtUtc",
            lines[0]);

        Assert.Contains("SN-200", csv);
        Assert.DoesNotContain("SN-201", csv); // filtered-out machine's row must be absent
        Assert.Contains("AOI-01", csv);
        Assert.DoesNotContain("SCRW-01", csv);

        // Booleans/dates render exactly as the brief specifies.
        Assert.Contains("true", csv); // AckSuccess
        Assert.Contains(r1.EventTimeUtc.ToString("O"), csv);
    }

    [Fact]
    public async Task Export_with_an_unparseable_from_date_returns_400()
    {
        var store = NewStore();

        var result = await HistorianEndpoints.ExportResultsCsvAsync(
            machine: null, from: "not-a-date", to: null, serial: null, verdict: null, kind: null,
            store, CancellationToken.None);

        var error = ExpectBadRequest(result);
        Assert.Contains("from", error.Error);
    }
}
