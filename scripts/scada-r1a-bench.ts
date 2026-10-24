/**
 * SCADA R1a Task 15 — bench nghiệm thu "điều khiển lõi" trên OpenPLC (Docker) + safety PLC MÔ PHỎNG. CHẠY TAY, không vào CI.
 *
 *   npx tsx scripts/scada-r1a-bench.ts [--endpoint tcp://127.0.0.1:15502] [--container avi-openplc-bench] [--web http://127.0.0.1:18080]
 *       [--poll 1000] [--timeout 800] [--lap 3]
 *
 * Trong tiến trình, KHÔNG đụng :3000 / :8091 / GPU. CSDL = `_test` (suy từ DATABASE_URL của .env như vitest.setup.ts: chỉ đọc MỘT khoá đó,
 * thêm hậu tố `_test`; tên phải chứa "test" và khác DB dev, nếu không script dừng). Mọi cờ đặt TƯỜNG MINH trong tiến trình — `.env` không
 * được nạp; `OT_CONTROL_ENABLED=true` CHỈ ở đây (D9).
 *
 * Đường đo (đúng đường sản phẩm):
 *   • otManager THẬT (`startOt`, nhánh legacy) qua seam nguồn adapter `setAdapterSource` (như scripts/scada-r0-bench.ts) trên ModbusDriver
 *     THẬT; vòng poll THẬT nuôi bộ đệm giá trị hiện tại ⇒ kênh chế độ máy là một tag poll trung tâm (không deadband) đọc từ PLC.
 *     Adapter cùng `id` với hàng `device_adapters` thật trên `_test` (dispatch đọc hàng + tag từ DB, driver từ otManager).
 *   • `scadaCommands.request/confirm` qua tRPC caller; người dùng admin tạo bằng `taoNguoiDungTest` (helper nhập `afterAll` của vitest ⇒
 *     script cài một resolve hook thay "vitest" bằng shim `afterAll` rỗng; dọn bằng `donNguoiDungTest()` của chính helper).
 *   • `dispatch()` trực tiếp như tool AI (dòng chờ AI đã xác nhận + băm) cho phần "dispatch" của ô 2/ô 3.
 *   • Safety PLC giả trong tiến trình (khuôn scripts/safety-plc-bench.ts:30 `selfServer`): `ServerTCP` 127.0.0.1 cổng HĐH cấp, coil 0 =
 *     e-stop (sạch); hàng `safety_plc_configs` THẬT backend `modbus` phạm vi trạm của máy bench; giữ khoá seed độc quyền.
 *   • Adapter bench có hàng `commissioning_records` thật (OT_COMMISSIONING_REQUIRED bật như mặc định sản phẩm).
 *
 * Oracle độc lập: một client Modbus RIÊNG (kết nối mới mỗi lần) đọc thanh ghi đích TRƯỚC/SAU — lệnh bị từ chối ⇒ thanh ghi không đổi;
 * đường vui ⇒ thanh ghi = giá trị gửi.
 *
 * BƯỚC 0 (bắt buộc, trước khi tin bench): XÁC NHẬN thanh ghi holding ghi được và GIỮ giá trị khi đọc lại (runtime OpenPLC không ghi đè mỗi
 * chu kỳ quét). Thử lần lượt các ứng viên (holding 0..17 = %QW0..17, 1024..1027 = %MW0..3): ghi FC06 một giá trị lạ, đọc lại ở +200 /
 * +1000 / +2500 ms; giữ đủ 3 lần ⇒ dùng được. In kết quả từng ứng viên; trả lại giá trị gốc. Cú pháp tag của sản phẩm là 1-BASED
 * (`holding:N` = thanh ghi N-1).
 *
 * Cuối cùng: trả container về đúng trạng thái đã gặp; dọn mọi hàng không-WORM đã tạo.
 */
import { execFileSync } from "node:child_process";
import { createRequire, registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { resolve as duongDan } from "node:path";
import { randomUUID } from "node:crypto";

// ── "vitest" ⇒ shim (taoNguoiDungTest đăng ký afterAll lúc nạp module; ngoài vitest runner lời gọi đó ném) ──
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "vitest") return { url: "data:text/javascript,export const afterAll=()=>{};", shortCircuit: true, format: "module" };
    return next(spec, ctx);
  },
});

