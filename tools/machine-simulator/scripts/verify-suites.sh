#!/usr/bin/env bash
# verify-suites.sh — assert a POSITIVE expected quantity, never the absence of failure.
#
# WHY THIS EXISTS
# ---------------
# Đợt C hit seven distinct verification traps. Five produced a GREEN-LOOKING NUMBER,
# and four of those survive an exit-code check:
#
#   1. An orphaned `testhost` held file locks -> the build emitted errors, a project
#      never relinked, and the suite that followed ran against a half-copied output
#      directory and cascaded into ~100 bogus failures.
#   2. A crashed test host -> vstest printed `Passed!  - Failed: 0, Passed: 606`
#      with a TRUNCATED TOTAL, after a clean build, with exit code 0. The real
#      number was 735. This is the dangerous one: it looks like success.
#   3. A mutation that silently failed to apply -> a clean run that reads as
#      "the mutation survived, therefore this code is untested".
#   4. A stale binary after a skipped rebuild -> a spurious failure, nearly reported
#      as a defect. The batch already had a written rule against this and both an
#      implementer and a reviewer still walked into it.
#   5. Vacuous tests -> seven caught in this project, EVERY ONE by mutation and
#      NONE by reading, including two written by authors who had just read a report
#      about that exact failure mode.
#   6. A genuinely hung suite -> the host stays alive, nothing is printed, and the
#      run never ends. Handled by the CPU sample below.
#   7. 🔴 THIS SCRIPT'S OWN HANG CHECK, on its first real run (C-7), and it was wrong
#      TWICE for two different reasons:
#        (a) it sampled `ps -W | awk '{print $NF}'`, which on Windows is the
#            executable PATH -- a CONSTANT -- so the two samples always matched and
#            EVERY suite running longer than 90s was killed and reported HUNG. It
#            killed the two largest suites and passed the three short ones, which is
#            exactly what makes the verdict look plausible.
#        (b) with a REAL CPU sample in place, one flat 30s window still is not a
#            hang: a suite awaiting a timer burns no CPU. The very next run killed a
#            suite that had passed 735/735 minutes earlier. It now needs several
#            consecutive flat windows.
#      Both fixes, and why the tolerance is deliberately lopsided, are at the check.
#
# The shape of 1-5 is always the same: AN ABSENT NEGATIVE READ AS A POSITIVE. Trap 7
# is its inversion -- A HEALTHY POSITIVE READ AS A FAILURE -- and it costs the same,
# because a verification tool that cries wolf gets its output ignored. Awareness of a
# failure mode does not prevent it; only a check that runs every time does. So this
# asserts exact totals rather than "no failures", and refuses to look at any test
# number until the build reports 0 errors.
#
# USAGE
#   scripts/verify-suites.sh                 # verify against the expected totals below
#   scripts/verify-suites.sh --update        # print the observed totals, to update them
#
# Run from tools/machine-simulator. Prints exactly one PASS/FAIL line at the end.

set -uo pipefail

