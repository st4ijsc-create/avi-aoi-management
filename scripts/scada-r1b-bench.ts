/**
 * SCADA R1b-1 Task 12 — bench nghiệm thu STOP HMI (`scadaCommands.dungMay`) trên OpenPLC (Docker) + safety PLC MÔ PHỎNG. CHẠY TAY, không vào CI.
 *
 *   npx tsx scripts/scada-r1b-bench.ts [--endpoint tcp://127.0.0.1:15502] [--container avi-openplc-bench] [--web http://127.0.0.1:18080]
 *       [--poll 1000] [--timeout 800] [--lap 3] [--start-neu-tat] [--khong-docker]
 *
 * Container DÙNG CHUNG (điều phối 2026-10-25): mặc định script KHÔNG khởi động container. Container không `running` hoặc Modbus không trả lời
 * ⇒ in "bench not run — container unavailable" kèm bằng chứng (trạng thái `docker inspect`, kết quả thăm dò) và thoát mã 3, không đụng gì.
 *   • `--start-neu-tat`: hành vi của bench R1a (start / unpause, bấm Start qua web, cuối cùng trả về đúng trạng thái ban đầu) — CHỈ khi
 *     người điều phối cho phép.
 *   • `--khong-docker`: bỏ mọi lệnh docker (chạy khô trên một endpoint Modbus bất kỳ, vd. máy chủ mô phỏng trong tiến trình) — KHÔNG phải
 *     bench OpenPLC; dùng để kiểm mã của script.
 *
 * Container: avi-openplc-bench chạy với --memory 1g (điều phối 2026-10-25 — máy dùng chung với llama-server); gỡ bằng
 *   docker update --memory 0 --memory-swap -1 avi-openplc-bench nếu cần.
 * Trong tiến trình, KHÔNG đụng :3000 / :8091 / GPU. CSDL = `_test` (suy từ DATABASE_URL của .env như vitest.setup.ts: chỉ đọc MỘT khoá đó,
 * thêm hậu tố `_test`; tên phải chứa "test" và khác DB dev, nếu không script dừng). Mọi cờ đặt TƯỜNG MINH trong tiến trình — `.env` không
 * được nạp; `OT_CONTROL_ENABLED=true` CHỈ ở đây (D9).
 *
 * Đường đo (đúng đường sản phẩm, khuôn scripts/scada-r1a-bench.ts):
 *   • otManager THẬT (`startOt`, legacy, cờ V2 bật) qua seam `setAdapterSource` trên ModbusDriver THẬT; vòng poll THẬT nuôi bộ đệm ⇒ kênh
 *     chế độ là tag poll trung tâm đọc từ PLC. Adapter cùng `id` với hàng `device_adapters` thật trên `_test`.
 *   • STOP HMI: `scadaCommands.dungMay` qua tRPC caller (admin tạo bằng `taoNguoiDungTest`; resolve hook thay "vitest" bằng shim `afterAll`).
 *     Ghim `stop_value` = 0 trên MỘT thanh ghi (`dung`, int mức 1, dải 0..100).
 *   • Đối chứng LOCAL: `scadaCommands.request` thường trên cùng kênh ở LOCAL ⇒ MODE_LOCAL (chứng minh cổng chế độ thấy máy LOCAL).
 *   • X2 (điều phối): `dispatch()` như tool AI lên tag int CHƯA khai scale 10 ở thanh ghi thứ ba: 25 ⇒ OFF_STEP (thanh ghi không đổi);
 *     30 ⇒ thanh ghi = 3 (số THÔ trên PLC thật).
 *   • Safety PLC giả trong tiến trình (khuôn scripts/safety-plc-bench.ts `selfServer`) + hàng `safety_plc_configs` THẬT theo trạm; giữ khoá
 *     seed độc quyền. Adapter có `commissioning_records` thật (OT_COMMISSIONING_REQUIRED bật như mặc định sản phẩm).
 *
 * Oracle độc lập: một client Modbus RIÊNG (kết nối mới mỗi lần) đọc thanh ghi TRƯỚC/SAU mỗi bước.
 *
 * BƯỚC 0 (bắt buộc): thanh ghi holding 0..17 (`holding:1..18`) có GIỮ giá trị ghi vào không (ghi FC06 một giá trị lạ, đọc lại +200/+1000/
 * +2500 ms, trả giá trị gốc). Cú pháp tag của sản phẩm là 1-BASED (`holding:N` = thanh ghi N-1).
 *
 * Trạng thái cũ của container được GHI và TRẢ LẠI: giá trị gốc của MỌI thanh ghi 0..17 đọc trước khi chạm (ghi lại cuối cùng) + trạng thái
 * running/paused/exited. Mọi hàng không-WORM đã tạo được dọn.
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
  startNeuTat: boolean;
  khongDocker: boolean;
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
    startNeuTat: argv.includes("--start-neu-tat"),
    khongDocker: argv.includes("--khong-docker"),
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

// ── Docker + Modbus (khuôn scripts/scada-r1a-bench.ts) ──
function docker(...args: string[]): void {
  execFileSync("docker", args, { stdio: "ignore", timeout: 60_000 });
}
function trangThaiContainer(name: string): string {
  try {
    return execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", name], { encoding: "utf8" }).trim();
  } catch (e) {
    return `khong-doc-duoc (${String((e as Error).message).split("\n")[0].slice(0, 120)})`;
  }
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
    if (!o.khongDocker && now - t0 >= bamStartSauMs && now - lanCuoi >= 2000) {
      lanCuoi = now;
      if (await batPlcQuaWeb(o.web)) daBam = true;
    }
    await ngu(100);
  }
}

/** Bước 0 — thanh ghi 0..17 nào GIỮ giá trị ghi vào (runtime không ghi đè mỗi chu kỳ)? */
async function kiemGiuGiaTri(ep: string): Promise<Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }>> {
  const out: Array<{ reg0: number; goc: number; ghi: number; doc: number[]; giu: boolean }> = [];
  for (let reg0 = 0; reg0 < 18; reg0++) {
    let goc = -1;
    const ghi = 12_000 + reg0;
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

/** Giá trị "đang chạy" của thanh ghi dừng trước mỗi STOP (khác ghim 0, trong dải 0..100). */
const DANG_CHAY = 77;

async function main(): Promise<void> {
  const o = docThamSo(process.argv.slice(2));
  const RUN = `r1bbench${process.pid}${Date.now().toString(36)}`;

  // ── container: GHI trạng thái; không running ⇒ KHÔNG chạy (mặc định) ──
  let banDau = "khong-docker";
  if (!o.khongDocker) {
    banDau = trangThaiContainer(o.container);
    let anh = "?";
    let ver = "?";
    try {
      anh = execFileSync("docker", ["inspect", "-f", "{{.Config.Image}} {{.Image}} created={{.Created}} exit={{.State.ExitCode}} finished={{.State.FinishedAt}}", o.container], { encoding: "utf8" }).trim();
      ver = execFileSync("docker", ["version", "-f", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
    } catch (e) {
      anh = `khong-doc-duoc (${String((e as Error).message).split("\n")[0].slice(0, 120)})`;
    }
    console.log(`[bench] container ${o.container}: trạng thái ban đầu=${banDau}; ${anh}; Docker engine ${ver}`);
    if (banDau !== "running" && !o.startNeuTat) {
      console.log(`[bench] bench not run — container unavailable (trạng thái "${banDau}", không --start-neu-tat: container dùng chung, không khởi động)`);
      process.exitCode = 3;
      return;
    }
  }
  if (banDau === "running" || o.khongDocker) {
    const traLoi = await thamDo(o.endpoint);
    console.log(`[bench] thăm dò Modbus ${o.endpoint}: ${traLoi ? "trả lời" : "KHÔNG trả lời"}`);
    if (!traLoi && !o.startNeuTat) {
      console.log(`[bench] bench not run — container unavailable (Modbus ${o.endpoint} không trả lời; trạng thái "${banDau}")`);
      process.exitCode = 3;
      return;
    }
  }

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
    SCADA_CONG_CHE_DO_ENABLED: "false", // cổng chế độ 3c vẫn chạy cho hmi.* — không nhờ cờ
    OT_CONTROL_ENABLED: "true", // D9: chỉ trong tiến trình bench
    AI_OT_CONTROL_ENABLED: "false",
    OT_COMMISSIONING_REQUIRED: "true",
    OT_SAFETY_PREFLIGHT_ENABLED: "true",
    SAFETY_PLC_ADAPTER_ENABLED: "true",
    OT_READBACK_ENABLED: "false", // HMI vẫn đọc lại (docLai bat_buoc)
    OT_CMD_SERIALIZE_ENABLED: "false",
    SEC_PLATFORM: "false",
    UNS_CMD_ACK_ENABLED: "false",
    INTERLOCK_AUTO_BLOCK_ENABLED: "false",
  };
  for (const [k, v] of Object.entries(CO)) process.env[k] = v;
  console.log(`[bench] DB: ${new URL(CO.DATABASE_URL).pathname.slice(1)} · cờ: ${Object.entries(CO).filter(([k]) => k !== "DATABASE_URL").map(([k, v]) => `${k}=${v}`).join(" ")}`);

  if (!o.khongDocker) {
    if (banDau === "paused") docker("unpause", o.container);
    else if (banDau !== "running") docker("start", o.container);
  }

  const bang: Dong[] = [];
  const don: Array<() => Promise<unknown>> = [];
  try {
    const daBam = await doiModbusTraLoi(o, 3000);
    console.log(`[bench] Modbus ${o.endpoint} trả lời${daBam ? " (đã bấm Start qua web)" : ""}`);

    // ── trạng thái cũ của MỌI thanh ghi sẽ chạm (0..17) — trả lại cuối cùng ──
    const goc: number[] = [];
    for (let r = 0; r < 18; r++) goc.push(await docThanhGhi(o.endpoint, r));
    console.log(`[bench] giá trị gốc holding reg 0..17: ${goc.join(",")}`);
    don.push(async () => {
      for (let r = 0; r < 18; r++) await ghiThanhGhi(o.endpoint, r, goc[r]);
      const sau: number[] = [];
      for (let r = 0; r < 18; r++) sau.push(await docThanhGhi(o.endpoint, r));
      console.log(`[bench] trả lại holding reg 0..17: ${sau.join(",")} ⇒ ${sau.every((v, i) => v === goc[i]) ? "KHỚP gốc" : "LỆCH gốc"}`);
    });

    // ── BƯỚC 0 ──
    const giu = await kiemGiuGiaTri(o.endpoint);
    for (const g of giu) console.log(`[bench] bước 0: holding reg ${g.reg0} (tag holding:${g.reg0 + 1}) gốc=${g.goc} ghi=${g.ghi} đọc@200/1000/2500ms=${g.doc.join("/")} ⇒ ${g.giu ? "GIỮ" : "KHÔNG GIỮ"}`);
    const dungDuoc = giu.filter((g) => g.giu);
    if (dungDuoc.length < 3) throw new Error(`bước 0: cần ≥ 3 thanh ghi giữ giá trị (dừng + chế độ + X2), có ${dungDuoc.length} — bench KHÔNG đo được`);
    const REG_DUNG = dungDuoc[0].reg0;
    const REG_CHE_DO = dungDuoc[1].reg0;
    const REG_SC10 = dungDuoc[2].reg0;
    console.log(`[bench] dùng: dừng (ghim 0) = reg ${REG_DUNG} (holding:${REG_DUNG + 1}), chế độ = reg ${REG_CHE_DO} (holding:${REG_CHE_DO + 1}), X2 int scale 10 = reg ${REG_SC10} (holding:${REG_SC10 + 1})`);
    await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2); // REMOTE
    await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
    await ghiThanhGhi(o.endpoint, REG_SC10, 0);

    // ── server ──
    await import("../server/services/ot"); // đăng ký driver
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

    const code = RUN;
    const [f] = await dung1(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    const [w] = await dung1(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
    const [l] = await dung1(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
    const [s] = await dung1(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
    const [m] = await dung1(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${code}, 'May bench R1b-1', 'AOI', true) RETURNING id`);
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
      VALUES (${maPlc}, 'R1b-1 bench safety PLC mo phong', 'generic', 'modbus', ${`tcp://127.0.0.1:${plc.port}`},
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
    const tagDung = `holding:${REG_DUNG + 1}`;
    const tagCheDo = `holding:${REG_CHE_DO + 1}`;
    const tagSc10 = `holding:${REG_SC10 + 1}`;
    await dung1(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", scale, writable, "isEnabled", channel_kind, display_name,
        write_min, write_max, write_step, actuation_level, stop_value, stop_pinned_by, stop_pinned_at)
      VALUES (${adapterId}, 'dung', ${tagDung}, 'int', 1, true, true, 'input_output'::scada_channel_kind, 'Dung bench (ghim 0)', 0, 100, 1, 1, '0'::jsonb, '1', now()),
             (${adapterId}, 'che_do', ${tagCheDo}, 'int', 1, false, true, 'input'::scada_channel_kind, 'Che do may', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
             (${adapterId}, 'sc10cu', ${tagSc10}, 'int', 10, true, true, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);
    await dung1(sql`INSERT INTO scada_kenh_che_do (machine_id, adapter_id, tag_key, gia_tri_remote, updated_by) VALUES (${machineId}, ${adapterId}, 'che_do', '2'::jsonb, 1)`);

    const admin = await taoNguoiDungTest("admin", "admin", { tienTo: "r1bbench", ts: RUN, ten: "R1b-1 bench admin" });
    don.push(() => dung1(sql`DELETE FROM ai_pending_actions WHERE "userId" = ${admin.id}`));
    don.push(() => donNguoiDungTest());
    const caller = scadaCommandsRouter.createCaller({ user: { id: admin.id, role: "admin", name: admin.name, twoFactorEnabled: admin.twoFactorEnabled === true } } as never);

    setAdapterSource(async () => [
      {
        adapterId,
        code: RUN,
        machineId,
        protocol: "modbus" as const,
        connection: { endpoint: o.endpoint, timeoutMs: o.timeoutMs, options: { unitId: 1, timeoutMs: o.timeoutMs } },
        pollIntervalMs: o.pollMs,
        tags: [
          { tagKey: "dung", address: tagDung, dataType: "int" as const },
          { tagKey: "che_do", address: tagCheDo, dataType: "int" as const },
          { tagKey: "sc10cu", address: tagSc10, dataType: "int" as const, scale: 10 },
        ],
        driver: createDriver("modbus"),
      } as never,
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

    /** STOP HMI một lần: thanh ghi dừng đặt về "đang chạy", bấm dungMay, đọc lại độc lập. */
    const stopHmi = async (lap: number, o2: string, nhan: string) => {
      await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
      const truoc = await docThanhGhi(o.endpoint, REG_DUNG);
      const n0 = await demLenh();
      const t0 = Date.now();
      let duoc = "";
      let dat = false;
      try {
        const kq = await caller.dungMay({ machineId, clientRequestId: randomUUID() });
        const r = kq.ketQua[0];
        duoc = `${r?.status} ok=${r?.ok}${r?.reason ? ` ${r.reason}` : ""} · ${kq.ketQua.length} adapter`;
        dat = kq.ketQua.length === 1 && r.status === "acked_verified" && r.ok === true && r.simulated === false;
      } catch (e) {
        duoc = `NÉM ${maLoi(e)}`;
      }
      const ms = Date.now() - t0;
      const sau = await docThanhGhi(o.endpoint, REG_DUNG);
      const n1 = await demLenh();
      bang.push({ lap, o: o2, buoc: nhan, mong: "acked_verified, thanh ghi dừng = ghim 0", duoc: `${duoc} · command_log +${n1 - n0}`, ms, thanhGhi: `${truoc} → ${sau}`, dat: dat && sau === 0 && truoc === DANG_CHAY });
    };

    for (let lap = 1; lap <= o.lap; lap++) {
      // ── S1: STOP HMI ở REMOTE ──
      await stopHmi(lap, "S1", "STOP HMI, máy REMOTE (chế độ = 2)");

      // ── S2: máy LOCAL (kênh chế độ ≠ 2, đọc từ PLC qua vòng poll THẬT) ──
      await ghiThanhGhi(o.endpoint, REG_CHE_DO, 1);
      const msThay = await doiDen(cheDoLa(1), 10_000);
      if (msThay === null) throw new Error("kênh chế độ không về 1 trong 10 s");
      {
        // đối chứng: lệnh ghi thường ở LOCAL bị cổng chế độ chặn
        await ghiThanhGhi(o.endpoint, REG_DUNG, DANG_CHAY);
        const truoc = await docThanhGhi(o.endpoint, REG_DUNG);
        const t0 = Date.now();
        let duoc = "";
        try {
          await caller.request({ adapterId, tagKey: "dung", value: 50, lyDo: "bench R1b-1 doi chung LOCAL", clientRequestId: randomUUID() });
          duoc = "THÀNH CÔNG (sai)";
        } catch (e) {
          duoc = maLoi(e);
        }
        const ms = Date.now() - t0;
        const sau = await docThanhGhi(o.endpoint, REG_DUNG);
        bang.push({ lap, o: "S2-ĐC", buoc: `request dung=50 ở LOCAL (chế độ=1 thấy sau ${msThay} ms)`, mong: "MODE_LOCAL, thanh ghi không đổi", duoc, ms, thanhGhi: `${truoc} → ${sau}`, dat: duoc.startsWith("MODE_LOCAL") && sau === truoc });
      }
      await stopHmi(lap, "S2", "STOP HMI, máy LOCAL (chế độ = 1)");
      await ghiThanhGhi(o.endpoint, REG_CHE_DO, 2);
      if ((await doiDen(cheDoLa(2), 10_000)) === null) throw new Error("kênh chế độ không về 2 trong 10 s");

      // ── X2: tag int CHƯA khai scale 10 — 25 ⇒ OFF_STEP; 30 ⇒ số thô 3 trên PLC ──
      {
        await ghiThanhGhi(o.endpoint, REG_SC10, 0);
        const n0 = await demLenh();
        const t0 = Date.now();
        const r25 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 25 }]));
        const ms = Date.now() - t0;
        const sau25 = await docThanhGhi(o.endpoint, REG_SC10);
        const n1 = await demLenh();
        const goiY = (r25.appError?.appParams as { goiY?: unknown } | undefined)?.goiY;
        bang.push({ lap, o: "X2", buoc: "dispatch AI sc10cu=25 (int chưa khai, scale 10)", mong: "rejected OFF_STEP goiY 30, command_log +1, thanh ghi không đổi", duoc: `${r25.status} ${r25.reason ?? ""} goiY=${String(goiY)} · command_log +${n1 - n0}`, ms, thanhGhi: `0 → ${sau25}`, dat: r25.status === "rejected" && r25.reason === "OFF_STEP" && goiY === 30 && n1 - n0 === 1 && sau25 === 0 });

        const t1 = Date.now();
        const r30 = await disp.dispatch(await lenhAi("set_param", [{ tagKey: "sc10cu", value: 30 }]));
        const ms2 = Date.now() - t1;
        const sau30 = await docThanhGhi(o.endpoint, REG_SC10);
        bang.push({ lap, o: "X2", buoc: "dispatch AI sc10cu=30", mong: "gửi, thanh ghi = số thô 3", duoc: `${r30.status} ok=${r30.ok}`, ms: ms2, thanhGhi: `0 → ${sau30}`, dat: r30.ok === true && r30.simulated === false && sau30 === 3 });
      }
    }
    console.log(`[bench] số hàng telemetry đi qua bus (seam ghi, không ghi DB): ${soHangTelemetry}`);
  } finally {
    for (const fn of don.reverse()) {
      try {
        await fn();
      } catch (e) {
        console.warn(`[bench] dọn: ${(e as Error).message}`);
      }
    }
    if (!o.khongDocker) {
      try {
        const s = trangThaiContainer(o.container);
        if (banDau !== "running" && banDau !== "paused" && s !== "exited") docker("stop", o.container);
        if (banDau === "paused" && s === "running") docker("pause", o.container);
        console.log(`[bench] container trả về: ${trangThaiContainer(o.container)} (ban đầu: ${banDau})`);
      } catch (e) {
        console.warn(`[bench] không trả được trạng thái container: ${(e as Error).message}`);
      }
    }
  }

  const out = ["| Lượt | Ô | Bước | Mong đợi | Đo được | ms | Thanh ghi (client riêng) | Kết quả |", "|---|---|---|---|---|---|---|---|"];
  for (const d of bang) out.push(`| ${d.lap} | ${d.o} | ${d.buoc} | ${d.mong} | ${d.duoc} | ${d.ms} | ${d.thanhGhi} | ${d.dat ? "ĐẠT" : "KHÔNG ĐẠT"} |`);
  console.log(out.join("\n"));
  const dat = bang.filter((d) => d.dat).length;
  console.log(`[bench] tổng: ${dat}/${bang.length} bước ĐẠT${o.khongDocker ? " (CHẠY KHÔ — không phải OpenPLC)" : ""}`);
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
