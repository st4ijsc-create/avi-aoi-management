using System.Reflection;
using St4i.Connector.Abstractions.Models;
using St4i.EngineApi.HmiModel;
using St4i.Hmi.Contracts;
using Xunit;

namespace St4i.EngineApi.Tests.HmiModel;

/// <summary>
/// WS-HMI-0c Task 2 — the compiler from a connector's declaration to the namespace the HMI serves.
///
/// <para><b>KHÔNG đo cái gì:</b> (1) nó KHÔNG đo rằng driver thật sự đọc được địa chỉ trong
/// <c>Source</c> — không có thiết bị nào trong bài test này; cái nó đo là cờ
/// <c>isBackedByDriver</c> nói đúng về NĂNG LỰC CỦA KIND, và ranh giới ấy là có chủ ý; (2) nó KHÔNG
/// kiểm bất biến §5 — đó là <c>ContractInvariants</c> tại cửa ghi; (3) nó KHÔNG đo đơn vị được
/// <c>MappingProfile</c> viết lại, vì đó là một tầng khác trả lời một câu khác.</para>
///
/// <para>All three clauses were re-checked against the code as written, not pasted and left. (1) holds:
/// no test here constructs a device, opens a session or reads a register — the flag is decided from two
/// static facts, whether this build can construct a connector of the kind at all and whether the tag's
/// own source names that kind. (2) holds and is pinned positively by
/// <c>A_writable_entry_with_no_policyAction_still_compiles_because_that_rule_lives_at_the_write_door</c>,
/// which asserts the builder does NOT enforce §5. (3) holds: <c>Unit</c> is copied verbatim and this file
/// makes no assertion about what any unit ought to be.</para>
/// </summary>
public sealed class TagNamespaceBuilderTests
{
    // -------------------------------------------------------------------------------------------------
    // Fixtures. One shape per arm of the frozen schema's source union, so no test has to invent one.
    // -------------------------------------------------------------------------------------------------

    private static TagSource ModbusSource(int register) => new("modbus", UnitId: 1, Register: register, Scale: 1.0);
    private static TagSource OpcUaSource() => new("opcua", NodeId: "ns=2;s=Temperature");
    private static TagSource MqttSource() => new("mqtt", Topic: "line3/temp", JsonPath: "$.value");
    private static TagSource SimulatedSource() => new("simulated");
    private static TagSource DerivedSource() => new("derived", Expr: "oven/temp * 1.8 + 32");

    private static TagMapEntry Entry(string path, TagSource source) =>
        new(path, "float", "C", EngMin: 0, EngMax: 300, EnumValues: null, Access: "r", PolicyAction: null, Source: source);

    private static TagMapDeclaration Declaration(string machineCode, params TagMapEntry[] entries) =>
        new(SchemaVersion: 1, MachineCode: machineCode, Entries: entries);

    /// <summary>A declaration that is complete by every measure available to a reader: three well-formed
    /// Modbus entries with unit ids, registers and scales. Proposition 3's reverse direction is about
    /// exactly this document — completeness must not be able to buy the flag.</summary>
    private static TagMapDeclaration ACompleteModbusDeclaration() => Declaration(
        "AOI-01",
        Entry("oven/temp", ModbusSource(40001)),
        Entry("oven/pressure", ModbusSource(40002)),
        Entry("oven/humidity", ModbusSource(40003)));

    // -------------------------------------------------------------------------------------------------
    // Proposition 1 — every entry becomes exactly one descriptor, every field intact.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Driven by reflection rather than a hand-written field list, because a hand-written list is exactly
    /// what stops being true when someone adds a tenth field: the copy would silently drop it and every
    /// assertion here would still pass.
    ///
    /// <para>Does not measure: whether any field's VALUE is correct for a real machine — only that the
    /// value the declaration carried is the value the descriptor carries.</para>
    /// </summary>
    [Fact]
    public void Every_field_of_an_entry_arrives_on_the_descriptor_unchanged()
    {
        var source = ModbusSource(40001);
        var entry = new TagMapEntry(
            Path: "oven/temp",
            DataType: "float",
            Unit: "C",
            EngMin: -40.5,
            EngMax: 300.25,
            EnumValues: new[] { "cold", "hot" },
            Access: "rw",
            PolicyAction: "machine.setpoint",
            Source: source);

        var doc = TagNamespaceBuilder.Build(Declaration("AOI-01", entry), DriverKinds.Modbus);

        var descriptor = Assert.Single(doc.Tags);

        var carried = typeof(TagMapEntry).GetProperties(BindingFlags.Public | BindingFlags.Instance);
        Assert.NotEmpty(carried);

        foreach (var property in carried)
        {
            var mirrored = typeof(TagDescriptor).GetProperty(property.Name, BindingFlags.Public | BindingFlags.Instance);

            Assert.True(mirrored is not null,
                $"TagMapEntry.{property.Name} has no same-named property on TagDescriptor, so this test can " +
                "no longer check that it survives the copy. If the field was renamed on one side only, the " +
                "builder is dropping it silently.");

            Assert.Equal(property.GetValue(entry), mirrored!.GetValue(descriptor));
        }
    }

