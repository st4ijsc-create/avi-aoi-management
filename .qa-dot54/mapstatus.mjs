// ĐỢT 54 — đo TRỰC TIẾP hàm sản phẩm `mapMachineStatus` (không qua tệp test của họ).
//   Biên dịch server/services/trangThaiMayTuoi.ts bằng esbuild rồi gọi.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
const r = await build({ entryPoints: ["server/services/trangThaiMayTuoi.ts"], bundle: true, format: "esm", platform: "node", write: false, packages: "external" });
writeFileSync(".qa-dot54/trangThaiMayTuoi.build.mjs", r.outputFiles[0].text);
const m = await import("./trangThaiMayTuoi.build.mjs");
const now = Date.now();
const song = { logStatus: "online", nhipTimTs: now - 5_000, lastStatusChange: now - 5_000, heartbeatStatus: "online", connected: true };
const cases = [
  ["null", null], ["undefined", undefined], ["rong ''", ""], ["stopped", "stopped"], ["running", "running"],
  ["maintenance", "maintenance"], ["error", "error"], ["warming_up", "warming_up"], ["XAP_XI", m.VAN_HANH_XAP_XI_KET_NOI],
];
const kq = { luc: new Date().toISOString(), dangKetNoi: m.dangKetNoi(song, now), NGUONG_TRANG_THAI_TUOI_MS: m.NGUONG_TRANG_THAI_TUOI_MS, ca: {} };
for (const [ten, v] of cases) kq.ca[ten] = m.mapMachineStatus(song, v, now);
// máy KHÔNG kết nối
const chet = { logStatus: "offline", nhipTimTs: now - 9e8, lastStatusChange: now - 9e8, heartbeatStatus: null, connected: false };
kq.khongKetNoi = { null: m.mapMachineStatus(chet, null, now), running: m.mapMachineStatus(chet, "running", now) };
kq.lichSuTaiMoc = m.trangThaiLichSuTaiMoc(song, now);
console.log(JSON.stringify(kq, null, 1));