# Expected per-suite totals. Update deliberately when a task adds tests, and state
# the new numbers in the task report -- a changed total is a fact to be justified,
# not a number to be pasted over.
EXPECT_ABSTRACTIONS=151
EXPECT_CONFORMANCE=22
# chore/test-hygiene raised this 735 -> 741 (+6): guards proving the test-isolation seam added to
# CredentialStore, which was the only one of FOURTEEN stores without one — which is exactly why
# 2,999 DPAPI blobs accumulated in the product's REAL credential directory, dating to 2026-07-18.
# 🔴 Đợt D, D-1 re-review — this total is UNCHANGED at 741, and that is the point. A reviewer's gate run
# came back EdgeCore 740/741 on WalFlushPumpTests.Pump_DrainsAnIdleBacklogOnItsOwnTimer_..., an IOException
# out of File.ReadAllLines (not out of any assertion), reproducing 1 run in 4. Byte-for-byte the defect Đợt C
# closed in StoreAndForwardRestartSurvivalTests: a FileShare.Read reader opened against a LIVE writer — the
# pump is `await using`, so it is still ticking on the assertion line, and every tick's drain ends in the
# vendored SDK's unconditional File.WriteAllText(queuePath, ""). Fixed at the mechanism in all three of this
# file's reads by disposing the pump first (DisposeAsync cancels the loop AND awaits it, so no handle can be
# open afterwards) — no retry, no share-mode tolerance, NO NEW TUNABLE, and no test added or removed. The
# reviewer's 1-in-4 became 0 failures in 12 consecutive runs, but the load-bearing argument is the mechanism,
# not the sample: after DisposeAsync returns there is no writer for the read to collide with.
# 🔴 Đợt D, D-2 raises this 741 -> 787 (+46).
#
# 🔴 COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand. The previous revision of this block
# said 7/4/8/12/8 where the truth was 7/4/9/11/8 — two files wrong, and the two errors CANCELLED, so the
# grand total was right and the justification was not. That is the failure mode this per-file breakdown
# exists to prevent: a total that reconciles is not evidence that anybody knows where the tests are. Both
# numbers now come from the runner enumerating them.
#
#     + 8  ModbusRtuDriverLoopbackTests      (new) — a real read against an in-process RTU slave; Input
#                                             registers read through FC04 not FC03; two drivers on ONE bus
#                                             each reading their own slave address; the driver handing the bus
#                                             ITS OWN map's timeout and retry count; the device going quiet
#                                             (Health degrades, iterator survives); Health never reporting
#                                             Connected even transiently against a device that never answers;
#                                             construction opening no link; disposal releasing the lease once.
#     + 6  ModbusBusCancellationTests        (new) — the task's non-negotiable: cancel while queued for the
#                                             bus; cancel an in-flight read WITHOUT rebuilding the link; a
#                                             second device on the same bus still reading correctly after the
#                                             first one's cancellation; a cancellation BETWEEN two registers
#                                             leaving the bus clean; an aborted read never retrying even when
#                                             the transport allows three; an already-cancelled token refused at
#                                             the arbitration gate.
#     + 9  ModbusBusResynchronisationTests   (new) — the post-timeout bus state: the hazard demonstrated
#                                             against raw NModbus; the late frame discarded; the quiet window
#                                             restarting rather than expiring on a schedule; a fresh link NOT
#                                             clearing the quarantine; exactly one request on the wire
#                                             (Retries honoured); a transaction that executed nothing staying
#                                             clean; a clean transaction costing the next one nothing; a bus
#                                             that never goes quiet being refused AND its link rebuilt; the
#                                             arbitration lock surviving that refusal.
#     +15  ModbusBusRegistryTests            (new) — the sharing/refcount contract D-4 consumes: sharing per
#                                             key, distinct keys, one release vs the last release, a double
#                                             release decrementing once, re-acquire after disposal, registry
#                                             disposal, acquire-after-disposal, the settings defaults and their
#                                             validation, 32 concurrent acquires, BeginTransactionAsync's own
#                                             argument validation (3 cases) and its one-operation-at-a-time
#                                             guard.
#     + 8  GatewayTcpBusLinkTests            (new) — the RTU-over-TCP transport: DiscardInBuffer head to head
#                                             against NModbus's own TcpClientAdapter, abort-without-close,
#                                             the bounded timeout, the hang-up, disposal, RTU end to end over
#                                             a real socket, the bus-key rule, and a dead endpoint.
#
# Eight of those 46 exist only because a mutation survived an earlier version of this suite: a fresh link
# clearing the quarantine; Transport.Retries left at NModbus's own default of 3; Health reporting Connected
# transiently; DiscardInBuffer's own hook being unwired from the drain it delegates to; the quiet window's
# TRAILING silence; the FC04 (Input register) arm, which no RTU map in the suite had ever declared; and the
# driver's own map reaching the bus at all. The 46th (AnAbortedInFlightRead_NeverRetries_...) pins a property
# of a THIRD-PARTY exception filter rather than of this code: NModbus happens not to retry the
# OperationCanceledException the abort throws from inside its own retry loop, and nothing here would notice if
# that changed — a retried abort re-transmits a request whose caller has given up, which on D-5's write path is
# a physical double-actuation. Verified to have teeth: making the link throw TimeoutException instead makes the
# same test see 32 bytes (four attempts) rather than 8. See task-2-report.md §8 — none was found by reading.
#
# EVERY OTHER SUITE IS UNCHANGED, and that is a check rather than a coincidence: D-2 adds no code outside
# src/St4i.EdgeCore/Drivers/Modbus, so a moved total anywhere else would mean this task reached somewhere it
# had no business reaching. In particular EXPECT_CONFORMANCE stays 22 — RTU conformance wiring is D-6 — and
# every pre-existing Modbus test passes UNCHANGED (verified: 114/114 on four consecutive baseline runs at
# 36d9454c). The D-2 review fix round also rewrites two PRE-EXISTING conformance helpers
# (Modbus/OpcUaDriverConformanceTests' FindAndReleaseFreePort -> Drivers/ClosedLoopbackPort) and adds NO test
# for them: a released ephemeral port can be reassigned to another test's listener, which is what made an
# unrelated TLS test fail once. A moved total there would mean that rewrite was not behaviour-preserving.
#
# 🔴 Đợt D, D-3 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-3-brief.md) raises this
# 787 -> 817 (+30). D-3 adds the NATIVE SERIAL transport — Modbus RTU over a real COM port — in its OWN
# assembly (src/St4i.EdgeCore.Serial), which is the only place in the product allowed to depend on
# System.IO.Ports. Every number below is COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand,
# for the reason D-2 wrote down: a total that reconciles is not evidence that anybody knows where the tests
# are.
#
#     + 9  SerialLineSettingsTests          (new) — the line parameters of one RS-485 segment: the defaults
#                                            are the MODBUS spec's 19200-8-E-1 and not SerialPort's own
#                                            9600-8-N-1 (asserted against a real SerialPort as the control,
#                                            so the test is about the decision rather than about reading back
#                                            the numbers written in the type); six rows of lines a port cannot
#                                            honour (baud <= 0, 7/9 data bits, StopBits.None/OnePointFive);
#                                            a blank port name; and the port-name normalisation, because
#                                            "com3" and "COM3" are one physical port and the bus key is built
#                                            from that string.
#     +14  SerialPortBusLinkTests           (new) — the transport itself, to the exact extent a machine with
#                                            no RS-485 hardware can drive it: SerialPort.DiscardInBuffer
#                                            verified to reach Kernel32.PurgeComm while TWO of NModbus's three
#                                            own adapters are 1-IL-byte empty bodies (the brief's "verify,
#                                            don't trust the name" obligation, discharged by reading the
#                                            shipped IL because no loopback exists to measure it
#                                            behaviourally); the port configured from an explicit line AND
#                                            from the default line (both arms — D-2's I-2 lesson); the
#                                            handshake forced off and RTS left deasserted, which is the
#                                            RS-485 direction-control decision; four theory rows proving the
#                                            bus key distinguishes every line parameter, plus its
#                                            case-insensitivity; an absent port failing with the port AND its
#                                            framing in the message; the abort check firing BEFORE the port is
#                                            touched (with the cleared-abort arm as the discriminator); the
#                                            write timeout reaching the port object; a closed port draining to
#                                            nothing without throwing, and disposal being idempotent; and two
#                                            registry tests — two connectors on one line sharing ONE bus and
#                                            ONE open, and two connectors that disagree about baud rate
#                                            getting TWO buses rather than one silently shared port.
#     + 7  SerialDependencyScopingTests     (new) — the STRUCTURAL proof the brief demands instead of
#                                            inspection: the three shipping executables (EdgeService, EngineApi,
#                                            the WPF shell) carry no System.IO.Ports.dll; St4i.EdgeCore — which
#                                            holds ModbusBus, the RTU framing and GatewayTcpBusLink — references
#                                            neither the package nor the serial assembly; plus THREE positive
#                                            controls without which those FOUR would be vacuous (this test
#                                            assembly's own output DOES carry the DLL, the serial assembly DOES
#                                            reference the package, and the output search refuses a project that
#                                            was never built rather than reporting it clean). 4 + 3 = the 7 above.
#                                            (Review M-6: this said "those five" — a hand-kept count that drifted
#                                            when the never-built guard landed.)
#
# Six of those 30 exist only because a mutation survived an earlier version of this suite: the "never built"
# guard (which every caller bypassed, so nothing ever ASKED it — a reachability gap a mutation cannot find on
# its own); the abort check and the write timeout (unreachable until an internal Adopt() let a test drive the
# pre-I/O half of those members without hardware); the write timeout's non-positive arm (the test originally
# used -1, which IS SerialPort.InfiniteTimeout, so its expected value coincided with its input); and the read
# slice's own bound, which is that defect's sibling found by sweeping rather than by care.
#
# 🔴 FIVE mutations still SURVIVE and are recorded rather than papered over — see task-3-report.md §8. Four of
# the five need a COM port with something on the other end of it, which no CI machine and no portable virtual
# COM pair provides; the fifth is untestable by construction. Nothing hardware-conditional was committed: a
# dynamically skipped test would fail this very gate, which expects 0 skipped.
#
# EVERY OTHER SUITE IS UNCHANGED, and that is the check rather than a coincidence: D-3 adds no code outside
# src/St4i.EdgeCore.Serial and tests/St4i.EdgeCore.Tests. In particular EXPECT_ABSTRACTIONS stays 151 even
# though St4i.Connector.Abstractions.Tests owns the sibling "this assembly references only the BCL" guard, and
# EXPECT_CONFORMANCE stays 22 because RTU conformance wiring is D-6. D-3 also EXTRACTS MakaretuNotShippedTests'
# solution-root walk and output search into tests/St4i.EdgeCore.Tests/BuildOutputProbe.cs so the new scoping
# suite shares one implementation rather than growing a second copy that can drift silently — that rewrite is
# behaviour-preserving and adds NO test (MakaretuNotShippedTests stays at 3, counted from the runner). A moved
# total there would mean it was not.
#
# 🔴 D-3's REVIEW FIX round raises this 817 -> 824 (+7), all in SerialPortBusLinkTests (14 -> 21), counted
# from the runner. Every one closes something the review found; none is a rewrite or a split:
#   + 1  I-1  Read_WithAZeroLengthCount_ReturnsImmediately_WithoutTouchingThePort. SerialPort.Read(buf,0,0)
#             returns 0 WITHOUT WAITING (measured: 0.46 ms; a bare loop over it ran at 33 MILLION
#             iterations/second), so a zero count fell through the `read > 0` check and span the loop holding
#             the bus's arbitration lock and a core — with no deadline at all when ReadTimeout <= 0.
#             GatewayTcpBusLink never had this because Socket.Poll consumes its slice whatever the count is:
#             a divergence between two links on one seam that the report's own §8.6 was written to catch and
#             did not. The discriminating assertion is that the port is CLOSED, so anything that reached it
#             would throw.
#   + 1  I-2  EveryLink_PinsThePortsReadTimeoutToOneSlice_HoweverItWasConstructed. The slice pin lived in
#             CreatePort, so Adopt produced a link whose port kept SerialPort's own default of -1
#             (InfiniteTimeout) — the unbounded blocking read measured as releasable by nothing but Dispose(),
#             i.e. Đợt B's forbidden mechanism on a shared bus. All three mutations defending the pin targeted
#             CreatePort, so the evidence had a hole the same shape as the code. The pin moved to the
#             constructor; the test's first assertion (the factory leaves the BCL default alone) is what makes
#             the second one discriminating.
#   + 4  I-3  The four members that were unreachable while the class held a concrete SerialPort — every member
#             of which is non-virtual and which cannot be constructed without hardware. A ~40-line internal
#             ISerialPortHandle (7 members) with a real-backed impl and a fake whose every behaviour was
#             MEASURED against a real port makes them CI-testable: the drain's true count (M19b, the most
#             consequential survivor), the outer deadline (M21b), the between-slice abort recheck with the
#             port left OPEN, and a read returning as soon as a byte arrives. Same move D-2 made when
#             NModbus's IStreamResource could not be driven.
#   + 1        AnRtuFrameRoundTripsThroughThisLinksOwnReadAndWrite — a real NModbus RTU master and slave on
#             opposite ends of a paired handle, so real CRC, real t3.5 framing and real slave dispatch pass
#             through THIS transport's own Read/Write rather than through D-2's in-memory link. It narrows
#             "no Modbus frame has ever traversed this transport" to "…has ever traversed a real SerialPort".
#             Verified to have teeth: truncating the write by one byte kills it.
#
# The hardware half is now a COMMITTED, runnable artefact — tools/serial-bench, an executable OUTSIDE the five
# suites, so `skipped == 0` is untouched. That constraint is right and the brief was wrong about it: xUnit
# counts a dynamically skipped test in Total, so a hardware-conditional suite would make Skipped
# environment-dependent and any fixed expectation would fail on the BETTER-equipped machine — trap #2 in a
# hardware costume. It is in the solution so this gate's build keeps it compiling, and it adds no test.
#
# 🔴 D-3's SECOND review round raises this 824 -> 825 (+1), in SerialPortBusLinkTests (21 -> 22), for M-10:
#   + 1  DrainBufferedInput_WhenThePortIsTornDownMidDrain_ReturnsWhatItAlreadyRemoved_RatherThanThrowing.
#        The drain swallowed the two "the port went away underneath me" shapes around BytesToRead and NOT
#        around Read, so a disposal landing between them threw out of the drain — and
#        ModbusBus.ResynchroniseAsync turns any throw from there into ModbusBusResynchronisationException +
#        FaultLink(). Noisier teardown rather than a wrong number, but the half-guarded shape was the defect.
#        The test has TWO arms because the drain touches the port twice per iteration and a mutation aimed at
#        the Read catch matched the BytesToRead one instead and SURVIVED — fixing one instance of a defect
#        class buys no immunity to the class. Its load-bearing assertion is that PARTIAL progress is still
#        reported: a `catch { return 0; }` would pass a "doesn't throw" test while telling the quiet window
#        the line had been silent when 512 bytes had just come off it.
#
# 🔴 GatewayTcpBusLink gets the IDENTICAL one-line fix in the same commit and adds NO test. It is a shared
# nit, not a serial regression, and fixing only the serial one would create exactly the two-links-on-one-seam
# divergence D-3's report §8.6 exists to catch. It is untestable for the same reason the serial drain was
# before review I-3 — that class holds a concrete TcpClient — and the mutation disabling it SURVIVES and is
# recorded as such rather than papered over. All 198 Drivers.Modbus tests pass unchanged, which is the check
# that the edit is behaviour-preserving.
#
# 🔴 TASK D-4 (multidrop) raises this 825 -> 850 (+25), counted from the runner (`dotnet test --list-tests`),
# not by hand. Three files; none is a rewrite, a split or a deletion:
#   +17  ModbusMultidropMapTests      (new file — how a bus of N devices is DECLARED and how it fans out)
#   + 5  ModbusMultidropBusTests      (new file — N devices actually RUNNING on one bus)
#   + 3  ModbusRtuDriverLoopbackTests (8 -> 11 — the RTU addressing boundary; see below)
#
# The 17 map tests are each a configuration that would otherwise fail SILENTLY or WRONGLY rather than throw:
# two devices at one slave address (both answer, the frames collide, and the master decodes whichever survived
# — a plausible wrong number); two devices claiming one machine (the second silently never registers, and the
# reason is a log line); a bus declaring no devices (indistinguishable from a connector that failed); a device
# element that will not parse (an error naming no device out of eight). Plus the ONE refusal that is
# deliberately ABSENT: unit 0 parses fine here, because this document shape is shared with the Modbus TCP
# driver where unit 0 is legal and common — D-2's own m-9 correction, which is why the RTU rule lives at the
# RTU CONSTRUCTION boundary instead, i.e. the 3 tests below.
#
# The +3 in ModbusRtuDriverLoopbackTests are that boundary and its control: unit 0 (broadcast — a read to it
# can NEVER be answered, and on a multidrop bus each of those timeouts holds the shared arbitration lock for a
# full read timeout), units 248-255 (reserved by MODBUS over Serial Line V1.02 §2.2 — a separate check with a
# separate message, so a mutation deleting one leaves the other standing), and BOTH EDGES of the addressable
# range accepted, because a refusal that is too WIDE takes a legitimately-addressed device off the bus while
# blaming the operator. That last one is the control: without it, narrowing the range to 1..127 kills nothing.
#
# 🔴 The 5 bus tests MEASURE the costs of sharing one wire rather than asserting them, and each prints its own
# figures (`--logger "console;verbosity=detailed"`) so nobody has to take task-4-report.md's word for them —
# D-3's reviewer had to rewrite its whole hardware probe to check its numbers. On this machine:
#   * one timeout quarantines the bus ONCE for the WHOLE bus (14 stale bytes discarded, both healthy devices
#     reading again 92 ms later against a 50 ms quiet window) — NARROWER than D-2 §5.5's own wording, which
#     reads as though every device pays a window;
#   * one unanswered device collapses two healthy devices from 135.0 to 2.0 reads/s — a 67.5x tax, three
#     orders of magnitude worse than the quarantine, and the finding of the task;
#   * a device polling at 200 ms hit 15 of a nominal 15 polls while three others completed 119,069 flat out —
#     not starved, because the driver delays AFTER each poll rather than on a schedule.
# The two ratio tests compare a rate against a rate measured on the SAME machine in the SAME test and assert a
# 4x margin against a ~50x effect, so they state a mechanism rather than a machine's speed.
#
# 28 mutations, all KILLED, every round opened with a positive control and every verdict gated on all five
# verbs of scripts/mutate-guard.sh. One SURVIVED on the first pass and was a real vacuous test: the
# nested-`devices` refusal could be deleted with every test green, because the generic "this element is not a
# valid single-device map" wrapper names the same element index. What the dedicated check buys is the WORDING,
# so the assertions are now on the phrase and on the ABSENCE of an inner exception. One reported NOT-APPLIED
# (a needle that no longer matched the source) and was re-run rather than read as a gap.
#
# EXPECT_ENGINEAPI moves too (+6) because the fan-out's REGISTRATION half necessarily lives beside
# ConnectorRegistry — see its own note below. EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE
# are deliberately unchanged: D-4 adds no code outside src/St4i.EdgeCore/Drivers/Modbus,
# src/St4i.EngineApi/Config and their two test projects, so a moved total anywhere else would mean this task
# reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays 22 — RTU conformance
# wiring is still D-6.
#
# 🔴 D-4's REVIEW FIX round raises this 850 -> 860 (+10), counted from the runner. Two files:
#   + 9  ModbusMultidropMapTests      (17 -> 26)
#   + 1  ModbusRtuDriverLoopbackTests (11 -> 12)
# ModbusMultidropBusTests stays 5 — the m2/m7 fixes there change only what the test PRINTS, not what it
# asserts, and a moved total would mean they did more than that.
#
#   + 5  I-2  EveryDeviceLevelKeyAtTheRoot_IsRefused_NotOnlyTheMandatoryOnes — one InlineData per device-level
#             key. {"pollIntervalMs": 5000, "devices": […]} parsed cleanly and every device silently ran its
#             own value: verbatim the failure the class's own no-inheritance doc uses to justify itself, left
#             reachable by the check written to prevent it. The first list held only the two MANDATORY fields
#             — the wrong test; the right one is "could a reader believe this applies to the bus", which is
#             every key the per-device parse consumes. Each key is a separate case because a mutation deleting
#             one entry survives a test that checks another.
#   + 3  I-1  The worst-case arbitration hold is decidable from the map alone and nothing computed it:
#             20 registers x (5 retries + 1) x 60 000 ms readTimeout ~= TWO HOURS of shared bus per poll, every
#             input declared, every value inside this map's own accepted maxima. ModbusRegisterMap gains
#             WorstCaseBusHoldMs (long, because that product overflows int and a NEGATIVE hold would make the
#             check report a comfortable number) and FanOut warns, comparing each device's hold against the SUM
#             OF THE OTHER devices' poll intervals. Three tests: the hog is named with its arithmetic; a
#             correctly-sized bus is SILENT (the control — without it the check could be tightened into noise);
#             and the warning names the DOMINANT term, because a derived timeout is the product's own default
#             and a declared one is the operator's number.
#   + 1  I-1  ABusOfOne_IsNeverWarnedAbout_InEitherDocumentShape, and it is here because a mutation found the
#             first version could not fail: it used only the LEGACY single-device document, which RETURNS
#             EARLY and never reaches the check. The shape the devices.Count < 2 guard actually defends is a
#             one-element `devices` ARRAY, where the siblings' cadence is 0 and every such bus would otherwise
#             be warned about. Both arms now.
#   + 1  I-5  ValidateRtuUnitId_RefusesWithoutALease_AndTheConstructorUsesTheSameRule. The rule moved out of
#             the ctor into a public static so D-7 can refuse a bad map BEFORE ModbusBusRegistry.Acquire — a
#             ctor throw after a lease is taken leaks a reference count nothing decrements, and D-3 measured
#             that SerialPort opens a COM port EXCLUSIVELY, so the port is dead for the process lifetime and
#             presents as an unrelated connector failing to start. The discriminating assertion is that it
#             throws with no bus, no lease and no registry at all; the second half pins that both paths give
#             the SAME message so they cannot drift.
#
# 9 further mutations this round (8 + a re-run), all KILLED, every verdict gated on all five verbs. ONE
# survived first — the devices.Count < 2 guard — and was a real vacuous test rather than dead code; see the
# +1 above.
#
# 🔴 backlog-test-deadlines (edgecore-host-crash-report.md) raises this 860 -> 861 (+1), counted from the
# runner (`dotnet test --list-tests`: 853 -> 854). ONE file, ONE new test, none rewritten and none deleted:
#
#     + 1  HotFolderDriverTests (4 -> 5)
#          DisposeAsync_WhileTheReadLoopIsIdle_EndsTheEnumeration_RatherThanStrandingItForever
#
# 🔴 IT IS THE REGRESSION TEST FOR THIS SCRIPT'S OWN RECURRING "ABORTED SUITE", and the diagnosis every
# previous reading got wrong. The log said `Test host process crashed : [deviceidentity] ... corrupt or
# unreadable` and printed `Passed! ... 731` — trap #2's exact costume — so four tasks recorded it as "a
# pre-existing DeviceIdentityStore flake, no root cause". None of that was the defect:
#   * the "crash reason" is just whatever the host last wrote to STDERR. That line comes from the
#     corrupt-blob test's own HANDLED path, which had already PASSED. A red herring, printed by a green test.
#   * the host did not crash. The trx's own <Times> shows start 20:47:53, last result 20:48:36, and the
#     abort recorded at 21:03:58 — 966 s later, i.e. the exact moment THIS SCRIPT's ceiling fired
#     `taskkill //F //IM testhost.exe`. The gate manufactured the crash it then reported. Trap 7 again, in a
#     third costume: a healthy-looking negative produced by the checker itself.
#   * the CPU heuristic could not have caught it either (trap 7(d), already documented above).
# The real defect: HotFolderAoiDriver.DisposeAsync disposed the SemaphoreSlim its own ReadAsync was parked
# on. SemaphoreSlim.Dispose() drops queued ASYNC waiters WITHOUT completing them, so the await is stranded
# permanently and its CancellationToken can no longer reach it — measured 200/200 on this runtime. Because
# xunit starts a DisableParallelization collection only after the whole parallel phase drains, that one
# stranded test kept the Site (70) and OpcUa (52) collections from ever starting: 731 of the 860 this line
# then expected, forever.
# Reproduced 2 times in 8 runs under two-worker load, 0 in 24 runs after the fix.
#
# EXPECT_EDGECORE is the ONLY total that moves. The fix also touches src/St4i.Connector.Conformance
# (bounding the unbounded `await runTask` that let one stranded driver hang a whole assembly) and
# src/St4i.EdgeCore/Drivers/OpcUa/OpcUaDriver.cs (the identical `_sessionLock.Dispose()`, a second instance
# of the same defect class) — both ADD assertions/delete a line and add NO test, so a moved total on
# Abstractions, Conformance, EdgeService or EngineApi would mean this task reached further than it meant to.
#
# 🔴 TASK D-5 (the RTU WRITE path) raises this 861 -> 896 (+35). COUNTED FROM THE RUNNER
# (`dotnet test --list-tests`: 854 -> 889), not by hand, for the reason D-2 wrote down: a total that
# reconciles is not evidence that anybody knows where the tests are. ONE file, ONE new test class; nothing
# else in this suite gains or loses a test.
#
#     +35  ModbusRtuDriverWriteTests (new) — 24 methods, 35 cases (three theories: 3 wrong-answer shapes,
#          9 setpoint rejections, 2 command rejections). What each group buys:
#
#      * ATTRIBUTION (2) — a setpoint written to unit 2 of a three-device bus lands on unit 2 and NOWHERE
#        else, and a coil pulse addresses only its own coil, TRUE then FALSE. Asserted twice over: off each
#        slave's OWN data store, AND off the frames that reached the bus boundary — because a pulse ends with
#        the coil back at FALSE, which the data store cannot distinguish from "never touched".
#      * NO IMPLICIT RETRY (3) — exactly ONE request FRAME on the wire for a write and for a command, plus
#        the read path getting its own tolerance back afterwards. 🔴 NON-VACUOUS BY CONSTRUCTION: the map
#        declares `retries: 5`, i.e. the test supplies the number that must NOT be used, and the assertions
#        are on the frame count at the boundary and on ModbusBus.LastTransactionRetries — neither of which
#        this test provides. D-2's equivalent read test passed while the driver hardcoded a different count
#        precisely because it supplied the value it checked. MEASURED for a WRITE specifically against NModbus
#        3.0.83 (D-2 had only measured it for a read): 1 request frame at Retries=0, 2 at 1, 4 at 3 — i.e.
#        retries+1, from which 5 gives 6. The 6 is derived; the other three are on the probe's own output.
#      * INDETERMINATE (1) — produced by a GENUINE timeout (elapsed >= the bound), with four separate
#        content assertions on Detail (what happened, that it is unknown, WHICH unit, that nothing was
#        resent) plus a DoesNotContain on the generic backstop string. Đợt B shipped two defects in which a
#        NullReferenceException replaced an authored Indeterminate message with a generic one, and both were
#        invisible to a "Detail is not null" check.
#      * NO STALE FRAME CAN ACKNOWLEDGE A WRITE (4) — three hand-crafted responses that differ from the true
#        echo in exactly one field (wrong register, wrong value, a stale FC03 read response) are each refused,
#        plus the correct-echo CONTROL without which all three would pass on a driver that can never report
#        Applied at all. Driven through the new RawRtuResponder, because a real NModbus slave always answers
#        correctly and this question needs an answer that is wrong on purpose. In effect a contract test on
#        NModbus's echo validation, which D-5 measured and which is STRICTLY STRONGER than a read's: a write
#        response is an echo checked on slave address, function code, start address AND value.
#      * THE BUS AFTER A FAILED WRITE (2) — a write times out on machine A, its echo arrives LATE on the
#        shared line, and machine B's next read still returns B's own value; the quarantine is asserted
#        ENTERED and paid ONCE, with real bytes discarded, and LinkGeneration never moves. Plus: a bus that
#        will not go quiet REFUSES the write and reports Failed, with ZERO frames on the line — the one place
#        this driver reports a definite "no" that is not a device rejection, decided on WriteOutcome.Failed's
#        own words ("the device OR THE TRANSPORT TALKING TO IT was reached and explicitly reported failure").
#      * CANCELLATION AND WHAT AN OPERATOR WAITS (4) — an in-flight write cancelled in ~209 ms against a
#        30 000 ms bound, with the link NOT rebuilt and a second machine still reading (the mechanism
#        assertions; the clock is not the claim); a write queued behind a dead device's 700 ms hold served
#        after ~1.7 s; and the same write cancelled after 150 ms returning in ~151 ms with NOT ONE FC06 frame
#        on a line that was busy throughout. Those three are the evidence behind task-5-report.md §7's
#        decision NOT to build the per-device backoff. The fourth pins the branch for a cancellation observed
#        AFTER the bus was taken but BEFORE the request was written — reachable only in a race, so a mutation
#        could never find a defect in it (the reachability gap D-1's review found by READING); made
#        deterministic by cancelling from inside the bus's own openLink delegate, which ModbusBus invokes with
#        the arbitration lock already held.
#      * B-3's LIMITS THROUGH THIS ENTRY POINT (12) — nine setpoint rejections (unknown point, read-only
#        point, over, under, NaN, +Infinity, bool, string, null) and three command ones (unknown, arguments
#        supplied, no declared coil address), each asserting the shared bus saw ZERO bytes. "No frame ever
#        left the master" is what B-1 requires; "the register still holds its old value" also passes for a
#        write the device refused. One row per rejection because a mutation deleting one guard survives a
#        test that exercises another.
#      * THE REST OF THE SURFACE (7) — WritablePoints/Commands immutable and not castable back to a List;
#        a write after disposal; a write serialised against this driver's own running poll; a device-rejected
#        write and a device-rejected pulse assert (Failed, naming the Modbus exception code); a pulse whose
#        RESET never completes (Indeterminate, naming the coil and that it may be latched); and both halves
#        of a pulse sharing ONE transaction so no other machine can run between them with a coil latched high.
#
# 🔴 NO OTHER TOTAL IN THIS SUITE MOVES, and that is the check rather than a coincidence. D-5 also does two
# behaviour-preserving extractions, both of which add NO test and both of which are proved by a total that
# does not move:
#   * src/…/Modbus/ModbusWritePreflight.cs (new) takes five `private static` members VERBATIM off
#     ModbusTcpDriver (point/command lookup, the object?->double narrowing, and the hand-written six-entry
#     Modbus-exception-code table) so the RTU driver reuses them instead of holding a second copy that can
#     drift silently. ModbusTcpDriverWriteTests is what proves it behaviour-preserving.
#   * tests/…/Modbus/RawRtuResponder.cs (new) carries RtuFrames.WithCrc, which ModbusBusResynchronisationTests'
#     own private AppendCrc now delegates to. That suite stays at 9.
# ModbusBusTransaction gains an ADDITIVE Task-returning ExecuteAsync overload that delegates to the existing
# generic one (NModbus's write calls return Task, not Task<T>), so the quarantine accounting D-4 and D-6 sit
# on is literally the same code for a write as for a read.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately unchanged:
# D-5 adds no code outside src/St4i.EdgeCore/Drivers/Modbus and tests/St4i.EdgeCore.Tests, so a moved total
# anywhere else would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in
# particular stays 22 — RTU conformance wiring is D-6, and no operator can turn the RTU write path on at all
# until D-7 builds the connector factory, the policy gate and the RBAC route.
#
# 🔴 D-5's REVIEW FIX ROUND raises this 896 -> 905 (+9), counted from the runner
# (`dotnet test --list-tests`: 889 -> 898). Two files; none is a rewrite, a split or a deletion. The expected
# total is the ONLY executable line this task has changed in this script, per the standing rule the D-5 review
# settled: totals may move with a per-file justification in this block; nothing else in this file may change.
#
#   + 5  ModbusRtuDriverWriteTests (35 -> 40) — 🔴 THE CRITICAL. The review applied FIVE mutations to
#        InvokeCommandAsync SIMULTANEOUSLY (bus refusal -> Indeterminate, assert-half Detail -> the generic
#        backstop string, queued cancellation -> Failed, in-flight cancellation Detail -> generic,
#        bus-disposed -> Failed) and the whole suite reported `Passed! - Failed: 0, Passed: 896`; a sixth
#        mutant in the same tree killed 1, so the pipeline was live. Every content assertion D-5 shipped was
#        on the setpoint path or the pulse's RESET half, so the member that answers "did a machine cycle
#        start?" asserted its outcome and nothing else. The four branches now have command-path equivalents
#        of the setpoint tests (assert-half timeout with nine content assertions plus a DoesNotContain on the
#        backstop string; in-flight cancel with LinkGeneration and a second machine still reading; queued
#        cancel proven at the bus boundary with ZERO FC05 frames; bus refusal reporting Failed), and the
#        fifth covers a branch that turned out to be unguarded on BOTH members: a bus disposed out from under
#        a live driver. That last one is distinct from AWriteOrCommandAfterDisposal_..., which covers the
#        DRIVER's own flag.
#   + 1  ModbusRtuDriverWriteTests — review I-1. ModbusBusResynchronisationException is raised from exactly
#        two places and the driver hard-coded the reason of ONE of them, so a failed drain (live and
#        intentional: GatewayTcpBusLink lets an IOException escape on the strength of the bus's catch
#        "saying so") told an operator to go hunting a babbling device. Both refusal causes are now driven
#        through one parameterised link decorator in ONE test, because "distinguishable" is a claim about a
#        pair: the Assert.NotEqual is the discriminating assertion and the two Contains stop it passing on
#        any two strings that merely differ.
#   + 3  ModbusTcpDriverWriteTests (13 -> 16) — review m-2. A [Theory] with one row per non-numeric setpoint
#        shape (bool, string, null). Found by a D-5 mutation, not by reading: mutating the SHARED
#        ModbusWritePreflight.TryToEngineeringValue to accept a bool killed a test in the RTU suite and NONE
#        here, because this file had 13 tests and zero [InlineData] and had never passed a non-numeric value
#        since B-4. The behaviour was guarded (through the shared method, by the RTU suite) — what these
#        retire is a future re-inlining silently unguarding TCP.
#
# NO OTHER TOTAL MOVES. The fix round also REMOVES two assertions that could not discriminate (review m-1 and
# m-5 — a frame-length count that is structurally always 0 because every RTU master request is 8 bytes, and an
# Assert.All over a collection that can hold only the single frame the line above already checked) and adds
# none in their place: each test's remaining assertions are the ones that carry it, so those two edits move no
# count.
#
# 🔴 TASK D-6 (conformance) raises this 905 -> 951 (+46), counted from the runner (`dotnet test --list-tests`:
# 898 -> 944 — the two agree here because none of the new tests is a [Theory]). Three new files; nothing is
# rewritten, split or deleted. The expected total is again the ONLY executable line this task changes in this
# script, per the standing rule.
#
#   +19  ModbusRtuDriverConformanceTests (new) — the shared DeviceDriverConformanceSuite against the real
#          ModbusRtuDriver on a bus it owns alone: the 17 Check_* wirings, the suite's own
#          EveryCheckIsWiredOrAcknowledged census (ZERO AcknowledgedGaps — every check runs), and one test
#          this transport needs that the other four drivers do not (below). Three device shapes, all in
#          St4i.EdgeCore.Tests because there is no portable virtual COM port: CreateDriver() rides a bus whose
#          LINK CANNOT BE OPENED (RTU's real fast failure — SerialPortBusLink.OpenAsync throws on an absent
#          port with no handshake to wait out; a silent line could only produce a timeout, which is not fast),
#          CreateUnresponsiveDeviceAsync/CreateUnresponsiveWritableDeviceAsync ride D-2's paired in-memory link
#          with D-5's RawRtuResponder answering nothing, and CollectReadingsAsync drives a REAL in-process
#          NModbus RTU slave network.
#   +21  ModbusRtuMultidropConformanceTests (new) — the SAME 19 (inherited from a shared abstract base, so the
#          wirings exist once and run twice) with the device under test sharing a live, continuously polled
#          line with another machine, plus 2 claims only this shape can make. D-4 shipped N devices on one bus
#          and no conformance check had ever run against it. Worth its runtime, measured: the mutation that
#          reduces ModbusRtuDriver.Id to the BUS alone (the TCP driver's endpoint-only shape) is KILLED here
#          and INVISIBLE to every one of the 19 single-device checks.
#   + 6  ModbusRtuConformanceRigTests (new) — the harness's own teeth, per the brief's rule that a loopback
#          peer which always behaves makes several checks vacuous. The no-device target is proved genuinely
#          ASKED and to fail an order of magnitude inside its own read timeout; the silent peer is proved to
#          RECEIVE every request and answer none (otherwise Indeterminate could be passing because nothing was
#          transmitted); the attempt counter the no-retry check reads is proved able to report TWO; the rig's
#          map is proved to declare a retry count the bus then records as 0; the readings rig is a control PAIR
#          (readings when the slave answers, none when it is silenced); and the last one pins the RTU form of
#          the ClosedLoopbackPort defect — releasing the last lease disposes the bus AND its link, which is why
#          every rig holds a keep-alive lease.
#
# ModbusRtuDriverWriteTests's own count is UNCHANGED (the +46 above is exactly the three new files, counted
# from the runner and reconciling to the suite total with nothing left over), and that is the check rather
# than a coincidence: D-6 MOVES its
# private `WritableMap` into ModbusRtuLoopbackHarness.BuildWritableMap (with the point/coil/command names as
# named constants) so RTU has ONE writable map shape rather than two, and that suite's own tests are what prove
# the move behaviour-preserving. Same call D-5 made twice (ModbusWritePreflight, RtuFrames).
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGESERVICE and EXPECT_ENGINEAPI are deliberately unchanged.
# EXPECT_CONFORMANCE in particular stays 22: D-6 WIRES the shared suite, it does not change it — no Check_*
# method was added, removed or edited, so the suite's own negative controls still describe it exactly.
# EXPECT_ENGINEAPI staying 1190 is the evidence for the AmbiguousDriver claim: that guard lives in
# ConnectorRegistry/FleetHost, the conformance rig never constructs either, and D-4's
# ModbusMultidropRegistrationTests still prove the routing unchanged.
#
# 🔴 D-6's REVIEW FIX ROUND raises this 951 -> 952 (+1), counted from the runner (`--list-tests`: 944 -> 945).
# ONE file, one test; the Critical's own fix adds none.
#
#   + 1  ModbusRtuConformanceRigTests (6 -> 7) — review M-5. The MULTIDROP rig's "no device" target is a
#          SILENCED SLAVE, not the single-device rig's unopenable line (a shared link cannot be refused for one
#          device without making every device on the segment unreachable), and that substitution had no harness
#          control of its own. The new one asserts the three things that could each make it green for the wrong
#          reason: the silenced slave really RECEIVED the request and its reply really was dropped
#          (FramesSilenced > 0 — "the master timed out" and "the master never transmitted" are
#          indistinguishable from the master's side), the driver addressed at it yields zero readings, and its
#          BUS-MATE still reads its own value off the same line, which is what stops "no readings" also being
#          satisfied by a rig whose whole bus was broken.
#
# The CRITICAL's fix moves no total, and that is the check rather than a coincidence: it is a `base`-calling
# override of Check_Write_Cancellation_HonouredPromptly_EvenAgainstAnUnresponsiveDevice on the shared abstract
# base, raising ONLY that one check's target bound from 300 ms to the rig's existing 8 000 ms so that an
# ordinary timeout can no longer satisfy a cancellation check. No shared-suite change, EXPECT_CONFORMANCE
# unmoved, four other drivers untouched, no test added or removed. Proven by re-running the mutation that
# neuters ModbusBusTransaction's AbortPendingRead registration: it used to kill 2 tests and now kills 4 — the
# two write-side cancellation checks join the two read-side ones. Passing cost: 231 ms / 223 ms against the
# 8 000 ms bound.
#
# The other fixes are documentation corrections on records that were WRONG rather than merely thin (a false
# impossibility proof, an untested keep-alive claim, an arithmetically wrong retries rationale, an imprecise
# "every write check" and an over-general "no fast per-device failure"), plus blueprint §10 item 4 answered on
# IModbusBusLink.DrainBufferedInput where D-7 will stand. Comment-only in src/; none moves a count.
EXPECT_EDGECORE=952
EXPECT_EDGESERVICE=28
# Task C-7 raised this from 1087 to 1122 across two rounds.
#   +29 in the implementation round:
#     +24  NotificationEndpointsTests    (new file — the eleven notification routes)
#     + 2  RbacPolicyTests               (the relay Admin gate end to end; the reads not being Operator)
#     + 2  AlarmAnnunciationStreamTests  (the SSE subscriber cap's 503; the shipped cap's value)
#     + 1  LocalAnnunciationChannelTests (the hub-level subscriber cap)
#   + 6 in the review round, all NotificationEndpointsTests:
#     + 2  I-1  a failed credential write must not answer 200 (webhook, smtp)
#     + 1  I-2  webhook instance cardinality is capped
#     + 1  I-4  the limiter RECOVERS — the previous test could not tell a bound from a wall
#     + 1  M-3  hub gauges survive a degraded host
#     + 1  M-5  the SMTP send test's bound is measured, not inherited
# No other suite is touched: C-7 adds no code outside St4i.EngineApi.
#
# Task C-8 raised this from 1122 to 1131 (+9), all in St4i.EngineApi.Tests:
#   + 3  NotificationEndpointsTests   — GET /v1/notifications/annunciator, the new Operator-tier route:
#          the payload carries NO channel configuration (with the Engineer route as the control);
#          a failed config read is distinguishable from "nothing configured" ON THIS ROUTE;
#          a host with no configuration store still answers and says nothing is running.
#   + 6  NotificationDocumentationTests (new file) — the census, as a test rather than as a claim in a
#          report: the retired "alarms cannot reach anyone" claim is not asserted in EN or VI; the
#          Alarms/ file-count claim is not present-tense (and the folder is measured); the retired
#          "additive and default-off" claim is not restated; the honest limitations are stated in both
#          languages; ST4I_NOTIFICATIONS_DIR is documented AND purged by remove-data.ps1; and
#          docs/ALARM_WEBHOOK_CONTRACT.md's load-bearing UNSIGNED/read-the-body text is intact.
#          (This is the doc-drift guard C-7's §11.2 note 14 recommended and declined to build; the
#          working-directory objection is answered by walking up from AppContext.BaseDirectory, the
#          idiom PackagingFleetJsonTests already uses.)
# RbacPolicyTests' ExpectedRoutes goes 105 -> 106 for the new route but adds no test.
#
# C-8's review round 1 raised it again, 1131 -> 1133 (+2), both NotificationDocumentationTests:
#   + 1  I-1  EveryDirectoryTheEngineCreatesUnderProgramData_IsPurgedByTheDecommissioningScript.
#            The engine creates THIRTEEN directories under %ProgramData%\ST4I\sim; remove-data.ps1
#            purged five, and two of the eight it missed hold credentials (`identity` is the device's
#            PFX private key sealed at LocalMachine scope; `connector-config` stores an OPC-UA password
#            in plaintext). The old test pinned the five-name list, freezing the gap as if closed — so
#            this one DERIVES the expected set by scanning src/ for each store's own default-path
#            constant, and a fourteenth store fails it until the script purges that too.
#   + 1  I-2  TheWebhookContract_DedupRecipe_NamesTheSignedBodyField_NeverTheUnsignedHeader.
#            The reviewer changed §3's numbered recipe to dedup on the UNSIGNED X-ST4I-Delivery header
#            and all six existing doc tests passed — C-3's defect reproduced, in the half of the
#            contract that was RIGHT last time and therefore unguarded.
# EXPECT_EDGECORE stays 735: I-4 fixes leaked TcpListener accepts in three ModbusTcpDriverWriteTests
# (and bounds two conformance accepts) but adds no test.
# No other suite is touched: C-8 adds no code outside St4i.EngineApi, web/ and docs.
#
# Đợt C CLOSEOUT ROUND raised this from 1133 to 1135 (+2), both AlarmStoreTests, both for I-4:
#   + 1  RaiseAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows
#   + 1  ClearAsync_StillNeverThrows_WhenTheLogErrorDelegateItselfThrows
#        AlarmStore's never-throws contract ended each of its two implementing catch blocks with an
#        UNGUARDED `_logError?.Invoke(...)` — a hole in the last statement of the handler written to close
#        it (NotifySafely wrapped the identical call in its own try/catch, so the two sites disagreed).
#        Program.cs binds logError to `sp.GetRequiredService<ILoggerFactory>()`, a service resolution on
#        the error path, which throws ObjectDisposedException once the root provider is disposed — i.e.
#        during shutdown, which is also when alarms.db is most likely failing. The twelve pre-existing
#        AlarmStore tests could NOT see it: their own logError delegate succeeds. Two tests rather than
#        one because the two catch blocks are separate statements and a fix applied to only one would
#        still pass a single test. Both die with ReportSafely's catch removed (verified by mutation).
#
# 🔴 EVERY OTHER SUITE IS UNCHANGED, and EXPECT_EDGECORE deliberately stays 735: the closeout round moves
# three ModbusTcpDriverWriteTests' teardown into a `finally` and rewrites three EngineApi tests' timing,
# but RESTRUCTURES them — it adds no test and deletes none. A moved total on any suite other than
# EngineApi would mean something unintended happened.
# chore/test-hygiene raised this 1135 -> 1136 (+1): a guard proving the Playwright harness really
# does isolate the creds directory. The config previously justified leaving it un-isolated with
# "this suite never calls anything that writes there" — FALSE: 613 of the 2,999 leaked blobs carry
# exactly the prefixes 04-onboarding.spec.ts mints, one per e2e run. A claim in a comment, believed
# because nobody measured it, is what kept this leak open.
#
# Task D-1 (.superpowers/sdd/2026-08-02-dotD-modbus-rtu-blueprint/task-1-brief.md) raised this 1136 -> 1165
# (+29), all in St4i.EngineApi.Tests. D-1 moves connector identity from "the protocol kind" to "this
# connector instance"; every number below is a NEW test, none is a rewritten or split one, and no test was
# deleted:
#   + 9  ConnectorRegistryTests — instance identity at the unit level: two instances of ONE kind coexisting;
#          the derived default (omitting the id == naming the kind, the fact the whole migration rests on);
#          id normalization and blank-id fallback; and the four covering the MACHINE-CODE CLAIM, which is the
#          structural gate that makes MachineDriverAvailability.AmbiguousDriver unconstructible — a second
#          instance claiming a served machine is refused with nothing mutated, a claim differing only by
#          casing is still the same claim, an instance may keep its OWN claim across a reconfigure, and an
#          unbound instance blocks nobody. The ninth drives 20 threads through a Barrier at one machine code
#          and asserts exactly one winner (the claim is a CROSS-entry invariant that a ConcurrentDictionary's
#          per-key atomicity cannot supply).
#   + 5  ConnectorConfigStoreTests — migration v4 (kind PRIMARY KEY -> instance_id PRIMARY KEY, a table
#          rebuild). Three build a GENUINE version-3 database with raw SQL, in the old column ORDER, and
#          assert every row and every field survives with instance_id = kind. This is deliberately NOT how
#          the two pre-existing "MigratesExistingRowsToVersionN" tests work: those construct their "old"
#          database by calling THIS build's own constructor, which runs the ladder to the current version
#          first, so they can never exercise a migration FROM an older schema — a rung that dropped every row
#          would have passed both. Plus two rows of one kind being independently readable/deletable, and a
#          re-pin that ListAsync still never selects map_json (its SELECT list was edited by this task).
#   + 7  FleetHostConnectorInstanceRoutingTests (new file) — the routing proof. The non-negotiable: two
#          machines on two connector instances, a write for B reaching B's driver and ONLY B's (asserted as
#          driverA.WriteCallCount == 0, never as a status code); the same for the command path, which Đợt B
#          treats as the higher-risk member; each machine cycling off its own connector and not double-driven;
#          a machine claimed by an instance whose id is NOT its DriverKind still excluded from simulation;
#          Đợt B's exact ambiguity recipe now resolving instead of refusing, with zero I/O reaching the
#          unclaimed machine; every roster member enumerated and none landing on AmbiguousDriver; and
#          AmbiguousDriver still being returned AND still refusing a write through the one seam that can
#          still construct it.
#   + 5  ConnectorEndpointsTests — two same-kind connectors over the real HTTP surface (both save, both
#          visible, both in the roster, deleting one leaves the other); a second connector naming an
#          already-served machine refused; the no-instanceId request still configuring and deleting exactly as
#          before; both surviving a simulated restart with the live registry's bindings re-established; and
#          the env-var-configured Modbus AND OPC-UA connectors being bound to their maps' machines. That last
#          one required adding an opcUaEnvMapPath parameter to this file's own factory helper (additive,
#          default null): NO test in this repository had ever booted with ST4I_OPCUA_MAP set.
#   + 3  ConnectorEndpointsMachineClaimTests (new file) — the claim check at the handler level, because the
#          HTTP-level version of it could not fail: a machine a live connector serves is also a machine in the
#          roster, so the PRE-EXISTING cross-kind roster-collision guard answers one branch earlier. Proven by
#          mutation (the first draft passed with the claim check deleted). Calling the handler directly with a
#          registry claim that has no roster entry separates the two invariants; the discriminating assertion
#          is that the store is still EMPTY, since without the pre-check the row is written and only then
#          refused.
# RbacPolicyTests' ExpectedRoutes changes one STRING (/v1/connectors/{kind} -> /v1/connectors/{instanceId})
# and adds no test — the route count is unchanged, and the exact-count sweep passes in both directions.
#
# 🔴 EVERY OTHER SUITE IS UNCHANGED. D-1 adds no code outside St4i.EngineApi, and the four other totals below
# are deliberately untouched: a moved total on Abstractions, Conformance, EdgeCore or EdgeService would mean
# this task reached somewhere it had no business reaching.
#
# D-1's REVIEW-FIX round raised this again, 1165 -> 1181 (+16), all in St4i.EngineApi.Tests. Every one closes
# something the review found; none is a rewrite or a split:
#   + 6  ConnectorEndpointsMachineClaimTests — I-1 and m2. THREE for the rollback the review proved was
#          missing: the claim pre-check, SaveAsync and Register are not atomic, so two concurrent POSTs for
#          one machine both pass the pre-check and the loser wrote its row, was refused, and left that row
#          behind PERMANENTLY (persisted, listed in GET /v1/connectors/configured, refused again by
#          Program.cs on every boot, never in the roster) — exactly the state this endpoint's own SM-5
#          comment says must never be creatable. Two cover the compensation's arms deterministically
#          (delete when this request created the row; restore field-for-field, provenance included, when it
#          overwrote one) and one covers its never-throws contract with a cancelled token. A FOURTH proves
#          the compensation is actually WIRED, by producing the interleaving for real: 8 rounds x 16 racers.
#          It is probabilistic in what it KILLS and never in whether it passes (its invariant holds under
#          every interleaving), and the rate was MEASURED, not assumed — 1 round x 12 killed 3/10, the
#          shipped 8 x 16 killed 10/10. TWO more for m2: a 409 naming a claimant whose row is already gone
#          must say "restart", not "delete the connector you already deleted", with the still-configured
#          case as its control.
#   + 7  ConnectorsJsonRegistrationTests (new file) — I-3. The connectors.json -> registry dispatch had NEVER
#          been covered, before or after D-1, and D-1 added code to it: a mutation making every such
#          connector register UNBOUND left the whole suite green. It was untestable where it lived
#          (Program.cs reads connectors.json from AppContext.BaseDirectory, one shared artifact in this
#          assembly's output), so the loop moved verbatim to ConnectorsJsonRegistration — an extraction, NOT
#          a new ST4I_CONNECTORS_CONFIG knob, because a configuration surface added to serve a test is a
#          permanent commitment. Covers both dispatch arms separately (never one plus an inference that the
#          other "is the same code"), the machine binding, the deliberate non-adoption of the entry's own id,
#          an unparseable blob still registering but unbound, an undispatchable kind being skipped and never
#          registered, the claim gate from this path, and one bad entry not aborting the loop.
#   + 2  FleetHostConnectorInstanceRoutingTests — one for m3's snapshot lookup being case-INSENSITIVE like
#          every other machine-code comparison in the codebase (mutation-found: all existing routing tests
#          spelled the code identically on both sides, so a case-sensitive lookup survived); one recording a
#          hazard D-1 silently FIXES rather than leaving it to be rediscovered as a bug — a connector whose
#          map names a machine already in the roster as Simulated now leaves the simulated group, closing the
#          two-EdgePipelines-one-MachineState double-drive corruption GP-5 closed for third-party kinds.
#   + 1  ConnectorConfigStoreTests — m1: SaveAsync now folds the instance id through DriverKinds.Normalize
#          rather than a bare Trim(), matching the registry and the DELETE route. A row written as
#          instance_id = "modbus" was UNDELETABLE (the route normalizes to "Modbus", GetAsync misses, 404 for
#          a row the operator can see). Also pins that a third-party id stays case-SENSITIVE.
# No suite other than EngineApi is touched by this round either.
#
# D-1's RE-REVIEW round raised this 1181 -> 1184 (+3), all ConnectorEndpointsMachineClaimTests, all for I-A:
# the 409 returned on a failed live registration ASSERTED that a rollback had happened instead of checking.
# It said "its configuration was rolled back, so there is no leftover row to clean up" unconditionally —
# directly contradicting this suite's own CompensatingAFailedRegistration_NeverThrows_... test, which pins
# that a FAILED compensation leaves the row, and false in the direction that stops an operator looking.
# Guaranteed, not exotic: the compensation was handed the REQUEST's CancellationToken, so for any client
# that hung up the rollback threw at its first store call while the message claimed success.
#   + 2  the sentence's own three outcomes, now a pure extracted function (DescribeRollbackOutcome) because
#          the branch that produces it is only reachable under a concurrent registration — code a test
#          cannot reach is code nothing ever asks a consequence question about, which is exactly how the
#          contradictory wording shipped. One test for the failed-rollback arm (must point at
#          GET /v1/connectors/configured and must NOT claim "no leftover row"), one for the two success arms
#          NOT being interchangeable (a restored row still exists at that instance id).
#   + 1  both compensation arms driven through the store together, so a wrong sentence and a wrong rollback
#          cannot drift apart.
# The existing race test (ConcurrentSavesForOneMachine_...) additionally gained cancellation on half its
# racers, which is what makes the CancellationToken.None fix observable at all: an already-cancelled token
# cannot reach that branch through the handler, because the handler's FIRST store read takes the request
# token and throws long before it. Measured against the mutation that restores `ct`: KILLED 8/8 runs. That
# test's own count is unchanged.
#
# 🔴 TASK D-4 (multidrop) raises this 1184 -> 1190 (+6), counted from the runner. One new file,
# ModbusMultidropRegistrationTests — the REGISTRATION half of blueprint §7.1, which is the half that decides
# whether multidrop is safe. The map format alone does not: the same document can be registered two ways and
# only one preserves D-1's routing invariant, so this has to live where ConnectorRegistry and FleetHost do.
#   + 1  a three-device bus map fans out into three instances and a write for the middle one reaches ONLY its
#          device — the load-bearing assertion is the pair of ZEROES on its bus-mates, not the status code,
#          and the COMMAND path is driven in the same test because CommandRequest carries no machine code
#          either and "one fix, one sibling untouched" is this batch's most repeated defect.
#   + 1  each instance stores its OWN device's standalone document, asserted on what the registry handed the
#          FACTORY. A fan-out that stored the whole bus under three ids passes every count in the test above
#          and would then hand D-7's real factory a document declaring three machines — verbatim the
#          "one driver emitting N machine codes" shape §7.1 forbids.
#   + 1  every registered instance holds exactly ONE machine code and no code is held twice, enumerated over
#          the registry's own snapshot and resolved BACK per code.
#   + 1  a device whose machine another BUS already claims is skipped, NAMED (with the incumbent), and its
#          bus-mates still come up.
#   + 1  a malformed bus map registers nothing, logs, and does not throw — it runs inside startup wiring.
#   + 1  a LEGACY single-device map registers under the bus id ITSELF, so an existing connector keeps its
#          instance id, its slot label and therefore its alarm TargetId when a registration path starts
#          calling the fan-out. The discriminating assertion is the id, not the count.
# The fake factory in that suite builds its driver from the CONFIG IT IS HANDED (parsing the machine code out
# of the map) rather than from a lookup the test keeps — otherwise it would report the machine the test
# expects no matter what the registry stored, which is D-2's I-2 shape exactly.
#
# Nothing in Program.cs calls RegisterAll: the RTU connector factory is still D-7's, so no operator can turn
# multidrop on yet — the same posture D-2 and D-3 both shipped with and said so.
EXPECT_ENGINEAPI=1190

