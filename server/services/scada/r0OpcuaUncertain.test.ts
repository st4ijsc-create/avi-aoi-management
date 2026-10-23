/**
 * SCADA R0 Task 12 — cổng 5: "Uncertain của OPC UA TỚI ĐƯỢC MÀN".
 *
 * Đầu-cuối trong tiến trình, mọi khâu là mã sản phẩm thật:
 *   OPCUAServer (node-opcua, cổng do HĐH cấp, SecurityMode None) — biến `U` mang StatusCode `UncertainLastUsableValue` + giá trị,
 *   biến `G` Good (đối chứng)
 *     → OpcuaDriver.subscribe (vòng poll chung) → ingest.ts `ingestSamples` → telemetryBus.ingestTelemetry (thật; CHỈ khâu ghi DB
 *       được thay bằng `setTelemetryPersistFn` — seam sẵn có, ghi lại hàng thay vì INSERT)
 *     → bộ đệm giá trị hiện tại (`napTuOt`, ingest.ts gọi TRƯỚC khi ghi)
 *     → scadaSocket `scada:subscribe` trên socket giả ⇒ `scada:snapshot` mang `q:"uncertain"` và `v` khác null.
 *
 * Giả: `checkPermission` (quyền xem) và cổng phạm vi (`__datCongPhamViChoTest`, toàn quyền) — phạm vi đã có lưới DB riêng ở Task 8.
 * Đối chứng: cờ OT_CHAT_LUONG_V2_ENABLED TẮT ⇒ cùng biến tới màn là `bad`, `v: null` (hành vi cũ) — chứng minh cổng đo được C2.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRequire } from "node:module";

const kiemQuyen = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => true));
vi.mock("../../_core/accessControl", () => ({ checkPermission: kiemQuyen }));

const req = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "r0-opcua-unc-"));
const SAVED_ENV: Record<string, string | undefined> = {};
for (const k of ["APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "OPCUA_PKI_DIR", "OT_OPCUA_MONITORED_ITEMS", "OPCUA_ALLOW_TRUST_ON_FIRST_USE"]) {
  SAVED_ENV[k] = process.env[k];
}
// PKI mặc định của node-opcua → thư mục tạm (không đụng %APPDATA% thật); đường POLL (không monitored items).
process.env.APPDATA = path.join(TMP, "appdata");
process.env.LOCALAPPDATA = path.join(TMP, "localappdata");
process.env.XDG_CONFIG_HOME = path.join(TMP, "xdg");
process.env.OPCUA_PKI_DIR = path.join(TMP, "client-pki");
delete process.env.OT_OPCUA_MONITORED_ITEMS;
delete process.env.OPCUA_ALLOW_TRUST_ON_FIRST_USE;

import type { OtTagAddress } from "../ot/otDriver";
import type { RuntimeAdapter } from "../ot/deviceAdapter";
import { setTelemetryPersistFn } from "../telemetryBus";
import { ingestSamples } from "../ot/ingest";
import { __datCongPhamViChoTest } from "../../_core/socketPhongQuyen";
import { __datLaiBoDemHienTai, datThongTinAdapter, layGiaTri } from "./boDemHienTai";
import { __datLaiScadaSocket, registerScadaHandlers, type GiaTriGoi } from "./scadaSocket";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: quá ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function congTrong(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

const ADAPTER_ID = 990_120_001;
const MACHINE_ID = 990_120_077;
const GIA_TRI_U = 42.5;
const GIA_TRI_G = 7.25;

let server: any;
let cm: any;
let url = "";
let ns = 0;
const hangDaGhi: Array<{ metric: string; quality: string | null; numValue: number | null; meta: unknown }> = [];

beforeAll(async () => {
  const o = req("node-opcua");
  const port = await congTrong();
  cm = new o.OPCUACertificateManager({ rootFolder: path.join(TMP, "server-pki"), automaticallyAcceptUnknownCertificate: true });
  await cm.initialize();
  server = new o.OPCUAServer({
    port,
    hostname: "127.0.0.1",
    securityModes: [o.MessageSecurityMode.None],
    securityPolicies: [o.SecurityPolicy.None],
    serverCertificateManager: cm,
    allowAnonymous: true,
    nodeset_filename: [o.nodesets.standard],
  });
  await withTimeout(server.initialize(), 30_000, "server.initialize");
  const addressSpace = server.engine.addressSpace;
  const nsp = addressSpace.getOwnNamespace();
  const u = nsp.addVariable({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "U",
    nodeId: "s=U",
    dataType: "Double",
    minimumSamplingInterval: 100,
  });
  // Giá trị CÓ, nhưng nguồn chỉ "dùng được lần cuối" — đúng tình huống uncertain của một PLC (cảm biến vừa mất, giữ giá trị cuối).
  u.setValueFromSource(new o.Variant({ dataType: o.DataType.Double, value: GIA_TRI_U }), o.StatusCodes.UncertainLastUsableValue, new Date());
  const g = nsp.addVariable({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: "G",
    nodeId: "s=G",
    dataType: "Double",
    minimumSamplingInterval: 100,
  });
  g.setValueFromSource(new o.Variant({ dataType: o.DataType.Double, value: GIA_TRI_G }), o.StatusCodes.Good, new Date());
  await withTimeout(server.start(), 30_000, "server.start");
  url = `opc.tcp://127.0.0.1:${port}`;
  ns = nsp.index;

  // Khâu ghi DB thay bằng seam sẵn có: ghi lại hàng (cổng ts, kiểm hợp đồng, ánh xạ canonical vẫn thật).
  setTelemetryPersistFn(async (rows) => {
    for (const r of rows) hangDaGhi.push({ metric: r.metric, quality: r.quality ?? null, numValue: r.numValue ?? null, meta: r.meta });
    return rows.length;
  });
}, 60_000);

afterAll(async () => {
  setTelemetryPersistFn(null);
  __datCongPhamViChoTest(null);
  __datLaiScadaSocket();
  __datLaiBoDemHienTai();
  if (server) await withTimeout(server.shutdown(0), 10_000, "server.shutdown").catch(() => undefined);
  if (cm) await cm.dispose().catch(() => undefined);
  try {
    const { __disposeOpcuaCertificateManagersForTest } = await import("../ot/drivers/opcuaSecurity");
    await __disposeOpcuaCertificateManagersForTest();
  } catch {
    /* bỏ qua */
  }
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* Windows có thể còn khoá tệp PKI — thư mục tạm */
  }
}, 60_000);

