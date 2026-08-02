using System.Text.Json;
using St4i.EdgeCore.Drivers.Modbus;
using Xunit;

namespace St4i.EdgeCore.Tests.Drivers.Modbus;

/// <summary>
/// 🔴 Task D-4 — <b>how a bus of N devices is declared, and the refusals that keep it honest.</b>
///
/// <para>Every test here is about a configuration that would otherwise fail SILENTLY or WRONGLY: two devices
/// at one slave address (both answer, the master decodes whichever frame survives), two devices claiming one
/// machine (the second never registers and the reason is a log line), a bus that declares no devices (looks
/// exactly like a connector that failed), a device element that will not parse (an error naming no device out
/// of eight). None of these produces an exception at run time on its own; each produces a plausible wrong
/// number or a quietly missing device, which is why they are parse-time refusals rather than run-time
/// diagnostics.</para>
///
/// <para><b>The discriminating test in this class is
/// <see cref="UnitZero_IsNotRefusedHere_BecauseTheSameDocumentShapeDrivesModbusTcpWhereItIsLegal"/>.</b> D-2
/// found, and corrected in its own report, that "reject unit 0 at parse time" implemented literally would be a
/// regression: <see cref="ModbusRegisterMap.FromJson"/> is shared with the Modbus TCP driver, where unit 0 is
/// legal and common. That test pins the refusal's ABSENCE here, and
/// <c>ModbusRtuDriverLoopbackTests.Construction_WithUnitZero_…</c> pins its presence at the RTU construction
/// boundary. A future edit that "helpfully" moves the check into the shared path fails the first; one that
/// deletes it altogether fails the second.</para>
/// </summary>
public class ModbusMultidropMapTests
{
    private const string BusId = "rs485-line1";

    /// <summary>One device, as a standalone single-device map document — the exact shape every map shipped
    /// before D-4 already has.</summary>
    private static string DeviceJson(
        string machineCode, int unitId, string metric = "temperature", int pollIntervalMs = 1000,
        string extraFields = "") =>
        $$"""
        {"machineCode":"{{machineCode}}","unitId":{{unitId}},"pollIntervalMs":{{pollIntervalMs}}{{extraFields}},"registers":[{"address":0,"type":"Holding","dataType":"UInt16","scale":1.0,"metric":"{{metric}}","unit":"C"}]}
        """;

    private static string BusJson(params string[] devices) =>
        "{\"devices\":[" + string.Join(",", devices) + "]}";