SUITES=(
  "tests/St4i.Connector.Abstractions.Tests:$EXPECT_ABSTRACTIONS"
  "tests/St4i.Connector.Conformance.Tests:$EXPECT_CONFORMANCE"
  "tests/St4i.EdgeCore.Tests:$EXPECT_EDGECORE"
  "tests/St4i.EdgeService.Tests:$EXPECT_EDGESERVICE"
  "tests/St4i.EngineApi.Tests:$EXPECT_ENGINEAPI"
)

LOGDIR="${TMPDIR:-/tmp}/st4i-verify-$$"
mkdir -p "$LOGDIR"
FAILURES=()
UPDATE=0
[[ "${1:-}" == "--update" ]] && UPDATE=1

note() { printf '  %s\n' "$*"; }

# Total processor SECONDS consumed by every live `testhost` process, as a float, or the
# empty string when there is none (or when PowerShell is unavailable). See the hang
# check below for why this cannot be `ps`: Windows' `ps` has no CPU column at all.
# Empty must read as "cannot tell", never as "flat".
# 🔴 This hard-codes a process named `testhost`, which is vstest's host. Under
# Microsoft.Testing.Platform the host is the test assembly's OWN executable, so this would
# return empty forever, the CPU check would go permanently inert (correctly reading "cannot
# tell", never "flat"), and only the wall-clock ceiling would remain. That degrades safely --
# but SILENTLY. If an SDK bump ever removes half this detector, this comment is why.
# 🔴 TRAP 7(i) and 7(j), BOTH FOUND BY AN AGENT DEBUGGING A FAILURE THIS SCRIPT CAUSED.
#
# (i) THE REMEDY MANUFACTURED THE EVIDENCE. When the ceiling fired, this script ran
#     `taskkill //F //IM testhost.exe`, and vstest then wrote "Test host process crashed"
#     into the log. Four tasks read that line as a product crash and carried it forward as
#     "a pre-existing DeviceIdentityStore flake, no root cause". The trx timestamps settle
#     it: last result 20:48:36, abort recorded 21:03:58 -- 966s later, the exact second the
#     ceiling fired. THE SUITE HUNG; IT NEVER CRASHED. A tool whose remedy fabricates a
#     different diagnosis than the fault is worse than one that only reports.
#
# (j) THE CLEANUP WAS NAME-WIDE, NOT RUN-SCOPED. `//IM testhost.exe` kills EVERY test host
#     on the machine, so two overlapping gate runs execute each other. That accounts for
#     three further aborts in the preserved history -- including a set I produced myself and
#     briefly read as a code regression.
#
# So: kill only the descendants of THIS run's `dotnet test`, and say plainly in the failure
# text that the kill is ours, so nobody reads vstest's crash line as a product fault again.
kill_this_runs_hosts() {
  local root_pid="${1:?pid}"
  # //T on a PID kills that process tree only. The name-wide form is what caused (j).
  taskkill //F //T //PID "$root_pid" >/dev/null 2>&1 || true
}