type Cb = (...a: any[]) => any;
function socketGia() {
  const handlers = new Map<string, Cb>();
  const sk: any = { data: { clientType: "browser", user: { id: 1, role: "engineer" } }, emit: vi.fn(), on: (ev: string, cb: Cb) => void handlers.set(ev, cb) };
  registerScadaHandlers(sk);
  const goi = async (ev: string, payload?: unknown) => handlers.get(ev)?.(payload);
  const nhan = (ev: string) => sk.emit.mock.calls.filter((c: any[]) => c[0] === ev).map((c: any[]) => c[1]);
  return { goi, nhan };
}

/** Chạy đường driver → ingest → bộ đệm với cờ V2 = `v2`, rồi đăng ký socket; trả snapshot. */
async function chayDauCuoi(v2: boolean): Promise<{ values: GiaTriGoi[]; denied: unknown[] }> {
  vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2 ? "true" : "false");
  vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
  vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
  vi.stubEnv("OT_STORE_FORWARD_ENABLED", "false");
  vi.stubEnv("OT_INGEST_TO_UNS", "false");
  __datLaiBoDemHienTai();
  __datLaiScadaSocket();
  __datCongPhamViChoTest({ trongPhamVi: async () => true, idsTrongPhamVi: async () => null });
  hangDaGhi.length = 0;

  const { OpcuaDriver } = await import("../ot/drivers/opcuaDriver");
  const driver = new OpcuaDriver();
  const tags: OtTagAddress[] = [
    { tagKey: "u", address: `ns=${ns};s=U`, dataType: "float" },
    { tagKey: "g", address: `ns=${ns};s=G`, dataType: "float" },
  ];
  const adapter: RuntimeAdapter = {
    adapterId: ADAPTER_ID,
    code: "r0-opcua-unc",
    machineId: MACHINE_ID,
    protocol: "opcua",
    connection: { endpoint: url, timeoutMs: 5000 },
    pollIntervalMs: 200,
    tags,
    driver,
  };
  // otManager.baoThongTinChoBoDem làm việc này khi khởi động adapter
  datThongTinAdapter(ADAPTER_ID, { pollMs: adapter.pollIntervalMs, coDeadband: false, machineId: MACHINE_ID, code: adapter.code });
  await withTimeout(driver.connect(adapter.connection), 20_000, "driver.connect");
  const handle = await driver.subscribe(tags, (s) => ingestSamples(adapter, [s]), adapter.pollIntervalMs, { deadlineMs: 6000 });
  try {
    await vi.waitFor(
      () => {
        // cả hai tag có mẫu TƯƠI (chu kỳ đọc đầu tiên sau khi các module đã nạp xong)
        expect(layGiaTri(ADAPTER_ID, "u")?.stale).toBe(false);
        expect(layGiaTri(ADAPTER_ID, "g")?.stale).toBe(false);
      },
      { timeout: 40_000, interval: 50 }, // lần ingest đầu nạp lười nhiều module (bus, phát socket) — đo được > 10 s khi lạnh
    );
    const { goi, nhan } = socketGia();
    await goi("scada:subscribe", {
      subId: "r0",
      tags: [
        { adapterId: ADAPTER_ID, tagKey: "u" },
        { adapterId: ADAPTER_ID, tagKey: "g" },
      ],
    });
    expect(nhan("scada:error")).toEqual([]);
    const [snap] = nhan("scada:snapshot");
    return snap;
  } finally {
    await handle.close();
    await withTimeout(driver.disconnect(), 10_000, "driver.disconnect").catch(() => undefined);
  }
}