    // ─────────────────────────────────────────────────────────────────────
    // The fan-out itself.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ATwoDeviceBus_FansOutIntoTwoDevices_EachCarryingItsOwnMachineCodeUnitIdAndRegisters()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 1, metric: "temperature"),
            DeviceJson("LINE1-B", unitId: 7, metric: "pressure"));

        var devices = ModbusMultidropMap.FanOut(json, BusId);

        Assert.Equal(2, devices.Count);

        Assert.Equal("LINE1-A", devices[0].MachineCode);
        Assert.Equal((byte)1, devices[0].UnitId);
        Assert.Equal("temperature", devices[0].Map.Registers.Single().Metric);

        Assert.Equal("LINE1-B", devices[1].MachineCode);
        Assert.Equal((byte)7, devices[1].UnitId);
        Assert.Equal("pressure", devices[1].Map.Registers.Single().Metric);

        // Document order, not dictionary order — an operator reading a log against their file has to be able
        // to follow it.
        Assert.Equal(new[] { "LINE1-A", "LINE1-B" }, devices.Select(d => d.MachineCode));
    }

    /// <summary>
    /// 🔴 <b>The property the whole design rests on:</b> what each connector instance STORES is a standalone
    /// single-device document that cannot declare a second machine. Blueprint §7.1's unsafe shape — one blob to
    /// one factory producing one driver that emits N machine codes — is unreachable downstream precisely
    /// because this is what the factory is handed.
    ///
    /// <para>Asserted three ways, because "it looks like a device map" is not the claim. It re-parses through
    /// the ordinary <see cref="ModbusRegisterMap.FromJson"/> to exactly this device; fanning it out again
    /// yields exactly ONE device; and the sibling's machine code does not appear in it at all — a fan-out that
    /// handed every instance the whole bus document would pass the first two and fail the third.</para>
    /// </summary>
    [Fact]
    public void EachFannedOutDevicesConfig_IsAStandaloneSingleDeviceDocument_ThatCannotDeclareASecondMachine()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 1),
            DeviceJson("LINE1-B", unitId: 7));

        var devices = ModbusMultidropMap.FanOut(json, BusId);

        foreach (var device in devices)
        {
            var reparsed = ModbusRegisterMap.FromJson(device.MapJson);
            Assert.Equal(device.MachineCode, reparsed.MachineCode);
            Assert.Equal(device.UnitId, reparsed.UnitId);
            Assert.Single(reparsed.Registers);

            Assert.Single(ModbusMultidropMap.FanOut(device.MapJson, "whatever"));
        }

        Assert.DoesNotContain("LINE1-B", devices[0].MapJson, StringComparison.Ordinal);
        Assert.DoesNotContain("LINE1-A", devices[1].MapJson, StringComparison.Ordinal);
    }

    /// <summary>The instance id is derived from the UNIT id, and the ids are distinct — distinctness is what
    /// makes N registry entries and N pipeline slots possible at all, and the derivation is asserted against
    /// <see cref="ModbusMultidropMap.DeviceInstanceId"/> rather than against a restated literal so the format
    /// lives in one place.</summary>
    [Fact]
    public void MultidropDeviceInstanceIds_AreDerivedFromTheUnitId_AndAreDistinct()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 1),
            DeviceJson("LINE1-B", unitId: 7),
            DeviceJson("LINE1-C", unitId: 200));

        var devices = ModbusMultidropMap.FanOut(json, BusId);

        Assert.Equal(3, devices.Select(d => d.InstanceId).Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(ModbusMultidropMap.DeviceInstanceId(BusId, 1), devices[0].InstanceId);
        Assert.Equal(ModbusMultidropMap.DeviceInstanceId(BusId, 7), devices[1].InstanceId);
        Assert.Equal(ModbusMultidropMap.DeviceInstanceId(BusId, 200), devices[2].InstanceId);

        // 🔴 Review m1 — the LITERAL format, pinned exactly once. Every other assertion in this suite goes
        // through DeviceInstanceId, which compares the generator with itself and would survive any change to
        // the format. That format is load-bearing: it becomes the pipeline slot label and therefore the alarm
        // TargetId, so a silent change forks an operator's acknowledged alarms once D-7 wires this up.
        Assert.Equal("rs485-line1:unit7", devices[1].InstanceId);

        // The bus id is a prefix of each device id, so an operator grepping a log for their connector's name
        // finds every device on it.
        Assert.All(devices, d => Assert.StartsWith(BusId, d.InstanceId, StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 A map that exists TODAY keeps its exact instance id — and therefore its pipeline slot label and its
    /// alarm <c>TargetId</c> — when a registration path starts calling this method instead of
    /// <see cref="ModbusRegisterMap.FromJson"/>. The discriminating assertion is the id, not the count: a
    /// fan-out that produced <c>rs485-line1:unit1</c> here would also produce one device, and would silently
    /// fork every existing operator's acknowledged alarms on upgrade.
    /// </summary>
    [Fact]
    public void ALegacySingleDeviceMap_FansOutToOneDevice_KeepingTheBusInstanceIdVerbatim()
    {
        var json = DeviceJson("LEGACY-1", unitId: 3);

        var devices = ModbusMultidropMap.FanOut(json, BusId);

        var only = Assert.Single(devices);
        Assert.Equal(BusId, only.InstanceId);
        Assert.NotEqual(ModbusMultidropMap.DeviceInstanceId(BusId, 3), only.InstanceId);
        Assert.Equal("LEGACY-1", only.MachineCode);
        Assert.Equal((byte)3, only.UnitId);
        Assert.Same(json, only.MapJson);
    }

    // ─────────────────────────────────────────────────────────────────────
    // The refusals, each with the silent failure it prevents.
    // ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void TwoDevicesAtOneSlaveAddress_AreRefused_NamingBothMachines()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 4),
            DeviceJson("LINE1-B", unitId: 4));

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, BusId));

        // Both machines, because "unit 4 is duplicated" leaves the operator to find which two of eight devices
        // collide.
        Assert.Contains("LINE1-A", ex.Message, StringComparison.Ordinal);
        Assert.Contains("LINE1-B", ex.Message, StringComparison.Ordinal);
        Assert.Contains("unit id 4", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>Case-insensitive, matching every other machine-code comparison in this codebase
    /// (<c>ConnectorRegistry.Register</c>'s claim gate, <c>FleetHost.RegisterMachine</c>'s duplicate guard).
    /// A case-SENSITIVE check here would let the document through and the collision would then be resolved by
    /// the registry refusing the second claim — i.e. a device silently missing, with the reason in a log.</summary>
    [Fact]
    public void TwoDevicesClaimingOneMachine_AreRefused_EvenWhenTheCodesDifferOnlyByCasing()
    {
        var json = BusJson(
            DeviceJson("Line1-A", unitId: 1),
            DeviceJson("LINE1-a", unitId: 2));

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, BusId));

        Assert.Contains("LINE1-a", ex.Message, StringComparison.Ordinal);
        Assert.Contains("unit 1", ex.Message, StringComparison.Ordinal);
        Assert.Contains("unit 2", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ADocumentDeclaringBothABusAndADeviceAtTheRoot_IsRefused()
    {
        var withMachineCode = "{\"machineCode\":\"ROOT\",\"devices\":[" + DeviceJson("LINE1-A", 1) + "]}";
        var withRegisters =
            "{\"registers\":[{\"address\":0,\"type\":\"Holding\",\"dataType\":\"UInt16\",\"scale\":1.0,\"metric\":\"m\"}],\"devices\":["
            + DeviceJson("LINE1-A", 1) + "]}";

        var byCode = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(withMachineCode, BusId));
        Assert.Contains("machineCode", byCode.Message, StringComparison.Ordinal);

        var byRegisters = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(withRegisters, BusId));
        Assert.Contains("registers", byRegisters.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// 🔴 Review I-2 — <b>EVERY device-level key is refused at the root, not only the two that are mandatory.</b>
    ///
    /// <para>The first version of the check listed only <c>machineCode</c> and <c>registers</c>, on the reasoning
    /// that a root declaring a REQUIRED field is obviously declaring a device. That is the wrong test, and the
    /// gap it left is exactly the failure the no-inheritance decision exists to prevent:
    /// <c>{"pollIntervalMs": 5000, "devices": […]}</c> parsed cleanly and every device silently ran its own value
    /// or the default, so the file on disk and the configuration actually running were two different things.
    /// The right test is "could a reader believe this applies to the bus", and that set is every key the
    /// per-device parse consumes.</para>
    ///
    /// <para>Each key is asserted individually rather than as one representative, because a mutation deleting
    /// one entry from the list would survive a test that only checked another.</para>
    /// </summary>
    [Theory]
    [InlineData("\"unitId\":9")]
    [InlineData("\"pollIntervalMs\":5000")]
    [InlineData("\"readTimeoutMs\":250")]
    [InlineData("\"retries\":3")]
    [InlineData("\"commands\":[]")]
    public void EveryDeviceLevelKeyAtTheRoot_IsRefused_NotOnlyTheMandatoryOnes(string rootField)
    {
        var json = "{" + rootField + ",\"devices\":[" + DeviceJson("LINE1-A", 1) + "]}";

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, BusId));

        // Names the field it found — an operator with a bus of eight needs to know WHICH root key is the problem.
        var fieldName = rootField.Split(':')[0].Trim('"');
        Assert.Contains(fieldName, ex.Message, StringComparison.Ordinal);
        Assert.Contains("nothing is inherited from the bus level", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void AnEmptyDeviceList_IsRefused()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut("{\"devices\":[]}", BusId));
        Assert.Contains("devices", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>A device element that will not parse fails the whole document — and the message names WHICH
    /// element. The discriminating assertion is the position: <see cref="ModbusRegisterMap.FromJson"/>'s own
    /// message ("'registers' must contain at least one entry") is already present without the wrapper, so
    /// asserting only on it would pass with the wrapper deleted.</summary>
    [Fact]
    public void ADeviceElementThatIsNotAValidSingleDeviceMap_NamesWhichDeviceFailed()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 1),
            "{\"machineCode\":\"LINE1-B\",\"unitId\":2,\"registers\":[]}");

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, BusId));

        Assert.Contains("devices[1]", ex.Message, StringComparison.Ordinal);
        Assert.Contains("registers", ex.Message, StringComparison.Ordinal);
        // The original failure survives as the inner exception rather than being replaced by the wrapper.
        Assert.IsType<InvalidOperationException>(ex.InnerException);
    }

    /// <summary>
    /// 🔴 <b>The first version of this test could not fail, and a mutation is what said so.</b> It asserted only
    /// that the message named <c>devices[0]</c> — which the generic
    /// "this element is not a valid single-device map" wrapper ALSO does, because a nested bus has no
    /// <c>registers</c> of its own and <see cref="ModbusRegisterMap.FromJson"/> rejects it for that instead.
    /// Deleting the dedicated check therefore changed only the WORDING, and the assertion could not see it.
    ///
    /// <para>What the dedicated check buys is exactly that wording — "a bus of buses is not a shape this format
    /// has" is actionable where "'registers' must contain at least one entry" sends an operator looking at the
    /// wrong thing — so the assertions are now on the two facts that distinguish the two paths: the phrase, and
    /// the ABSENCE of an inner exception (the wrapper always carries the original failure as one).</para>
    /// </summary>
    [Fact]
    public void ANestedDevicesArray_IsRefused_AsABusOfBuses_NotAsAMalformedDevice()
    {
        var json = BusJson("{\"devices\":[" + DeviceJson("LINE1-A", 1) + "]}");

        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut(json, BusId));

        Assert.Contains("devices[0]", ex.Message, StringComparison.Ordinal);
        Assert.Contains("bus of buses", ex.Message, StringComparison.Ordinal);
        Assert.Null(ex.InnerException);
    }

    [Fact]
    public void ADeviceElementThatIsNotAnObject_IsRefused()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => ModbusMultidropMap.FanOut("{\"devices\":[1,2]}", BusId));
        Assert.Contains("devices[0]", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ADevicesPropertyThatIsNotAnArray_IsRefused()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => ModbusMultidropMap.FanOut("{\"devices\":{}}", BusId));
        Assert.Contains("devices", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ADocumentWhoseRootIsNotAnObject_IsRefused()
    {
        var ex = Assert.Throws<InvalidOperationException>(() => ModbusMultidropMap.FanOut("[]", BusId));
        Assert.Contains("object", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void ABlankBusInstanceId_IsRefused()
    {
        Assert.Throws<ArgumentException>(() => ModbusMultidropMap.FanOut(DeviceJson("A", 1), "  "));
    }

    /// <summary>Malformed JSON reaches the caller as <see cref="JsonException"/>, unwrapped — the same
    /// contract <see cref="ModbusRegisterMap.FromJson"/> has, so a registration path's existing catch behaves
    /// identically for a bus map and a single-device map.</summary>
    [Fact]
    public void MalformedJson_ThrowsTheSameWayASingleDeviceMapDoes()
    {
        const string malformed = "{ not json";

        var fromFanOut = Assert.ThrowsAny<JsonException>(() => ModbusMultidropMap.FanOut(malformed, BusId));
        var fromSingle = Assert.ThrowsAny<JsonException>(() => ModbusRegisterMap.FromJson(malformed));

        // The same exception TYPE, not merely both-throw: a registration path's existing catch is written
        // against what FromJson raises, and a fan-out that wrapped it would change what that catch sees.
        Assert.Equal(fromSingle.GetType(), fromFanOut.GetType());
    }

    /// <summary>Every device's tolerant-field warnings reach the caller's callback, tagged by
    /// <see cref="ModbusRegisterMap.FromJson"/> itself. Without forwarding, a fat-fingered
    /// <c>readTimeoutMs</c> on device 5 of a bus of eight would be silently replaced by the derived default
    /// with nothing said — the one case that file's parse deliberately does NOT fail on.</summary>
    [Fact]
    public void APerDeviceTolerantFieldWarning_ReachesTheCallersCallback()
    {
        var json = BusJson(
            DeviceJson("LINE1-A", unitId: 1),
            DeviceJson("LINE1-B", unitId: 2, extraFields: ",\"readTimeoutMs\":-5"));

        var warnings = new List<string>();
        var devices = ModbusMultidropMap.FanOut(json, BusId, warnings.Add);

        Assert.Equal(2, devices.Count);
        Assert.Contains(warnings, w => w.Contains("readTimeoutMs", StringComparison.Ordinal));
        // The value was ignored in favour of the derived default, exactly as for a single-device map.
        Assert.Equal(4_000, devices[1].Map.EffectiveReadTimeoutMs);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 Review I-1 — the bus-wide cost that IS decidable from the document.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>A device that can monopolise the shared bus is named, with the number, at parse time.</b> Every
    /// input to <see cref="ModbusRegisterMap.WorstCaseBusHoldMs"/> is in this document — register count, retry
    /// count, read timeout — so unlike bus THROUGHPUT (which needs the line rate) there is nothing undecidable
    /// about it, and saying nothing was the gap the review found.
    ///
    /// <para>The map here is the review's own example and is accepted by every other check in this class:
    /// <c>readTimeoutMs: 60000</c> (the map's own maximum) with <c>retries: 5</c> (likewise) over 20 registers
    /// = <c>20 × 6 × 60 000 = 7 200 000 ms</c>, about two hours of shared bus per poll cycle. The assertions are
    /// on the NUMBER and the device, not on the fact that some warning appeared.</para>
    /// </summary>
    [Fact]
    public void ADeviceThatCanHoldTheBusForHours_IsNamedWithItsNumber_AtParseTime()
    {
        var registers = string.Join(",", Enumerable.Range(0, 20).Select(i =>
            $"{{\"address\":{i},\"type\":\"Holding\",\"dataType\":\"UInt16\",\"scale\":1.0,\"metric\":\"m{i}\"}}"));
        var hog =
            "{\"machineCode\":\"BUS-HOG\",\"unitId\":1,\"pollIntervalMs\":1000,\"readTimeoutMs\":60000,\"retries\":5," +
            "\"registers\":[" + registers + "]}";

        var warnings = new List<string>();
        var devices = ModbusMultidropMap.FanOut(
            BusJson(hog, DeviceJson("LINE1-B", 2, pollIntervalMs: 1000, extraFields: ",\"readTimeoutMs\":250")),
            BusId, warnings.Add);

        // Parsed, not refused — see WarnAboutDevicesThatCanMonopoliseTheBus for why this warns.
        Assert.Equal(2, devices.Count);
        Assert.Equal(7_200_000L, devices[0].Map.WorstCaseBusHoldMs);

        var warning = Assert.Single(warnings, w => w.Contains("BUS-HOG", StringComparison.Ordinal));
        Assert.Contains("7200000", warning, StringComparison.Ordinal);
        Assert.Contains("20 register(s) × 6 attempt(s) × 60000 ms", warning, StringComparison.Ordinal);

        // The well-behaved sibling is NOT warned about — otherwise the warning would be noise rather than a
        // signal, which is the whole reason a threshold was chosen instead of always reporting the number.
        Assert.DoesNotContain(warnings, w => w.Contains("LINE1-B", StringComparison.Ordinal));
    }

    /// <summary>
    /// 🔴 The control for the warning above, and the reason the threshold is what it is: <b>a bus whose devices
    /// declare a read timeout sized for their actual round trip is silent.</b> Eight 8-register devices at a
    /// 1 s cadence with <c>readTimeoutMs: 300</c> hold the line for <c>8 × 2 × 300 = 4 800 ms</c> against the
    /// 7 000 ms of cadence their seven siblings are collectively asking for.
    ///
    /// <para>Without this test the check could be tightened to "always warn" and nothing would fail — and a
    /// warning that fires for every bus is exactly the noise §6 of task-4-report.md rejected.</para>
    /// </summary>
    [Fact]
    public void ACorrectlySizedBus_ProducesNoHoldWarningAtAll()
    {
        var eightRegisters = string.Join(",", Enumerable.Range(0, 8).Select(i =>
            $"{{\"address\":{i},\"type\":\"Holding\",\"dataType\":\"UInt16\",\"scale\":1.0,\"metric\":\"m{i}\"}}"));
        var device = new Func<int, string>(unit =>
            $"{{\"machineCode\":\"SIZED-{unit}\",\"unitId\":{unit},\"pollIntervalMs\":1000,\"readTimeoutMs\":300," +
            "\"registers\":[" + eightRegisters + "]}");

        var warnings = new List<string>();
        var devices = ModbusMultidropMap.FanOut(
            BusJson(Enumerable.Range(1, 8).Select(device).ToArray()), BusId, warnings.Add);

        Assert.Equal(8, devices.Count);
        Assert.Equal(4_800L, devices[0].Map.WorstCaseBusHoldMs);
        Assert.Empty(warnings);
    }

    /// <summary>
    /// A bus of ONE is never warned about, whatever its hold: with no siblings there is nobody to stall, and the
    /// hold is exactly the private cost <see cref="ModbusTcpDriver"/> has always paid on its own socket.
    ///
    /// <para>🔴 <b>Both document shapes, and the second is the one that matters — a mutation said so.</b> My
    /// first version of this test used only the LEGACY single-device document, and deleting the
    /// <c>devices.Count &lt; 2</c> guard survived it: that path returns early and never reaches the check at
    /// all, so the test was asserting against code it could not run. The shape the guard actually defends is a
    /// <c>devices</c> array with exactly ONE element, where the sum of the other devices' cadence is 0 and every
    /// such bus would otherwise be warned about. Both arms are here now — the legacy one because it is the
    /// common case, the one-element one because it is the reachable one.</para>
    /// </summary>
    [Fact]
    public void ABusOfOne_IsNeverWarnedAbout_InEitherDocumentShape()
    {
        var solo = DeviceJson("SOLO", 1, extraFields: ",\"readTimeoutMs\":60000");

        var legacyWarnings = new List<string>();
        var legacy = ModbusMultidropMap.FanOut(solo, BusId, legacyWarnings.Add);

        Assert.Single(legacy);
        Assert.Equal(120_000L, legacy[0].Map.WorstCaseBusHoldMs);   // 1 register × 2 attempts × 60 000 ms
        Assert.Empty(legacyWarnings);

        // 🔴 The arm that kills the mutation: a one-element `devices` array DOES reach the check.
        var arrayWarnings = new List<string>();
        var asArray = ModbusMultidropMap.FanOut(BusJson(solo), BusId, arrayWarnings.Add);

        Assert.Single(asArray);
        Assert.Equal(120_000L, asArray[0].Map.WorstCaseBusHoldMs);
        Assert.Empty(arrayWarnings);
    }

    /// <summary>The warning names the DOMINANT term, because the fix differs. A derived read timeout is the
    /// product's own default — <c>max(1000, PollIntervalMs × 4)</c>, reasoned for a dedicated TCP socket where a
    /// stalled read costs only its own device — and the operator simply has to declare one; a declared timeout is
    /// a number they chose. A message that said only "this is too long" would be equally true and not actionable.</summary>
    [Fact]
    public void WhenTheReadTimeoutIsDERIVED_TheWarningSaysSo_AndNamesTheDefaultAsTheCause()
    {
        var warnings = new List<string>();

        ModbusMultidropMap.FanOut(
            BusJson(DeviceJson("DERIVED-A", 1, pollIntervalMs: 1000), DeviceJson("DERIVED-B", 2, pollIntervalMs: 1000)),
            BusId, warnings.Add);

        var warning = Assert.Single(warnings, w => w.Contains("DERIVED-A", StringComparison.Ordinal));
        Assert.Contains("DERIVED", warning, StringComparison.Ordinal);
        Assert.Contains("max(1000, 1000 × 4) = 4000 ms", warning, StringComparison.Ordinal);
        Assert.Contains("declare 'readTimeoutMs'", warning, StringComparison.Ordinal);
    }

    // ─────────────────────────────────────────────────────────────────────
    // 🔴 The refusal that must NOT be here.
    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// 🔴 <b>Unit 0 (broadcast) and the reserved 248–255 parse fine here, and that is deliberate.</b> This
    /// document shape is transport-agnostic: the identical single-device element drives
    /// <see cref="ModbusTcpDriver"/>, where unit 0 is entirely legal and common (a TCP device that ignores the
    /// unit id, or a TCP→RTU gateway that uses it to select the serial slave). D-2's task-2-report.md §10b
    /// (m-9) records that implementing "reject unit 0 at parse time" literally would break those deployments to
    /// fix a problem they do not have.
    ///
    /// <para>This test exists so that "moving the check somewhere more convenient" fails loudly. Its twin —
    /// <c>ModbusRtuDriverLoopbackTests.Construction_WithUnitZero_IsRefused_…</c> — fails if the check is
    /// deleted instead. Neither test alone pins the decision; the pair does.</para>
    /// </summary>
    [Fact]
    public void UnitZero_IsNotRefusedHere_BecauseTheSameDocumentShapeDrivesModbusTcpWhereItIsLegal()
    {
        var busWithBroadcast = BusJson(
            DeviceJson("TCP-BROADCAST", unitId: 0),
            DeviceJson("TCP-RESERVED", unitId: 250));

        var devices = ModbusMultidropMap.FanOut(busWithBroadcast, BusId);

        Assert.Equal((byte)0, devices[0].UnitId);
        Assert.Equal((byte)250, devices[1].UnitId);

        // And the shared parse path itself is untouched — the single-device document a TCP connector stores
        // still parses with unit 0, which is the deployment m-9 protects.
        Assert.Equal((byte)0, ModbusRegisterMap.FromJson(DeviceJson("TCP-ONLY", unitId: 0)).UnitId);
    }
}
