// ĐỢT 48 · D-4 — MA TRẬN API × VAI × NHÀ MÁY cho MỌI thủ tục ĐỌC mà 4 màn twin (+MachineCockpitBody nhúng) gọi (G113).
//   node .qa-dot49/api-vai.mjs --vai=A|B|C|D|M|ADM [--base=http://localhost:3049]
//   A e2e_tai_loE (oee+status+andon, gán NM1) · B operator1 (status+andon, 0 gán) · C e2e_dot32_khongquyen (0 quyền, 0 gán) ·
//   D e2e_dot36_oee (CHỈ analytics_oee, gán NM1) · M e2e_dot41_mon (machine_monitoring+status+oee, gán NM1) · ADM e2e_dot41_adm (admin, 0 perm, 0 gán).
//   NM1 = SIM-FAC (toà 24, tầng 28, line 2, trạm 14, máy 14) · NM18 = T12-SHOT (line 11, trạm 44, máy 257, KHÔNG có toà nhà twin).
//   Dấu vết dữ liệu: coSIM = thân phản hồi chứa "SIM-" · coT12 = chứa "T12-SHOT" hoặc "mtlt8goc8429". Ghi .qa-dot48/api-vai/<vai>.json (thô).
import { request } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const VAI = arg("vai", "A"); const BASE = arg("base", "http://localhost:3049");
// ★★★ ĐỢT 49 — ĐƯỜNG RA LẤY TỪ ENV. Bản chép nguyên văn của QA ghi CỨNG `.qa-dot48/api-vai`, nên
//   lượt D-4 của tôi ĐÃ GHI ĐÈ 13 tệp TRACKED của Đợt 48 (đã khôi phục byte-exact bằng
//   `git show HEAD:<tep>`). Đúng cùng lớp lỗi mà mục F vừa vá cho `e2e/twin-dot47-bam-canh.spec.ts`
//   — và tôi dính nó ở một tệp KHÁC trong cùng phiên: sửa MỘT chỗ ghi cứng không đóng được lớp lỗi,
//   phải quét MỌI harness có đường ra ghi cứng (G110 "cùng kit, màn thứ ba không quét").
const OUT = process.env.API_VAI_OUT || ".qa-dot49/api-vai"; mkdirSync(OUT, { recursive: true });
const TK = {
  A: { username: "e2e_tai_loE", password: "E2eTaiLoE!2026" }, B: { username: "operator1", password: "User@123" },
  C: { username: "e2e_dot32_khongquyen", password: "KhongQuyen!2026" }, D: { username: "e2e_dot36_oee", password: "Oee!2026Dot36" },
  M: { username: "e2e_dot41_mon", password: "Mon!2026Dot41" }, ADM: { username: "e2e_dot41_adm", password: "Adm!2026Dot41" },
}[VAI];
const ctx = await request.newContext({ baseURL: BASE });
const login = await ctx.post("/api/auth/login", { data: TK });
const meR = await ctx.get("/api/trpc/auth.me"); const meJ = await meR.json().catch(() => null); const me = meJ?.result?.data?.json ?? meJ?.result?.data ?? null;
const kq = { vai: VAI, user: TK.username, base: BASE, luc: new Date().toISOString(), login: login.status(), me: { id: me?.id ?? null, ten: me?.username ?? null, role: me?.role ?? null }, ds: [] };
if (me?.username !== TK.username) { kq.loi = `dang nhap that bai: login=${login.status()} me=${me?.username}`; console.log("   LOI", kq.loi); writeFileSync(`${OUT}/${VAI}.json`, JSON.stringify(kq, null, 2)); await ctx.dispose(); process.exit(1); }
async function goi(ten, proc, input, ghi) {
  const u = `/api/trpc/${proc}` + (input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`);
  const t0 = Date.now(); const r = await ctx.get(u); const ms = Date.now() - t0; const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  const err = j?.error?.json ?? j?.error ?? null; const data = j?.result?.data?.json ?? j?.result?.data ?? null;
  const n = Array.isArray(data) ? data.length : Array.isArray(data?.machines) ? data.machines.length : Array.isArray(data?.may) ? data.may.length : Array.isArray(data?.stations) ? data.stations.length : Array.isArray(data?.types) ? data.types.length : Array.isArray(data?.points) ? data.points.length : typeof data === "string" ? data.length : data && typeof data === "object" ? Object.keys(data).length : data === null ? 0 : null;
  const row = { ten, proc, input: input ?? null, status: r.status(), code: err?.data?.code ?? err?.code ?? null, appCode: err?.data?.appCode ?? null, msg: (err?.message ?? "").slice(0, 100), n, bytes: t.length, coSIM: /SIM-/.test(t), coT12: /T12-SHOT|mtlt8goc8429/.test(t), ms, tho: t.slice(0, 140).replace(/\s+/g, " "), ghi: ghi ?? "" };
  kq.ds.push(row);
  console.log(`   [${VAI}] ${ten.padEnd(36)} ${String(row.status).padEnd(3)} ${(row.code ?? "ok").padEnd(12)} n=${String(n).padEnd(5)} SIM=${row.coSIM ? "CO" : "-"} T12=${row.coT12 ? "CO" : "-"} ${ms}ms ${row.msg}`);
  return { data, row };
}
const moc = Date.now();
await goi("factory.list", "factory.list");
await goi("twinCanh.danhSachToaNha(1)", "twinCanh.danhSachToaNha", { factoryId: 1 });
await goi("twinCanh.danhSachToaNha(18)", "twinCanh.danhSachToaNha", { factoryId: 18 }, "NM18 KHONG co toa nha twin => rong ca khi khong rao");
await goi("twinCanh.chiTietToaNha(24)", "twinCanh.chiTietToaNha", { id: 24 });
await goi("twinCanh.canhThietKe(1,[28])", "twinCanh.canhThietKe", { factoryId: 1, tangIds: [28] });
await goi("twinCanh.canhThietKe(18)", "twinCanh.canhThietKe", { factoryId: 18 });
await goi("twinCanh.anToanRobot(1)", "twinCanh.anToanRobot", { factoryId: 1 });
await goi("twinCanh.anToanRobot(18)", "twinCanh.anToanRobot", { factoryId: 18 });
await goi("twinCanh.sucKhoeMay(1)", "twinCanh.sucKhoeMay", { factoryId: 1 });
await goi("twinCanh.sucKhoeMay(18)", "twinCanh.sucKhoeMay", { factoryId: 18 });
await goi("twinCanh.anhLichSu(1)", "twinCanh.anhLichSu", { factoryId: 1, moc });
await goi("twinCanh.anhLichSu(18)", "twinCanh.anhLichSu", { factoryId: 18, moc });
await goi("twinCanh.trangThaiHangLoat(1)", "twinCanh.trangThaiHangLoat", { factoryId: 1 });
await goi("twinCanh.trangThaiHangLoat(18)", "twinCanh.trangThaiHangLoat", { factoryId: 18 });
await goi("twinCanh.demVatThe([28])", "twinCanh.demVatThe", { tangIds: [28] });
await goi("twinCanh.danhSachBanGhi([28])", "twinCanh.danhSachBanGhi", { tangIds: [28] });
await goi("twinCanh.xemTruocSinh(1,[28])", "twinCanh.xemTruocSinh", { factoryId: 1, tangIds: [28] });
{ const r = await goi("twinCanh.danhSachModel()", "twinCanh.danhSachModel"); if (r.row.code === "BAD_REQUEST") await goi("twinCanh.danhSachModel({factoryId:1})", "twinCanh.danhSachModel", { factoryId: 1 }); }
await goi("factoryCommand.overview(1)", "factoryCommand.overview", { factoryId: 1 });
await goi("factoryCommand.overview(18)", "factoryCommand.overview", { factoryId: 18 });
await goi("factoryCommand.machineDetail(14)", "factoryCommand.machineDetail", { machineId: 14 });
await goi("factoryCommand.machineDetail(257)", "factoryCommand.machineDetail", { machineId: 257 });
await goi("assetCockpit.machineDetail(14)", "assetCockpit.machineDetail", { machineId: 14 });
await goi("assetCockpit.machineDetail(257)", "assetCockpit.machineDetail", { machineId: 257 });
await goi("assetCockpit.machineAlarms(14)", "assetCockpit.machineAlarms", { machineId: 14 });
await goi("assetCockpit.machineAlarms(257)", "assetCockpit.machineAlarms", { machineId: 257 });
await goi("assetCockpit.robotDetail(1)", "assetCockpit.robotDetail", { robotId: 1 }, "robot mo coi (stationId null)");
await goi("andon.active", "andon.active", undefined, "7 su kien deu NM1 (line 1/2)");
await goi("digitalTwin.wipFlowState(line 2)", "digitalTwin.wipFlowState", { lineId: 2 });
await goi("digitalTwin.wipFlowState(line 11)", "digitalTwin.wipFlowState", { lineId: 11 }, "line NM18");
await goi("wip.lineBalance(line 2)", "wip.lineBalance", { lineId: 2 }, "line_balance_metrics: line 2 co 16 hang; wipRouter 0 tham chieu scope");
await goi("wip.lineBalance(line 11)", "wip.lineBalance", { lineId: 11 }, "line NM18: 0 hang trong DB => rong ca khi khong rao");
await goi("dashboard.getMachineStats(14)", "dashboard.getMachineStats", { machineId: 14 });
await goi("dashboard.getMachineStats(257)", "dashboard.getMachineStats", { machineId: 257 });
await goi("maintenance.listWorkOrders(m14)", "maintenance.listWorkOrders", { machineId: 14 }, "WO 23 thuoc may 14");
await goi("maintenance.listWorkOrders(m257)", "maintenance.listWorkOrders", { machineId: 257 });
await goi("maintenance.listPartsForWorkOrder(23)", "maintenance.listPartsForWorkOrder", { workOrderId: 23 });
await goi("machine.checkCapabilities(14)", "machine.checkCapabilities", { id: 14 });
await goi("machine.checkCapabilities(257)", "machine.checkCapabilities", { id: 257 });
const lt = await goi("sensor.listTypes(m1)", "sensor.listTypes", { machineId: 1 }, "may 1 co 72 hang machine_sensor_readings; sensorRouter khong nhan ctx");
await goi("sensor.listTypes(m257)", "sensor.listTypes", { machineId: 257 }, "may 257: 0 hang sensor");
const t0 = lt.data?.types?.[0]; const loai = typeof t0 === "string" ? t0 : (t0?.sensorType ?? t0?.type ?? "temperature");
await goi(`sensor.readSeries(m1,${loai})`, "sensor.readSeries", { machineId: 1, sensorType: String(loai) });
await goi("mqttClient.getDowntimeHistory(m14)", "mqttClient.getDowntimeHistory", { machineId: 14 }, "downtime_events may 14: 4 hang");
await goi("orchestration.listWorkflows", "orchestration.listWorkflows", undefined, "bang toan cuc, khong co cot nha may");
await goi("user.assignableTechnicians", "user.assignableTechnicians", undefined, "tra MOI user isActive (id+name) — khong loc nha may");
await goi("twin.usdExport(1)", "twin.usdExport", { factoryId: 1 }, "twinRouter.ts:316 requirePermission(machine_monitoring) — buildFactoryUsda(factoryId) KHONG scope");
await goi("twin.usdExport(18)", "twin.usdExport", { factoryId: 18 });
await goi("digitalTwin.whatIf(tram 44)", "digitalTwin.whatIf", { stations: [{ stationId: 44, cycleTimeSec: 10 }], horizonHours: 1 }, "tinh thuan, khong doc DB");
writeFileSync(`${OUT}/${VAI}.json`, JSON.stringify(kq, null, 2));
const t12 = kq.ds.filter((r) => r.coT12).map((r) => r.ten); const sim = kq.ds.filter((r) => r.coSIM).map((r) => r.ten);
console.log(`   [${VAI}] ${kq.ds.length} goi · me=${JSON.stringify(kq.me)} · dau vet NM18 (T12): ${t12.length} [${t12.join(", ")}] · dau vet NM1 (SIM): ${sim.length}`);
await ctx.dispose();
