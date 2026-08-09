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
# CredentialStore, which was the only one of THIRTEEN stores without one — which is exactly why
# (🔴 Dot F branch review, F-7: this said FOURTEEN while the same file says THIRTEEN in three later
# places and the product declares thirteen directories. Dot F's own R4 counts census named this file's
# directory in its corpus and did not reach this line — it corrected packaging/remove-data.ps1 and
# stopped there.)
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
#
# 🔴 TASK D-7a (backend: configuration, lifecycle, and a path an operator can reach) raises this 952 -> 1009
# (+57). Three new files; nothing is rewritten, split or deleted. Both moved EXPECT_* constants are again the
# ONLY executable lines this task changes in this script, per the standing rule.
#
#   +22  ModbusRtuBusSettingsTests (new) — the schema half of "connectors.json can declare a multidrop RTU
#          bus". 6 facts + two [Theory] blocks (10 rows + 6). The two that carry it: the COMPATIBILITY rule
#          (10 rows of documents that must NOT be read as RTU, including three that do not parse at all —
#          DeclaresATransport must answer false rather than throw, or a malformed map would be reported twice
#          by two different paths), and the SERIAL refusal, which asserts the reason and the alternative AND
#          asserts the message does NOT read as "unknown transport" — the wording an operator would act on by
#          assuming they had a typo.
#   +15  ModbusMultidropMapTests (25 -> 40) — D-4 review m5 and blueprint §10 item 2. A [Theory] of 12 rows
#          pins the derived-id namespace at its boundaries (":unit" with no digits, "unit1a", ":unit1" with no
#          bus half); one fact proves a bus named like a device position is REFUSED, which is what makes the
#          namespace disjoint and is what the ghost sweep depends on; one computes the bus-wide write bound on
#          a bus whose devices differ by 20x so "the first" or "its own" is red rather than merely different;
#          and one finally pins the LITERAL "{bus}:unit{n}" (D-4 review m1 — every existing assertion goes
#          through the generator, which cannot see a change to the format).
#   +10  ModbusRtuReadBackoffTests (new) — the backoff arithmetic. The load-bearing ones are about
#          RELATIONSHIPS, not an input/output table: that the base is the HOLD and not the poll interval
#          (asserted against a second device whose hold is small, so a constant floor would fail), that the
#          multiplier really drives the growth (a 1.5x instance, whose answers this test does not also supply
#          as inputs), and that 60 consecutive failures cannot overflow into a NEGATIVE delay — which would
#          make a dead device poll in a tight loop, i.e. the opposite of the mechanism, produced by it.
#   + 6  ModbusRtuConnectorFactoryTests (new) — the first thing in src/ that builds an RTU driver from
#          configuration. THE LEASE LEAK is here twice: once as "an unbuildable device takes no lease at all"
#          (validate before Acquire), and once as the discriminating version — a driver-constructor throw AFTER
#          the lease is owned, observed through the OPENER being invoked a SECOND time. A lease count cannot
#          discriminate: had it leaked, a later Acquire would silently ride the leaked bus and every read would
#          still work, which is the leak's whole signature. Also pins that the factory turns the read backoff
#          ON where a directly-constructed driver leaves it off, asserted through the two drivers' own
#          failed-poll messages on one bus in one test.
#   + 3  ModbusRtuDriverWriteTests (40 -> 43) — blueprint §10 items 1, 2 and 3. The budget test passes
#          CancellationToken.None deliberately — literally the unbounded token §10 item 1 forbids — so only the
#          driver's own bound can end the call, and asserts the Detail does NOT say "cancelled" (nobody
#          cancelled anything). Its control is a driver with NO budget, which still waits the hold out and
#          applies; without that pair the first would pass against an implementation that bounded every write
#          at a constant. The third pins that an Applied COMMAND now carries the acknowledgement-not-observation
#          sentence, with the pulse having genuinely worked.
#   + 1  ModbusMultidropBusTests (11 -> 12) — the read backoff measured on D-4's OWN harness, before and after,
#          in one process. Measured: 2.0 reads/s with the backoff off, 60.0 with it on — a 30x recovery, against
#          an asserted 3x. D-4's own dead-device tax test is unchanged (82x collapse on this machine) and now
#          passes ModbusRtuReadBackoff.Disabled EXPLICITLY, so a future flip of the driver's default cannot
#          silently turn that baseline into a measurement of something else.
#
# 🔴 AND ONE DEFECT THIS MOVE PAID FOR, recorded because it is the reason the measurement exists: the failure
# counter was incremented inside the ARGUMENT of `_logError?.Invoke(ex, DescribeFailedPoll())`, and `?.`
# short-circuits its arguments — so for every driver constructed without a log callback the counter never moved
# and the backoff never engaged. Every unit test of the arithmetic passed. Only the end-to-end number could see
# it, and it reported a 1.0x "improvement".
#
# 🔴 D-7a's REVIEW FIX ROUND raises this 1009 -> 1012 (+3). One file; nothing rewritten, split or deleted. It
# is again the ONLY executable line this task has changed in this script, and it is the ONLY total that moves —
# the round touches src/St4i.EdgeCore and its tests plus doc comments in EngineApi, so a moved total anywhere
# else would mean the fix round reached somewhere it had no business reaching.
#
#   + 3  ModbusRtuConnectorFactoryTests (6 -> 9)
#        + 1  review I-2 — 🔴 THE ONE THAT MATTERS. D-7a's report claimed no test could distinguish
#             "validate before Acquire" from "release on constructor failure", and that claim was FALSE: the
#             reviewer built the counterexample. The observation is at the public seam, not on the lease —
#             a device that cannot produce a driver must be refused BY ITS OWN MAP'S ERROR and must never
#             touch the bus registry. A disposed registry plus a unitId:0 map discriminates, and it still
#             discriminates after I-1's fix (the error becomes "Cannot access a disposed object" instead of
#             the device's own configuration error), which is why it guards something outliving this round.
#             M5 was SURVIVED across 20 runs in the original batch; it is KILLED by this test.
#        + 1  review M-1 — a backed-off device whose WorstCaseBusHoldMs is at or below its poll interval told
#             its operator "no read backoff is configured for this driver", because the message branched on
#             the COMPUTED DELAY rather than on the configuration. Ordinary, not exotic: 1 register, default
#             retries, readTimeoutMs 100, pollIntervalMs 1000 -> a 200 ms hold. D-5's I-1 class for the third
#             time in this batch, landed on the exact message pair the report offers as the operator's way to
#             tell backed-off from quiet.
#        + 1  the SWEEP of M-1's rule rather than the instance: the RECOVERY notice had the same defect one
#             method away, claiming "its read backoff is cleared" for a driver that never had one. Driven as a
#             Default/Disabled PAIR on one bus, because "true of only one of two producing paths" is exactly
#             what a single-path test cannot see. Both messages now branch on ModbusRtuReadBackoff.IsEnabled.
#
# Review M-6 STRENGTHENS an existing assertion without adding a test: UnitZero_IsNotRefusedHere_... now proves
# "still legal for TCP" through ModbusConnectorFactory itself rather than at the parse layer, so the pair is
# RTU-refuses / TCP-accepts at the SAME boundary. Same test, more teeth, no count change.
#
# 🔴 TASK D-7c (direct RS-485: a COM port declarable in connectors.json, on all three hosts) raises this
# 1012 -> 1053 (+41). One new file; nothing is rewritten, split or deleted. EXPECT_ENGINEAPI moves too (+7)
# because the transport SWITCH lives in the composition root and can only be driven there — see its own note
# below. EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately unchanged: D-7c adds
# no driver, no conformance check and nothing St4i.EdgeService executes, so a moved total in any of those
# would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays
# 22 — the serial transport sits on the SAME IModbusBusLink seam D-2 built, so the RTU conformance rig is
# untouched.
#
#   +27  ModbusRtuSerialBusSettingsTests (new) — the SERIAL half of the connectors.json schema, which cannot
#          live beside the gateway half: ModbusRtuBusSettings is in St4i.EdgeCore and SerialLineSettings is in
#          St4i.EdgeCore.Serial, which references it, so a third arm in that parser would be a CIRCULAR
#          reference. 8 facts/theories (1 + 6 + 14 + 2 + 1 + 1 + 1 + 1 rows). The three that carry it:
#          (a) the LITERAL bus key "modbus-rtu-serial:COM7:19200:8:E:1" from a document naming only its port —
#              a literal because comparing against CreateBusKey(new SerialLineSettings("COM7")) would pass for
#              a parser that read no defaults at all, both sides coming from the same constructor. It is red
#              for SerialPort's own 9600-8-N-1 defaults, for any dropped line parameter, and for an
#              un-normalised port name, all at once;
#          (b) a port ABSENT from this machine parses cleanly and fails only when OPENED — the decision the
#              brief asks for, asserted rather than argued (a config file is written for a SITE; an unplugged
#              USB adapter must recover without a restart; TryCreate performs no I/O);
#          (c) the same document fanned out by ModbusMultidropMap yields N devices whose stored MapJson
#              contains NO port name — which is what makes D-7a's projection decision (host/SummaryColumns,
#              never map_json) structurally true rather than filtered, with a positive control so the three
#              DoesNotContain assertions are not satisfied by an empty string.
#   +12  ModbusRtuBusSettingsTests (22 -> 34) — the gateway half, where the schema-level members live.
#          +11  ReadTransport (new member) as an 11-row [Theory]: the routing peek the composition root
#               switches on. It answers with the operator's OWN SPELLING (never normalised — the
#               unknown-transport message has to quote what they wrote) and never throws for a document too
#               malformed to read, which is what keeps a bad map reported by ONE path instead of two.
#          + 1  'portName' refused on a gateway bus. The SWEEP half of the rule ModbusRtuSerialBusSettings
#               applies to 'host'/'port' on a serial bus: a well-formed key that is silently IGNORED makes the
#               file on disk and the configuration actually running two different things. Both directions ship
#               in one commit, because fixing one is the "an instance, not the class" failure §8.1 records.
#          + 0  TheSerialTransport_IsRefusedWithTheReasonAndTheAlternative_… RENAMED and re-pointed to
#               …_IsNoLongerRefusedAsUnavailable_ButAsTheWrongParser. D-7a's message said the serial transport
#               "is not available in this build"; that became FALSE with the ProjectReference, and it was
#               actionable-false — an operator who believed it would buy and cable a gateway they do not need.
#               The test now asserts against that sentence by content.
#   + 2  SerialPortBusLinkTests (+2, and one existing test strengthened) — 🔴 THE DEFECT D-3 RECORDED AND DID
#          NOT FIX. Its open-failure wrapper appended ONE sentence naming all three causes at once ("may not be
#          present …, may be held by another application, or the name may not be a serial port"), which is true
#          of exactly one producing path at a time and sends a reader to three different places. D-5's I-1
#          class, the fourth sighting in this batch. DescribeOpenFailure now branches on the BCL exception the
#          open actually threw, and the assertions are a MATRIX (each arm carries its own diagnosis AND not the
#          other two) — three positive "contains" checks would all have passed on the old shotgun message.
#          Driven from synthesised exceptions because reaching the HELD arm needs a real port plus a second
#          holder; the existing absent-port test is what proves the function is the one OpenAsync calls.
#   + 0  SerialDependencyScopingTests (7 -> 7) — the three deployment assertions INVERTED into positive ones
#          (the owner's ruling of 2026-08-03: direct RS-485 in all three hosts), NOT deleted, because a deleted
#          assertion lets the capability vanish in a later "remove the unused reference" refactor. The FOURTH,
#          TheRtuFramingLayersOwnAssembly_ReferencesNeitherSystemIoPorts_NorTheSerialAssembly, is UNTOUCHED and
#          still green — it is what forces D-7c's design, since the circular-reference-free alternative would
#          have required inverting it.
#
# 🔴 D-7c's REVIEW FIX ROUND raises this 1053 -> 1071 (+18). It is the ONLY total that moves — EXPECT_ENGINEAPI
# stays 1226 because the round's EngineApi edits are doc comments (review M-1's pair obligation, and the I-3
# correction on the lease test's own remarks). No test is rewritten, split or deleted.
#
#   + 1  SerialPortBusLinkTests — 🔴 review I-3, and the finding is that D-7c's report said this could not be
#          done. OneOpenForNLeases_ObservedThroughTheSerialLink_AndTheLastReleaseClosesThePort OBSERVES what
#          the EngineApi test derives: the opener mints one handle per call so the openings are COUNTED (1 for
#          3 leases), ModbusBus.LinkGeneration is pinned at 1, and the PORT's own IsOpen is asserted after each
#          release — open, open, CLOSED. The shipped test asserted LeaseCount, correctly rejected it for the
#          final check, and substituted HasBus: the same witness one field over, both being the registry's own
#          bookkeeping, while the thing protected is a COM port not held to process exit. Everything it needs
#          already existed for exactly this reason — AdoptHandle is internal behind D-3's InternalsVisibleTo
#          and FakeSerialPortHandle.Unpaired is D-6's. No hardware, no virtual COM pair, no conditional skip.
#   + 8  ModbusRtuSerialBusSettingsTests — 🔴 review I-2, the THIRD direction of the sweep. A devices[] element
#          carrying a BUS-level key was accepted, did nothing, and was copied VERBATIM into that device's
#          MapJson, which falsified D-7c report section 6's structural guarantee for any malformed document.
#          ModbusMultidropMap now refuses BusLevelKeys inside an element, mirroring the DeviceLevelKeys check
#          at the root it already had. The [Theory]'s 8 rows are the two parsers' own const fields, which makes
#          it the DRIFT GUARD for a list that cannot be shared: half those keys are declared in
#          St4i.EdgeCore.Serial, which St4i.EdgeCore may never reference, so BusLevelKeys must hold literals.
#   + 1  ModbusRtuSerialBusSettingsTests — the same leak in its PUREST shape, found while fixing I-2 and not
#          named by the review: FanOut's DEGENERATE branch makes the root simultaneously the bus and its only
#          device, so {"transport":"rtu-serial","portName":"COM3","machineCode":"M1",…} stored the port path
#          inside the device's configuration with nothing malformed anywhere. Now refused, with a control
#          proving an ordinary legacy single-device map still fans out under its own instance id unchanged.
#   + 5  ModbusRtuSerialBusSettingsTests — 🔴 review M-2 (4 [Theory] rows + 1 fact). A misspelled key of the
#          operator's OWN transport was silently ignored: {"portName":"COM31","baudrate":9600,"Parity":"none"}
#          parsed to 19200-8-E-1 — TryGetProperty is case-sensitive — so the operator asked for 9600-8-N-1 and
#          got a line whose parity mismatch has no symptom but a device that never answers. The near-miss
#          ("Did you mean 'baudRate'?") is asserted, not merely the refusal.
#   + 3  ModbusRtuBusSettingsTests — M-2 swept to the GATEWAY parser (2 rows) rather than matched, per the
#          coordinator's ruling, through ONE shared implementation with a per-transport key list so the two
#          cannot diverge; plus 1 fact pinning that the unknown-key refusal runs LAST and never pre-empts a
#          more specific one ('portName' on a gateway bus must still be answered by the cross-transport rule).
# 🔴 THE CARRIED-FINDINGS REVIEW FIX ROUND raises this 1071 -> 1072 (+1), counted from the runner. ONE test,
# and it guards a FINDING rather than a behaviour — which is why it is here and not deferred with the finding.
#
#     + 1  ModbusTcpDriverConformanceTests.ThisRigsPollIntervalIsWhatKeepsTheCarriedDisposeFindingReproducible
#          A carried finding says Check_DisposeAsync_IsIdempotent_AfterCancellation passes on the Modbus TCP
#          rig because of its TOKEN, not because DisposeAsync ends the read loop: mutating the shared check so
#          the cancellation is never issued leaves five rigs green (correctly — Dispose is the mechanism that
#          check enforces, cancellation is only scene-setting) and fails that one at ~5.25 s.
#
#          🔴 The MECHANISM is a boundary condition, and the first write-up of it was WRONG in a way that
#          would have sent the next round hunting a disposed semaphore. It is NOT HotFolderAoiDriver's scar —
#          nothing is stranded permanently. DisposeAsync tears the connection down and the read loop observes
#          its flag at the top of the NEXT iteration, having parked in Task.Delay(PollIntervalMs). The whole
#          question is whether that one tick fits inside CancellationBudget — and
#          ModbusLoopbackHarness.BuildWritableMap's default pollIntervalMs (5 000 ms) is EXACTLY EQUAL to
#          CancellationBudget (5 000 ms), from two unrelated files, while the RTU rigs pass 50.
#
#          So: lower that harness default and the TCP rig silently becomes a sixth rig on which the mutation
#          survives, the carried finding stops being reproducible, and NOT ONE TEST GOES RED. That is the
#          "nothing detects deletion of the override" lesson in different clothes, so it gets the same
#          treatment — an assertion rather than a sentence in a report. Asserted as >= rather than == 5000
#          deliberately: the claim is the relationship, not either number.
# 🔴 Task E-3 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §11) raises EXPECT_EDGECORE
# 1072 -> 1080 (+8) and EXPECT_EDGESERVICE 28 -> 45 (+17). Grand total 2556 -> 2581. Per file, and nothing
# is rewritten, split or deleted:
#
#   +8  tests/St4i.EdgeCore.Tests/Engine/EdgeAgentPipelinesTests.cs  (NEW FILE) — the N-driver lifecycle an
#       edge agent gets. The headline one measures at the TRANSPORT that N registered device instances
#       produce N drivers each pushing readings, not that N slots exist; the rest are fault isolation, a
#       refusing factory named in StartIssues, the all-faulted rethrow, orphan-driver disposal, driver
#       disposal at end of run, and the nothing-to-poll case that must not reach SimulatedDriver's ctor guard.
#
#   +7  tests/St4i.EdgeService.Tests/EdgeAgentWriteSurfaceTests.cs   (NEW FILE) — blueprint §3's read-only
#       limit as a STRUCTURAL fact. Runs from St4i.EdgeService.Tests, which has no InternalsVisibleTo from
#       St4i.EdgeCore, so "not exported" here means exactly what it means for the production host. Two of the
#       seven are positive controls (the assembly really is St4i.EdgeCore and really does export things; the
#       driver-shape walker really can see a driver — ConnectorRegistry.TryCreateDriver; MachineState really
#       is an exported mutable type), without which every absence assertion could pass vacuously.
#       🔴 E-3 REVIEW ROUND, +2 in this file. The review found the member census was EIGHT when the real
#       number is THIRTEEN plus one indirect, and that the two missing names were `Start` — the member that
#       builds every driver and opens every port — and `Stop`. One test now CHECKS the census against
#       FleetCore's real public surface (so the count is a measurement, not prose), and one closes the
#       fourteenth, indirect path by asserting nothing exported hands out a MachineState. Nothing was
#       unprotected before: the type-level assertion always guarded all fourteen.
#
#  +10  tests/St4i.EdgeService.Tests/EdgeWorkerConnectorsTests.cs    (NEW FILE) — the connectors.json read
#       path, and the task's most important regression: a deployment with no connectors.json (and one with a
#       malformed one) still runs exactly the simulated fleet it always did, with every commit coming from
#       EdgeWorker's own 8-machine roster. Also pins the two decisions E-4 inherits: entries key on their own
#       id here (not on kind, as in EngineApi), and OPC-UA/RTU entries are refused BY NAME rather than
#       dispatched — OPC-UA because dispatching it would make this host a new writer to the machine-wide
#       %ProgramData%\ST4I\sim\opcua-pki root, which E-3's brief forbids outright. The tenth is the seam
#       that joins the task's two halves: it asserts EdgeWorker actually hands the registry it built to the
#       agent it runs, which nothing else did — a mutation passing `connectors: null` there left every other
#       test in the task green.
#       🔴 E-3 REVIEW ROUND, +0 tests in this file but one assertion strengthened, recorded here because the
#       run got ~2 s slower and that is visible: the headline regression was a MEMBERSHIP check over ~3
#       observed commits, and the reviewer's R2 mutation (collapse all eight simulators onto machine #1)
#       SURVIVED 45/45 with seven of eight machines gone from the run. It is now a SET-EQUALITY check with
#       smoke raised to 60 so full coverage is reachable at all; R2 re-run against it dies in both regression
#       tests.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_ENGINEAPI are deliberately UNCHANGED, and that is the
# evidence for two of E-3's claims rather than a convenience. EXPECT_ENGINEAPI staying 1283 is what says the
# two things E-3 did to EngineApi's own tree — making FleetCore `internal`, and moving ConnectorsConfig down
# to St4i.EdgeCore.Config — changed no behaviour there: the first touched one word and no call site (FleetHost
# is the only file outside St4i.EdgeCore that names the type), the second is a namespace move carried by three
# added `using` lines. EXPECT_CONFORMANCE in particular stays 22: E-3 adds no driver and no connector kind.
#
# 🔴 Task E-5 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §14) raises EXPECT_EDGECORE
# 1080 -> 1082 (+2) and EXPECT_EDGESERVICE 46 -> 49 (+3). Grand total 2589 -> 2594. Per file:
#
#   +2  tests/St4i.EdgeCore.Tests/Config/ModbusMultidropAgentTests.cs   (NEW FILE) — the second half of the
#       split E-3 set: "N instances run N drivers that actually reach the transport", for RTU. The headline
#       one drives ONE RS-485 bus document through the fan-out E-5 moved here, then through
#       EdgeAgentPipelines, over D-2's in-memory paired link (a real in-process NModbus slave network), and
#       asserts three separate claims — three instances keyed {bus}:unit{n}; each machine's readings carry
#       that DEVICE's own register value, read out of the canonical payload at the transport (attribution,
#       which is the thing a shared wire gets wrong); and the link was opened EXACTLY ONCE for three
#       drivers, counted at the opener rather than read off ModbusBusRegistry's own ledger (D-7c's rule:
#       read the thing being protected). The second is the D-7a witness: the ghost sweep runs with BOTH log
#       callbacks absent, which is the composition under which a mechanism computed inside a `?.` argument
#       list silently stops existing. E-5 is what made those callbacks nullable, so E-5 owns that witness.
#
#   +3  tests/St4i.EdgeService.Tests/EdgeWorkerConnectorsTests.cs — 10 -> 13. The RTU refusal test E-3
#       shipped (AnRtuBusEntry_IsRefusedByName_…) is REPLACED, not deleted and not left to go red: it pinned
#       a DECISION, and E-5 reverses that decision in the open, so its successor
#       (AnRtuBusEntry_FansOutIntoOneInstancePerDevice_EachClaimingItsOwnMachine) asserts the derived id SET
#       plus each device's machine claim — a set, because a fan-out registering N instances under one id, or
#       one instance for N machines, satisfies a count. That is +0. The three that move the number are: the
#       auto-DE hardware limit now being logged where the operator plugging the adapter in will meet it
#       (blueprint §9's limit is SILENT when violated, and this is the host on that machine); the
#       no-bus-registry arm, which is why Build's parameter is optional at all; and the SEAM — that
#       EdgeWorker hands a REAL ModbusBusRegistry to the dispatch, which nothing else asserts and whose
#       mutation (pass null) leaves every other test in this task green while every RS-485 bus in production
#       is silently skipped. That is E-3's own `connectors: null` finding, one layer down.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_ENGINEAPI are deliberately UNCHANGED, and EXPECT_ENGINEAPI
# staying 1290 is evidence rather than convenience: E-5 moves ModbusMultidropRegistration and ModbusRtuBusPlan
# OUT of St4i.EngineApi and moves RtuBusConfiguration.IsInBusNamespace to ModbusMultidropMap, and every test
# of all three stayed where it was and kept passing — the E-3 precedent (ConnectorsConfigTests stayed put when
# ConnectorsConfig moved down), and the same argument: a namespace move carried by added `using` lines plus,
# here, one ILogger->callback signature change at the call sites. A behavioural change in EngineApi would show
# up as a moved number. EXPECT_CONFORMANCE in particular stays 22: E-5 adds no driver and no connector kind —
# ModbusRtuDriver has shipped since D-5 and its conformance wiring since D-6.
# 🔴 TASK F-1 (.superpowers/sdd/per-host-roots/task-1-brief.md) raises EXPECT_EDGECORE 1082 -> 1088 (+6),
# COUNTED FROM THE RUNNER (`dotnet test --list-tests`), not by hand. Two NEW files; nothing is rewritten,
# split or deleted, and no existing test in this suite gains or loses a case.
#
#   +3  tests/St4i.EdgeCore.Tests/PerHostDataRootIsolationTests.cs (NEW FILE) — the load-bearing half of
#       F-1 Part 1: TWO HOSTS, TWO ROOTS, and neither observes the other's data. Not a ResolveRoot test: a
#       resolver can be correct while the store ignores it, which is the defect CredentialStoreTests' own
#       redirect test exists for.
#       🔴 WHAT CARRIES EACH ARM, ENUMERATED — fix round 2, review NEW-1. This block has stated a false
#       UNIVERSAL twice. Round 1 said "every assertion is an observation made through the store", which was
#       false of the WAL arm; its replacement said "no arm computes a file name or asserts on a path
#       string", which was false of the CREDENTIAL arm the same day. Ninth instance of that class in four
#       batches, third inside the correction written for it — so this is a list, and a third universal is
#       not the fix:
#         * credential arm — SUBJECT is CredentialStore.Load/ListMachineCodes after only an env var moved.
#           It ALSO corroborates on disk, and that half DOES compute <machineCode>.bin, under three roots
#           (host A, host B, CredentialStore.DefaultRoot()). The third is a negative control on the real
#           %ProgramData% root and earns its duplication of the naming rule; the first two sit on top of
#           the Load assertions rather than carrying them.
#         * settings arm — SUBJECT is FleetSettingsStore.Load per instance. Its one path assertion is a
#           PRECONDITION on two roots this test chose, and can fail only if CreateTempSubdirectory
#           returned the same path twice.
#         * WAL arm — SUBJECT is a glob over each root after a real offline SendAsync. Computes no file
#           name and asserts on no path. It does encode ONE detail the SDK chooses — that a queue file ends
#           in .jsonl — as the pattern it enumerates with, which is the smallest coupling that keeps the
#           observation "what appeared under this root" rather than "what appeared at this path".
#       Anyone editing this block who reaches for "every arm" or "no arm" should enumerate the three
#       against the claim instead.
#         + 1  CredentialStore, the static one whose only seam is the env var, driven with ONE machine code
#              on both sides deliberately: two codes would be separated by the FILENAME even inside one
#              shared directory, so such a test passes on a build where the redirect does nothing. Both
#              directions, because "B cannot read A" and "B did not overwrite A" are different failures.
#         + 1  FleetSettingsStore, via its explicit-directory seam and no env var at all — the store that
#              holds exactly one (ServerUrl, MachineCode, VerifyTls) triple, so sharing its root is a
#              last-writer-wins overwrite rather than a merge.
#         + 1  the WAL, which is the only machine-wide store St4i.EdgeService has ever WRITTEN (blueprint
#              §11.4) and therefore the collision a two-host deployment hits first. 🔴 FIX ROUND 1 (review
#              I-1) REWROTE THIS ARM AND THIS JUSTIFICATION WITH IT. The first version resolved the queue
#              path itself and wrote it with File.WriteAllText, which made it a fact about Path.Combine —
#              WalOptions.ResolveQueueFile documents itself as a pure function of (Directory, machineCode) —
#              so the "through the store" sentence above was FALSE of one of the three arms it justified,
#              in the one place the binding constraint requires a per-file justification to be accurate.
#              The arm now drives a real TransportCoordinator (whose RebuildLive is what calls EnsureDir()
#              and ResolveQueueFile and hands the result to LiveTransport.ForMachine) and a real offline
#              SendAsync, so the bytes are appended by the vendored SDK's own Enqueue. No socket: the
#              injected CapturingHandler throws HttpRequestException, the same technique and the same reason
#              as TransportCoordinatorWalTests. Its CONTROL arm is a third send from host A's OWN root with
#              the SAME machine code, which lands in host A's existing file — one file, two backlogs — so
#              "the two roots stayed separate" is distinguished from "the WAL wrote nowhere at all".
#              Costs ~22 s (three real retry-exhaustions at the SDK's fixed maxRetries/backoff); that is the
#              price of the arm being about this product rather than about Path.Combine.
#       🔴 MUTATION, and it is the one that discriminates: memoise CredentialStore.CredsDir() into a static
#       field (`_cache ??= ResolveRoot()`) — a first-resolution-wins shape nobody would flag on review. The
#       new credential test is KILLED deterministically; the pre-existing redirect test's verdict is
#       ORDER-DEPENDENT, because it only ever resolves one root. All five verbs of mutate-guard.sh, clean
#       first, with a positive control reported KILLED in the same session.
#
#   +3  tests/St4i.EdgeCore.Tests/Drivers/Modbus/RtuSegmentOwnershipTests.cs (NEW FILE) — F-1 Part 2: the
#       one-host-per-segment DEPLOYMENT CONSTRAINT, stated on BOTH transports and stated as a constraint
#       rather than a guarantee. The two transports are asserted in one file on purpose: the claim is a
#       PAIR (each transport carries the rule exactly once, where its operator can meet it), and E-5 is the
#       evidence that two tests each looking at one half do not establish it — E-5 rewrote the serial
#       message and left the gateway with nothing, invisibly.
#         + 1  the plan's two arms together: a gateway plan carries SegmentOwnershipNotice and no
#              LimitNotice; a serial plan carries LimitNotice and no SegmentOwnershipNotice. Either arm
#              alone passes on a build that put the same string on both — the specific mistake available
#              here, since the RULE is true of both transports and only its DELIVERY differs.
#         + 1  the wording, because the wording IS the deliverable: names the segment, says NOTHING
#              enforces it, says CONSTRAINT-not-guarantee, and keeps the write consequence labelled
#              NOBODY HAS MEASURED. The DoesNotContain arms ("prevents", "blocks") are the discriminating
#              ones — a notice that reads as a promise stops the operator checking the other host's
#              connectors.json, which is the only thing that settles it.
#         + 1  the serial half: DescribeOpenFailure's held arm now attributes the refusal to the OPERATING
#              SYSTEM and points at the gateway, so the two halves of the rule cannot be learned
#              separately. E-5's own assertions ("already held", "THE OTHER ST4I HOST") are re-asserted
#              here so this task cannot be read as having weakened them.
#
# No behaviour in this assembly changed. ModbusRtuBusPlan gains a seventh positional member and
# ModbusRtuBusSettings gains one pure string method; every pre-existing RTU test passes unchanged, which is
# the check that the record change is additive rather than a rewrite. CredentialStoreTests gains a
# [Collection] attribute (it and PerHostDataRootIsolationTests both flip the PROCESS-WIDE ST4I_CREDS_DIR, and
# two classes doing that in parallel is a real race) — an attribute moves no count, and a moved count there
# would mean the attribute did more than serialize.
EXPECT_EDGECORE=1088
# 🔴 Task E-4 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md §12) raises EXPECT_EDGESERVICE
# 45 -> 46 (+1) and EXPECT_ENGINEAPI 1283 -> 1289 (+6). Grand total 2581 -> 2588. Per file, and nothing is
# rewritten, split or deleted:
#
#   +1  tests/St4i.EdgeService.Tests/EdgeServiceSerialReachabilityTests.cs   (NEW FILE) — the census rule
#       "every claim of the form 'only X can do Y' gets a test", applied to README §23.6's "Only
#       St4i.EngineApi can open a COM port." That sentence is false as a CAPABILITY claim and has been since
#       D-7c itself, which is what gave all three hosts the ProjectReference: SerialPortBusLink.OpenAsync and
#       SerialLineSettings are public on St4i.EdgeCore.Serial. This test performs a real open from
#       St4i.EdgeService.Tests — whose ONLY ProjectReference is St4i.EdgeService, so naming the type compiles
#       solely because it is reachable through THAT host's reference graph — and the open is refused by the
#       OPERATING SYSTEM (SerialPortUnavailableException, "NOT PRESENT" wording, non-null InnerException),
#       not by the compiler. Deterministic on a machine with no RS-485 hardware: the port name is DERIVED
#       from SerialPort.GetPortNames() the same way SerialPortBusLinkTests derives its own, never hardcoded.
#       The TRUE statement — only St4i.EngineApi has a CONFIGURED path from connectors.json to a serial open
#       — is README §24.5, and its other half is already pinned by E-3's
#       EdgeWorkerConnectorsTests.AnRtuBusEntry_IsRefusedByName_…, so no test is added for it here.
#
#   +6  tests/St4i.EngineApi.Tests/MachineWriteUnavailableMessageTests.cs   (NEW FILE) — the four
#       operator-facing "this write was never attempted" explanations, asserted BY CONTENT on every path
#       that produces them. They had never been asserted at all: every existing test checked the STATUS and
#       the REASON CODE, and the closest any came to the message was
#       Assert.False(string.IsNullOrWhiteSpace(body.Error)), which is true of the wrong string too. Three of
#       the four had drifted into stating something false — each presupposed a connector exists, so none was
#       true for a machine with no connector configured, nor for a machine a St4i.EdgeService edge agent
#       holds (blueprint §12 / README §24.4). One of the six is the COLLAPSE witness (pairwise-distinct, so
#       a single generic "not available" string cannot satisfy the other five individually); one is the
#       throwing default for MachineDriverAvailability.Writable, which is also what makes a future enum
#       member with no arm a red test rather than a soothing sentence.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGECORE are deliberately UNCHANGED. E-4 touches three
# production files, all in St4i.EngineApi (MachineWriteGate, MachineWriteEndpoints, RelayNotificationChannel)
# — a movement in any of the other three suites would mean this task reached somewhere it had no business
# reaching. EXPECT_CONFORMANCE in particular stays 22: E-4 adds no driver and no connector kind.
#
# 🔴 And the four assertions that carry E-4's fix are DELIBERATELY NOT new tests — they replace vacuous
# assertions inside tests that already reached the right states, so they move NO count: the four
# not-available cases in MachineWriteEndpointsTests now assert the HTTP body equals
# MachineWriteGate.ExplainUnavailable(...), and RelayNotificationChannelTests'
# TheFourUnavailableCases_AreDistinguished_AndNoneIsCollapsed now asserts the operator WARNING carries the
# same text. Those two files are the join: the new file proves the text is right, and these prove the two
# surfaces that render it actually use it. A count that did not move is the evidence that the states were
# already covered and only the assertion was empty.
# 🔴 TASK F-1 raises EXPECT_EDGESERVICE 49 -> 50 (+1), counted from the runner. ONE file, ONE test; nothing
# rewritten, split or deleted.
#
#   +1  EdgeWorkerConnectorsTests.AGatewayBus_WarnsThatNothingEnforcesOneHostPerSegment_AndASerialBusDoesNot
#       — the one-host-per-segment constraint emitted by THIS host. It is not a copy of EngineApi's for
#       tidiness: this host is the one an operator adds SECOND, and a gateway accepts its connection whether
#       or not the other host is already on the segment — no error, no log line on either side. Stated only
#       by EngineApi, the constraint would be stated only to the host that was already there. The serial arm
#       in the same file is the discriminator (a COM line must NOT get this notice; its operator meets the
#       rule at the OS's refusal instead). No socket is opened: TryCreate performs no I/O and the link is
#       dialled lazily inside the first transaction, so gw.example is never resolved.
#
# The OPC-UA refusal message in EdgeConnectors.cs is REWORDED by F-1 (the blocking condition — an unmade
# per-host data-root decision — is now made; the refusal stands because what remains is engineering) and
# AnOpcUaEntry_IsRefusedByName_… is unchanged and still green: it asserts the refusal and the word
# "opcua-pki", both of which survive deliberately. A moved count here would mean the reword changed behaviour.
EXPECT_EDGESERVICE=50
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
#
# 🔴 TASK D-7a raises this 1190 -> 1219 (+29), and the sentence directly above stops being true: Program.cs
# now calls ModbusMultidropRegistration.RegisterAll through ConnectorsJsonRegistration's RTU arm, so a
# connectors.json entry can declare a multidrop bus and an operator can turn it on. No file is rewritten,
# split or deleted, and NO NEW ROUTE IS ADDED — RbacPolicyTests.ExpectedRoutes is unchanged and its
# exact-count sweep still runs in both directions, which is why that suite's own total does not move.
#
#   + 7  ConnectorsJsonRegistrationTests (11 -> 18) — the deliverable. A three-device bus entry produces THREE
#          registered instances, each bound to its own machine, each building a real ModbusRtuDriver, all three
#          leasing ONE bus (asserted on the ModbusBusRegistry that enforces it, not on three drivers that
#          merely work); two RS-485 lines in one file are two buses, not a duplicate, with two bus keys and one
#          lease each; the registration-key rule is pinned as a discriminating pair (every pre-D-7a entry shape
#          still answers with its KIND, including one carrying an explicit id — the case that must NOT move,
#          because its slot label and therefore its alarm TargetId would fork); a bus in a host composed with
#          no ModbusBusRegistry is skipped rather than half-wired; a bus whose settings will not parse disables
#          THAT BUS and nothing else; and re-running registration after a device is deleted from the file
#          leaves no ghost.
#   + 7  ModbusMultidropRegistrationTests (12 -> 19) — D-4 review m5 and m6. m6: a removed device is
#          unregistered AND another connector can then claim its machine, which is the only way to prove a
#          CLAIM was released (the brief's own instruction: prove the ghost is gone, not that a method returned
#          true). A RE-ADDRESSED device (unit 2 -> unit 4) is the ordinary edit and is why removal runs BEFORE
#          registration. m5: a derived id already held by something serving a DIFFERENT machine is refused and
#          COUNTED as refused — the half D-4's review found broken. The sweep is proved not to touch a second
#          bus whose id SHARES A PREFIX, nor an ordinary connector. Plus: the factory is built once per bus
#          with the LARGEST device's hold (a bus built so those answers differ by 20x), and a bus that will not
#          parse never builds its factory at all, so a transport that would have been dialled for it is not.
#   + 7  ConnectorRegistryTests (24 -> 31) — the removal path itself: the claim is released (proved by another
#          instance taking it, after asserting the gate was real first), unknown/blank/null ids are ordinary
#          false answers ([Theory], 4 rows), removal uses the SAME DriverKinds.Normalize as everything else
#          (with the third-party half — "vendor.acme.weld" must NOT remove "Vendor.Acme.Weld"), and a
#          TryCreateDriver for an id removed after a snapshot is a visible failure rather than a throw. That
#          last one is the consequence question the old "this task never removes entries" comment let nobody
#          ask, asked.
#   + 6  ConnectorEndpointsMachineClaimTests (13 -> 19) — DELETE releases the live claim, so the 409 that used
#          to tell an operator to restart because a connector they had already deleted was "STILL RUNNING" is
#          gone. 🔴 AND ITS LIMIT, which a failing run corrected: FleetHost.RegisterMachine has no un-register
#          either, so with the machine in the ROSTER the replacement save is still refused — by the roster
#          guard. The first draft of that test asserted the optimistic version and went red. Both are now
#          pinned, and the DELETE response says the roster half in advance. Plus the reserved-instance-id 400
#          (the second door into the derived namespace) and its control [Theory] (3 rows) proving names that
#          are merely SIMILAR are still accepted.
#   + 2  ConnectorsConfigTests (30 -> 32) — ResolveEntries de-duplicates and applies env precedence on the
#          REGISTRATION KEY. Driven with a stand-in resolver so this suite states the RULE rather than
#          restating the production predicate; the real one is driven in ConnectorsJsonRegistrationTests. The
#          three pre-existing ResolveEntries tests are untouched and still pass with no resolver supplied,
#          which is the compatibility half.
#
# 🔴 TASK D-7c raises this 1219 -> 1226 (+7), all in ConnectorsJsonRegistrationTests (13 -> 20). This suite
# moves because the TRANSPORT SWITCH lives here and can live nowhere else: ModbusRtuBusSettings is in
# St4i.EdgeCore, SerialPortBusLink is in St4i.EdgeCore.Serial which references it, so the choice between them
# belongs to the composition root. No other EngineApi file gains or loses a test.
#
#   + 1  ASerialRtuBusEntry_FansOutToNInstances_AllSharingOneSerialBusBuiltFromItsLineParameters — THE
#          deliverable. Three devices on one declared COM port, each bound to its own machine, all on the
#          literal bus key "modbus-rtu-serial:COM7:19200:8:E:1" read off the DRIVERS' own ids (which embed the
#          bus key) rather than off the registry's bookkeeping. Plus the routing proof D-7a met, by enumeration.
#   + 1  OneOpenForNLeases_AndTheLastReleaseDisposes_ThroughTheSerialOpener — 3 leases, two releases leave the
#          bus alive, the third disposes it. Asserted with HasBus and not LeaseCount at the end, because
#          LeaseCount answers 0 for a key that never existed and therefore cannot tell "the last release
#          disposed it" from "it was never created" — on serial that difference is a COM port held to exit.
#   + 1  ASerialBusAndAGatewayBusInOneFile_AreTwoBusesOnTwoTransports — the switch is per ENTRY.
#   + 1  TwoSerialBusesNamingOnePortWithDifferentFraming_AreTwoBuses_NotOneSharedLine — CreateBusKey's rule
#          carried up to a file an operator writes, and the misconfiguration whose runtime symptom is the
#          held-port message (which is why that message names TWO holders).
#   + 1  ASerialBusWhoseAdapterIsNotThere_DegradesAndTellsTheOperatorWhichPort — 🔴 the only test in the batch
#          that makes the SERIAL OPENER actually run on the production path. Everything else observes the bus
#          KEY, which a switch could compute correctly while handing over the wrong opener — they are two
#          arguments. One real poll, through ModbusBus and ModbusRtuDriver's poll catch, to the ILogger the
#          composition root wired: no observer the mechanism does not itself need. Its first draft waited on
#          "a message naming the port" and passed INSTANTLY off the §9 hardware notice logged at registration,
#          reading Health as its initial Down; it now waits on the failed-poll line itself.
#   + 1  TheAutoDirectionControlLimit_IsLoggedOncePerSerialBus_AndNeverForAGatewayOrADeadBus — blueprint §9's
#          hardware limit said where an operator configuring a port will see it. The three NEGATIVE halves are
#          the discriminating ones: not for a gateway bus, not for a serial bus that registered nothing, and
#          exactly once for a bus of three devices.
#   + 1  TheEngineApisOwnIl_ReferencesTheSerialAssembly_… — the half SerialDependencyScopingTests cannot make,
#          because St4i.EdgeCore.Tests does not reference St4i.EngineApi and cannot load it. It distinguishes
#          "this deployment carries System.IO.Ports.dll" (true of all three hosts, and true of anything that
#          merely inherits a copied package asset) from "this host's own code can open a COM port". Asserted
#          for the ENGINE ONLY, deliberately: measured, St4i.EdgeService and St4iMachineSimulator have no
#          ConnectorRegistry, no IConnectorFactory and no connectors.json reader, so neither has IL that could
#          reference the serial assembly and asserting that it does would assert something false.
#
# 🔴 TASK D-7b raises this 1226 -> 1251 (+25). Counted from the runner (three `dotnet test --filter` runs,
# 14/6/5), not by hand — D-2's rule: a total that reconciles is not evidence that anybody knows where the
# tests are. Three NEW files; no pre-existing EngineApi test is added or removed. Two pre-existing assertions
# CHANGE VALUE without moving the count: ConnectorConfigStoreTests' two `Assert.Equal(4, ReadUserVersion(dir))`
# become 5, because the migration ladder grew a rung (bus_instance_id/bus_settings_json). They assert the
# ladder's CURRENT top rather than "the rung this test is about", which is what makes a v3 database opened by
# this build prove that the LAST rung ran too.
#
#   +14  ConnectorRtuBusEndpointTests           (new) — POST /v1/connectors creating a BUS, the first of the
#          two endpoint gaps D-7a deferred with an argument. 3 devices -> 3 store rows, 3 registry claims, 3
#          roster machines; the LINE projection through the endpoint for both transports; 🔴 the partial-
#          failure pair, which is the point — device 5 of 8 invalid and a third device colliding with an
#          existing claim BOTH leave zero rows, zero registrations and an unchanged roster, asserted on all
#          three surfaces rather than on a status code (a 400 that had already written seven rows satisfies a
#          status assertion); a re-save that DROPS a device losing exactly that row; a bus with no instanceId
#          and a bus named like a device position both refused; an ordinary Modbus TCP save proved to still
#          take the single-connector path; DELETE removing exactly one device of two with its sibling's claim
#          intact; the last device's delete saying the bus is gone; and B-3's save gate over a whole bus, whose
#          discriminating half is that re-pointing ONE device's register changes the required fingerprint.
#          🔴 The LAST TWO of the fourteen exist ONLY because a mutation survived, and both were reached by
#          attempting the counterexample on a DIFFERENT AXIS than the one the code was reasoned about
#          (blueprint §8.1, principle 1). The rollback branch was written for a concurrent registration,
#          which no test can stage — so deleting the rollback SURVIVED. The axis that reaches it is not
#          concurrency at all but the BUS'S OWN NAMESPACE: swapping two devices' machine codes between two
#          slave addresses passes the pre-check (every incumbent claim belongs to an id this bus is about to
#          re-register) and is then refused by Register itself, deterministically, after the store has been
#          written. ABusSaveThatFailsToRegister_… kills the store half; a SECOND mutation (leave the partial
#          registrations behind) then survived THAT, because in a two-device swap the first device is the one
#          that fails and nothing is registered yet to undo — so ABusSaveThatFailsPartWayThrough_… moves the
#          swap to units 2 and 3 of three, putting one success ahead of the refusal. Its assertion is the
#          DOCUMENTED LIMIT (the re-registered id ends up registered by nothing, because Register is
#          last-write-wins and the incumbent entry was destroyed at the moment of success), not an optimistic
#          one — asserting that the previous binding came back would assert something false.
#   + 6  ConnectorConfigStoreBusProjectionTests (new) — 🔴 the store BOUNDARY, where the SummaryColumns/
#          FullColumns split actually lives and where D-7c said D-7a's projection decision had to be asserted:
#          portName in `host`, NULL in `port`, through BOTH projections. The credential-free projection is
#          proved to carry neither the bus document nor the map — by putting a recognisable sentinel in each
#          and serializing the whole returned summary, which is a statement about the SQL rather than about a
#          C# type's property list. Plus: a bus save replaces its whole row set; a restore puts the exact
#          previous set back INCLUDING created_at (without the explicit @created_at parameter this is the one
#          that fails, and it fails in the direction that rewrites history); an empty restore is a pure delete;
#          a bus save leaves a connector whose id merely SHARES A PREFIX alone; and a pre-D-7b row reads back
#          with no bus at all.
#   + 5  ConnectorConfigVisibilitySeederBusTests (new) — the second endpoint gap: GET /v1/connectors/configured
#          now seeds an RTU bus, removing D-7a's explicit Program.cs skip. N rows one per device, tagged
#          Seeded, carrying the line; a re-seed LOSING a device the operator deleted from connectors.json (an
#          insert-only seeder leaves a row for a device that is not on the wire); 🔴 a bus with ANY operator-
#          owned row skipped WHOLE and warned about, because half a seeded bus is worse than none; and two
#          never-throws arms (a malformed device, an unreadable transport) that seed nothing and warn naming
#          the offending element.
#
# 🔴 D-7b FIX ROUND 1 raises this 1251 -> 1265 (+14). Counted from the runner (18/10/6/5), not by hand.
#   + 4  ConnectorRtuBusEndpointTests (14 -> 18) — review I-1 and I-2, and the count moves for a reason worth
#          reading: TWO tests were REPLACED rather than added to. The rollback pair I built last round drove a
#          device SWAP, and I-2's fix makes that swap SUCCEED — re-addressing two devices on a line was a
#          permanent DEAD END (the registry kept the old claims, so the identical retry failed identically,
#          forever, and the refusal named a cause that had not happened). So those two became
#          TwoDevicesTradingSlaveAddresses_… (the save works, and a write for the moved machine resolves to
#          its NEW unit) and ADeviceDroppedFromTheMap_LosesItsMachineClaimToo_… (the endpoint half of D-4's
#          own m6 ghost). Net +4 is those two plus I-1's three: the failed-save SENTENCE is now a pure
#          function (DescribeBusRollbackOutcome) driven over every combination, because the version it
#          replaces told an operator their live registry had been destroyed on a path where nothing was
#          touched — a [Theory] of 2 rows pinning that false half, plus the released-count arm and the
#          failed-rollback arm.
#   +10  RtuBusRegistrationTests (new) — 🔴 where the rollback is provable now that I-2 removed the only
#          deterministic path to it through the endpoint. Both halves of the undo driven directly against an
#          OUTSIDE claim (one success ahead of the refusal, taken back), the IncumbentsReleased count I-1's
#          message branches on (0 on a first save, 2 on a re-save), the proof that a release touches this
#          bus's namespace and nothing else (`line1-spare` and `line2:unit1` both survive — a bare-prefix
#          rule would take the first), and a 7-row [Theory] stating the namespace rule itself, since
#          TryFindBlockedDevice's exemption and ReleaseOwnNamespace's removal must be the SAME set or an edit
#          is refused that the register pass was about to make work.
#
# 🔴 D-7b FIX ROUND 2 raises this 1265 -> 1269 (+4), all in RtuBusRegistrationTests (10 -> 14). Counted from
# the runner (18/14/6/5). Review N-2: the shared bus-namespace predicate was OVER-BROAD — it asked only that
# an id start with "{bus}:unit" and end in digits, so bus `line1` claimed `line1:unitA:unit3`, which is a
# legitimate device of the DIFFERENT bus `line1:unitA` (a legal name: ValidateBusInstanceId reserves only an
# all-DIGIT suffix). Saving `line1` released that device's machine claim while its driver kept polling.
#
#     + 3  three rows added to TheBusNamespaceRule_… — the falsifying row the reviewer supplied
#            (`line1` vs `line1:unitA:unit3` = false), its mirror (`line1:unitA` vs the same id = true, so the
#            fix does not simply narrow the rule into uselessness), and a same-length/different-prefix row
#            (`abcde` vs `xyzab:unit3`) proving the new position check did not REPLACE the prefix check. The
#            theory was named `…AndNothingElse` while omitting the row that falsified it, which is what let a
#            doc call the property "a guarantee rather than a hope".
#     + 1  SavingOneBus_NeverReleasesADeviceOfADifferentBusWhoseNameSharesItsPrefix — the same defect at its
#            CONSEQUENCE on the production path rather than at the predicate: a registered device of bus
#            `line1:unitA` survives a save of bus `line1`, with IncumbentsReleased == 0.
#
# No test is added for N-3 (SweepGhosts now calls the shared predicate instead of its own inline copy) and
# that is deliberate: ModbusMultidropRegistrationTests already owns that behaviour and its
# TheGhostSweep_NeverTouchesAnotherBusOrAnOrdinaryConnector is what a redirection must not break — verified
# by mutation (making the sweep ignore the namespace kills 2 of its 13). A redirection that moved the total
# there would mean it was not behaviour-preserving.
#
# 🔴 WHOLE-BRANCH REVIEW, I-1 raises this 1269 -> 1272 (+3), all in ConnectorRtuBusEndpointTests (18 -> 21).
# Counted from the runner (21/14/6/5). The bus-device DELETE branch selected on BusInstanceId alone and never
# consulted Source, so for a bus declared in connectors.json — the PRIMARY way an RS-485 line is declared —
# it told the operator "the bus is no longer configured at all" while the seeder re-seeds that bus on every
# boot. One operator-facing string covering two producing paths, true of only one: the sixth instance of this
# batch's defect class #1, and the THIRD in that one file.
#
#     + 1  DeletingTheLastDeviceOfASEEDEDBus_SaysItComesBack_NeverThatTheBusIsGone — driven through the REAL
#            seeder and the real endpoint rather than a hand-written Seeded row, so the provenance under test
#            is the one production produces. Asserts the false sentence as an ABSENCE, because the defect was
#            not a missing caveat but an active assertion of the opposite.
#     + 1  DeletingTheLastDeviceOfAnOPERATORBus_StillSaysTheBusIsGone — the other arm, so the fix is a FORK
#            rather than a blanket caveat. Telling an operator their own deleted bus will come back is the
#            same defect pointing the other way.
#     + 1  TheRemedyForAnIncumbentConnector_DependsOnWhereThatConnectorCameFrom — I-1's SWEEP, not its
#            instance. "Remove that connector first (DELETE …)" is right for an Operator-owned incumbent and
#            WRONG for a Seeded one, which is re-created at every start, so the DELETE frees the machine only
#            until the next restart. A pure function, three arms; two of them are otherwise reachable only by
#            constructing a specific store state at a specific endpoint.
#
# 🔴 WHOLE-BRANCH REVIEW, LAST ITEM raises this 1272 -> 1276 (+4). Counted from the runner (23/16/6/5).
# TryFindBlockedDevice — the refusal an operator hits SAVING an RS-485 bus — still emitted "Remove that
# connector (DELETE …)" with no provenance fork, wrong the same way for a connectors.json-seeded incumbent
# (the DELETE frees the machine until the next restart and no longer). The sibling of the I-1 sweep, and the
# reason that sweep could not reach it is the finding: the grep was on `existing.Source`/`ConnectorConfigSource`,
# tokens that appear ONLY where the field is already in scope, and TryFindBlockedDevice takes bindings +
# roster and never the store — so `Source` could not have appeared in it under any circumstances.
#
#     + 2  ConnectorRtuBusEndpointTests (21 -> 23) — both arms at the endpoint, where the store is in scope:
#            a SEEDED incumbent is told to change the connectors.json entry (naming its bus) and is NOT told
#            to delete a row that comes back; an OPERATOR incumbent still gets the DELETE, which for it works.
#            The seeded one is driven through the REAL seeder.
#     + 2  RtuBusRegistrationTests (14 -> 16) — the seam: the refusal names the incumbent and the remedy is
#            ABSENT (a type that cannot see provenance must not ship a sentence that depends on it), and the
#            ROSTER arm hands out no incumbent and keeps its advice — nothing removes a machine from the
#            roster, so "use a different machine code" is true whatever wrote it. A sentence true without the
#            field beats a fork that cannot be built.
#
# 🔴 CARRIED FINDINGS (fix/carried-findings, task 1) raises this 1276 -> 1280 (+4). Counted from the runner
# (`dotnet test --list-tests`), not by hand. ONE file, four new tests; nothing rewritten, split or deleted.
# This line is the ONLY executable line the task changes in this script, per the standing rule.
#
#     + 4  NotificationEndpointsTests
#          + 1  TheWebhookSendTest_TellsARefusedDestinationFromASilentOne_AtTheProductionBound — the PAIR, both
#                 arms at the 5 s bound Program.cs actually constructs, because "distinguishable" is a claim
#                 about a pair and two arms at two configurations would not be one. Assert.NotEqual is the
#                 discriminator; the two Contains stop it passing on any two strings that merely differ.
#          + 1  TheWebhookSendTest_AtABoundBelowTheConnectPath_ReportsTheCauseAsUndetermined_NotAsABlackHole —
#                 the carried Important itself. A REFUSED destination at a 1 s bound lands in the TIMEOUT arm,
#                 and that arm no longer names the black-holing peer as the cause. Its lower bound on elapsed
#                 time is what makes it non-vacuous: it proves the two producing paths genuinely collapsed
#                 before asserting on the message the collapsed case produces.
#          + 1  TheEmailSendTest_NeverTellsAnOperatorARelayRefusedAMessageThatNeverReachedOne — the SWEEP's own
#                 find, in the sibling channel. SmtpNotificationChannel.Classify returns descriptions covering
#                 both "a relay decided something" and "nothing was ever reached", and BOTH callers wrapped
#                 every one of them in a sentence asserting the relay had acted. No grep could have found it:
#                 the distinguishing fact did not exist as a field anywhere to grep for. Classify now returns
#                 it.
#          + 1  TheEmailDispatch_ReportsAMessageThatNeverLeftThisMachine_AsNeverSENT_NotAsARelayRejection — the
#                 same find on the DISPATCH half, which an operator meets without pressing anything. Reachable
#                 and ordinary: SaveSmtpAsync requires a From address to be non-blank and not to PARSE, so a
#                 mistyped one throws FormatException out of Compose before a socket is opened — permanent,
#                 with no relay involved, and reported as a relay REJECTION until now.
#
# 🔴 THIS PARAGRAPH WAS TRUE WHEN WRITTEN AND STALE ONE COMMIT LATER, in the one file this project treats
# as the record. It said EXPECT_EDGECORE was "deliberately UNCHANGED ... staying 1071", and the fix round
# that followed added the harness-default pin above, taking it to 1072. The claim below is still true of
# the conformance work it describes — no test was added or removed BY THAT WORK — but a reader checking it
# against the constant finds 1072 and has no way to tell which half is wrong. Corrected rather than
# deleted, because the reasoning it carries is the evidence that the conformance fix cost nothing.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE and EXPECT_EDGESERVICE are deliberately UNCHANGED, and
# EXPECT_EDGECORE moved by exactly +1 — the pin at :750, nothing else. That the CONFORMANCE half of this
# task moved it by ZERO is the check rather than a coincidence: the other half of this task fixes
# a conformance check that could not fail on the Modbus TCP and OPC-UA rigs, and it does so exactly as D-6 did
# for RTU — a `base`-CALLING override that raises ONLY that one check's own target bound, with an assertion
# that it genuinely strengthened before delegating. No shared-suite change, no test added or removed, four
# drivers' other checks untouched. Proven by re-running the mutation that removes `cts.Cancel()` from
# DeviceDriverConformanceSuite.cs so cancellation is never issued at all: it used to kill 2 of the 4 writable
# rigs and now kills 4 of 4.
#
# 🔴 THE REVIEW FIX ROUND raises this 1280 -> 1282 (+2), counted from the runner. ONE file; nothing is
# rewritten, split or deleted. Both close CRITICALS that are finding 1's own defect class reproduced INSIDE
# the fix for finding 1's class — which is blueprint §8.1 principle 3 landing on this task exactly as it
# landed on three people in Đợt D.
#
#     + 1  TheEmailSendTest_TellsARelayThatBrokeTheConversation_FromAHostThatNeverAnswered — C-2. The fix's
#            first shape answered "no relay was reached" for EVERY transport failure. A relay that greets,
#            reads EHLO and then RSTs is a transport failure in which a conversation demonstrably took place
#            and the RELAY ended it. MEASURED, and the measurement corrected this test's own first doc
#            comment: the refused port carries SocketException(ConnectionRefused), while the reset relay
#            carries a bare IOException with NO SocketException at all — so the pair is separated by the
#            classifier's no-socket-error FALLBACK, not by its socket-code switch. Mutation found that: the
#            switch could be mutated with this test still green.
#     + 1  TheEmailSendTest_TellsAMessageThatNeverLeftThisMachine_FromOneNoRelayAnswered — the Minor beneath
#            C-2. "Nothing was reached" and "nothing was SENT" are different facts wanting different advice: a
#            mistyped From address never opens a socket, so "check the host, the port and this machine's
#            route to it" is advice written for the other producing path. Three situations need three
#            sentences and a bool carries two, which is why the flag is now an enum.
#
# C-1 adds NO test and that is the check rather than an omission: it is closed by an assertion added to the
# EXISTING pair test (the credentials hint must not ride along on a "no SMTP conversation took place"
# sentence). One assertion of the same shape was written on the dispatch test and DELETED after mutation
# proved it could not fail — that path's exception yields no hint code, so it would have read as coverage of
# the composition defect while being incapable of detecting it.
# 🔴 Task E-2 (docs/plans/2026-08-04-dotE-fleet-core-extraction-blueprint.md) raises this 1282 -> 1283, and
# the SIZE of that delta is the point of the number rather than an inconvenience to it.
#
# E-2 extracted the N-driver lifecycle core out of St4i.EngineApi.Fleet.FleetHost into
# St4i.EdgeCore.Fleet.FleetCore — ~2 400 lines relocated, ConnectorRegistry/MachineState/SafetySnapshot
# moved with it, MachineState.cs and Dtos.cs split, 14 ILogger call sites re-expressed as EdgeCore callbacks,
# and FleetHost rewritten as a shell. Its brief made the gate the CHECK on that: "this is a move, not an
# addition — if a number moves, stop and report the reason before changing it."
#
#     THE MOVE ITSELF MOVED NOTHING. It was committed and run first, on its own, at exactly
#     151/22/1072/28/1282 = 2555, 0 errors, 116 warnings, 0 build nodes. That run is the evidence, and it is
#     why this constant could be left alone through the entire relocation.
#
# The +1 is the one test the SAME brief separately required, and it is irreducible to zero:
#
#     + 1  Safety/EstopLatchVisibilityRaceTests.Estop_RacedAgainstAContinuousWriteLoop_… — blueprint §9.3b's
#            racing test. Nothing in 2555 tests had ever raced Estop() against anything; every latch test was
#            sequential, so a latch write moved off FleetCore._gate was invisible. It guards a REAL,
#            PRE-EXISTING, previously-untested safety property (every guard evaluation beginning after
#            Estop() returns denies) and it says in its own header that it does NOT guard the cut — §9.3b
#            proved with two mutations that no racing test can, because EstopGuardRule reads EstopEngaged
#            alone. A new behaviour under test is a new [Fact]; folding it into an existing test to protect
#            this constant would have been the constant lying.
#
# The brief's other two mandated witnesses cost ZERO, deliberately, and that is not an accounting trick —
# §9.3b's own words are "any test that kills the hardcoded `true` is enough":
#
#     + 0  SafetySnapshot.IsRunning now has a witness: two assertions inside the EXISTING
#            RelayNotificationChannelTests.HaltLatched_TheBeaconDoesNotLight_… — already the batch's headline
#            safety test, with a latched/cleared pair to hang them on. §9.3b measured that a hardcoded `true`
#            in that field survived all 1282; it now fails.
#     + 0  The redaction property (FleetCore's write path emits ex.GetType().Name and NEVER ex.Message) now
#            has a witness: assertions inside the two EXISTING disposal-race tests in
#            FleetHostMachineDriverResolutionTests, plus a secret-shaped message on the test double so a leak
#            is legible. E-1 §4.5 measured that the ex.Message mutation left all 2555 green; it now fails on
#            both the setpoint and the command path.
# 🔴 Task E-4 raises this 1283 -> 1289 (+6). The whole justification is in the block above
# EXPECT_EDGESERVICE — one new file, MachineWriteUnavailableMessageTests.cs, and the four assertions that
# actually carry the fix cost 0 because they replaced vacuous ones inside tests that already existed.
#
# 🔴 E-4 REVIEW ROUND raises it once more, 1289 -> 1290 (+1), in ONE existing file. It is the only total
# that moves in that round; every other correction the review asked for is a comment or a doc sentence.
#
#   +1  tests/St4i.EngineApi.Tests/MachineWriteEndpointsTests.cs
#         Setpoint_FleetRunning_NoConnectorEverConfigured_409_NoLiveDriver_WithAllThreeOldCausesFalse
#       Review finding C3: the comment on the EXISTING NoLiveDriver test claimed that test's own scenario
#       "satisfies none of" the old string's three named causes. It does not — that test never calls
#       host.Start(), so "the fleet may be stopped" is exactly true of it. The claim was right about the
#       product and wrong about its witness, which is the same defect class one layer up, so it gets a
#       witness instead of a rewording: a Modbus-kind roster machine on a RUNNING fleet with no connector
#       ever configured, asserting all three old causes false AT the moment the 409 is produced
#       (host.IsRunning true, EstopEngaged false, GetConfiguredConnectorIssues empty) and then asserting
#       the body. Modbus-kind specifically because ResolveSlotLabelFor excludes Modbus/OPC-UA from the
#       simulated group unconditionally; a simulated-kind machine would report ReadOnly, the other case.
# 🔴 TASK F-1 raises EXPECT_ENGINEAPI 1290 -> 1293 (+3), counted from the runner. Two files; nothing
# rewritten, split or deleted.
#
#   +2  tests/St4i.EngineApi.Tests/PerHostDataRootsTests.cs (NEW FILE) — it lives in THIS suite, not in
#       EdgeCore's, because it is the THIRD scan-derived census test of the same set and the other two are
#       already here (NotificationDocumentationTests' decommissioning scan, TestHarnessIsolationTests'
#       Playwright scan). It also has to see EngineApi's own five stores, which St4i.EdgeCore.Tests cannot.
#         + 1  EveryMachineWideDirectory_IsRelocatable_ByADerivableEnvVarName — 🔴 THE FIFTH-STORE GUARD,
#              and the reason F-1 enumerated instead of trusting its brief. The brief named FOUR stores;
#              the enumeration found THIRTEEN. All thirteen were already relocatable, so this test is not
#              a fix — it is the thing that makes a FOURTEENTH impossible to add without a variable, which
#              is where this defect would actually have lived. Derives BOTH sets from src/ and requires the
#              variable NAME to be derivable from the directory name (ST4I_<NAME>_DIR), because that is the
#              rule README §15.9 tells an operator; requiring only "thirteen of each exist" would pass
#              while a directory and its variable named different things. Non-vacuity floors on both sets
#              plus five named controls, the same shape both siblings carry. The quantity it measures is
#              "a quoted ST4I_<NAME>_DIR literal exists in src/" — narrower than "relocatable", which is
#              why fix round 1 added the test below rather than letting README §15.9 lean on this one.
#         + 1  TheReadme_TellsAnOperatorThatRelocatingARootDoesNotMigrateTheOldData — §8.1's fourth census
#              tier: a rule stated to an OPERATOR is a different population of text from one stated to a
#              programmer. Relocating a root on a running deployment silently orphans that store's data,
#              and a host that cannot read its own saved credential looks exactly like one that was never
#              onboarded. Pins the three FACTS (the section exists, EN+VI both say nothing is migrated, the
#              credential consequence is named) and deliberately not the prose.
#
#   +1  ConnectorsJsonRegistrationTests.TheOneHostPerSegmentConstraint_IsLoggedOncePerGatewayBus_AndNever-
#       ForASerialOrADeadBus — the exact mirror of the file's own DE-limit test, and the mirroring is the
#       argument. Once per SEGMENT (three devices, one notice), never for a serial bus, never for a bus that
#       registered nothing. It also asserts the two load-bearing phrases reach the log ("NOTHING enforces
#       it", "NOBODY HAS MEASURED"), because a notice an operator reads as a promise is worse than none.
#
# The startup persisted-bus path (Program.cs) and the POST /v1/connectors save response also carry the new
# notice, and neither gains a test: both were already covered for LimitNotice by tests that assert the
# notice-carrying branch, and the new statement rides the identical branch. Recorded as a KNOWN GAP rather
# than claimed as covered — see task-1-report.md.
# 🔴 TASK F-1 FIX ROUND 1 (review I-4) raises EXPECT_ENGINEAPI 1293 -> 1294 (+1), counted from the runner.
# ONE file, ONE test; nothing rewritten, split or deleted.
#
#   +1  PerHostDataRootsTests.EveryRelocationVariable_IsActuallyREAD_NotMerelyDeclared — closes the
#       instrument/criterion gap the review named. The guard above measures "a quoted ST4I_<NAME>_DIR
#       literal appears somewhere in src/"; README §15.9 cited it for "there is no exception", i.e. that the
#       directory is RELOCATABLE. A fourteenth store declaring `const string EnvVarDir = "ST4I_FOO_DIR"` and
#       never reading it satisfied the first and violated the second — and neither M3 (no variable) nor M4
#       (non-derivable name) reaches that shape, so the gap was untested as well as undisclosed. The new
#       test requires every variable to reach a real Environment.GetEnvironmentVariable call, binding
#       constants to literals PER FILE so that thirteen stores all naming their constant `EnvVarDir` cannot
#       vouch for each other, and resolving a qualified Type.Member against Type.cs. Two named controls, one
#       per resolution form: ST4I_HISTORIAN_DIR (read only as a bare literal, in Program.cs, not on its
#       store) and ST4I_CREDS_DIR (read only through a same-file constant).
#       🔴 What it still does NOT measure, disclosed here and in README §15.9 rather than left to a reader:
#       "declared and read at a resolution site" is not "the resolved value is honoured to a file". Nothing
#       here executes a store. A sweep that did would have to set thirteen process-wide variables inside a
#       suite whose other classes boot real hosts that read them — trading a documented narrowness for an
#       undocumented race.
#       🔴 WHERE THAT HALF ACTUALLY IS — and this note has been wrong twice, in opposite directions.
#       Fix round 2 removed an over-claim (SecurityEnvVarTests carries NO TEST; it is a
#       [CollectionDefinition] marker whose only member is a collection name). The branch review found the
#       replacement wrong as well, on both the instrument and opcua-pki:
#         * F-8, THE INSTRUMENT. This said the rows came from "counting the files under tests/ that name
#           each variable" — the very grep PerHostDataRootsTests explains cannot work, because every store
#           reads through its own constant. FleetSettingsStoreTests spells ST4I_SETTINGS_DIR ZERO times
#           while driving the seam through FleetSettingsStore.EnvVarDir; BridgeSpoolTests' only occurrence
#           of its literal is a doc comment. TWO instruments were used and one was named: (a) a literal
#           count over tests/, which gives the breadth, and (b) reading each candidate for a
#           SetEnvironmentVariable(<Store>.EnvVarDir, …) call, which gives the per-store rows.
#         * F-10, OPCUA-PKI. "Nothing measures it" was false. OpcUaDriver's ctor calls
#           OpcUaPkiPaths.ResolveRoot(pkiDir), and OpcUaDriverConformanceTests / OpcUaDriverLoopbackTests /
#           OpcUaDriverWriteTests each hand it a real temp root and let it write its app-instance
#           certificate there — the EXPLICIT-PATH arm of the same explicit > env > default chain. The true
#           residual: nothing exercises ST4I_OPCUA_PKI_DIR, the env var.
#       By (b): FOUR dedicated witnesses (creds, settings, wal, bridge-spool); EIGHT redirected
#       incidentally by host harnesses; opcua-pki covered on its explicit arm and not on its env arm.
#
# TheReadme_TellsAnOperator... does NOT move a count and its assertions changed: it used to require the
# phrase "not onboarded", and review C-2 showed the sentence beside it prescribed a remedy ("until it claims
# again") that St4i.EdgeService cannot perform. It now pins the ASYMMETRY — that §15.9 says the edge agent
# cannot claim — in both languages. Same test, different (and correct) subject.
# 🔴 DOT F BRANCH REVIEW (F-15) raises EXPECT_ENGINEAPI 1294 -> 1295 (+1), counted from the runner. ONE
# file, ONE test; nothing rewritten, split or deleted.
#
#   +1  PerHostDataRootsTests.TheNumberOfMachineWideDirectories_IsDerivedFromSource_AndAgreesWithEvery-
#       PlaceThatSpellsIt — the three guards in that file floor at `>= 13`, so a fourteenth store that
#       arrives WITH a variable passes all three while the word "thirteen" rots in six artefacts. It
#       derives the count from src/ and compares it against the number spelled in the two sentences that
#       state it as a rule: README §15.9's "There are **N** of them today" and remove-data.ps1's
#       .DESCRIPTION. Those two are each the authoritative sentence of their own artefact; the rest of the
#       prose repeats them.
#       🔴 MEASURED, not asserted (branch re-review, N-4). TWO mutations, because the first was not
#       discriminating and the report said it was: a BARE fourteenth store (variable declared and read,
#       but no playwright env entry and no remove-data.ps1 purge entry) is killed by THREE tests — this
#       one plus the two SET-MEMBERSHIP censuses, TestHarnessIsolationTests and
#       NotificationDocumentationTests. A FULLY INTEGRATED fourteenth store (variable + playwright entry +
#       purge entry + parameter, with only the spelled count left alone) is killed by THIS TEST ALONE:
#       1 failed, 12 passed, both set-membership censuses green. That second shape is the gap F-15 named,
#       and it is the one that justifies the test existing.
#       🔴 WHAT THIS TEST REACHES, stated because the first version of this block overstated it (branch
#       re-review, N-2). It opens exactly two files besides src/: README.md and packaging/remove-data.ps1.
#       It never opens web/playwright.config.ts or this file. So it would NOT have caught the four
#       FOURTEENs the Dot F branch review found — at 709df245 the derived count was 13, README said
#       "thirteen" and remove-data.ps1 said "THIRTEEN", all three compared values agreed, and this test
#       would have been GREEN with every one of those defects in the tree. What it does do: it fires the
#       moment src/ and those two rule sentences diverge, and its failure message then names the other
#       artefacts by hand for a human to walk. The overstatement is recorded rather than deleted because
#       it was a claim in the VOICE OF A MEASUREMENT about the reach of the instrument built to end that
#       class, sitting in the binding per-file justification.
#       🔴 THIS IS THE MECHANICAL CHECK THE LEDGER'S §G.6 TRIGGER ASKED FOR, and the grep for
#       "every"/"all"/"no arm" was declined — but NOT for the reason first written here. That reason was
#       "a quantifier grep cannot decide whether a universal is true, so it answers a narrower question
#       than the criterion". It is wrong, and it would disqualify this count check too: a count does not
#       decide whether "thirteen" is TRUE either, it decides whether three artefacts AGREE. An instrument
#       answering a narrower question is a defect only when it is REPORTED as answering the criterion,
#       which is what F-8 was. The real reason to decline is RECALL: the grep keys on quantifier WORDS,
#       and this branch's worst false universal used none — "two uncoordinated frame sources on one
#       segment do not corrupt data" is a universal by generic plural, and so was its replacement. The
#       grep would have flagged neither, only the historical "every assertion …" / "no arm computes …"
#       pair that the prose trigger already covers. Bounded recall on a sub-class already covered, versus
#       a count check whose class has produced four real defects in one branch.
# 🔴 TASK G-1 (.superpowers/sdd/gate-and-log-channel/task-1-brief.md) raises this 1295 -> 1300 (+5),
# COUNTED FROM THE RUNNER (`dotnet test --list-tests`: 1295 -> 1300), not by hand. TWO new files; nothing is
# rewritten, split or deleted. Per file:
#   FleetHostSeedNotificationOffGateTests            +2   NEW
#   FleetHostTeardownLogChannelTests                 +3   NEW
#
# WHY EACH TEST EXISTS, and why five is the number rather than "a suite":
#   - Two of the five are MEASUREMENTS of the same shape, against the two mechanisms G-1 took off
#     FleetCore._gate: a host callback is made deliberately slow, and a reader of `EstopEngaged` — the very
#     reader blueprint §9.2 timed at 12.35 ms, and the same lock Estop() takes — is timed while it runs.
#     That is §8.1's fifth rule applied ("measure the effect on the thing the mechanism protects, on the
#     production path, with no observer the mechanism does not itself need"), not a shape check on where a
#     call sits in a file. Both are MUTATION-PROVEN: putting the callback back inside `lock (_gate)` gives
#     2012.0 ms and 2011.7 ms against a 500 ms budget. Neither hangs under its mutant — the blocks are
#     bounded on purpose, so a mutant FAILS rather than looking like this script's trap 6.
#   - One pins the three invariants that moving a call out of a lock could have broken: exactly one
#     notification per seeded machine, in roster order, never before the machine is in the roster. It tests
#     what CHANGED, not what was kept.
#   - Two pin the third log channel end to end through the real FleetHost: the two teardown sites that are
#     deterministically reachable now arrive as Debug and NOT as Error. The negative is the half that
#     matters — "no Error on a best-effort teardown path" is the operator-facing claim, because under
#     AddWindowsService an Error there is a synchronous Windows Event Log write.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately
# UNCHANGED, and that is the check rather than a coincidence: G-1 touches exactly two product files
# (src/St4i.EdgeCore/Fleet/FleetCore.cs, src/St4i.EngineApi/Fleet/FleetHost.cs) and adds two test files in
# one suite. A total moving anywhere else would mean this task reached somewhere it had no business
# reaching. EXPECT_CONFORMANCE in particular stays 22: G-1 adds no driver and no connector kind.
# EXPECT_WARNINGS stays 116 — the new code adds no warning, and the third log channel adds a parameter to an
# internal ctor rather than an unused symbol.
#
# 🔴 G-1 REVIEW FIX ROUND raises this 1300 -> 1303 (+3), counted from the runner, ALL THREE in the existing
# FleetHostSeedNotificationOffGateTests. No file added, none rewritten, none deleted. The review's finding was
# that the invariant MOST at risk from the fix was the one LEAST tested — the two original tests are both
# single-threaded and both deliberately leave the fleet stopped, so the two properties that only
# record-then-drain could break had no witness at all, and neither gap was listed in the report's own "what is
# NOT proven" section, which is what made it a finding rather than a known gap.
#   ConcurrentRegistrations_NeverRunTwoSeedCallbacksAtOnce_AndDeliverInRosterOrder   +1
#       The seed-notify lock's actual job. Asserts MaxConcurrentCallbacks == 1 plus exactly-once and roster
#       order, with 8 threads released from a common start line and a dwell inside the callback.
#       🔴 This entry used to add "— order is a probabilistic witness, overlap is the property". The test's
#       own doc was corrected by MEASUREMENT after that (overlap is what kills the lock-removed mutant, 6 of
#       6; order is what catches an interleave at the DEQUEUE point, which produces zero overlap and is
#       invisible to the high-water mark — "do not trim either one"), and this line was not swept with it.
#       Corrected by G-2 under §8.1(c): the gate script is an operator-facing artifact describing the same
#       mechanism, and "probabilistic witness" is exactly the wording review N-1 flagged as inviting a
#       maintainer to delete the assertion that covers the schedule the other one cannot see.
#   RegisteringIntoARunningFleet_StillNotifiesExactlyOnce_AfterTheRestart            +1
#       The path that changed most: the drain moved past StopLocked + WaitAndDisposeOldPipeline +
#       StartLocked. Previously asserted nowhere.
#   WhenTheRestartThrows_TheSeedNotificationIsStillDelivered_NotStrandedInTheQueue   +1
#       The witness for review I-3, a REGRESSION G-1 introduced: the roster write commits under _gate and is
#       never rolled back, so a throw between it and the drain left a registered machine owing a notification
#       forever. Fixed with a try/finally; this test is what makes the finally falsifiable.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE stay put, same check as
# above: the review round touches FleetCore.cs, FleetHost.cs, one test file, this script, one blueprint
# section and mutate-guard.sh's header. EXPECT_WARNINGS stays 116.
#
# 🔴 TASK G-2 (.superpowers/sdd/gate-and-log-channel/task-2-brief.md) raises this 1303 -> 1310 (+7), COUNTED
# FROM THE RUNNER (`dotnet test --list-tests`: 1303 -> 1310), not by hand. ONE new file; nothing is
# rewritten, split or deleted. Per file:
#   FleetHostGateCommitCompletionTests               +7   NEW
#
# G-2 closes the defect CLASS G-1 found one instance of: state committed while FleetCore._gate is held whose
# correctness depends on a step that runs after the lock is released. Seven tests, and the number is what it
# is because the class has one member per (commit, completion) pair and each member has its own throw site:
#   Estop_WhenTheUnsSeamThrowsUnderTheGate_TheOldPipelineIsStillDisposed                        +1
#   Estop_WhenTheHostLoggerThrowsFlushingTheHaltPathLines_TheOldPipelineIsStillDisposed         +1
#       S2 — the halt path, the most serious member. The two tests are two different throw sites in the same
#       window, not one property twice: the first is the IUnsPublisher seam called with _gate held (the
#       enumeration's own item 8); the second is the deferred-log flush that G-1 placed AS THE FIRST
#       STATEMENT of WaitAndDisposeOldPipeline, ahead of every disposal — a regression G-1 introduced into
#       the routine whose job is to release the pipeline. Each asserts the driver was disposed EXACTLY once,
#       so a fix that traded a lost teardown for a doubled one fails.
#   Start_WhenTheUnsSeamThrowsUnderTheGate_TheOrphanedConnectorDriverIsStillDisposed            +1
#   Start_WhenTheHostLoggerThrowsFlushingDeferredLines_TheOrphanIsDisposedAndTheRunEventRecorded +1
#       S3 (same two throw sites, on the start path — the leak here is the orphaned connector driver
#       "review fix round 2" exists to prevent) and S7 (the historian Start run event, a SECOND completion
#       owed by the same commit, which sits after the first). The second test is the one that caught a
#       defect in G-2's own first draft: a throw inside a `finally` abandons the rest of that same `finally`,
#       so the run event was still exposed until the two statements were nested.
#   ARestartWhoseTeardownThrows_StillRebuildsThePipeline_RatherThanLeavingTheFleetStopped       +1
#       S4's first half — the restart chokepoint's rebuild now survives a throwing off-lock teardown. S4's
#       SECOND half (StartLocked itself throwing) is reported OPEN and is asserted as such in the next test.
#   Burst_WhenApplyingTheBurstThrows_TheRevertIsStillScheduled                                  +1
#   Burst_WhenTheScheduledRevertItselfThrows_ItIsReported_NotDroppedOnAnUnobservedTask          +1
#       S5, and the one genuinely SILENT instance of S4. Review M-5 named only the Cancel half of Burst's
#       window; the larger half is ApplyScenario, reachable through the enumeration's item 5. The second
#       test covers the revert task's own failure, which ran on an unobserved Task and was dropped by the
#       finalizer with nothing logged anywhere.
#
# NOT COVERED, said out loud rather than implied: S6 (UpdateSettings) is deliberately left OPEN — the
# uniform try/finally remedy would convert "the edit evaporates at the next restart" into "the service does
# not start", because Program.cs feeds the persisted triple back into that same method during startup. There
# is therefore no test for it, and that is a refusal rather than a gap. See FleetCore.UpdateSettings' own
# comment and the G-2 report.
#
# 🔴 RUNTIME, disclosed HERE and not only in the task report (G-2 review, Minor 10): this file adds ~8 s of
# WALL CLOCK to every gate run, and it is not incidental. Two Burst tests wait on the real BurstDuration
# (4 s, FleetCore.cs) because the property under test IS "a revert was scheduled", and three more poll for a
# fire-and-forget historian write. If this ever needs to come down, the fix is making BurstDuration
# injectable — a production change nobody has asked for — NOT loosening a bound (§8's rule). Recorded so the
# next person asking "why did the gate get slower" finds the answer where they are already looking.
#
# 🔴 G-2 FIX ROUND 1 raises this 1310 -> 1314 (+4), counted from the runner, ALL FOUR in the existing
# FleetHostGateCommitCompletionTests. No file added, none rewritten, none deleted.
#   Estop_WhenTheUnsSeamThrowsUnderTheGate_TheHaltRunEventIsStillRecorded              +1
#   Stop_WhenTheUnsSeamThrowsUnderTheGate_TheStopRunEventIsStillRecorded               +1
#       Review C-1. Round 1 closed S2's teardown and left S2's OTHER completion — the halt run event —
#       exposed to the same throw site the member's own test injects. SqliteHistorianStore's OEE query opens
#       an interval on "Start" and closes it on "Stop"/"Estop", so a dropped halt event INFLATES availability.
#       Two tests, not one: Estop needed a new latched flag (an unconditional finally would record a halt
#       StopLocked never completed), Stop already had one.
#   Estop_WhenTheHostDebugLoggerThrowsOnOneSlot_EverySubsequentSlotIsStillDisposed     +1
#       Review I-3. DisposeOldSlots called the host _logDebug from INSIDE each per-slot catch — interleaved
#       with the disposals, not in front of them — so a throwing host logger stranded every later slot's
#       driver and CTS on the halt path. Two slots; the second one's disposal is the assertion. The same
#       shape was found by grep in DisposeOrphanedConnectorDrivers and fixed there too — and witnessed, not
#       argued from similarity:
#   Start_WhenTheHostDebugLoggerThrowsOnOneOrphan_EveryOtherOrphanIsStillDisposed     +1
#       The sibling. Two rejecting-but-leaking connector factories, both orphans faulting on dispose, both
#       disposal counts asserted — so the test does not depend on ConnectorRegistry.RegisteredIds
#       enumeration order. Added because "identical mechanism, no separate test" is exactly the reasoning
#       this project has been burned by; a fix nothing can turn red is a fix nobody has measured.
#
# EXPECT_ABSTRACTIONS, EXPECT_CONFORMANCE, EXPECT_EDGECORE and EXPECT_EDGESERVICE are deliberately UNCHANGED,
# and that is the check rather than a coincidence: G-2 touches exactly ONE product file
# (src/St4i.EdgeCore/Fleet/FleetCore.cs) and adds one test file in one suite. A total moving anywhere else
# would mean this task reached somewhere it had no business reaching. EXPECT_CONFORMANCE in particular stays
# 22: G-2 adds no driver and no connector kind. EXPECT_WARNINGS stays 116 — the new code adds no warning and
# the one signature change (DisposeOrphanedConnectorDrivers' parameter becoming nullable) is matched by a
# null guard at its head, so no CS86xx appears.
EXPECT_ENGINEAPI=1314

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
# 🔴 TRAP 1, RESTATED AFTER SOMEONE RAN INTO IT FROM THE OTHER SIDE (E-3, Đợt E). The kill below is why
# THIS SCRIPT IS NOT RE-ENTRANT: launch a second run while a first is still going and the second's cleanup
# kills the first's live test host mid-suite. E-3 did exactly that and got
# `St4i.Connector.Conformance.Tests: ABORTED (host crash)` — trap 1, self-inflicted, on a healthy tree.
#
# The half worth writing down is not the FAIL. It is what the implementer said about the other run:
# **a PASS from a raced run is exactly as worthless as the FAIL.** Both runs were racing, so neither
# number describes the tree. The instinct on seeing the red is to re-read the passing one and move on —
# and that instinct is what turns a self-inflicted abort into a recorded fact about the code.
#
# One gate at a time. If two are running, discard both and start one.
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

