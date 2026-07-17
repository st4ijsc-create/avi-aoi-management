// doc 56 Đ6 — LIVE proof that the AI local persona tools read the REAL standardised
// pilot data: get_device_health (công nhân/kỹ thuật) folds process + config-drift +
// SPC for SCRW-SIM-01; get_fleet_process_summary (quản lý) rolls up by deviceClass.
// Runs the ACTUAL registered tool handlers against the live DB.
//
//   DATABASE_URL="postgresql://aoi:aoi@127.0.0.1:5434/aoi_management" npx tsx scripts/pilot-ai-persona.mjs
import { getDeviceHealth, getFleetProcessSummary } from "../server/services/aiLocalTools/handlersF7.ts";

const line = () => console.log("─".repeat(78));

// 1) Kỹ thuật / công nhân — device health (SCRW-SIM-01 = machine 243).
const health = await getDeviceHealth.handler({ machineCode: "SCRW-SIM-01", days: 365 });
console.log("get_device_health(SCRW-SIM-01):");
console.log(health.textSummary);
line();

// 2) Quản lý — fleet process summary.
const fleet = await getFleetProcessSummary.handler({ days: 365 });
console.log("get_fleet_process_summary:");
console.log(fleet.textSummary);
line();

const pass =
  health.data.machineType === "SCREWDRIVE" &&
  health.data.process.total >= 1 &&
  health.data.spc != null &&
  fleet.data.groups.length >= 1;
console.log(pass
  ? "✅ AI PERSONA TOOLS PROVEN on real pilot data: device health (process+drift+SPC) + fleet rollup."
  : "❌ FAILED — see values above.");
process.exit(pass ? 0 : 1);
