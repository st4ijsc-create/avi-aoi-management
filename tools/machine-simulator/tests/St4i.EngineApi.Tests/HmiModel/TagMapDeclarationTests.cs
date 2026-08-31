using System.Text;
using System.Text.Json;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0c Task 1 — the shape a connector uses to declare which tags it can back, and its parser.
///
/// <para><b>Why this is OUR document and not part of the vendor's config string.</b>
/// <c>IConnectorFactory.TryCreate(string config, …)</c> takes an opaque string that each vendor defines
/// the inside of — <c>connectors.json</c> forwards it verbatim and this codebase never parses it. Putting
/// a tag map in there would force every third-party connector to understand OUR format inside THEIR
/// document. So a tag map is a separate document keyed by <c>machineCode</c>, exactly the way
/// <see cref="TagNamespaceDocument"/> already is.</para>
///
/// <para><b>KHÔNG đo cái gì — what this file deliberately does not measure:</b>
/// <list type="number">
///   <item><description>It does NOT measure that any connector produces one of these. Nothing emits a tag
///   map yet; Task 3 decides which driver kinds can back tags and Task 4 ingests them. This measures the
///   SHAPE and the PARSER only.</description></item>
///   <item><description>It does NOT measure §5 safety rules. That is the write door's job
///   (<see cref="ContractInvariants"/>), and the third test below exists to pin that this parser stays out
///   of it.</description></item>
///   <item><description>It does NOT measure JSON Schema conformance — there is no schema for this
///   document, deliberately: it is an internal ingestion shape, not a frozen cross-branch contract, and
///   <c>contracts/</c> is frozen.</description></item>
///   <item><description>It does NOT measure canonicalisation of the machine code as an IDENTITY. The
///   parser preserves what the file said; who canonicalises is pinned below and answered where 0b already
///   answered it.</description></item>
/// </list></para>
/// </summary>
public sealed class TagMapDeclarationTests
{
    private const string OneValidEntry = """
        {
          "schemaVersion": 1,
          "machineCode": "AOI-01",
          "entries": [
            {
              "path": "AOI-01/spindle/torque",
              "dataType": "float",
              "unit": "Nm",
              "engMin": 0,
              "engMax": 250.5,
              "enumValues": null,
              "access": "r",
              "policyAction": null,
              "source": { "kind": "modbus", "unitId": 1, "register": 40001, "scale": 0.1 }
            }
          ]
        }
        """;

    // ═════════════════════════════════════════════════════════════════════
    // 1. A valid document parses and keeps EVERY field.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public void A_valid_declaration_parses_and_preserves_every_field()
    {
        Assert.True(TagMapDeclaration.TryParse(OneValidEntry, out var decl, out var error));
        Assert.Null(error);
        Assert.NotNull(decl);

        Assert.Equal(1, decl!.SchemaVersion);
        Assert.Equal("AOI-01", decl.MachineCode);

        var entry = Assert.Single(decl.Entries);
        Assert.Equal("AOI-01/spindle/torque", entry.Path);
        Assert.Equal("float", entry.DataType);
        Assert.Equal("Nm", entry.Unit);
        Assert.Equal(0, entry.EngMin);
        Assert.Equal(250.5, entry.EngMax);
        Assert.Null(entry.EnumValues);
        Assert.Equal("r", entry.Access);
        Assert.Null(entry.PolicyAction);

        // The nested union comes back whole, not flattened or defaulted — `source` is what tells Task 4
        // which driver is supposed to back this tag, so losing a field here would be losing the answer.
        Assert.NotNull(entry.Source);
        Assert.Equal("modbus", entry.Source.Kind);
        Assert.Equal(1, entry.Source.UnitId);
        Assert.Equal(40001, entry.Source.Register);
        Assert.Equal(0.1, entry.Source.Scale);
    }