# 🔴 TRAP 9 — this line PRINTED the number for eight tasks and never checked it, and the branch's
# own history is the argument. The count sat at 115 across D-1..D-7; THREE separate rounds drifted
# it by exactly one (xUnit1031, then xUnit1030 from a ConfigureAwait(false) written out of src/
# habit, then two CS8767 from a test double), and every one of those was caught by a HUMAN reading
# this line -- never by the gate. One warning is precisely the size of signal that gets waved
# through, which is why it needs a check rather than better attention.
#
# This is the same shape as trap 2, one field over: a printed number that looks like evidence.
# The whole batch's rule is "assert a POSITIVE expected quantity, never the absence of failure",
# and a warning count is a quantity like any other. Move it deliberately, in the same breath as a
# test total, and say why in the block below -- a warning that arrives with a task is a fact to be
# justified, not a number to be pasted over.
#
# Deliberately NOT a ratchet ("<= EXPECTED"): a DROP is also a fact worth a sentence, and a
# one-sided bound would let a real fix that removes a warning silently rot the number until the
# next addition hides inside the slack.
# 🔴 THIS NUMBER IS PINNED TO AN SDK THAT IS NOT PINNED. There is no global.json in this repo;
# 115 was measured on 10.0.302. A colleague on a different SDK gets a red gate on a CLEAN tree from
# a shifted analyzer set. The direction is safe — it fails closed, never falsely green, and the
# message says what to do — but it is §8.1's `skipped != 0` reasoning inverted: there, an
# environment-dependent count was refused so one number would mean the same thing everywhere; here,
# an environment-dependent number is asserted. If this bites someone, the fix is a global.json, not
# a looser check. Recorded rather than left for them to discover.
# 🔴 CARRIED FINDINGS (fix/carried-findings, task 1) raises this 115 -> 116 (+1), and the +1 is ONE xUnit1013
# in St4i.EdgeCore.Tests, on the two `base`-calling Check_Write_Cancellation_… overrides this task adds:
#   "Public method '…' on test class 'DeviceDriverConformanceSuite' should be marked as a Fact.
#    Reduce the visibility of the method, or add a Fact attribute to the method."
# BOTH remedies it offers are impossible, and its premise is false. The method overrides a `public virtual`, so
# visibility cannot be reduced; marking it [Fact] would run the check TWICE, because the [Fact] wrapper right
# above it already calls it. Its premise — that a public non-[Fact] method on a test class never runs — is
# exactly wrong here.
#
# D-6's identical RTU override does NOT emit it, and the difference is the whole reason this drifted: that one
# sits on an ABSTRACT base (ModbusRtuConformanceTestsBase), which the analyzer skips. These two rigs are SEALED
# concrete classes. Reproducing the abstract-base structure on two more rigs, purely to dodge an analyzer,
# would split each rig across two types and is a worse trade than one documented warning.
#
# 🔴 A THIRD impossible remedy, and it is the one a future author will actually reach for (found by review,
# not by me): put the [Fact] on the OVERRIDE and delete the wrapper. That is blocked by the census's own
# convention — EveryCheckIsWiredOrAcknowledged requires a [Fact] on the CONCRETE SUBCLASS named identically
# MINUS the "Check_" prefix (src/St4i.Connector.Conformance/DeviceDriverConformanceSuite.cs:36-43). A [Fact]
# named Check_Write_Cancellation_... does not satisfy it, so that rig would fail the census instead.
#
# 🔴 IT IS NOT SUPPRESSED, and that was tried first and REPORTED here rather than quietly dropped: the
# diagnostic is emitted as `CSC :` with NO source location (it names the symbol's original definition, which
# lives in a referenced assembly), so a #pragma in either rig cannot reach it — measured, the count stayed at
# 116 with both pragmas in place. The mechanisms that WOULD reach it are assembly-wide (<NoWarn> or a
# GlobalSuppressions entry), and blinding St4i.EdgeCore.Tests to every future xUnit1013 to hide one known-good
# instance is a strictly larger loss than +1. A number that is justified still fails on the NEXT drift; a
# suppressed analyzer does not.
#
# 🔴 HOW THIS NUMBER GROWS, MEASURED by the review — and it is better than either of us assumed, which is
# exactly why it is written down instead of left for the next reader to guess (they would guess "+1 per rig"
# and be wrong):
#
#     tree                                                     warnings   distinct xUnit1013
#     two rigs override the SAME check (this commit)              102              1
#     + a third rig overrides a DIFFERENT check                   103              2
#     + a second rig overrides that same different check          103              2
#
# It grows per DISTINCT Check_* METHOD that any sealed rig overrides, NOT per rig — because the diagnostic
# carries no source location and names the BASE symbol, so every override of one method collapses into one
# warning. **A new driver rig applying this proven remedy costs 0.** The bad half stands: +1 the first time
# anyone applies it to a NEW check.
EXPECT_WARNINGS=116
if [[ "${WARNINGS:-}" != "$EXPECT_WARNINGS" ]]; then
  echo "FAIL: build warnings are ${WARNINGS:-unknown}, expected ${EXPECT_WARNINGS}."
  echo "  A warning count is an expected quantity, not a readout. If this move is intended,"
  echo "  update EXPECT_WARNINGS and justify it beside the suite totals below."
  echo "  Warning CODES in this build, by occurrence count across all projects (NOT the 115 --"
  echo "  MSBuild counts a warning once per project that emits it; this is a pointer, not the total):"
  grep -oE 'warning [A-Za-z]+[0-9]+' "$BUILD_LOG" | sort | uniq -c | sort -rn | head -10
  echo "  full log: $BUILD_LOG"
  exit 1