interface TuyChon {
  endpoint: string;
  container: string;
  web: string;
  pollMs: number;
  timeoutMs: number;
  lap: number;
}
function docThamSo(argv: string[]): TuyChon {
  const lay = (k: string, mac: string) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : mac;
  };
  return {
    endpoint: lay("endpoint", "tcp://127.0.0.1:15502"),
    container: lay("container", "avi-openplc-bench"),
    web: lay("web", "http://127.0.0.1:18080"),
    pollMs: Number(lay("poll", "1000")),
    timeoutMs: Number(lay("timeout", "800")),
    lap: Math.max(1, Number(lay("lap", "3"))),
  };
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── DB _test (như vitest.setup.ts) ──
function docKhoaEnv(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1 || t.slice(0, i).trim() !== key) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}
function urlTest(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const dev = docKhoaEnv(duongDan(process.cwd(), ".env"), "DATABASE_URL");
  if (!dev) throw new Error("không tìm thấy DATABASE_URL trong .env");
  const u = new URL(dev);
  const devName = u.pathname.replace(/^\//, "");
  u.pathname = "/" + devName + "_test";
  const testName = u.pathname.replace(/^\//, "");
  if (!/test/i.test(testName) || testName === devName) throw new Error(`từ chối: DB "${testName}" phải chứa "test" và khác DB dev`);
  return u.toString();
}

// ── Docker + Modbus (khuôn scripts/scada-r0-bench.ts) ──
function docker(...args: string[]): void {
  execFileSync("docker", args, { stdio: "ignore", timeout: 60_000 });
}
function trangThaiContainer(name: string): string {
  return execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" }).trim();
}
const req = createRequire(import.meta.url);
const ModbusNs: any = req("modbus-serial");
const ModbusRTU: any = ModbusNs.default ?? ModbusNs;
const ServerTCP: any = ModbusNs.ServerTCP ?? ModbusNs.default?.ServerTCP;

function hostPort(endpoint: string): { host: string; port: number } {
  const u = new URL(endpoint.replace(/^tcp:/, "http:"));
  return { host: u.hostname, port: Number(u.port || 502) };
}
/** Một phiên client Modbus RIÊNG (kết nối mới) — oracle độc lập với driver của sản phẩm. */
async function voiClient<T>(endpoint: string, fn: (c: any) => Promise<T>, hanMs = 1500): Promise<T> {
  const { host, port } = hostPort(endpoint);
  const c = new ModbusRTU();
  try {
    await c.connectTCP(host, { port });
    c.setID(1);
    c.setTimeout(hanMs);
    return await fn(c);
  } finally {
    try {
      c._port?._client?.destroy?.();
      c.close(() => undefined);
    } catch {
      /* bỏ qua */
    }
  }
}
const docThanhGhi = (ep: string, reg0: number) => voiClient(ep, async (c) => Number((await c.readHoldingRegisters(reg0, 1)).data[0]));
const ghiThanhGhi = (ep: string, reg0: number, v: number) => voiClient(ep, async (c) => void (await c.writeRegister(reg0, v)));

async function thamDo(endpoint: string): Promise<boolean> {
  try {
    return await voiClient(endpoint, async (c) => Array.isArray((await c.readHoldingRegisters(0, 18))?.data), 500);
  } catch {
    return false;
  }
}
async function batPlcQuaWeb(web: string): Promise<boolean> {
  try {
    const r = await fetch(web + "/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "username=openplc&password=openplc",
      redirect: "manual",
    });
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (!cookie) return false;
    const s = await fetch(web + "/start_plc", { headers: { cookie }, redirect: "manual" });
    return s.status === 302 || s.status === 200;
  } catch {
    return false;
  }
}
async function doiModbusTraLoi(o: TuyChon, bamStartSauMs: number, hanMs = 90_000): Promise<boolean> {
  const t0 = Date.now();
  let daBam = false;
  let lanCuoi = 0;
  for (;;) {
    if (await thamDo(o.endpoint)) return daBam;
    const now = Date.now();
    if (now - t0 > hanMs) throw new Error(`Modbus ${o.endpoint} không trả lời sau ${hanMs} ms`);
    if (now - t0 >= bamStartSauMs && now - lanCuoi >= 2000) {
      lanCuoi = now;
      if (await batPlcQuaWeb(o.web)) daBam = true;
    }
    await ngu(100);
  }
}

/** Bước 0 — thanh ghi nào GIỮ giá trị ghi vào (runtime không ghi đè mỗi chu kỳ)? */
async function kiemGiuGiaTri(ep: string): Promise<Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }>> {
  const ungVien = [...Array.from({ length: 18 }, (_, i) => i), 1024, 1025, 1026, 1027];
  const out: Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }> = [];
  for (const reg0 of ungVien) {
    let goc = -1;
    const ghi = 12_000 + reg0; // giá trị lạ, khác 0
    const doc: number[] = [];
    try {
      goc = await docThanhGhi(ep, reg0);
      await ghiThanhGhi(ep, reg0, ghi);
      let tr = 0;
      for (const moc of [200, 1000, 2500]) {
        await ngu(moc - tr);
        tr = moc;
        doc.push(await docThanhGhi(ep, reg0));
      }
      await ghiThanhGhi(ep, reg0, goc);
    } catch (e) {
      doc.push(Number.NaN);
      console.log(`[bench] bước 0: thanh ghi ${reg0} lỗi: ${(e as Error).message}`);
    }
    out.push({ reg0, goc, ghi, doc, giu: doc.length === 3 && doc.every((v) => v === ghi) });
  }
  return out;
}