    /// <summary>Round-trip through <see cref="HmiContractJson.Options"/> — the options this parser is
    /// required to use, and the ones every other HMI contract producer already uses. Pinned because
    /// "parses" and "parses under the same rules as everything else" are different claims: a fresh
    /// <c>JsonSerializerOptions</c> would be camelCase-insensitive-by-default and would quietly accept
    /// documents the rest of the pipeline rejects.</summary>
    [Fact]
    public void A_parsed_declaration_round_trips_through_the_shared_contract_options()
    {
        Assert.True(TagMapDeclaration.TryParse(OneValidEntry, out var decl, out _));

        var reserialised = JsonSerializer.Serialize(decl, HmiContractJson.Options);
        Assert.True(TagMapDeclaration.TryParse(reserialised, out var again, out var error), error);

        Assert.Equal(decl!.MachineCode, again!.MachineCode);
        Assert.Equal(decl.Entries[0].Path, again.Entries[0].Path);
        Assert.Equal(decl.Entries[0].Source.Register, again.Entries[0].Source.Register);

        // ...and absence stays absence: HmiContractJson.Options drops nulls on write, the rule every HMI
        // producer follows, so an unset optional never comes back as an explicit `null` in the document.
        Assert.DoesNotContain("\"unit\":null", reserialised, StringComparison.Ordinal);
        Assert.DoesNotContain("\"policyAction\":null", reserialised, StringComparison.Ordinal);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 2. Malformed JSON is an ERROR THAT NAMES A POSITION, never an exception.
    // ═════════════════════════════════════════════════════════════════════

    [Fact]
    public void Malformed_json_returns_false_with_an_error_and_never_throws()
    {
        const string broken = "{ \"schemaVersion\": 1, \"machineCode\": \"AOI-01\", \"entries\": [ { ";

        Assert.False(TagMapDeclaration.TryParse(broken, out var decl, out var error));
        Assert.Null(decl);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    /// <summary>🔴 <b>The error must name a POSITION, and this is the test that makes that a requirement
    /// rather than a courtesy.</b> A connector's tag map is hundreds to thousands of entries — the same
    /// population <see cref="ITagNamespaceStore"/>'s own doc comment describes. An error that says only
    /// "invalid JSON" for a 2 000-entry document is an error an engineer cannot act on: they know the file
    /// is wrong and have no idea where.
    ///
    /// <para>The break is planted deep on purpose. A parser that happened to report position only for
    /// errors near the start would pass a small fixture and fail the case that matters.</para></summary>
    [Fact]
    public void A_syntax_error_deep_in_a_large_map_is_located_not_merely_reported()
    {
        var json = new StringBuilder();
        json.Append("{\n  \"schemaVersion\": 1,\n  \"machineCode\": \"AOI-01\",\n  \"entries\": [\n");
        for (var i = 0; i < 2_000; i++)
        {
            // Entry 1337 is missing the colon after "dataType" — valid everywhere else.
            var broken = i == 1_337;
            json.Append("    {\"path\": \"AOI-01/t").Append(i).Append("\", \"dataType\"")
                .Append(broken ? " " : ": ")
                .Append("\"float\", \"access\": \"r\", \"source\": {\"kind\": \"simulated\"}}");
            if (i < 1_999) json.Append(',');
            json.Append('\n');
        }
        json.Append("  ]\n}");

        Assert.False(TagMapDeclaration.TryParse(json.ToString(), out var decl, out var error));
        Assert.Null(decl);
        Assert.NotNull(error);

        // The three coordinates System.Text.Json can give, all of which this error must carry: which LINE,
        // where in it, and — the one that actually finds the entry in a 2 000-element array — the JSON PATH.
        Assert.Contains("line", error!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("1342", error, StringComparison.Ordinal);      // 4 header lines + entry 1337
        Assert.Contains("entries[1337]", error, StringComparison.Ordinal);

        // ...and exactly ONE line number, 1-based. System.Text.Json counts from zero and appends its own
        // " | LineNumber: 1341 | …" tail, so forwarding its message verbatim produced a sentence naming
        // both 1342 and 1341 for one error — leaving the engineer to guess which their editor will show.
        // The tail is stripped; this asserts the 0-based duplicate cannot come back.
        Assert.DoesNotContain("1341", error, StringComparison.Ordinal);
        Assert.DoesNotContain("LineNumber:", error, StringComparison.Ordinal);

        // The explanation of WHAT is wrong survives the strip — position without cause is half an error.
        Assert.Contains("Expected a ':'", error, StringComparison.Ordinal);
    }

    /// <summary>Valid JSON that is not a declaration at all. <c>"null"</c> is the case worth pinning: it
    /// parses without throwing and deserialises to a null reference, so a parser that only caught
    /// <see cref="JsonException"/> would hand back <c>true</c> with a null <c>decl</c> — and every caller
    /// that trusted the boolean would dereference it.</summary>
    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"a string\"")]
    [InlineData("")]
    [InlineData("   ")]
    public void Json_that_is_not_a_declaration_is_an_error_not_a_null_success(string json)
    {
        Assert.False(TagMapDeclaration.TryParse(json, out var decl, out var error));
        Assert.Null(decl);
        Assert.False(string.IsNullOrWhiteSpace(error));
    }

    // ═════════════════════════════════════════════════════════════════════
    // 3. 🔴 THE PROPOSITION THAT IS EASY TO GET BACKWARDS.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>An <c>rw</c> entry with no <c>policyAction</c> MUST PARSE. Rejecting it here would be
    /// the bug, not the safety.</b>
    ///
    /// <para>§5 says a writable tag must carry a <c>policyAction</c>, and refusing one is
    /// <see cref="ContractInvariants"/>'s job at the WRITE DOOR — where every caller passes, including the
    /// ones that never go near this parser. If this parser also refused it, <b>one safety rule would be
    /// defined in two places, and two places drift.</b> This repository has already paid for that lesson:
    /// the <c>IsNullOrEmpty</c>/<c>IsNullOrWhiteSpace</c> split was closed at the two sites a finding named
    /// while the rule stayed broken at the three that mattered, and it took a source-wide guard to close
    /// it. A parser that enforces safety is a second definition waiting to disagree with the first.</para>
    ///
    /// <para><b>What "parses" does not mean:</b> it does not mean the entry is acceptable. It means the
    /// parser's answer is "this is what the document says", and the door's answer is separately "no". Task
    /// 4 sends this through <c>ITagNamespaceStore</c>, whose <c>PutAsync</c> calls
    /// <c>ThrowIfInvalid</c> — so this entry is still refused, once, by the component that owns
    /// the rule.</para></summary>
    [Fact]
    public void An_rw_entry_with_no_policyAction_parses_because_refusing_it_belongs_to_the_write_door()
    {
        const string ungated = """
            {
              "schemaVersion": 1,
              "machineCode": "AOI-01",
              "entries": [
                {
                  "path": "AOI-01/spindle/setpoint",
                  "dataType": "float",
                  "access": "rw",
                  "source": { "kind": "modbus", "unitId": 1, "register": 40010 }
                }
              ]
            }
            """;

        Assert.True(TagMapDeclaration.TryParse(ungated, out var decl, out var error), error);
        Assert.Null(error);

        var entry = Assert.Single(decl!.Entries);
        Assert.Equal("rw", entry.Access);
        Assert.Null(entry.PolicyAction);
    }

    /// <summary>The other half of the same rule, so the test above cannot be read as "this parser has no
    /// opinions": the parser is equally indifferent to a <c>policyAction</c> that is present but
    /// meaningless. §5 is a PRESENCE rule, not a membership rule (WS-HMI-0b's ruling), and membership is
    /// the JSON Schema's job — so a parser filtering values here would be inventing a third opinion about
    /// a rule that already has exactly one owner.</summary>
    [Fact]
    public void The_parser_has_no_opinion_about_what_a_policyAction_means()
    {
        var json = OneValidEntry.Replace("\"policyAction\": null", "\"policyAction\": \"xyzzy\"", StringComparison.Ordinal);

        Assert.True(TagMapDeclaration.TryParse(json, out var decl, out var error), error);
        Assert.Equal("xyzzy", decl!.Entries[0].PolicyAction);
    }

    // ═════════════════════════════════════════════════════════════════════
    // Shape normalisation — the parser's job — versus safety, which is not.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>§5-bis at this layer: a declaration with no entries is VALID and contributes no tags. It
    /// is not an error and must not block anything.
    ///
    /// <para>An omitted <c>entries</c> array deserialises to a genuine <see langword="null"/> — C#'s
    /// non-nullable annotation does not survive <c>System.Text.Json</c> on a missing field, which is the
    /// mechanism that produced two HIGH findings in WS-HMI-0b. The parser normalises it to EMPTY, and that
    /// is shape work rather than safety work: no caller can null-dereference a list this parser
    /// returned.</para></summary>
    [Theory]
    [InlineData("{\"schemaVersion\":1,\"machineCode\":\"AOI-01\",\"entries\":[]}")]
    [InlineData("{\"schemaVersion\":1,\"machineCode\":\"AOI-01\"}")]
    [InlineData("{\"schemaVersion\":1,\"machineCode\":\"AOI-01\",\"entries\":null}")]
    public void A_declaration_with_no_entries_is_valid_and_never_yields_a_null_list(string json)
    {
        Assert.True(TagMapDeclaration.TryParse(json, out var decl, out var error), error);
        Assert.NotNull(decl!.Entries);
        Assert.Empty(decl.Entries);
    }

    // ═════════════════════════════════════════════════════════════════════
    // 🔴 S-5 — the machine code, which is 0b Task 1's HIGH-A one layer up.
    // ═════════════════════════════════════════════════════════════════════

    /// <summary>🔴 <b>The parser preserves the machine code VERBATIM, and does not canonicalise it.</b>
    /// A connector may spell it any way, and the parser's job is to report what the document said — an
    /// error message or a diagnostic that renamed the engineer's own string would be lying about the file.
    ///
    /// <para><b>Where canonicalisation happens instead, and why that is not a gap:</b> WS-HMI-0b closed
    /// this structurally at the store seam. <c>CanonicalizingTagNamespaceStore</c> rewrites
    /// <c>doc.MachineCode</c> and the storage key on every <c>PutAsync</c>, so a declaration that reaches
    /// the namespace through DI — which is the only way Task 4 may reach it — is canonicalised whether or
    /// not the ingesting code remembered to think about case. Adding a second canonicalisation here would
    /// not add safety; it would add a second place implementing one rule, which is the same objection this
    /// file makes about <c>policyAction</c> two tests up.</para>
    ///
    /// <para><b>The gap that IS real, and what closes it:</b> anything that uses the raw
    /// <see cref="TagMapDeclaration.MachineCode"/> as an IDENTITY <i>before</i> the store — grouping
    /// declarations by machine, or deciding two connectors describe the same machine — would treat
    /// <c>aoi-01</c> and <c>AOI-01</c> as two machines. <see cref="TagMapDeclaration.CanonicalMachineCode"/>
    /// is the one call that answers it, and Tasks 2 and 4 must use it for any such decision. It is a
    /// METHOD rather than a property on purpose: a property would be serialised into the document by
    /// <c>System.Text.Json</c> and invent a field the shape does not have.</para></summary>
    [Fact]
    public void The_machine_code_is_preserved_verbatim_and_canonicalised_only_on_request()
    {
        var json = OneValidEntry.Replace("\"machineCode\": \"AOI-01\"", "\"machineCode\": \"  aoi-01 \"", StringComparison.Ordinal);

        Assert.True(TagMapDeclaration.TryParse(json, out var decl, out var error), error);

        // Verbatim — including the whitespace the engineer typed.
        Assert.Equal("  aoi-01 ", decl!.MachineCode);

        // ...and one call away from the identity every 0b read surface reports.
        Assert.Equal("AOI-01", decl.CanonicalMachineCode());
    }
}