fi

# ── Gate 2: each suite, sequentially, asserting an EXACT total. ──────────────────
# Trap 2. `Failed: 0` is not evidence: an aborted run prints it with a short total.
# Trap 8 (see the build above): the build's own server population must not still be resident
# while the suites run. Measured before this line existed: 14 processes, 1955 MB, alive through
# all five suites. Report what the suites are actually running underneath, so the next person
# reading a machine-wide failure has the number instead of a hypothesis.
dotnet build-server shutdown >/dev/null 2>&1 || true
# 🔴 TRAP 7 AGAIN, IN A NEW COSTUME — a checker that cries wolf, found by the first task that ran
# under it. This counted processes BY NAME (`Get-Process dotnet`), and VS Code's C# Dev Kit language
# server is also `dotnet.exe`. So the assertion below failed whenever the repository was merely OPEN
# IN AN EDITOR: a run reported "3 build-server processes" of which TWO were
# Microsoft.CodeAnalysis.LanguageServer, untouched by `dotnet build-server shutdown` and no business
# of this gate's.
#   (Reproducing that needs the language server hosted UNDER `dotnet.exe`. On csdevkit-3.20.199 /
#   csharp-2.140.9 it ships its own apphost `Microsoft.CodeAnalysis.LanguageServer.exe`, so today
#   the OLD matcher would also return 0 for Dev Kit -- the review measured that. The .dll ships too
#   and `vscode-dotnet-runtime` is installed, which is how it lands under `dotnet.exe`. Version
#   named so the next person re-testing does not conclude this comment is false and reach for the
#   ceiling instead. What is NOT version-dependent is Dev Kit's build host, measured live:
#   `Microsoft.CodeAnalysis.Workspaces.MSBuild.BuildHost.dll` passes the name filter and fails the
#   regex, because it never contains the literal `MSBuild.dll`.)
# That is trap 7's exact inversion — a healthy positive read as a failure — and it
# costs the same, because a verification tool that fires on innocent states gets its output ignored,
# which is precisely how the number this assertion protects went unwatched for eight tasks.
#
# So match on what the process IS, not what it is called: an MSBuild worker node, the Roslyn
# compiler server, or the Razor server. Those three are exactly what `dotnet build-server shutdown`
# targets -- it names all three in its own output -- which is the only population this check is
# entitled to have an opinion about.
#
# 🔴 AND THE FIRST REWRITE INTRODUCED TWO FALSE NEGATIVES, i.e. it could newly read HEALTHY while
# the defect was present -- the one direction this whole rewrite exists to avoid. Both found by the
# review pressing "does the new matcher miss anything", which is the question the fix did not ask
# itself:
#   (a) `rzc.dll`, the Razor server, was dropped. Measured: a live one scores False on the old
#       regex, and `dotnet build-server shutdown` reports "Shutting down Razor build server
#       (process N)... shut down successfully" and kills it. Unreachable in this repo today (no
#       .razor/.cshtml anywhere), reachable the day someone adds one -- a check that silently stops
#       covering a case when the repo grows into it is worse than one that never covered it.
#   (b) A NULL CommandLine matched nothing, so it FAILED OPEN. Measured non-elevated: 182 of 419
#       processes report a null command line, because a process owned by another account or an
#       elevated shell does not surrender it. `Get-Process` still sees them. So an MSBuild node
#       started elevated was counted by the old name-based matcher and skipped silently by the new
#       one. Null now counts as a hit: this check may cry wolf on an unreadable process, and must
#       never wave one through.
BUILD_NODES=$(powershell -NoProfile -NonInteractive -Command \
  "(Get-CimInstance Win32_Process -Filter \"Name='dotnet.exe' OR Name='VBCSCompiler.exe'\" | Where-Object { \$null -eq \$_.CommandLine -or \$_.CommandLine -match 'MSBuild\.dll|VBCSCompiler|rzc\.dll' } | Measure-Object).Count" \
  2>/dev/null | tr -d '\r' | head -1)