describe("cổng 5 — uncertain của OPC UA tới màn (driver → ingest → bộ đệm → scada:snapshot)", () => {
  // T12b fix round 1 — gỡ env SAU MỖI test (kể cả khi assertion ném giữa chừng): cờ không rò sang test/tệp sau.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("cờ OT_CHAT_LUONG_V2_ENABLED bật ⇒ snapshot mang q:'uncertain' với v = giá trị server (khác null); tag Good vẫn good", async () => {
    const snap = await chayDauCuoi(true);
    expect(snap.denied).toEqual([]);
    const u = snap.values.find((x) => x[1] === "u")!;
    const g = snap.values.find((x) => x[1] === "g")!;
    // GiaTriGoi = [adapterId, tagKey, v, q, ts, ageMs, stale, reason]
    expect(u[0]).toBe(ADAPTER_ID);
    expect(u[3]).toBe("uncertain");
    expect(u[2]).not.toBeNull();
    expect(u[2]).toBeCloseTo(GIA_TRI_U, 9);
    expect(u[7]).toBe("device_error");
    expect(u[6]).toBe(false); // tươi
    expect(g[3]).toBe("good");
    expect(g[2]).toBeCloseTo(GIA_TRI_G, 9);
    // Khâu ghi (telemetryBus thật → seam ghi) nhận CÙNG chất lượng + mã trạng thái giao thức.
    const hangU = hangDaGhi.filter((h) => h.metric === "u");
    expect(hangU.length).toBeGreaterThan(0);
    expect(hangU[0].quality).toBe("uncertain");
    expect(hangU[0].numValue).toBeCloseTo(GIA_TRI_U, 9);
    expect(JSON.stringify(hangU[0].meta)).toMatch(/UncertainLastUsableValue/);
  }, 60_000);

  it("đối chứng — cờ TẮT ⇒ cùng biến tới màn là bad, v null (hành vi cũ): cổng đo được ánh xạ C2", async () => {
    const snap = await chayDauCuoi(false);
    const u = snap.values.find((x) => x[1] === "u")!;
    expect(u[3]).toBe("bad");
    expect(u[2]).toBeNull();
  }, 60_000);
});