// ── Safety PLC giả trong tiến trình (khuôn scripts/safety-plc-bench.ts selfServer) ──
async function safetyPlcGia(): Promise<{ port: number; coils: Map<number, boolean>; close(): Promise<void> }> {
  const coils = new Map<number, boolean>();
  const srv = new ServerTCP(
    {
      getCoil: (a: number) => coils.get(a) ?? false,
      getDiscreteInput: () => false,
      getHoldingRegister: () => 0,
      getInputRegister: () => 0,
      setCoil: () => undefined,
      setRegister: () => undefined,
    },
    { host: "127.0.0.1", port: "0", unitID: 1 },
  );
  await new Promise<void>((res, rej) => {
    srv.once("initialized", () => res());
    srv.once("serverError", rej);
  });
  const port = srv._server.address().port as number;
  return {
    port,
    coils,
    close: () =>
      new Promise<void>((res) => {
        for (const s of srv?.socks?.keys?.() ?? []) (s as any).destroy();
        srv.close(() => res());
      }),
  };
}

interface Dong {
  lap: number;
  o: string;
  buoc: string;
  mong: string;
  duoc: string;
  ms: number;
  thanhGhi: string;
  dat: boolean;
}

async function main(): Promise<void> {
  const o = docThamSo(process.argv.slice(2));
  const RUN = `r1abench${process.pid}${Date.now().toString(36)}`;

  // Cờ — đặt TRƯỚC mọi import của server. .env KHÔNG được nạp.
  const CO: Record<string, string> = {
    DATABASE_URL: urlTest(),
    NODE_ENV: "test",
    DB_POOL_MAX: "4",
    DB_POOL_MAX_JOBS: "2",
    DB_POOL_MAX_READ: "2",
    EXTERNAL_MQTT_ENABLED: "false",
    OT_GATEWAY_ENABLED: "true",
    OT_CONN_HA_ENABLED: "false",
    OT_CHAT_LUONG_V2_ENABLED: "true",
    OT_GHI_TRANG_THAI_ADAPTER_ENABLED: "false",
    OT_STORE_FORWARD_ENABLED: "false",
    OT_POLL_BATCH_ENABLED: "false",
    OT_TAG_DEADBAND_ENABLED: "false",
    OT_INGEST_TO_UNS: "false",
    SCADA_LIVE_CACHE_ENABLED: "true",
    SCADA_SOCKET_ENABLED: "false",
    SCADA_COMMANDS_ENABLED: "true",
    SCADA_CONG_CHE_DO_ENABLED: "false",
    OT_CONTROL_ENABLED: "true", // D9: chỉ trong tiến trình bench
    AI_OT_CONTROL_ENABLED: "false",
    OT_COMMISSIONING_REQUIRED: "true",
    OT_SAFETY_PREFLIGHT_ENABLED: "true",
    SAFETY_PLC_ADAPTER_ENABLED: "true",
    OT_READBACK_ENABLED: "false", // đường HMI vẫn đọc lại (docLai bat_buoc)
    OT_CMD_SERIALIZE_ENABLED: "false",
    SEC_PLATFORM: "false",
    UNS_CMD_ACK_ENABLED: "false",
    INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  };
  for (const [k, v] of Object.entries(CO)) process.env[k] = v;
  console.log(`[bench] DB: ${new URL(CO.DATABASE_URL).pathname.slice(1)} · cờ: ${Object.entries(CO).filter(([k]) => k !== "DATABASE_URL").map(([k, v]) => `${k}=${v}`).join(" ")}`);

  const banDau = trangThaiContainer(o.container);
  const anh = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}} {{.Image}} created={{.Created}}", o.container], { encoding: "utf8" }).trim();
  const ver = execFileSync("docker", ["version", "-f", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
  console.log(`[bench] container ${o.container}: trạng thái ban đầu=${banDau}; ảnh ${anh}; Docker engine ${ver}`);
  if (banDau === "paused") docker("unpause", o.container);
  else if (banDau !== "running") docker("start", o.container);

  const bang: Dong[] = [];
  const don: Array<() => Promise<unknown>> = [];
  try {
    const daBam = await doiModbusTraLoi(o, 3000);
    console.log(`[bench] Modbus ${o.endpoint} trả lời${daBam ? " (đã bấm Start qua web)" : ""}`);

    // ── BƯỚC 0 ──
    const giu = await kiemGiuGiaTri(o.endpoint);
    for (const g of giu) console.log(`[bench] bước 0: holding reg ${g.reg0} (tag holding:${g.reg0 + 1}) gốc=${g.goc} ghi=${g.ghi} đọc@200/1000/2500ms=${g.doc.join("/")} ⇒ ${g.giu ? "GIỮ" : "KHÔNG GIỮ"}`);
    const dung = giu.filter((g) => g.giu);
    if (dung.length < 2) throw new Error(`bước 0: cần ≥ 2 thanh ghi giữ giá trị (điểm đặt + kênh chế độ), có ${dung.length} — bench KHÔNG đo được`);
    const REG_SP = dung[0].reg0;
    const REG_CHE_DO = dung[1].reg0;
    console.log(`[bench] dùng: điểm đặt = reg ${REG_SP} (holding:${REG_SP + 1}), kênh chế độ = reg ${REG_CHE_DO} (holding:${REG_CHE_DO + 1})`);
    const gocSp = await docThanhGhi(o.endpoint, REG_SP);
    const gocCheDo = await docThanhGhi(o.endpoint, REG_CHE_DO);
    don.push(async () => {
      await ghiThanhGhi(o.endpoint, REG_SP, gocSp);
      await ghiThanhGhi(o.endpoint, REG_CHE_DO, gocCheDo);
    });
    await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2); // REMOTE

    // ── server ──
    await import("../server/services/ot"); // đăng ký driver (như scada-r0-bench / safety-plc-bench)
    const [{ getDb }, { sql }, schema, { taoNguoiDungTest, donNguoiDungTest }, { acquireSeedExclusive }] = await Promise.all([
      import("../server/db/connection"),
      import("drizzle-orm"),
      import("../drizzle/schema"),
      import("../server/testing/nguoiDungTest"),
      import("../server/services/edge/__edgeSeedGuard.dot10"),
    ]);
    const [{ setAdapterSource }, { createDriver }, ot, boDem, { setTelemetryPersistFn }, disp, binding, { scadaCommandsRouter }] = await Promise.all([
      import("../server/services/ot/deviceAdapter"),
      import("../server/services/ot/driverRegistry"),
      import("../server/services/ot/otManager"),
      import("../server/services/scada/boDemHienTai"),
      import("../server/services/telemetryBus"),
      import("../server/services/ot/commandDispatcher"),
      import("../server/services/ot/otActionBinding"),
      import("../server/routers/scadaCommandsRouter"),
      import("../server/services/ot/adapterFacade"),
      import("../server/services/safety/plc/safetyPlcAdapter"),
    ]);
    const db = await getDb();
    if (!db) throw new Error("không nối được CSDL _test");
    const dung1 = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];

    const seed = await acquireSeedExclusive(CO.DATABASE_URL, { waitMs: 30_000 });
    don.push(() => seed.release());
    let soHangTelemetry = 0;
    setTelemetryPersistFn(async (rows) => {
      soHangTelemetry += rows.length;
      return rows.length;
    });
    don.push(async () => setTelemetryPersistFn(null));

    const plc = await safetyPlcGia();
    don.push(() => plc.close());

    // nhà máy → máy
    const code = RUN;
    const [f] = await dung1(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    const [w] = await dung1(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
    const [l] = await dung1(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
    const [s] = await dung1(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
    const [m] = await dung1(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, 'May bench R1a', 'AOI', true) RETURNING id`);
    const machineId = Number(m.id);
    don.push(async () => {
      await dung1(sql`DELETE FROM machines WHERE code = ${code}`);
      await dung1(sql`DELETE FROM stations WHERE code = ${code}`);
      await dung1(sql`DELETE FROM production_lines WHERE code = ${code}`);
      await dung1(sql`DELETE FROM workshops WHERE code = ${code}`);
      await dung1(sql`DELETE FROM factories WHERE code = ${code}`);
    });
    const maPlc = `${RUN}-splc`.slice(0, 64);
    await dung1(sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", enabled, scope, "stationId")
      VALUES (${maPlc}, 'R1a bench safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
        ${JSON.stringify({ estop: { address: "coil:1", dataType: "bool" } })}::jsonb, true, NULL, ${s.id})`);
    don.push(() => dung1(sql`DELETE FROM safety_plc_configs WHERE code = ${maPlc}`));

    const [a] = await dung1(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "connectionOptions")
      VALUES (${machineId}, ${RUN}, ${RUN}, 'modbus', ${o.endpoint}, ${o.pollMs}, true, 'disabled', ${JSON.stringify({ unitId: 1, timeoutMs: o.timeoutMs })}::json) RETURNING id`);
    const adapterId = Number(a.id);
    don.push(async () => {
      await dung1(sql`DELETE FROM scada_khoa_chon WHERE adapter_id = ${adapterId}`);
      await dung1(sql`DELETE FROM scada_kenh_che_do WHERE machine_id = ${machineId}`);
      await dung1(sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`);
      await dung1(sql`DELETE FROM commissioning_records WHERE "adapterId" = ${adapterId}`).catch(() => undefined);
      await dung1(sql`DELETE FROM device_adapters WHERE id = ${adapterId}`);
    });
    await dung1(sql`INSERT INTO commissioning_records ("adapterId", status, "signedBy", "fatReference") VALUES (${adapterId}, 'active', 1, ${RUN})`);
    const tagSp = `holding:${REG_SP + 1}`;
    const tagCheDo = `holding:${REG_CHE_DO + 1}`;
    await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable, "isEnabled", channel_kind, display_name, write_min, write_max, write_step, actuation_level)
      VALUES (${adapterId}, 'sp', ${tagSp}, 'int', true, true, 'input_output'::scada_channel_kind, 'Diem dat bench', 240, 250, 1, 3),
             (${adapterId}, 'che_do', ${tagCheDo}, 'int', false, true, 'input'::scada_channel_kind, 'Che do may', NULL, NULL, NULL, NULL)`);
    await dung1(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${machineId}, ${adapterId}, 'che_do', '2'::jsonb, 1)`);

    const admin = await taoNguoiDungTest("admin", "admin", { tienTo: "r1abench", ts: RUN, ten: "R1a bench admin" });
    don.push(() => dung1(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${admin.id}`));
    don.push(() => donNguoiDungTest());
    const caller = scadaCommandsRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: admin.twoFactorEnabled === true } } as never);

    // otManager THẬT trên đúng adapter này (seam nguồn adapter)
    setAdapterSource(async () => [
      {
        adapterId,
        code: RUN,
        machineId,
        protocol: "modbus" as const,
        connection: { endpoint: o.endpoint, timeoutMs: o.timeoutMs, options: { unitId: 1, timeoutMs: o.timeoutMs } },
        pollIntervalMs: o.pollMs,
        tags: [
          { tagKey: "sp", address: tagSp, dataType: "int" as const },
          { tagKey: "che_do", address: tagCheDo, dataType: "int" as const },
        ],
        driver: createDriver("modbus"),
      },
    ]);
    if (!(await ot.startOt())) throw new Error("startOt trả false");
    don.push(async () => {
      await ot.stopOt();
      setAdapterSource(null);
      boDem.xoaAdapter(adapterId);
    });
    const doiDen = async (dk: () => boolean, hanMs: number) => {
      const t0 = Date.now();
      while (!dk()) {
        if (Date.now() - t0 > hanMs) return null;
        await ngu(20);
      }
      return Date.now() - t0;
    };
    const cheDoLa = (v: number) => () => {
      const g = boDem.layGiaTri(adapterId, "che_do");
      return !!g && g.q === "good" && !g.stale && g.v === v;
    };
    if ((await doiDen(cheDoLa(2), 30_000)) === null) throw new Error(`kênh chế độ không lên good=2 trong 30 s: ${JSON.stringify(boDem.layGiaTri(adapterId, "che_do"))}`);
    console.log("[bench] OT lên: kênh chế độ good = 2 (REMOTE) qua vòng poll THẬT");

    const lenhAi = async (commandType: string, writes: Array<{ tagKey: string; value: unknown }>) => {
      const actionId = `${RUN}-ai-${randomUUID()}`;
      await db.insert(schema.aiPendingActions).values({
        id: actionId,
        tool: "set_machine_param",
        argsJson: {},
        userId: admin.id,
        userRole: "admin",
        summary: `${RUN} AI`,
        previewJson: binding.withOtPayloadHash({ entityType: "machine" }, binding.otPayloadHash({ tool: "set_machine_param", adapterId, machineId, commandType, writes })),
        status: "confirmed",
        idempotencyKey: `${actionId}-idem`,
        expiresAt: new Date(Date.now() + 600_000),
      });
      return {
        adapterId,
        machineId,
        commandType,
        writes,
        triggeredBy: { kind: "hitl" as const, actionId, tool: "set_machine_param", confirmedBy: admin.id, requestedBy: admin.id },
        idempotencyKey: `${RUN}-ai-${randomUUID()}`,
      };
    };
    const maLoi = (e: unknown) => {
      const x = e as { cause?: { appCode?: string; appParams?: { ma?: string; lyDo?: string } } };
      return `${x.cause?.appParams?.ma ?? x.cause?.appCode ?? String(e)}${x.cause?.appParams?.lyDo ? ` (${x.cause.appParams.lyDo})` : ""}`;
    };
    const demLenh = async () => Number((await dung1(sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${adapterId}`))[0].n);

    for (let lap = 1; lap <= o.lap; lap++) {
      // ── Đường vui: acked_verified ──
      {
        const v = lap % 2 === 1 ? 245 : 246;
        await ghiThanhGhi(o.endpoint, REG_SP, 0);
        const t0 = Date.now();
        const { requestId } = await caller.request({ adapterId, tagKey: "sp", value: v, lyDo: "bench R1a duong vui", clientRequestId: randomUUID() });
        const t1 = Date.now();
        const kq = await caller.confirm({ requestId });
        const t2 = Date.now();
        const sau = await docThanhGhi(o.endpoint, REG_SP);
        bang.push({ lap, o: "vui", buoc: `request ${v} (${t1 - t0} ms) + confirm`, mong: "acked_verified, readBack = gửi, thanh ghi = gửi", duoc: `${kq.status} readBack=${String(kq.readBackValue)}`, ms: t2 - t1, thanhGhi: `0 → ${sau}`, dat: kq.status === "acked_verified" && kq.readBackValue === v && sau === v });
      }
      // ── Ô 2: 251 ngoài 240..250 ──
      {
        const truoc = await docThanhGhi(o.endpoint, REG_SP);
        const t0 = Date.now();
        let duoc = "";
        try {
          await caller.request({ adapterId, tagKey: "sp", value: 251, lyDo: "bench R1a o 2", clientRequestId: randomUUID() });
          duoc = "THÀNH CÔNG (sai)";
        } catch (e) {
          duoc = maLoi(e);
        }
        const ms = Date.now() - t0;
        const sau = await docThanhGhi(o.endpoint, REG_SP);
        bang.push({ lap, o: "2", buoc: "request 251", mong: "OUT_OF_RANGE, thanh ghi không đổi", duoc, ms, thanhGhi: `${truoc} → ${sau}`, dat: duoc === "OUT_OF_RANGE" && sau === truoc });

        const n0 = await demLenh();
        const t3 = Date.now();
        const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sp", value: 251 }]));
        const ms2 = Date.now() - t3;
        const sau2 = await docThanhGhi(o.endpoint, REG_SP);
        const n1 = await demLenh();
        bang.push({ lap, o: "2", buoc: "dispatch AI 251", mong: "rejected OUT_OF_RANGE, command_log +1, thanh ghi không đổi", duoc: `${res.status} ${res.reason ?? ""} · command_log +${n1 - n0}`, ms: ms2, thanhGhi: `${truoc} → ${sau2}`, dat: res.status === "rejected" && res.reason === "OUT_OF_RANGE" && n1 - n0 === 1 && sau2 === truoc });
      }
      // ── Ô 3: máy LOCAL (kênh chế độ ≠ 2, đọc từ PLC qua vòng poll THẬT) ──
      {
        await ghiThanhGhi(o.endpoint, REG_CHE_DO, 1);
        const msThay = await doiDen(cheDoLa(1), 10_000);
        if (msThay === null) throw new Error("kênh chế độ không về 1 trong 10 s");
        const truoc = await docThanhGhi(o.endpoint, REG_SP);
        const t0 = Date.now();
        let duoc = "";
        try {
          await caller.request({ adapterId, tagKey: "sp", value: 244, lyDo: "bench R1a o 3", clientRequestId: randomUUID() });
          duoc = "THÀNH CÔNG (sai)";
        } catch (e) {
          duoc = maLoi(e);
        }
        const ms = Date.now() - t0;
        const sau = await docThanhGhi(o.endpoint, REG_SP);
        bang.push({ lap, o: "3", buoc: `request 244 (chế độ=1 thấy sau ${msThay} ms)`, mong: "MODE_LOCAL, thanh ghi không đổi", duoc, ms, thanhGhi: `${truoc} → ${sau}`, dat: duoc.startsWith("MODE_LOCAL") && sau === truoc });

        process.env.SCADA_CONG_CHE_DO_ENABLED = "true";
        try {
          const n0 = await demLenh();
          const t3 = Date.now();
          const res = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sp", value: 244 }]));
          const ms2 = Date.now() - t3;
          const sau2 = await docThanhGhi(o.endpoint, REG_SP);
          const n1 = await demLenh();
          bang.push({ lap, o: "3", buoc: "dispatch AI 244, SCADA_CONG_CHE_DO_ENABLED", mong: "rejected MODE_LOCAL, command_log +1, thanh ghi không đổi", duoc: `${res.status} ${res.reason ?? ""} · command_log +${n1 - n0}`, ms: ms2, thanhGhi: `${truoc} → ${sau2}`, dat: res.status === "rejected" && res.reason === "MODE_LOCAL" && n1 - n0 === 1 && sau2 === truoc });
        } finally {
          process.env.SCADA_CONG_CHE_DO_ENABLED = "false";
        }
        await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2);
        if ((await doiDen(cheDoLa(2), 10_000)) === null) throw new Error("kênh chế độ không về 2 trong 10 s");
      }
    }
    console.log(`[bench] số hàng telemetry đi qua bus (seam ghi, không ghi DB): ${soHangTelemetry}`);
  } finally {
    for (const f of don.reverse()) {
      try {
        await f();
      } catch (e) {
        console.warn(`[bench] dọn: ${(e as Error).message}`);
      }
    }
    try {
      const s = trangThaiContainer(o.container);
      if (banDau !== "running" && banDau !== "paused" && s !== "exited") docker("stop", o.container);
      if (banDau === "paused" && s === "running") docker("pause", o.container);
      console.log(`[bench] container trả về: ${trangThaiContainer(o.container)} (ban đầu: ${banDau})`);
    } catch (e) {
      console.warn(`[bench] không trả được trạng thái container: ${(e as Error).message}`);
    }
  }

  const out = ["| Lượt | Ô | Bước | Mong đợi | Đo được | ms | Thanh ghi (client riêng) | Kết quả |", "|---|---|---|---|---|---|---|---|"];
  for (const d of bang) out.push(`| ${d.lap} | ${d.o} | ${d.buoc} | ${d.mong} | ${d.duoc} | ${d.ms} | ${d.thanhGhi} | ${d.dat ? "ĐẠT" : "KHÔNG ĐẠT"} |`);
  console.log(out.join("\n"));
  const dat = bang.filter((d) => d.dat).length;
  console.log(`[bench] tổng: ${dat}/${bang.length} bước ĐẠT`);
  console.log(`[bench] JSON ${JSON.stringify(bang)}`);
  if (dat !== bang.length) process.exitCode = 2;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error("[bench] lỗi:", e);
    process.exit(1);
  },
);