note "build servers still resident entering the test phase: ${BUILD_NODES:-unknown}"

# 🔴 TRAP 9 AGAIN, ELEVEN LINES BELOW ITS OWN FIX. The whole-branch review found this while
# reviewing the EXPECT_WARNINGS commit directly above: that commit argues "a printed number is not
# a check" and then left an identical printed number here — trap 8's OWN instrument, reporting the
# population this script creates, asserting nothing about it. The header records it measured at 14
# processes and 1955 MB alive through all five suites. The sweep that added the warnings check
# stopped at the number it was looking at.
#
# So the rule this script keeps re-learning, now stated where both instances sit: EVERY number
# this script computes is either asserted or deleted. A `note` is for something a human reads
# alongside a verdict, never for something the verdict depends on.
EXPECT_BUILD_NODES=0
if [[ "${BUILD_NODES:-}" != "$EXPECT_BUILD_NODES" ]]; then
  echo "FAIL: ${BUILD_NODES:-unknown} build-server process(es) are resident entering the test phase,"
  echo "  expected ${EXPECT_BUILD_NODES}. The suites would run under a population this script created"
  echo "  (measured once at 14 processes / 1955 MB), which is machine-wide memory pressure in the same"
  echo "  window as the memory-sensitive part of this run. Trap 8 in the build gate above is the story."
  exit 1
fi
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