    /// <summary>
    /// The other half of proposition 1, and the reason the builder exists: the descriptor is the entry
    /// plus EXACTLY ONE field, the computed flag. If a second computed field ever appears, this reddens
    /// and someone has to decide whether it is also being computed or merely carried.
    ///
    /// <para>Does not measure: the flag's VALUE — only that it is the one field the declaration does not
    /// supply.</para>
    /// </summary>
    [Fact]
    public void The_descriptor_adds_exactly_one_field_to_the_entry_and_it_is_the_computed_flag()
    {
        var declared = typeof(TagMapEntry)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name).ToHashSet(StringComparer.Ordinal);
        var served = typeof(TagDescriptor)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => p.Name).ToHashSet(StringComparer.Ordinal);

        Assert.NotEmpty(declared);
        Assert.Equal(new[] { nameof(TagDescriptor.IsBackedByDriver) }, served.Except(declared).OrderBy(n => n, StringComparer.Ordinal));
        Assert.Empty(declared.Except(served));
    }

    /// <summary>
    /// Does not measure: field values — that is the test above. This one is about arity and order, which a
    /// per-entry test using <c>Assert.Single</c> cannot see.
    /// </summary>
    [Fact]
    public void Each_entry_becomes_one_descriptor_in_the_order_declared()
    {
        var doc = TagNamespaceBuilder.Build(ACompleteModbusDeclaration(), DriverKinds.Modbus);

        Assert.Equal(3, doc.Tags.Count);
        Assert.Equal(new[] { "oven/temp", "oven/pressure", "oven/humidity" }, doc.Tags.Select(t => t.Path));
    }

    // -------------------------------------------------------------------------------------------------
    // Proposition 2 — machineCode and schemaVersion reach the document.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Does not measure: whether schemaVersion 1 is the only version the schema permits — the builder
    /// carries what it was given and the write door judges it.
    /// </summary>
    [Fact]
    public void MachineCode_and_schemaVersion_are_carried_into_the_document()
    {
        var doc = TagNamespaceBuilder.Build(
            new TagMapDeclaration(SchemaVersion: 1, MachineCode: "AOI-01", Entries: Array.Empty<TagMapEntry>()),
            DriverKinds.Modbus);

        Assert.Equal(1, doc.SchemaVersion);
        Assert.Equal("AOI-01", doc.MachineCode);
    }

    /// <summary>
    /// <c>schemaVersion</c> is CARRIED, not asserted. The frozen schema pins it to <c>const 1</c>, so it
    /// would be easy to write <c>1</c> here and be right for every document that exists today — and a
    /// declaration that said <c>2</c> would then be silently relabelled as a version-1 document, which is
    /// the builder lying about the file it compiled. Carrying it means a wrong version is refused at the
    /// write door, by the component that owns the schema, instead of being erased here.
    ///
    /// <para>Does not measure: that version 2 is invalid — that judgment belongs to
    /// <c>ContractInvariants</c> and the schema, and this test deliberately does not duplicate it.</para>
    /// </summary>
    [Fact]
    public void A_declaration_naming_another_schemaVersion_is_carried_not_relabelled()
    {
        var doc = TagNamespaceBuilder.Build(
            new TagMapDeclaration(SchemaVersion: 2, MachineCode: "AOI-01", Entries: Array.Empty<TagMapEntry>()),
            DriverKinds.Modbus);

        Assert.Equal(2, doc.SchemaVersion);
    }

    /// <summary>
    /// Ruling S-5. <c>TagMapDeclaration.CanonicalMachineCode</c>'s doc comment instructs this task to use
    /// the canonical form for grouping and same-machine comparison and never to compare the raw field.
    /// The builder makes no such comparison, so it makes no such call, and the engineer's own spelling
    /// survives the compile — canonicalisation of the STORED document belongs to
    /// <c>CanonicalizingTagNamespaceStore</c>, which owns it structurally.
    ///
    /// <para>Does not measure: what the store does with this document. No store is constructed here. The
    /// residue that a caller could serve this document without passing through that store is named in
    /// TagNamespaceBuilder's doc comment and is not closed by this test.</para>
    /// </summary>
    [Fact]
    public void MachineCode_is_carried_verbatim_and_the_canonical_form_stays_a_separate_question()
    {
        var declaration = Declaration("  aoi-01  ", Entry("oven/temp", ModbusSource(40001)));

        var doc = TagNamespaceBuilder.Build(declaration, DriverKinds.Modbus);

        Assert.Equal("  aoi-01  ", doc.MachineCode);
        Assert.Equal("AOI-01", declaration.CanonicalMachineCode());
    }

    // -------------------------------------------------------------------------------------------------
    // Proposition 3 — the flag reflects truth, not intent. Both directions.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Forward direction: a kind this build can construct a connector for, and tags whose sources name
    /// that same kind, are backed.
    ///
    /// <para>Does not measure: that a device answers at those registers, or that the register numbers are
    /// meaningful. There is no device in this test — see clause (1) of the class disclosure.</para>
    /// </summary>
    [Theory]
    [InlineData(DriverKinds.Modbus)]
    [InlineData(DriverKinds.OpcUa)]
    public void A_tag_is_backed_when_the_connector_kind_can_back_and_the_source_names_that_kind(string driverKind)
    {
        var source = driverKind == DriverKinds.Modbus ? ModbusSource(40001) : OpcUaSource();

        var doc = TagNamespaceBuilder.Build(Declaration("AOI-01", Entry("oven/temp", source)), driverKind);

        Assert.True(DriverTagSupport.CanBack(driverKind));
        Assert.True(Assert.Single(doc.Tags).IsBackedByDriver);
    }

    /// <summary>
    /// <b>Reverse direction, and the reason this task exists.</b> The declaration is complete by every
    /// measure a reader has — three well-formed Modbus entries with unit ids, registers and scales — and
    /// on a kind with no address-read path every flag is still <see langword="false"/>. Completeness of a
    /// declaration must not be purchasable as evidence of a driver.
    ///
    /// <para>This is the lesson block written as an assertion: <c>dispense_program</c> and
    /// <c>weld_profile</c> were declared in full, domain-checked, stored and served, and nothing read them
    /// for months.</para>
    ///
    /// <para>Does not measure: whether these kinds might gain an address-read path later. If one does,
    /// <c>DriverTagSupportTests</c>' reverse direction reddens first, which is the intended order.</para>
    /// </summary>
    [Theory]
    [InlineData(DriverKinds.Simulated)]
    [InlineData(DriverKinds.Mqtt)]
    [InlineData(DriverKinds.HotFolderAoi)]
    [InlineData("vendor.acme.weld")]
    [InlineData("")]
    [InlineData(null)]
    public void No_tag_is_backed_when_the_connector_kind_cannot_back_however_complete_the_declaration(string? driverKind)
    {
        var declaration = ACompleteModbusDeclaration();

        var doc = TagNamespaceBuilder.Build(declaration, driverKind);

        Assert.False(DriverTagSupport.CanBack(driverKind));
        Assert.Equal(3, doc.Tags.Count);
        Assert.All(doc.Tags, tag => Assert.False(tag.IsBackedByDriver));

        // The declaration really was complete: had these entries been on a Modbus connector they would all
        // have been backed. Without this the row above could pass on a declaration that was empty or
        // malformed, and would be measuring nothing.
        var onABackingKind = TagNamespaceBuilder.Build(declaration, DriverKinds.Modbus);
        Assert.All(onABackingKind.Tags, tag => Assert.True(tag.IsBackedByDriver));
    }

    /// <summary>
    /// <b>The sharpest form of proposition 3, and the row that pins the <c>CanBack</c> condition on its
    /// own.</b> Every other reverse-direction row pairs a non-backing connector with Modbus sources, so it
    /// would still come out <see langword="false"/> on the source-match condition alone — the two
    /// conditions are indistinguishable there. Here the declaration is internally PERFECT: an Mqtt
    /// connector carrying mqtt sources, a Simulated connector carrying simulated sources. The source names
    /// the connector's own kind exactly, and the tag is still not backed, because this build can construct
    /// no connector of that kind that reads by address.
    ///
    /// <para>Does not measure: whether MQTT delivers values at all — it does, which is the point. Being
    /// real is not the same as being readable by address, and <c>DriverKinds.IsFabricated</c> is
    /// <see langword="false"/> for Mqtt precisely because those are two different questions.</para>
    /// </summary>
    /// <para>🔴 INFO-11 — the <c>HotFolderAoi</c> row was REMOVED rather than fixed. It paired that
    /// connector with a source kind spelled <c>"HotFolderAoi"</c>, and the frozen schema's source union has
    /// exactly five arms — <c>modbus</c>, <c>opcua</c>, <c>mqtt</c>, <c>simulated</c>, <c>derived</c> — none
    /// of which is that. The row therefore asserted about a document the schema cannot express, which is a
    /// weaker claim than it looked: it would have passed for the wrong reason. There is no coherent
    /// HotFolderAoi row to write, because the schema gives that connector no source arm to match; its
    /// unbacked-ness is covered by
    /// <c>No_tag_is_backed_when_the_connector_kind_cannot_back_however_complete_the_declaration</c>.</para>
    [Theory]
    [InlineData(DriverKinds.Mqtt, "mqtt")]
    [InlineData(DriverKinds.Simulated, "simulated")]
    public void A_declaration_whose_sources_match_its_connector_exactly_is_still_unbacked_on_a_kind_that_cannot_back(
        string driverKind, string sourceKind)
    {
        var doc = TagNamespaceBuilder.Build(
            Declaration("AOI-01", Entry("oven/temp", new TagSource(sourceKind, Topic: "line3/temp"))),
            driverKind);

        Assert.False(DriverTagSupport.CanBack(driverKind));
        Assert.False(Assert.Single(doc.Tags).IsBackedByDriver);
    }

    /// <summary>
    /// The second necessary condition, which is this task's own design decision (see the Task 2 report).
    /// The connector kind CAN back tags in every row here — it is Modbus throughout — and the tag is still
    /// not backed, because its source is not something a Modbus driver reads: a value computed from an
    /// expression, a value manufactured outright, a broker topic, or an OPC-UA node id declared on the
    /// wrong connector.
    ///
    /// <para>Does not measure: whether such a pairing is legal elsewhere in the system. The frozen schema
    /// permits every one of these documents; this test is about what the flag may claim about them, not
    /// about whether they should have been written.</para>
    /// </summary>
    [Fact]
    public void A_source_the_connectors_own_driver_does_not_read_is_not_backed_even_on_a_backing_kind()
    {
        var declaration = Declaration(
            "AOI-01",
            Entry("oven/derived", DerivedSource()),
            Entry("oven/fake", SimulatedSource()),
            Entry("oven/topic", MqttSource()),
            Entry("oven/node", OpcUaSource()));

        var doc = TagNamespaceBuilder.Build(declaration, DriverKinds.Modbus);

        Assert.True(DriverTagSupport.CanBack(DriverKinds.Modbus));
        Assert.All(doc.Tags, tag => Assert.False(tag.IsBackedByDriver));
    }

    /// <summary>
    /// The flag is decided per tag, not per document. A real Modbus connector may carry a derived tag
    /// alongside its real registers, and one flag for the whole document would have to be wrong about one
    /// of them.
    ///
    /// <para>Does not measure: the expression in the derived source — nothing here evaluates it.</para>
    /// </summary>
    [Fact]
    public void Two_tags_on_one_connector_can_disagree_because_the_flag_is_per_tag()
    {
        var doc = TagNamespaceBuilder.Build(
            Declaration("AOI-01", Entry("oven/temp", ModbusSource(40001)), Entry("oven/degF", DerivedSource())),
            DriverKinds.Modbus);

        Assert.True(doc.Tags[0].IsBackedByDriver);
        Assert.False(doc.Tags[1].IsBackedByDriver);
    }

    /// <summary>
    /// The source kind is folded through <c>DriverKinds.Normalize</c>, the one place this codebase decides
    /// two spellings are one id, rather than compared raw. A document written with a differently-cased
    /// source kind must not silently lose its backing.
    ///
    /// <para>Does not measure: whether the schema permits these spellings — it specifies lowercase consts.
    /// This is about the builder not being the component that breaks on a tolerated variant.</para>
    /// </summary>
    [Theory]
    [InlineData("modbus")]
    [InlineData("Modbus")]
    [InlineData("MODBUS")]
    public void The_source_kind_is_folded_the_same_way_every_other_built_in_comparison_folds(string sourceKind)
    {
        var doc = TagNamespaceBuilder.Build(
            Declaration("AOI-01", Entry("oven/temp", new TagSource(sourceKind, UnitId: 1, Register: 40001))),
            DriverKinds.Modbus);

        Assert.True(Assert.Single(doc.Tags).IsBackedByDriver);
    }

    /// <summary>
    /// <b>The CONNECTOR kind is folded too, and this test exists because the mutation sweep proved nothing
    /// was checking that.</b> Every other test here passes a canonical <c>DriverKinds</c> constant, so
    /// removing the fold on the connector side reddened nothing — while the code with the fold removed had
    /// a real defect: <c>CanBack</c> normalises internally and would still answer <see langword="true"/>
    /// for <c>"modbus"</c>, but the unfolded connector kind would then fail to match its own folded
    /// <c>"modbus"</c> source, and a correctly-declared machine would silently report every tag as
    /// unbacked.
    ///
    /// <para><c>fleet.json</c> has always accepted any casing for a driver kind, so a lowercase connector
    /// kind is an ordinary input, not a contrived one.</para>
    ///
    /// <para>Does not measure: where a connector kind comes from at runtime — no config is loaded here.</para>
    /// </summary>
    [Theory]
    [InlineData("modbus")]
    [InlineData("MODBUS")]
    [InlineData(" Modbus ")]
    public void A_connector_kind_in_any_accepted_casing_still_backs_its_own_tags(string connectorKind)
    {
        var doc = TagNamespaceBuilder.Build(
            Declaration("AOI-01", Entry("oven/temp", ModbusSource(40001))), connectorKind);

        Assert.True(DriverTagSupport.CanBack(connectorKind));
        Assert.True(Assert.Single(doc.Tags).IsBackedByDriver);
    }

    /// <summary>
    /// Task 1 preserves a missing <c>source</c> as null rather than inventing one, so a null source
    /// reaches the builder. Fail closed.
    ///
    /// <para>Does not measure: §5 or schema validity. The builder's job is to compile truthfully, not to
    /// reject — the write door judges. <b>🔴 An earlier version of this sentence asserted such a document
    /// "is refused at the write door", and at the time that was FALSE:</b>
    /// <c>ContractInvariants.Validate(TagNamespaceDocument)</c> said in its own words that
    /// <c>TagDescriptor.Source</c> was "deliberately NOT checked", so a source-less entry parsed, compiled,
    /// drew zero violations and was stored and served as a schema-invalid namespace. The claim is true now
    /// because MED-3 made it true, not because it was re-worded —
    /// <c>TagIngestionServiceTests.A_tag_map_omitting_a_schema_required_field_is_refused_at_the_write_door</c>
    /// is the measurement.</para>
    /// </summary>
    [Fact]
    public void A_tag_that_declares_no_source_at_all_is_not_backed()
    {
        var entry = new TagMapEntry("oven/temp", "float", "C", 0, 300, null, "r", null, Source: null!);

        var doc = TagNamespaceBuilder.Build(Declaration("AOI-01", entry), DriverKinds.Modbus);

        Assert.False(Assert.Single(doc.Tags).IsBackedByDriver);
    }

    // -------------------------------------------------------------------------------------------------
    // Proposition 4 — §5-bis.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// A machine that has declared nothing is a real product state, not an error: the result is an empty,
    /// valid document — not null, not an exception. Both spellings of "nothing" are covered, because
    /// <c>Build</c> is public and only ONE of them can arrive through Task 1's parser.
    ///
    /// <para>Does not measure: what a route does with an empty namespace. WS-HMI-0b already ruled that an
    /// empty 200 is correct and never a 404; no route is exercised here.</para>
    /// </summary>
    [Fact]
    public void An_empty_declaration_builds_an_empty_valid_namespace()
    {
        foreach (var entries in new[] { Array.Empty<TagMapEntry>(), null })
        {
            var doc = TagNamespaceBuilder.Build(
                new TagMapDeclaration(SchemaVersion: 1, MachineCode: "AOI-01", Entries: entries!),
                DriverKinds.Modbus);

            Assert.NotNull(doc);
            Assert.NotNull(doc.Tags);
            Assert.Empty(doc.Tags);
            Assert.Equal("AOI-01", doc.MachineCode);
            Assert.Equal(1, doc.SchemaVersion);
        }
    }

    // -------------------------------------------------------------------------------------------------
    // What the builder deliberately does NOT do.
    // -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Clause (2) of the class disclosure, asserted positively rather than merely claimed. An entry with
    /// <c>access: "rw"</c> and no <c>policyAction</c> violates §5 — and it COMPILES here, because §5 is
    /// enforced once, by <c>ContractInvariants</c> at the write door that every caller passes. Two
    /// enforcement sites drift, and this repository has already paid for that.
    ///
    /// <para><b>Carry-forward S-6 is open and this test is what keeps it visible.</b> The builder derives
    /// no authorisation decision from <c>policyAction</c>; it copies the value, including an unrecognised
    /// one. There is nothing here to fail closed BECAUSE there is no consumer — if a later task makes the
    /// builder resolve this field to a permission, this test must be revisited rather than deleted.</para>
    ///
    /// <para>Does not measure: that the write door does reject it — that is
    /// <c>ContractInvariants</c>' own suite, and asserting it here would be the second site.</para>
    /// </summary>
    [Fact]
    public void A_writable_entry_with_no_policyAction_still_compiles_because_that_rule_lives_at_the_write_door()
    {
        var writableWithNoPolicy = new TagMapEntry(
            "oven/setpoint", "float", "C", 0, 300, null, Access: "rw", PolicyAction: null, Source: ModbusSource(40010));
        var unrecognisedPolicy = new TagMapEntry(
            "oven/mode", "string", null, null, null, null, Access: "rw", PolicyAction: "xyzzy", Source: ModbusSource(40011));

        var doc = TagNamespaceBuilder.Build(
            Declaration("AOI-01", writableWithNoPolicy, unrecognisedPolicy), DriverKinds.Modbus);

        Assert.Equal(2, doc.Tags.Count);
        Assert.Null(doc.Tags[0].PolicyAction);
        Assert.Equal("xyzzy", doc.Tags[1].PolicyAction);
    }

    /// <summary>
    /// Does not measure: anything about the flag or the fields — only that a null declaration is a
    /// programming error surfaced immediately rather than a null document handed downstream.
    /// </summary>
    [Fact]
    public void A_null_declaration_is_refused_rather_than_compiled_into_a_null_document()
    {
        Assert.Throws<ArgumentNullException>(() => TagNamespaceBuilder.Build(null!, DriverKinds.Modbus));
    }

    /// <summary>
    /// 🔴 <b>LOW-10 — the pin that actually covers the case carry-forward S-6 is named for.</b>
    ///
    /// <para>The test above asserts an unrecognised <c>policyAction</c> is COPIED, which reddens against a
    /// consumer that refuses or rewrites the value. It does not redden against the consumer S-6 is
    /// actually about: one that READS <c>policyAction</c>, resolves it to an authorisation decision
    /// recorded somewhere else, and FAILS OPEN on a value it does not recognise. That consumer leaves the
    /// copied string untouched, so every assertion above stays green while the door it opened is
    /// ungated — which is the whole of S-6.</para>
    ///
    /// <para>What can be measured without a consumer to test is ARRIVAL: this is a census of every
    /// production file that mentions the field. All four non-contract mentions below are carriers — two
    /// endpoints that serialise documents, the declaration record, and this builder's own copy. The day a
    /// fifth file appears, this reddens and whoever added it has to decide the fail-closed question S-6
    /// reserves, at the moment the decision is being made rather than after a review finds it.</para>
    ///
    /// <para>Does not measure: whether an existing file's mention is still only a carry. A file already on
    /// this list could start deciding, and this census would not see it — the same limit
    /// <c>PerHostDataRootsTests</c> states about its own store-versus-read split. Narrowing that needs a
    /// consumer to exist first.</para>
    /// </summary>
    [Fact]
    public void No_production_file_outside_the_contracts_assembly_has_become_a_policyAction_consumer()
    {
        var srcRoot = Path.Combine(MachineSimulatorRoot(), "src");

        // 🔴 THE TWO WRITE ENDPOINTS ARE NO LONGER EXEMPT, and that was the hole. Both were on this list
        // because they "serialise documents that carry the field" — but measured, NEITHER mentions it in
        // CODE: the only occurrences in HmiTagEndpoints.cs and HmiModelEndpoints.cs are comment lines. So
        // the census exempted precisely the two files a fail-open consumer would most naturally be written
        // into, and one added there left the suite green. Comment lines are now stripped before matching
        // (same rule as the LOW-5 caller census), which drops both endpoints off this list entirely — and
        // means a consumer added to either of them arrives as a NEW entry and reddens.
        var carriersByDesign = new[]
        {
            "St4i.EngineApi/HmiModel/TagMapDeclaration.cs",    // declares the field on TagMapEntry
            "St4i.EngineApi/HmiModel/TagNamespaceBuilder.cs",  // copies it, entry -> descriptor

            // 🔴🔴 SESSION S1 (S-6) — THIS TRIPWIRE FIRED, AS DESIGNED, AND THE ANSWER IS RECORDED HERE
            // RATHER THAN THE LIST QUIETLY WIDENED.
            //
            // These two are the FIRST real consumers of policyAction in this assembly — the census above
            // was written for exactly this moment ("the day a fifth file appears... whoever added it has
            // to decide the fail-closed question S-6 reserves, at the moment the decision is being made").
            // The decision, made deliberately and pinned by its own tests:
            //
            //   * MachineWriteGate.ActionForPolicyAction is a TOTAL, INJECTIVE, ORDINAL map from the two
            //     frozen SCREEN words to the two engine action ids, and returns null — never a default,
            //     never a throw — for anything else. There is no arm that turns an unrecognised value
            //     into an action, which is the precise shape of the fail-OPEN consumer this census was
            //     written to catch. MachineWriteGateActionMappingTests pins totality, injectivity-onto,
            //     and null for case/whitespace/the engine's own words/an unknown word, each falsified.
            //
            //   * MachineWritePermissionEndpoints READS the map to answer "may this session do this?" and
            //     treats null as NOT PERMITTED. It is a mutation-free READ that grants nothing: the
            //     enforcement is still MachineWriteEndpoints' own RequireAuthorization + PolicyEngine
            //     evaluation, which re-decides every actual write.
            //
            // So both DECIDE rather than merely carry, and both decide CLOSED. The census's own stated
            // limit still applies and is not narrowed here: it cannot tell whether a file already on this
            // list has since changed how it decides.
            "St4i.EngineApi/Endpoints/MachineWritePermissionEndpoints.cs",
            "St4i.EngineApi/Policy/MachineWriteGate.cs",
        };

        var mentions = Directory
            .EnumerateFiles(srcRoot, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => File.ReadLines(f).Any(line =>
            {
                var code = line.TrimStart();
                return !code.StartsWith("//", StringComparison.Ordinal)
                       && !code.StartsWith("///", StringComparison.Ordinal)
                       && !code.StartsWith("*", StringComparison.Ordinal)
                       && code.Contains("olicyAction", StringComparison.Ordinal);
            }))
            .Select(f => Path.GetRelativePath(srcRoot, f).Replace('\\', '/'))
            // The contracts assembly OWNS the field and its §5 rule; it is the one place allowed to decide
            // anything about it, which is exactly what "no consumer OUTSIDE the contracts assembly" means.
            .Where(f => !f.StartsWith("St4i.Hmi.Contracts/", StringComparison.Ordinal))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(carriersByDesign.OrderBy(f => f, StringComparer.Ordinal).ToArray(), mentions);
    }

    private static string MachineSimulatorRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "README.md")) &&
                File.Exists(Path.Combine(dir.FullName, "fleet.json")) &&
                Directory.Exists(Path.Combine(dir.FullName, "src")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new InvalidOperationException(
            "Could not locate tools/machine-simulator (README.md + fleet.json + src/) by walking up from " +
            $"\"{AppContext.BaseDirectory}\". Fix this walk — do NOT weaken the census to make it run.");
    }
}