testhost_cpu_seconds() {
  powershell -NoProfile -NonInteractive -Command \
    "(Get-Process testhost -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum" \
    2>/dev/null | tr -d '\r' | head -1
}

# ── Gate 1: the build. Nothing below is trustworthy until this passes. ───────────
# Trap 1 and 4. Read the LOG, not the exit code: a locked file can leave a project
# unrelinked while the overall invocation still reports success.
echo "[1/3] Killing stray test hosts, then rebuilding..."
taskkill //F //IM testhost.exe //T >/dev/null 2>&1 || true
taskkill //F //IM vstest.console.exe //T >/dev/null 2>&1 || true
dotnet build-server shutdown >/dev/null 2>&1 || true

BUILD_LOG="$LOGDIR/build.log"
# 🔴 TRAP 8, and it is this script's own cleanup being right once and then never again.
# D-6 hit a RED first gate run: UnsBridgeSpoolTests died on WSAENOBUFS ("lacked sufficient
# buffer space") on a LOOPBACK MQTT connect -- a machine-wide resource failure in a subsystem
# nothing in that task touched. The implementer diagnosed it as orphaned build-server nodes and
# concluded this script does not clean them. It does, on the line above -- so that story is
# self-refuting: any TRUE pre-existing orphan is already dead by the time the build starts.
#
# The review then measured what actually happens, which is worse and is ours:
#   * ONE `dotnet build` leaves 13 MSBuild nodes (~110-150 MB each) plus a ~705 MB VBCSCompiler.
#     "13 orphaned dotnet.exe" is not the signature of accumulated rounds; it is one build.
#   * The shutdown above runs ONCE, BEFORE the build. During [2/3], with the gate unattended:
#     14 build-server processes, 1955 MB resident, alive through ALL FIVE suites.
# So the gate created a ~2 GB population and then ran the memory-sensitive part of its own job
# underneath it. That is the same shape as trap 7(i) -- the remedy manufacturing the evidence --
# one step earlier: here the tool manufactures the CONDITIONS it then measures under.
#
# Node reuse buys nothing for a one-shot -t:Rebuild, so refuse it, and shut the servers down
# again after the build so the suites do not run under the build's leftovers.
MSBUILDDISABLENODEREUSE=1 dotnet build -t:Rebuild --nologo > "$BUILD_LOG" 2>&1 || true

