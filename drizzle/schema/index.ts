// Schema barrel - re-exports all domain schemas for backward compatibility
// All imports from "../drizzle/schema" or "../../drizzle/schema" continue to work

export * from "./enums";
export * from "./auth";
export * from "./hierarchy";
export * from "./product";
export * from "./inspection";
export * from "./layout";
export * from "./production";
export * from "./scheduling";
export * from "./machine";
export * from "./alerts";
export * from "./mqtt";
export * from "./dashboard";
export * from "./system";
export * from "./ai";
export * from "./oee";
export * from "./integration";
export * from "./spc";
export * from "./license";
export * from "./mes";
export * from "./g3";
export * from "./ot";
export * from "./process";
export * from "./andon";
export * from "./interlock";
export * from "./robot";
export * from "./aiInsight";
export * from "./kb";
export * from "./masterdata";
export * from "./orchestration";
export * from "./edge";
export * from "./programming";
export * from "./federation";
export * from "./integrationOutbox";
export * from "./erpOauth";
export * from "./fleet";
export * from "./fleetResource";
export * from "./twin";
export * from "./safetyWorkforce";
export * from "./safetyZones";
export * from "./safetyVision";
export * from "./equipmentStandards";
export * from "./equipmentIntegration";
export * from "./fieldHealth";
export * from "./aiLoop";
export * from "./goldenSample";
export * from "./aiEmbeddingHead";
export * from "./controlAudit";
export * from "./factoryZones";
export * from "./hotFolder";
export * from "./aoiCommissioning";
export * from "./defectDisposition";
export * from "./measurementCorrections";
export * from "./productPanel";
export * from "./operatorBadge";
export * from "./componentLibrary";
export * from "./productOnboarding";
export * from "./reportArtifact";
export * from "./lineMaterials"; // doc 35 W4-C — feeder-verify + MSD floor-life + stencil cycle counter
export * from "./maintenanceParts"; // doc 35 W4-A — work-order spare-parts consumption ledger
export * from "./ncr"; // doc 35 W4-B — nonconformance reports + golden-revalidation flags
export * from "./ecn"; // doc 35 W4-D — engineering change control (ECN/ECO)
export * from "./routing"; // doc 35 W4-E — ISA-95 routing master + steps
export * from "./reportingMart"; // doc 35 W5-B — dim/fact reporting mart
export * from "./contracts"; // doc 44 W0-E — persisted LDS-L1 contract-schema registry (G2.5)
export * from "./assetRegistry"; // doc 44 W2-A2 — config-drift snapshots (G1.11)
export * from "./policyStore"; // doc 44 W3-A1 — policy-as-code store + append-only decision log (G3.11/G3.13)
export * from "./orderLifecycle"; // doc 44 W3-A3 — order lifecycle transitions (G3.6/G3.7, spec LDS-L3 §8.2)
export * from "./lineController"; // doc 44 W3-A2 — Line Controller FSM: line_states + line_state_transitions (G3.1)
export * from "./twinFidelity"; // doc 44 W5-A1 — twin fidelity: simulation_runs + twin_trust (G4.1)
export * from "./parameterGuardrails"; // doc 44 W5-A2 — engineer min-max guardrails + append-only change log (G4.18/G4.19/G4.20)
export * from "./rulFailureMode"; // doc 44 W5-B3 — RUL survival estimates + failure-mode classification (G4.7/G4.8 software)
export * from "./ntfClassifier"; // doc 44 W5-B1 — trained NTF/false-call classifier registry (G4.12)
export * from "./sop"; // doc 44 W6-1 — e-SOP: sops + sop_steps + sop_executions (G5.14, spec LDS-L5 §6.2)
export * from "./enterpriseIntegration"; // doc 44 W6-5 — WMS/PLM/CMMS connector anti-corruption id-map + sync log (G5.24)
export * from "./machineConfigState"; // doc 56 Đ4 — generic machine config-sync shadow (desired/reported + drift), migration 0293
export * from "./processMart"; // doc 56 Đ5 — process analytics daily rollup mart, migration 0294
export * from "./kbStudio"; // doc69 Giai đoạn 5/Wave E3 (E3-1) — multi-corpus pgvector chunk store for Training Studio doc ingest, migration 0304
export * from "./vram"; // 2026-08-02 VRAM Pha 1 Task 2 — nhật ký chỉ-ghi-thêm điều phối VRAM, migration 0310
export * from "./aiCodingSession"; // doc 79 DANH SÁCH PHIÊN — mạch hội thoại tác nhân lập trình, phạm vi CHỦ SỞ HỮU, migration 0333
export * from "./aiCodingLesson"; // doc 82 BỘ NHỚ XUYÊN PHIÊN — bài học người dùng tự khai, phạm vi CHỦ SỞ HỮU, migration 0336
export * from "./aiRepoDuAn"; // QUẢN LÝ DỰ ÁN 2026-08-23 — dự án hộp cát đăng ký qua UI (nguồn DB, env thắng khi trùng id), migration 0337
export * from "./productConfigTree"; // Pha 1A 2026-08-25 — cây CẤU HÌNH 4 cấp surface→position→capture→component, migration 0338
