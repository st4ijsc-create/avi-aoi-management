# 24 — Advanced Capabilities Deep Audit + Reference-Standard Design & Execution Plan (2026-07)

> **Status: APPROVED (full 4-wave; HW-ready/sim; react-flow; Rapier + own-training + DTDL/USD). WAVE 1 EXECUTED & GREEN (2026-07-02) — see §9.** Deep audit + best-in-class reference design + detailed execution plan for the four "advanced/high-end" pillars:
> **(1) AOI/AVI inspection · (2) machine connectivity & control · (3) drag-and-drop block programming · (4) digital twin + realistic simulation.**
> Produced by 4 parallel specialist audit agents (read-only, honest code-vs-claim, per doc-22's maturity caution), each benchmarked against 2–4 best-in-class industrial ecosystems.
> No upgrade execution runs until the owner approves scope + sequencing. Working dir `d:\SOURCES\avi-aoi-management`.

---

## 0. Executive summary

The platform has **genuinely real, well-architected cores in all four pillars** — well above typical MES maturity — but the same three systemic truths repeat everywhere:

1. **Real but dormant.** The advanced machinery (PatchCore/DINOv2 vision, 5 real OT protocol drivers, a typed IR + kinematic/IK sim-gate, a DB-derived live twin with FK/IK + Timescale replay) is implemented and often unit-tested, yet **nearly every advanced feature is behind an OFF feature-flag and unproven on real hardware.** The #1 systemic gap is **commissioning/validation, not architecture.**
2. **Honest engineering.** Degradation is labeled, not faked (anomaly embedding tiers, metrology `degraded:true`, safety-vision "produces nothing", command `simulated` rows). This is a strong foundation to build on.
3. **Both doc-22 P0 safety races are now FIXED in code** — reservation TOCTOU (`fleet/resourceManager.ts:120` now `SELECT … FOR UPDATE` in a txn) and deploy-skips-sim-gate (`programmingService.ts:212-245` now hard-refuses hardware deploy without a passed sim run).

**The single most user-visible gap** (and your explicit ask): the "drag-and-drop block programming" surface **does not exist yet** — both `IrEditor` and `OrchestrationStudio` are click-to-add **nested-tree** editors, not node-graph/drag-drop canvases (dnd-kit is installed but only used for list reordering).

### Unified maturity scorecard (1–5; state = real / partial / framework / stub)

| Pillar | Headline state | Score | Highest-leverage P0 move |
|--------|----------------|:-----:|--------------------------|
| **1 · AOI/AVI inspection** | Real algorithms, statistical/threshold verdict, DL model BYO, flags off | **3.3** | Ship a bundled DL/anomaly model + flip & prove the dormant vision stack; sub-pixel golden-sample alignment |
| **2 · Connectivity & control** | Best-in-class *write-gate design*; 5 real drivers; all flag-off, unproven on HW | **3.5** | Telemetry **store-and-forward** + a **hardware commissioning/FAT gate** before live control |
| **3 · Block programming** | Real typed IR + safety linter + sim-gate; **no real drag-drop canvas**; pipeline flag-off | **2.8** | Real **node-graph drag-drop canvas** over the IR + flip `DPC_IR_V2_ENABLED`/`SIM_KINEMATIC_ENABLED` on |
| **4 · Digital twin + sim** | Real scene-graph + live binding + replay + FK/IK + hard sim-gate; quasi-static physics | **3.3** | **Articulate** the live twin (joint streams + FK render) + bind a **real physics engine** (Rapier) |

---

## 1. Cross-cutting synthesis — the integrated "highest-standard" vision

Best-in-class ecosystems (Omniverse, Ignition, Siemens, Cognex) all converge on **one canonical model feeding many loops**. This platform already embodies the principle partially (doc-16's "one model for sim AND viz"): the **scene-graph** feeds twin-viz; the **capability/PackML model** feeds control + orchestration; the **IR** feeds program + sim. The target is to **close the loops** end-to-end:

```
                    ┌──────────── Canonical Asset + Capability + Twin model (DTDL-style) ───────────┐
                    │                                                                                │
 Vision/AOI ──inspect──► Quality Gate ──typed control proposal──► HITL/Interlock ──► Dispatch(gate) ─► Machine
     ▲  (Pillar 1)                                    (Pillar 2 single write-gate) │                    │
     │                                                                             │                    │
 Program (node-graph IR, Pillar 3) ─► Sim-gate (kinematic+PHYSICS) ─► HIL ─► Deploy(gated) ─────────────┘
                    │                          ▲ (Pillar 4)                                            │
                    └──────── Digital Twin (scene-graph + live joint telemetry + replay + DES) ◄────────┘
```

The four pillars are not separate products — they are **stages of one control-and-quality loop over one model**. The roadmap below is sequenced to build that loop: foundation (prove what exists + make it safe on hardware) → headline UX (drag-drop authoring) → fidelity (physics, DL model, DES, articulated twin) → closed loops (vision→control, sim→schedule).

---

## 2. Pillar 1 — AOI/AVI Inspection

**Verdict:** an exceptionally honest, algorithmically real foundation that is currently a **statistical/threshold inspector with a rich, mostly-dormant AI toolkit.**

### Maturity (real/partial/stub × 1–5)
| Subarea | State | Lvl |
|---|---|:--:|
| Inspection ingest / canonical model | real | 4 |
| Vendor AOI adapters (generic-json, koh-young) | partial | 2 |
| DL defect classification (ONNX ensemble + A/B) | partial (BYO model) | 3 |
| Unsupervised anomaly (PatchCore) | real | 4 |
| Image embedding / similarity (DINOv2 + pgvector) | real | 4 |
| Segmentation + sub-pixel metrology (YOLOv8-seg) | real | 4 |
| Golden-sample reference alignment | partial (coarse, off) | 2 |
| Active learning / HITL | real | 4 |
| Closed-loop line action | stub (advisory) | 1 |
| VLM defect description (LLaVA/Qwen-VL sidecar) | partial | 3 |
| Native 3D / SPI / AXI processing | partial (pass-through) | 2 |
| Model lifecycle / MLOps | real | 3 |

### Key gaps (ranked)
- **[P0]** No first-party DL defect model / training round-trip that ships — inference is real but **modelless** (customer BYO `.onnx`; DINOv2 lives at an absolute path `D:/16.AI/model.onnx`, `register-dinov2.mjs:8`). *→ Cognex ViDi / Landing AI.*
- **[P0]** Golden-sample alignment is coarse rotate+translate NCC and **`ALIGN_BEFORE_DIFF=false`** (`imageAlignment.ts`) — pixel-diff without sub-pixel affine/homography registration false-calls. *→ MVTec HALCON / Koh Young.*
- **[P1]** No native 3D/SPI/AXI math (values only *transported*); no closed-loop line action; thin vendor coverage + no live GigE/GenICam acquisition. *→ Koh Young 3D SPI; Cognex/Keyence acquisition.*
- **[P2]** Anomaly bank is whole-image, not patch-level pixel-localization heatmaps; no metrology calibration UX / SEMI E30/E142 traceability.

### Target design
Live acquisition (GenICam grabber) + third-party adapters → **canonical inspection** → sub-pixel **reference registration** → parallel branches {threshold metrology · shipped trainable DL classifier/segmenter · **patch-level** PatchCore w/ heatmap · sub-pixel metrology} → ensemble/quality-gate with calibrated confidence + grey-zone→HITL. In-app labeling → dataset versioning → **owned training loop** → A/B canary → drift → auto-promote/rollback bound to recipe + SEMI E142. Quality NG emits a **typed control proposal** (reject-divert, SPI printer-offset) through the Pillar-2 HITL/interlock path (gated). Unify AOIPackages/InspectionDetail/MaskAnnotation/AnomalyBank/DefectHeatmap/QualityCockpit into one **Inspection Workbench**.

### Phased plan
- **A — Prove the built stack (S):** bundle a real DINOv2 ONNX (kill absolute path); flip+smoke `AOI_EMBEDDING_ENABLED`+`ANOMALY_DETECTION_ENABLED` end-to-end.
- **B — Sub-pixel reference alignment (M):** affine/homography + enable `ALIGN_BEFORE_DIFF` + golden-sample UI.
- **C — First-party DL round-trip (L):** in-app label→version→own training→auto-deploy; drift+rollback wired.
- **D — Patch-level localization + calibration UX (M).**
- **E — Live acquisition + more adapters (Cognex/Keyence/TRI) (L).**
- **F — Quality closed loop (M, gated `VISION_CONTROL_ENABLED`).**

*Refs:* Cognex ViDi (trainable DL + acquisition) · Koh Young (3D SPI + closed loop) · MVTec HALCON (shape-based registration) · Landing AI (label→train→deploy HITL) · AWS Lookout/Averroes (patch anomaly + heatmap) · Keyence + SEMI E30/E142 (calibration + traceability).
*Key files:* `server/services/{aiAnomalyDetection,aiImageEmbedding,aiSegmentation,aiMetrology,aiQualityGate,aiActiveLearning,imageAlignment,llamaVisionSidecar}.ts`, `vision/visionAdapterRegistry.ts`, `vision/adapters/kohYoung.ts`, `safety/vision/humanDetectionProducer.ts`, `drizzle/schema/{inspection,ai}.ts`.

---

## 3. Pillar 2 — Machine Connectivity & Control

**Verdict:** the **write/command-path design is best-in-class** (single gate, HITL, allowlist, read-back, append-only audit, interlock defense-in-depth); the gaps are **operational maturity, not architecture.**

### Maturity
| Dimension | State | Lvl |
|---|---|:--:|
| Protocol adapters (OPC-UA/Modbus/S7/MC/EtherNet-IP read+write; MTConnect/Euromap/FOCAS read; Sparkplug publish) | real | 4 |
| Command safety (single `dispatch()` gate) | real, flag-off | 4 |
| Edge (coordination + offline run-buffer; not hard-RT, no telemetry S&F) | partial | 3 |
| Robot/fleet (Techman framework; Fanuc/Mitsubishi/Delta NotImplemented; VDA5050 enum-blocked) | partial | 3 |
| Recipes / capability / PackML / interlocks | real | 4 |
| UNS (ISA-95 + Sparkplug-B birth/data/death + NCMD/DCMD→dispatch) | real, flag-off | 4 |
| SECS/GEM (HSMS + SECS-II codec + S1; not equipment-control-grade) | framework | 2 |

### Key gaps (ranked)
- **[P0]** **No telemetry store-and-forward** — `ot/ingest.ts` inserts direct to DB; a central/DB outage drops samples (edge run-results buffer, telemetry does not). *→ Ignition/Kepware/HighByte S&F + backfill.* **The biggest production gap.**
- **[P0]** Real control **entirely flag-off, never proven on hardware** (`OT_CONTROL_ENABLED`, `OT_GATEWAY_ENABLED`, `ROBOT_CONTROL_ENABLED`, `EDGE_RUNTIME_ENABLED`, … all off). Excellent code, zero commissioning evidence. *→ Rockwell/Siemens device-verified FAT.*
- **[P1]** Thin robot-vendor coverage (only Techman wired); no driver redundancy / HA failover (single active endpoint per adapter); SECS/GEM connect-only (no S2/S7 recipe/remote-command).
- **[P2]** No OPC-UA companion-spec (Machinery/Robotics/Euromap-83) info-modeling; no no-code tag→UNS mapping designer.

### Target design
Keep `OtDriver`/registry; add a **connection-supervisor** (reconnect backoff, dual-endpoint failover, health SLO) + certified-driver conformance harness. Add **disk-backed store-and-forward** to `telemetryBus`/`ingest.ts` (WAL + idempotent backfill). Keep SIL safety on the certified L1 PLC. Retain the single `dispatch()` gate; add a **per-adapter hardware commissioning gate** (no `OT_CONTROL_ENABLED` until a signed FAT/soak record exists — mirror the proven sim-gate pattern). Promote **Sparkplug-B UNS to the primary bus**; model OPC-UA companion specs into the capability contract; publish PackML command *state* to UNS for a true digital thread.

### Phased plan
- **C1 — Store-and-forward (M):** disk buffer + idempotent backfill in `telemetryBus`/`ingest.ts`.
- **C2 — Hardware commissioning gate + FAT (L):** per-adapter `commissioned` gate; soak harness; enable live control on one OPC-UA + one Modbus device with read-back verified.
- **C3 — Connection HA/failover (M).**
- **C4 — Robot breadth (Fanuc RMI + VDA5050 enum) (L).**
- **C5 — OPC-UA companion specs + UNS-first (M).**
- **C6 — GEM300 S2/S7 (fab, optional, L).**

*Refs:* Ignition (S&F, redundancy, Sparkplug UNS) · Kepware (driver breadth + conformance) · Siemens Industrial Edge (edge + companion specs) · Rockwell FactoryTalk (commissioning/FAT gate) · HighByte (no-code UNS modeling) · SEMI GEM300 (fab control).
*Key files:* `server/services/ot/{otDriver,driverRegistry,otManager,commandDispatcher,ingest}.ts`, `ot/drivers/*`, `edge/{edgeRuntime,edgeCoordinator}.ts`, `equipment/{packml,capabilityModel}.ts`, `interlock/interlockEngine.ts`, `uns/*`, `unsBridge.ts`, `secsgem/{hsmsClient,secs2Codec}.ts`, `fleet/resourceManager.ts`, `robot/drivers/*`.

---

## 4. Pillar 3 — Drag-and-Drop Block Programming

**Verdict:** a real typed IR + safety linter + kinematic/IK sim-gate + hardened deploy gate — but the **authoring surface is a nested tree, not the drag-drop node-graph canvas the name implies**, and the whole IR pipeline is **flag-off**.

### Maturity
| Dimension | State | Lvl |
|---|---|:--:|
| Authoring canvas UX (click-to-add tree + inspector; **no node-graph**) | partial | 2 |
| Typed IR model (Zod discriminated-union AST) | real | 4 |
| Transpilers (URScript real+golden; ROS2 skeleton; IEC-61131 ST + 1-line LD) | partial | 3 |
| Lint / safety validation (blocking pre-codegen gate) | real | 4 |
| Simulate (FK+IK+collision+limits+zones+cycle-time; FOE twin) | real, flag-off | 4 |
| Deploy + gate + rollback (sim-pass now a hard precondition) | real | 4 |
| Version diff / merge / collab | partial (append-only, no visual diff) | 2 |
| HIL (URSim seam; IR deploy always `simulated`) | stub | 1 |

Two complementary IRs (a genuine strength): **device-program IR** (`ir/irModel.ts` — motion/IO AST) and **FOE workflow IR** (`foe/workflowModel.ts` — ISA-88-ish sequence/parallel/branch/hitl_gate with saga compensation + fail-closed condition eval).

### Key gaps (ranked)
- **[P0]** **No real drag-and-drop / node-graph canvas** — `IrEditor.tsx`/`OrchestrationStudio.tsx` are click-to-add nested trees with ▲▼ reorder; OrchestrationStudio even notes "Future upgrade: graph-style editing (react-flow)". **The headline gap for your ask.** *→ Node-RED / n8n / Blockly.*
- **[P0]** Entire IR pipeline **flag-off** in production (`DPC_IR_V2_ENABLED`, `SIM_KINEMATIC_ENABLED` unset) — save/build/kinematic-sim never run for users. *→ TIA/CODESYS always-on.*
- **[P1]** Thin IEC 61131-3 / PLCopen (ST + 1-line LD only; no LAD/FBD/SFC graphical, no PLCopen XML, no reusable FB/POU library); no visual version diff/merge/collab; small robot-centric block vocabulary (8 blocks, no variables/subroutines/PID/timers).
- **[P2]** ROS2 target unbound skeleton; no HIL; per-robot safety envelope not wired (global ceilings).

### Target design
**Node-graph canvas** (react-flow/`@xyflow` or dnd-kit snap-blocks) over the **existing IR as source of truth** (tree + graph = two views of one AST): free placement, wiring, minimap, pan/zoom, undo/redo, live per-node lint markers. Keep the Zod IR; add variables/expressions, **user-defined function blocks/subroutines (reusable POUs)**, analog/PID/timer/counter blocks, **PLCopen XML** import/export. **Transpiler matrix** (target × language), each lint-gated + golden-tested. **Sim→HIL loop**: flip `SIM_KINEMATIC_ENABLED`, feed real URDF, add a URSim/Isaac HIL pre-stage, keep sim-pass as the hard deploy precondition. Block-level visual **diff + 3-way merge**, signed releases, rollback (already present), optional CRDT co-edit. Per-device `LimitProfile` from the capability model; E-stop/SIL stays on the certified controller.

### Phased plan
- **P1 — Flip & harden (S):** enable `DPC_IR_V2_ENABLED`+`SIM_KINEMATIC_ENABLED` in a cell; wire per-device `LimitProfile`.
- **P2 — Node-graph canvas (L):** react-flow/dnd-kit over the IR (reuse `findBlock/updateBlock/addChild`); tree↔graph round-trip identical JSON.
- **P3 — IR depth + FB library (M):** variables/expressions, function blocks, analog/PID/timer.
- **P4 — IEC 61131-3 + PLCopen (L):** graphical LAD/FBD/SFC + PLCopen XML + OpenPLC deploy.
- **P5 — Version diff/merge + collab (M).**
- **P6 — Bound ROS2 + HIL (L).**

*Refs:* Node-RED/n8n (flow canvas) · Blockly (typed snap-blocks) · TIA/CODESYS/TwinCAT (IEC-61131 + PLCopen + FBs + compare) · UR PolyScope (teach + safe motion library) · RobotStudio/RAPID (offline + co-edit) · ROS 2 + BehaviorTree.CPP/Groot (skill nodes) · Isaac Sim (HIL virtual commissioning).
*Key files:* `server/services/programming/ir/{irModel,irSafetyLinter,irAdapter}.ts`, `ir/transpilers/{irToUrscript,irToRos2,registry}.ts`, `sim/kinematicSimGate.ts`, `programmingService.ts`, `iec61131/iec61131Adapter.ts`, `orchestration/foe/{workflowModel,foeSimulator}.ts`; clients `{IrEditor,OrchestrationStudio,EngineeringWorkspace}.tsx`; `irRouter.ts`; flags `.env.example` `DPC_IR_V2_ENABLED`, `SIM_KINEMATIC_ENABLED`.

---

## 5. Pillar 4 — Digital Twin & Simulation

**Verdict:** a substantially real twin (not a scripted demo) — real scene-graph, socket-streamed live binding, Timescale replay, real FK/IK, and a sim-gate that is a **hard precondition for hardware deploy** — with honest fidelity seams.

### Maturity
| Capability | State | Lvl |
|---|---|:--:|
| Scene-graph (DB-derived factory→zone/line→station→device + PackML state) | real | 4 |
| 3D assets (hand-rolled glTF from URDF; primitive-heavy) | real | 3 |
| Live telemetry binding (socket.io tap→coalesced ≤10 Hz deltas) | real | 4 |
| Physics/dynamics (quasi-static holding-torque; external engine = throw stub) | partial/stub | 2 |
| Kinematics (DH+URDF FK; numerical DLS IK) | real | 4 |
| Replay/historian (Timescale `time_bucket` downsample + scrubber) | real | 4 |
| What-if (single predicted-cycle timeline; no DES) | partial | 2 |
| Sim-as-deploy-gate (hard precondition; URSim HIL) | real | 4 |
| SECS-II codec (round-trippable) / GEM-HSMS (skeleton) | partial | 3 |

### Key gaps (ranked)
- **[P0]** **No real physics engine** — `physics.ts` is quasi-static (ignores inertia/Coriolis/contact/friction); `ExternalPhysicsBackend` throws "not configured". Gate can't catch dynamic instability/payload slip/contact. *→ Isaac Sim/Gazebo PhysX/ODE.*
- **[P0]** **Two disconnected twins** — the telemetry-bound 3D `DigitalTwinCenter` and the predictive 2D cell players (`RfTestCellSim`, `CellTwinPlayer`) never share a runtime; the 3D view renders a device **block sliding in XY, not the FK'd articulated arm**. *→ Omniverse/Tecnomatix one-scene.*
- **[P1]** No standardized twin schema (**DTDL/USD**) → no interop/queryable twin graph; no **discrete-event throughput sim** (queues/resources/stochastic yield) as AnyLogic/Plant-Sim; rendering is functional primitives, not photoreal/metric-placed.
- **[P2]** Robot pose binding is coarse (`{x,y,state}` only — no joint vectors streamed, so the arm never articulates from live data); STEP/IGES CAD import unimplemented (`convertStepModel` "pending").

### Target design
Typed **DTDL-style twin-model** layer over the scene-graph (interfaces/properties/relationships/telemetry) + **USD/USDZ** export alongside glTF. Bind `ExternalPhysicsBackend` to **Rapier** (WASM in-proc) + an out-of-proc **Isaac Sim/Gazebo** adapter (the contract already exists — a binding, not a rewrite). **Articulate the live twin**: stream joint vectors, render the FK'd link chain from live + replay. Add a **discrete-event what-if** engine (reuse workflow routings). Extend the sim-gate with a **physics verdict** as a blocking condition; feed sim-predicted cycle time back into scheduling (closed loop). CAD→glTF via a real kernel (occt-import-js) + PBR + metric placement; optional Unreal/Unity pixel-streaming.

### Phased plan
- **T1 — Articulate live twin (M):** stream joint vectors + render FK link-chain.
- **T2 — Bind Rapier physics (M):** implement `PhysicsBackend` over Rapier under `SIM_PHYSICS_ENABLED`.
- **T3 — DTDL twin schema + USD export (L).**
- **T4 — CAD (STEP) import (M).**
- **T5 — Discrete-event what-if (L).**
- **T6 — Isaac Sim sim-to-real adapter (L).**

*Refs:* Omniverse/Isaac (USD + real physics + sim-to-real) · Siemens Tecnomatix/NX-MCD (one scene design+live) · Azure DT/DTDL (typed queryable twin) · AnyLogic/Plant-Sim (DES throughput) · Unity/Unreal (photoreal) · Gazebo/ROS (URDF articulated + swappable physics).
*Key files:* `server/services/twin/{sceneGraph,twinStream,twinReplay}.ts`, `programming/sim/{kinematicModel,ik,physics,collision,kinematicSimGate}.ts`, `programmingService.ts:212-245`, `robot/ursim/ursimHarness.ts`, `secsgem/secs2Codec.ts`, `modelRegistry.ts`, `urdfToGltf.ts`, `modelConversionService.ts`; clients `{DigitalTwinCenter,RfTestCellSim,CellTwinPlayer,FactoryLiveMap3D}.tsx`, `components/Factory3DScene.tsx`.

---

## 6. Unified execution roadmap (cross-pillar, dependency-ordered)

Sequenced into **4 waves**. Each phase gates on `npm run check` + `vite build` + its acceptance test; no behavior change without the owning feature flag; real-hardware phases require a signed commissioning record.

### Wave 1 — Foundation: prove & make safe (weeks) — *unlocks everything*
- **AOI-A** ship bundled model + flip/prove anomaly+embedding · **C1** telemetry store-and-forward · **C2** hardware commissioning/FAT gate (one OPC-UA + one Modbus) · **P1** flip IR pipeline + per-device LimitProfile · **T1** articulate live twin.
- *Why first:* converts "real but dormant/unproven" into "real and trusted"; C2's commissioning-gate pattern + T1's joint streaming are prerequisites for the closed loops.

### Wave 2 — Headline UX: drag-drop authoring + fidelity you can see
- **P2** node-graph drag-drop canvas over the IR (the flagship deliverable for your ask) · **AOI-B** sub-pixel golden-sample alignment · **T2** bind Rapier physics (gate catches dynamics) · **P3** IR depth (function blocks / PID / variables).

### Wave 3 — Depth & interop
- **AOI-C** first-party DL model round-trip · **C3** connection HA/failover · **C4** robot-vendor breadth · **P4** IEC-61131 graphical + PLCopen · **T3** DTDL twin schema + USD · **T4** CAD/STEP import.

### Wave 4 — Closed loops & scale
- **AOI-F** quality closed loop (vision→control, gated) · **T5** discrete-event what-if → scheduling feedback · **T6** Isaac sim-to-real · **C5** OPC-UA companion specs + UNS-first · **P5** version diff/merge + collab · **AOI-D/E**, **P6**, **C6** as needed.

**Dependency highlights:** AOI-F needs C2 (safe write path) + AOI-B/C. T2 strengthens P1/P6 sim-gate. P2 needs P1. C-wave robot control needs C2 commissioning gate. Everything hardware-facing needs C1+C2 first.

---

## 7. Decisions needed (before execution)

1. **Real-hardware scope now?** Do you have a target cell/device (PLC + robot + camera) to commission against in this cycle, or should Wave 1 stay **sim/emulator-only** (URSim + emulated OPC-UA) until hardware is available? This gates C2/C4 and AOI-E.
2. **Build vs integrate the heavy engines.** Physics: **Rapier (in-proc, ship now)** vs Isaac (GPU, heavier) vs both (T2 then T6). DL vision: **own the training loop** vs keep the Python-sidecar seam. Twin schema: **DTDL-style + USD** vs stay bespoke JSON.
3. **Drag-drop canvas tech.** **react-flow/@xyflow** (node-graph, fastest to great UX) vs **dnd-kit snap-blocks** (Blockly-like) vs Blockly itself. (Recommendation: react-flow over the existing IR.)
4. **Priority order.** Approve the 4-wave sequence as-is, or front-load a specific pillar (e.g. the drag-drop canvas P2 first because it's the most visible), or a specific vertical slice (e.g. "one cell, fully closed-loop: camera→gate→robot→twin").
5. **Scope of this engagement.** Full 4-wave program, or Wave-1 foundation first with a gate before Wave 2+?

---

## 8. Risks & guardrails
- **Safety-first:** live control stays behind per-adapter commissioning gates + the single `dispatch()` path + interlocks; E-stop/SIL never authored in-app (stays on certified L1). Vision→control actuation only under an explicit flag.
- **No silent capability claims:** keep the platform's honesty ethos — flags + `degraded`/`simulated` labels; a phase isn't "done" until proven on the target (sim or hardware) with an acceptance test.
- **Reversible:** feature-flagged, one commit per phase; the two doc-22 P0 races stay closed (regression tests).
- **Green gates:** `npm run check` + `vite build` per phase; conformance/soak harnesses for drivers; golden tests for transpilers; round-trip tests for IR/USD/SECS-II.

---

## 9. Execution log

### Wave 1 — DONE & GREEN (2026-07-02)
Final combined verify: **TSC 0 errors · `vite build` OK · 375 targeted tests pass**. All additive/flag-gated; no RBAC/route changes; both doc-22 P0 safety races stay closed. Not committed.

| Phase | Delivered | Flag | Verify |
|-------|-----------|------|--------|
| **P1+P2** | **react-flow (`@xyflow/react` 12.11.1) drag-drop node-graph canvas** over the typed IR — Graph\|Tree toggle, drag-to-add, live lint markers, minimap; **byte-identical tree↔graph round-trip** (`components/programming/{IrGraphCanvas,irTree}.tsx`); IR pipeline enabled for dev | `DPC_IR_V2_ENABLED`, `SIM_KINEMATIC_ENABLED` | check+build ✓ |
| **T1** | Articulated live twin — joint-vector streaming (delta/scene-graph/replay, additive) + client FK (`lib/kinematics.ts` + `components/twin/ArticulatedRobot.tsx`) renders FK'd link chain; block fallback | — | 65 tests ✓ |
| **T2** | Rapier physics (`@dimforge/rapier3d-compat` 0.19.3, `sim/rapierPhysics.ts`) — Newton-Euler inverse dynamics (inertial+Coriolis+gravity) + tip-over via COM; blocks sim-gate when on; quasi-static fallback | `SIM_PHYSICS_ENABLED` (off) | 92 tests ✓ |
| **C1** | Telemetry store-and-forward (`ot/storeForward.ts`) — disk JSONL WAL + idempotent backfill (`adapterId\|tag\|ts`), bounded, honest drop-metrics | `OT_STORE_FORWARD_ENABLED` (off) | 21+204 tests ✓ |
| **C2** | Per-adapter commissioning/FAT gate (`ot/commissioningService.ts`, `commissioningRouter.ts`, migration `0157`) — dispatch step 5a: not-commissioned ⇒ forced-`simulated`; strengthen-only | `OT_COMMISSIONING_REQUIRED` (ON) | 48 dispatch tests ✓ |
| **AOI-A** | Configurable `AI_DINOV2_MODEL_PATH` (killed absolute `D:/16.AI` path) + honest ONNX→text→heuristic degrade + `getDinov2ModelHealth()` | `AOI_EMBEDDING_ENABLED`, `ANOMALY_DETECTION_ENABLED` | 64 tests ✓ |

Also fixed a pre-existing missing dep (`@zxing/library@^0.22.0`) that would break a clean `npm ci`.

**To fully "prove" on hardware later:** run migration `0157`; drop a real DINOv2 ONNX at `AI_DINOV2_MODEL_PATH`; enable the relevant flags per cell; sign a commissioning record before any live write; feed a robot's joint vector onto the telemetry bus to light the twin's live-articulation path end-to-end.

### Wave 2 — DONE & GREEN + committed (2026-07-02)
Commit `549242b`. TSC 0 · build OK · tests pass (IR 49, registration 10, golden 3).
- **AOI-B** — sub-pixel reference alignment: Lucas-Kanade/ECC affine(/homography) over a Gaussian pyramid + confidence gate (low-confidence ⇒ `aligned=false`, no fake pass); golden-sample store (migration `0158`, `goldenSampleService.ts`, `imageRegistration.ts`); wired under `ALIGN_BEFORE_DIFF`.
- **P3** — IR depth: safe typed-expression model (no eval, `irExpr.ts`) + new blocks `set_variable`/`counter`/`wait_until`/`set_analog`/`pid_control` through schema→lint→URScript+ROS2 transpile→tree+react-flow editor. (Reusable function-blocks/POUs deferred to a later slice.)
- **Note:** P2 (drag-drop canvas) + T2 (Rapier physics) were front-loaded into Wave 1.

### Wave 3 — DONE & GREEN + committed (2026-07-02)
Batch A `481d5be`, Batch B `3bd4bb0`. TSC 0 · build OK · tests pass.
- **AOI-C** — first-party defect classifier: pure-TS softmax head on existing DINOv2 embeddings (no Python/GPU), label→train→register→serve→A/B→rollback reusing registry/active-learning/quality-gate; migration `0159`; flag `AOI_DL_HEAD_ENABLED`.
- **C3** — OT connection HA: reconnect supervisor (backoff+jitter, health SLO) + dual-endpoint hot-standby failover; single-dispatch write-gates untouched; flag `OT_CONN_HA_ENABLED`.
- **P4** — IEC 61131-3: structured LAD/FBD/SFC POU model + PLCopen TC6 XML round-trip (`fast-xml-parser`) + POU→ST transpile + blocking linter + `/pou-studio`; migration `0160`.
- **C4** — robot breadth: real Fanuc RMI driver (gated, mock-tested) + VDA5050 unblocked (migration `0161`); Mitsubishi/Delta honest scaffolds.
- **T3** — DTDL-v3-style twin schema (typed interfaces + capability telemetry + relationships, queryable) + USDA export; read-gated.
- **T4** — real STEP/IGES→glTF via `occt-import-js` (OpenCASCADE WASM), registered into modelRegistry, WASM-guarded.

### Wave 4 — DONE & GREEN + committed (2026-07-02) — **doc-24 program complete**
Commit `2ec76f1`. TSC 0 · build OK · Wave-4 tests pass (89).
- **AOI-F** — vision→control closed loop: gated NG/anomaly emits typed proposals (`reject_divert`, `spi_printer_offset`) **only** via propose→HITL→`commandDispatcher`; advisory-default (`VISION_CONTROL_ENABLED`), composes with C2 (uncommissioned ⇒ simulated, `writeTags` 0×); reuses `ai_pending_actions` (no migration); no gate bypassed.
- **T5** — discrete-event throughput sim (seeded PRNG, event heap, queues/resources/stochastic yield) → bottleneck + cycle-time advisory to scheduling; read-gated `simulation` router.
- **C5** — OPC-UA companion specs (Machinery/Robotics/Euromap-83) into the capability contract + PackML state → UNS-first Sparkplug channel (flag `UNS_PACKML_STATE_ENABLED`).
- **P5** — block-level program version diff + 3-way merge (never drops a block) + read-gated tRPC + `IrDiffPanel`.
- **T6 (Isaac sim-to-real) DEFERRED** per owner's "keep heavy external integrations light".
- *Incident:* a sandbox overlay-FS discarded P5's files mid-run; recovered (tracked edits from a stash, new files re-written), reconciled, all green.

### Commits (branch `automation-orchestration-r0`)
`89cdf1b` doc-23 frontend · `d617560` W1 · `549242b` W2 · `481d5be` W3-A · `3bd4bb0` W3-B · `57b922f` docs · `2ec76f1` W4.

### ✅ Doc-24 program COMPLETE (Waves 1–4; T6 Isaac deferred). All additive/flag-gated; TSC 0 / build OK throughout; both doc-22 P0 safety races stay closed. Live control/actuation remains sim/dry-run behind the commissioning gate until hardware FAT + flags. Migrations `0157`–`0161` authored (run when ready).