if ! grep -qE '^ *0 Error\(s\)' "$BUILD_LOG"; then
  echo "FAIL: build did not report 0 errors. Refusing to read any test count."
  grep -E 'error |Error\(s\)' "$BUILD_LOG" | head -20
  echo "  full log: $BUILD_LOG"
  exit 1
fi
# 🔴 TRAP 7(e), demonstrated live: a rebuild reported "117 Warning(s) / 0 Error(s)" of which
# TWELVE were MSB3061 "Unable to delete file ... Access to the path" -- a live process holding
# output files, so Rebuild could not delete them. THE GATE ABOVE PASSED. Its own header says
# "a locked file can leave a project unrelinked while the overall invocation still reports
# success" -- that is trap 1 verbatim, and the gate reads the log precisely to catch it, but it
# was reading the wrong line. There the un-deleted files were runner assemblies so the build
# stayed valid; MSB3061 on a PRODUCT assembly is trap 4 and the gate cannot tell them apart.
# Every suite then runs --no-build against whatever did not relink.
if grep -q 'MSB3061' "$BUILD_LOG"; then
  echo "FAIL: the rebuild could not delete build outputs (MSB3061) -- a project may not have relinked."
  grep -E 'MSB3061' "$BUILD_LOG" | head -10
  echo "  Kill stray test hosts and re-run. Full log: $BUILD_LOG"
  exit 1
fi
WARNINGS=$(grep -oE '^ *[0-9]+ Warning\(s\)' "$BUILD_LOG" | grep -oE '[0-9]+' | head -1)
note "build: 0 errors, ${WARNINGS} warnings (only comparable from -t:Rebuild on an unlocked tree)"

# ── Gate 2: each suite, sequentially, asserting an EXACT total. ──────────────────
# Trap 2. `Failed: 0` is not evidence: an aborted run prints it with a short total.
# Trap 8 (see the build above): the build's own server population must not still be resident
# while the suites run. Measured before this line existed: 14 processes, 1955 MB, alive through
# all five suites. Report what the suites are actually running underneath, so the next person
# reading a machine-wide failure has the number instead of a hypothesis.
dotnet build-server shutdown >/dev/null 2>&1 || true
BUILD_NODES=$(powershell -NoProfile -NonInteractive -Command \
  "(Get-Process dotnet,VBCSCompiler -ErrorAction SilentlyContinue | Measure-Object).Count" \
  2>/dev/null | tr -d '\r' | head -1)
note "build servers still resident entering the test phase: ${BUILD_NODES:-unknown}"
echo "[2/3] Running ${#SUITES[@]} suites sequentially..."
for entry in "${SUITES[@]}"; do
  proj="${entry%%:*}"; expected="${entry##*:}"; name=$(basename "$proj")
  log="$LOGDIR/$name.log"
  # 🔴 TRAP 7(f): this ran at `-v q`, so the log this script hands you on a failure carried the
  # failing test's NAME AND NOT ITS REASON — the one occasion the log exists to serve was the one
  # occasion it was empty. Output goes to a FILE, never to a terminal, so the quiet was bought
  # with nothing and cost the only thing the log is for.
  #
  # 🔴 TRAP 7(g) and 7(h) — I caused both while fixing 7(f), and they are the most instructive
  # entries here because each looked correct until it was measured.
  #   (g) My first fix was `-v n`. WRONG KNOB. `-v` sets MSBuild's verbosity; test results come
  #       from the vstest LOGGER, which `-v` does not control. The run emitted a 170-line BUILD
  #       log ending in "0 Error(s)" with no result line at all. This script's own "no Total
  #       line" guard caught it and failed all five suites — correctly, on its author.
  #   (h) My second fix was `--logger console;verbosity=detailed`. That DOES carry failure
  #       messages, and it REPLACES the summary with a different format: `Total tests: 151`
  #       instead of `Total: 151`, and no `Skipped:` line at all when nothing skipped. Every
  #       parse below would have broken. Caught by comparing the two invocations side by side
  #       rather than by reasoning about which flag sounded right.
  # The trx logger is the answer: it writes full failure detail to a FILE and leaves vstest's
  # console summary byte-for-byte untouched, which is exactly the two things needed at once.
  # Verified by running both forms and diffing the last three lines.
  dotnet test "$proj" --no-build --nologo -v q \
    --logger "trx;LogFileName=$name.trx" > "$log" 2>&1 &
  test_pid=$!

  # Trap 6, and it is the GENERATOR of traps 1 and 4: a hung suite forces a kill, a
  # kill orphans a test host, an orphaned host breaks the next build, and a broken
  # build produces numbers that read as a code regression. Sample the host's CPU
  # twice -- FLAT while the process is alive means hung; CLIMBING means merely slow.
  # That one call is the whole difference between "wait longer" and "this is stuck".
  #
  # 🔴 TRAP 7, and it was IN THIS SCRIPT (found by C-7, on its first real run). The
  # sample used to be `ps -W | grep testhost | awk '{print $NF}'`. In Git Bash, `ps -W`
  # prints  PID PPID PGID WINPID TTY UID STIME COMMAND  -- so $NF is the executable
  # PATH, a CONSTANT. cpu1 and cpu2 were therefore ALWAYS equal, and every suite that
  # ran longer than 90s was killed and reported HUNG. On this tree that was EdgeCore
  # (735 tests) and EngineApi (1115) -- i.e. the two suites that matter most -- while
  # the three short ones passed, which is what makes the verdict look plausible.
  #
  # It is the exact inversion of what this script exists to prevent: instead of an
  # absent negative read as a positive, a healthy positive read as a failure. A
  # verification tool that cries wolf gets its output ignored, which costs the same as
  # not having it. `ps` on Windows carries no CPU column at all, so the sample now
  # comes from PowerShell's Get-Process, which reports total processor SECONDS as a
  # float. An empty sample (no host yet, or no PowerShell) still means "cannot tell",
  # never "hung" -- the guard below is unchanged in that respect.
  #
  # 🔴 AND ONE FLAT SAMPLE IS NOT A HANG. With the sample fixed above, the very next run killed
  # EdgeCore -- a suite that had completed 735/735 minutes earlier -- reporting CPU flat at
  # 7.7s across 30s. It was not hung: a suite that legitimately AWAITS a timer (this repository
  # has spool, WAL-maintenance and retry-backoff tests that do) burns no CPU while it waits, and
  # is indistinguishable from a hang over any single window. So the fast path now needs
  # HUNG_SAMPLES consecutive flat periods before it will kill anything.
  #
  # 🔴 AND THE CPU CHECK IS THE COMPANION, NOT THE PRIMARY -- I had that backwards. C-7 observed
  # EdgeCore idle at a GENUINELY FLAT 9.55s of CPU for several minutes mid-suite and then finish
  # 735/735 normally, in the same session where another suite sat "flat but stopped". So
  # flat-and-healthy and flat-and-hung both occur here, minutes apart, in the same project: the
  # CPU heuristic cannot separate them IN EITHER DIRECTION. The wall-clock ceiling below is what
  # actually bounds the failure; the CPU check only makes the common case fail faster.
  #
  # 🔴 TRAP 7(c), found by C-7's review AFTER 7(a) and 7(b) were fixed. The comparison used to
  # be WITHIN one window only -- cpu1 at t+60, cpu2 at t+90 -- so the 60s BETWEEN windows was
  # never compared to anything. A suite busy in the unsampled gaps and idle across each sampled
  # window reads as flat five times running and is killed, while the very notes it prints show
  # the number CLIMBING (10s, 20s, 30s...). Not exotic on this repo: Windows quantises
  # TotalProcessorTime to the scheduler tick, so an I/O-bound suite (SQLite fsync, socket waits)
  # genuinely reads identical across 30s while making real progress. The fix is one variable --
  # carry the LAST OBSERVED sample across iterations, so "flat" means flat across the whole
  # elapsed period rather than across a sampling window we happened to choose.
  #
  # Tolerance, stated correctly (the first version of this comment was wrong by ~3x, which is
  # exactly the sort of number a future maintainer would tune from): each iteration costs
  # sleep 60 + sleep 30 = 90s, so HUNG_SAMPLES=5 means a legitimate idle survives ~7.5 minutes
  # and a genuine hang is caught ~7.5 minutes late. That trade is deliberately lopsided, because
  # the two errors do not cost the same: waiting out a real hang costs minutes, while killing a
  # healthy suite costs the whole run, orphans a test host, and breaks the NEXT build -- which
  # is trap 1, manufactured by the checker itself.
  # 🔴 TRAP 7(d) — a STRUCTURAL limit of the CPU heuristic, not a bug in it. Found by C-7 when
  # DeviceIdentityStoreTests' real-mTLS-handshake test wedged EdgeCore for ~20 MINUTES at
  # 9.77s CPU, creeping ~16ms at a time. That creep is enough to reset the consecutive-flat
  # counter on every iteration, so the detector below waits on it FOREVER. A process that is
  # stopped but not idle is invisible to "is the CPU flat" by construction.
  #
  # So the CPU heuristic gets a companion it cannot argue with: a hard wall-clock ceiling.
  # The two answer different questions -- "is it doing anything?" and "has it taken longer than
  # any healthy run ever does?" -- and a hang only has to trip one. The ceiling is generous
  # (the slowest suite here runs ~3-4 min; 15 min is ~4x) because killing a healthy suite costs
  # the whole run, orphans a test host and breaks the NEXT build.
  #
  # Was 1500s, lowered to 900s once the mTLS leak that motivated it was fixed at the mechanism.
  # Worth stating plainly: at 1500s the ceiling would NOT have caught the incident that prompted
  # it -- the observed wedge was ~20 min and resolved on its own. A ceiling's value is bounding
  # the UNBOUNDED case, not the one you happened to measure.
  SUITE_CEILING_SECONDS=900
  started=$SECONDS
  HUNG_SAMPLES=5
  hung=0
  flat=0
  last_cpu=""
  while kill -0 "$test_pid" 2>/dev/null; do
    sleep 60
    kill -0 "$test_pid" 2>/dev/null || break

    if [[ $((SECONDS - started)) -ge $SUITE_CEILING_SECONDS ]]; then
      hung=1
      note "$name: EXCEEDED the ${SUITE_CEILING_SECONDS}s ceiling ($((SECONDS - started))s) -- killing. A suite creeping slowly is invisible to the CPU check."
      kill_this_runs_hosts "$test_pid"
      kill -9 "$test_pid" 2>/dev/null || true
      break
    fi
    cpu1=$(testhost_cpu_seconds)
    sleep 30
    cpu2=$(testhost_cpu_seconds)

    # Flat means flat against BOTH the in-window sample and the previous iteration's reading.
    # An empty sample means "cannot tell" and must never read as "flat".
    if [[ -z "${cpu1:-}" || -z "${cpu2:-}" ]] \
       || [[ "$cpu1" != "$cpu2" ]] \
       || { [[ -n "$last_cpu" ]] && [[ "$cpu2" != "$last_cpu" ]]; }; then
      flat=0            # progress somewhere, or nothing to sample -- either way, not a hang
      last_cpu="${cpu2:-$last_cpu}"
      continue
    fi

    last_cpu="$cpu2"
    flat=$((flat + 1))
    if [[ $flat -lt $HUNG_SAMPLES ]]; then
      note "$name: no CPU progress for 90s (${flat}/${HUNG_SAMPLES}) at ${cpu1}s -- waiting, a suite may be awaiting a timer"
      continue
    fi

    hung=1
    note "$name: HUNG (test host CPU flat at ${cpu1}s of processor time across ${HUNG_SAMPLES} consecutive 90s periods while alive) -- killing"
    kill_this_runs_hosts "$test_pid"
    kill -9 "$test_pid" 2>/dev/null || true
    break
  done
  wait "$test_pid" 2>/dev/null || true

  if [[ $hung -eq 1 ]]; then
    # Say whose kill it was. vstest will write "Test host process crashed" into the log
    # BECAUSE WE KILLED IT -- that line is our own remedy talking, not a product fault.
    FAILURES+=("$name: HUNG, and WE killed it -- any 'Test host process crashed' in its log is OUR taskkill, not a crash. Rebuild before trusting anything that follows.")
    continue
  fi

  # Anchor to vstest's OWN summary token. The unanchored form matched TEST NAMES --
  # `Abort_FromExecute_TransitionsToAborted_...`, `Reset_FromAborted_...` all print under -v q
  # when they fail -- so an ordinary red test was reported as a host crash and the loop skipped
  # reading the real counts, sending the next reader hunting a phantom. It could not produce a
  # false green, only a misleading red; but a checker that misattributes failures gets ignored
  # just as fast as one that cries wolf.
  if grep -qE '^Aborted!|Test host process crashed' "$log"; then
    FAILURES+=("$name: run ABORTED (host crash) -- any count printed is truncated")
    note "$name: ABORTED"
    continue
  fi

  total=$(grep -oE 'Total: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)
  failed=$(grep -oE 'Failed: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)
  skipped=$(grep -oE 'Skipped: *[0-9]+' "$log" | grep -oE '[0-9]+' | tail -1)

  if [[ -z "${total:-}" ]]; then
    FAILURES+=("$name: no Total line -- the suite produced no result at all")
    note "$name: NO RESULT LINE"
    continue
  fi
  # Point the reader at the trx, which carries the REASON. The console log carries only the
  # NAME — that was trap 7(f), and a failure message you must re-run a whole suite to obtain
  # is a failure message you do not have.
  if [[ "${failed:-0}" != "0" ]]; then
    trx=$(find "$proj/TestResults" -name "$name.trx" 2>/dev/null | head -1)
    FAILURES+=("$name: ${failed} failed — reason in ${trx:-<no trx written>}")
  fi
  [[ "${skipped:-0}" != "0" ]] && FAILURES+=("$name: ${skipped} skipped (this repo expects 0)")
  if [[ "$total" != "$expected" ]]; then
    FAILURES+=("$name: total ${total}, expected ${expected} -- discovery loss or an unjustified change")
  fi
  note "$name: ${total}/${expected} total, ${failed:-?} failed, ${skipped:-?} skipped"
  eval "OBSERVED_${name//[.-]/_}=$total"
done

# ── Gate 3: the verdict, as one line. ───────────────────────────────────────────
echo "[3/3] Verdict:"
if [[ $UPDATE -eq 1 ]]; then
  echo "Observed totals (paste into the EXPECT_* constants above, and justify each change):"
  for entry in "${SUITES[@]}"; do
    name=$(basename "${entry%%:*}"); var="OBSERVED_${name//[.-]/_}"
    echo "  $name = ${!var:-<no result>}"
  done
fi

if [[ ${#FAILURES[@]} -eq 0 ]]; then
  grand=$((EXPECT_ABSTRACTIONS + EXPECT_CONFORMANCE + EXPECT_EDGECORE + EXPECT_EDGESERVICE + EXPECT_ENGINEAPI))
  echo "PASS: 0 build errors, ${#SUITES[@]}/${#SUITES[@]} suites at their exact expected totals (${grand}), 0 failed, 0 skipped, none aborted."
  exit 0
fi
echo "FAIL:"
printf '  - %s\n' "${FAILURES[@]}"
echo "  logs: $LOGDIR"
exit 1
