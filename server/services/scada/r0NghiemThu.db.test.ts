/**
 * SCADA R0 Task 12 — NGHIỆM THU R0 bằng stub CÓ KỊCH BẢN, ĐỒNG HỒ THẬT, trên CSDL `_test` THẬT.
 *
 * Toàn bộ đường sản phẩm chạy thật: otManager (nhánh legacy VÀ nhánh HA — `.env` dev đang bật HA) + StubDriver + vòng poll chung +
 * ingest.ts → bộ đệm giá trị hiện tại (`napTuOt`) + telemetryBus ghi `ot_telemetry` + trạng thái adapter ghi `device_adapters` +
 * `scadaDiag.danhSach` (tRPC caller, người dùng qua `taoNguoiDungTest`). Chỉ hai chỗ giả: bộ nạp adapter lọc đúng hàng của tệp này
 * (CSDL `_test` dùng chung) và hàng của suite khác nhận driver giả (không mở kết nối thật nào).
 *
 * "Rút cáp" có HAI kiểu (T12b): `tu-choi` = `simDatLoi({matKetNoi:true})` (cổng đóng/RST: isConnected lật false, đọc ném ngay) và
 * `treo` = `simDatLoi({treo:true})` (cáp rút SAU switch / PLC đóng băng: TCP nửa mở, isConnected VẪN true, mọi giao dịch quá hạn sau
 * timeoutMs, connect chờ tới hạn) — đường bench `docker pause` đã chứng minh là đường hỏng. "Cắm lại" = `simDatLoi({})`.
 * Adapter: `pollIntervalMs: 1000`, 18 tag, `connectionOptions.timeoutMs: 800` (như bench).
 *
 * Cổng (đúng hàng R0 của báo cáo; ngưỡng KHÔNG nới — đỏ ⇒ quay về task sở hữu):
 *   1. rút cáp ⇒ MỌI tag `bad` trong ≤ 2 chu kỳ poll (2000 ms), đo ở bộ đệm hiện tại;
 *   2. M10 hiện "mất kết nối" (`trangThai: "lost"`) trong ≤ 5 s, đo ở `scadaDiag.danhSach`;
 *   3. `device_adapters.status` trong DB: `error` khi mất, `connected` khi có lại — mỗi chiều ≤ 5 s;
 *   4. cắm lại ⇒ MỌI tag `good` trong ≤ 2 chu kỳ poll (2000 ms), đo ở bộ đệm hiện tại.
 *
 * Trước khi rút: liên kết đã ổn định 11 s (lần ghi DB cuối đã qua ≥ 6 s, quá cửa sổ điều tiết 5 s) — như một máy chạy bình thường.
 * (Rút trong < 5 s sau một lần ghi DB thì lần ghi 'error' bị điều tiết dời tới mốc 5 s — đo được 2,7–2,9 s, xem báo cáo nghiệm thu.) Mỗi lần đo là
 * vòng hỏi thật (bộ đệm mỗi 20 ms, danhSach/DB mỗi 100 ms) ⇒ số đo là CẬN TRÊN (chậm hơn thực tế tối đa một bước hỏi).
 *
 * CHỈ CHẠY KHI GỌI TƯỜNG MINH (T12b, phán quyết điều phối): không đặt biến ⇒ cả tệp bị bỏ qua (không dựng dữ liệu, không khởi động OT).
 *   Bash:       SCADA_R0_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r0NghiemThu.db.test.ts
 *   PowerShell: $env:SCADA_R0_NGHIEM_THU='1'; npx vitest run -c vitest.db.config.ts server/services/scada/r0NghiemThu.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";

const RUN = `r0nt${process.pid}${Date.now().toString(36)}`;
const myIds = new Set<number>();

// Chỉ "stub" chạy thật; hàng của suite khác nhận driver giả (loader thật dựng driver cho MỌI hàng bật trước khi lọc).
vi.mock("../ot/driverRegistry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/driverRegistry")>();
  const { createStubDriver } = await import("../ot/drivers/stubDriver");
  const gia = { protocol: "stub", isConnected: () => false } as never;
  return { ...real, createDriver: (p: string) => (p === "stub" ? createStubDriver() : gia) };
});
vi.mock("../ot/deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/deviceAdapter")>();
  return {
    ...real,
    loadEnabledAdapters: async () => (await real.loadEnabledAdapters()).filter((a) => myIds.has(a.adapterId)),
  };
});

// CHẨN ĐOÁN (không phải cổng, không đổi hành vi): vòng poll CHỜ từng lần ingest (`await onSample`) ⇒ một lần ghi telemetry chậm giữ
// tick và làm trễ phát hiện. Ghi lại mọi lần ingest > 300 ms (mốc bắt đầu, thời lượng) để tách "mã phát hiện chậm" khỏi "DB chậm".
const ingestCham = vi.hoisted(() => [] as Array<{ t: number; ms: number }>);
/** Chẩn đoán: vòng sự kiện bị nghẽn (nhịp 50 ms trễ > 300 ms) — mốc và độ trễ. */
const vongSuKienTre: Array<{ t: number; ms: number }> = [];
vi.mock("../ot/ingest", async (importOriginal) => {
  const real = await importOriginal<typeof import("../ot/ingest")>();
  const doThoiGian =
    <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
    async (...a: A): Promise<void> => {
      const t = Date.now();
      try {
        await fn(...a);
      } finally {
        const ms = Date.now() - t;
        if (ms > 300) ingestCham.push({ t, ms });
      }
    };
  return { ...real, ingestSample: doThoiGian(real.ingestSample), ingestSamples: doThoiGian(real.ingestSamples) };
});

import { getDb } from "../../db/connection";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Caller = ReturnType<(typeof import("../../routers/scadaDiagRouter"))["scadaDiagRouter"]["createCaller"]>;

const POLL_MS = 1000;
const SO_TAG = 18;
const TIMEOUT_MS = 800;
const NGUONG = { cong1: 2 * POLL_MS, cong2: 5000, cong3: 5000, cong4: 2 * POLL_MS } as const;
/** Hạn mỗi phép đo (đủ xa mọi ngưỡng; không đạt ⇒ Infinity ⇒ cổng đỏ). */
const HAN_DO_MS = 8000;
const TAG_KEYS = Array.from({ length: SO_TAG }, (_, i) => `r${String(i).padStart(2, "0")}`);

let db: Db;
let admin!: Caller;
let ot: typeof import("../ot/otManager");
let boDem: typeof import("./boDemHienTai");
let stub: typeof import("../ot/drivers/stubDriver");
let tt: typeof import("../ot/trangThaiAdapter");
let factoryCode = "";
let machineId = 0;
const adapterIds: number[] = [];
const adapterCodes: string[] = [];

async function dung(q: ReturnType<typeof sql>): Promise<any[]> {
  return (await db.execute(q)) as unknown as any[];
}

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hỏi `dk` mỗi `buocMs` tới khi đúng; trả ms kể từ `t0` lúc lần hỏi ĐẦU TIÊN đúng, hoặc Infinity nếu quá `hanMs`. */
async function doDen(t0: number, dk: () => boolean | Promise<boolean>, buocMs: number, hanMs = 15_000): Promise<number> {
  for (;;) {
    let dung = false;
    try {
      dung = await dk();
    } catch {
      dung = false;
    }
    const now = Date.now();
    if (dung) return now - t0;
    if (now - t0 > hanMs) return Number.POSITIVE_INFINITY;
    await ngu(buocMs);
  }
}

const moiTag = (adapterId: number, q: "good" | "bad") =>
  TAG_KEYS.every((k) => {
    const g = boDem.layGiaTri(adapterId, k);
    return !!g && g.q === q && (q === "good" ? !g.stale && typeof g.v === "number" : g.reason === "comm_lost");
  });
const trangThaiM10 = async (adapterId: number) => (await admin.danhSach()).find((r) => r.adapterId === adapterId)?.trangThai;
const trangThaiDb = async (adapterId: number) =>
  String((await dung(sql`SELECT status FROM device_adapters WHERE id = ${adapterId}`))[0]?.status ?? "");

interface KetQua {
  cong1Ms: number;
  cong2Ms: number;
  cong3MatMs: number;
  cong3CoLaiMs: number;
  cong4Ms: number;
  /** `device_adapters.status` ngay trước khi rút (liên kết đã ổn định ≥ 6 s) — thuộc cổng 3 ("DB khớp"). */
  dbTruocRut: string;
  /** Chẩn đoán (không phải cổng): RAM báo lại `connected` sau khi cắm lại — tách thời gian NỐI LẠI khỏi chu kỳ đọc đầu tiên. */
  noiLaiMs: number;
  /** Chẩn đoán: các lần ingest > 300 ms từ rút − 3 s, dạng "bắt đầu(ms so với lúc rút)+thời lượng". */
  ingestCham?: string[];
  /** Chẩn đoán: nghẽn vòng sự kiện > 300 ms từ rút − 3 s, dạng "mốc(ms so với lúc rút)+độ trễ". */
  vongSuKienTre?: string[];
}

async function seedAdapter(code: string): Promise<number> {
  const [r] = await dung(sql`INSERT INTO device_adapters ("machineId", code, name, protocol, endpoint, "pollIntervalMs", "isEnabled", status, "connectionOptions")
    VALUES (${machineId}, ${code}, ${code}, 'stub', ${"stub://" + code}, ${POLL_MS}, true, 'disabled', ${JSON.stringify({ timeoutMs: TIMEOUT_MS })}::jsonb) RETURNING id`);
  const id = Number(r.id);
  for (const k of TAG_KEYS) {
    await dung(sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", "isEnabled") VALUES (${id}, ${k}, ${"holding:" + k.slice(1)}, 'float', true)`);
  }
  adapterIds.push(id);
  adapterCodes.push(code);
  return id;
}

/** T12b fix round 1 (phán quyết 4) — lưới nghiệm thu chỉ chạy khi gọi TƯỜNG MINH (dài ~2 phút, đồng hồ thật, CSDL _test dùng chung). */
const CHAY_NGHIEM_THU = process.env.SCADA_R0_NGHIEM_THU === "1";

describe.skipIf(!CHAY_NGHIEM_THU)("nghiệm thu R0 (SCADA_R0_NGHIEM_THU=1)", () => {
  let nhipTre: ReturnType<typeof setInterval> | null = null;
  beforeAll(async () => {
    let truoc = Date.now();
    nhipTre = setInterval(() => {
      const now = Date.now();
      if (now - truoc > 350) vongSuKienTre.push({ t: truoc, ms: now - truoc - 50 });
      truoc = now;
    }, 50);
    vi.stubEnv("OT_GATEWAY_ENABLED", "true");
    vi.stubEnv("OT_LEGACY_RECONNECT_MS", "5000"); // mặc định sản phẩm
    vi.stubEnv("OT_STORE_FORWARD_ENABLED", "false");
    vi.stubEnv("OT_POLL_BATCH_ENABLED", "false");
    vi.stubEnv("OT_TAG_DEADBAND_ENABLED", "false");
    // năm cờ R0 (trừ Lab — không cần cho nghiệm thu)
    vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", "true");
    vi.stubEnv("OT_GHI_TRANG_THAI_ADAPTER_ENABLED", "true");
    vi.stubEnv("SCADA_LIVE_CACHE_ENABLED", "true");
    vi.stubEnv("SCADA_SOCKET_ENABLED", "true");
    vi.stubEnv("SCADA_LAB_ENABLED", "false");
    const d = await getDb();
    if (!d) throw new Error("test cần CSDL _test");
    db = d;
    ot = await import("../ot/otManager");
    boDem = await import("./boDemHienTai");
    stub = await import("../ot/drivers/stubDriver");
    tt = await import("../ot/trangThaiAdapter");
    const { scadaDiagRouter } = await import("../../routers/scadaDiagRouter");

    factoryCode = RUN;
    const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${RUN}, ${RUN + " f"}) RETURNING id`);
    const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${RUN}, ${RUN + " w"}) RETURNING id`);
    const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${RUN}, ${RUN + " l"}) RETURNING id`);
    const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${RUN}, ${RUN + " s"}) RETURNING id`);
    const [m] = await dung(
      sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${s.id}, ${RUN}, ${RUN + " m"}, 'AOI', true) RETURNING id`,
    );
    machineId = Number(m.id);
    const u = await taoNguoiDungTest("ad", "admin", { tienTo: "r0nt", ts: RUN, ten: "R0NT admin" });
    admin = scadaDiagRouter.createCaller({ user: { id: u.id, role: "admin", name: u.name, twoFactorEnabled: true } } as never);
  }, 60_000);

  afterAll(async () => {
    if (nhipTre) clearInterval(nhipTre);
    try {
      await ot?.stopOt();
    } catch {
      /* bỏ qua */
    }
    vi.unstubAllEnvs();
    if (!db) return;
    try {
      for (const code of adapterCodes) await dung(sql`DELETE FROM ot_telemetry WHERE "deviceId" = ${code}`);
      if (adapterIds.length > 0) {
        const ids = sql.join(
          adapterIds.map((i) => sql`${i}`),
          sql`, `,
        );
        await dung(sql`DELETE FROM device_tags WHERE "adapterId" IN (${ids})`);
        await dung(sql`DELETE FROM device_adapters WHERE id IN (${ids})`);
      }
      await dung(sql`DELETE FROM machines WHERE code = ${factoryCode}`);
      await dung(sql`DELETE FROM stations WHERE code = ${factoryCode}`);
      await dung(sql`DELETE FROM production_lines WHERE code = ${factoryCode}`);
      await dung(sql`DELETE FROM workshops WHERE code = ${factoryCode}`);
      await dung(sql`DELETE FROM factories WHERE code = ${factoryCode}`);
    } catch (e) {
      console.warn("[r0nt] dọn dữ liệu:", (e as Error).message);
    }
  }, 60_000);

  describe.each([
    ["legacy", "false", "tu-choi"],
    ["HA (cấu hình .env dev)", "true", "tu-choi"],
    ["legacy", "false", "treo"],
    ["HA (cấu hình .env dev)", "true", "treo"],
  ] as const)("nghiệm thu R0 — stub kịch bản, nhánh %s (HA=%s), rút kiểu %s", (nhan, haFlag, kieu) => {
    const kq: KetQua = { cong1Ms: NaN, cong2Ms: NaN, cong3MatMs: NaN, cong3CoLaiMs: NaN, cong4Ms: NaN, dbTruocRut: "", noiLaiMs: NaN };
    let id = 0;

    beforeAll(async () => {
      vi.stubEnv("OT_CONN_HA_ENABLED", haFlag);
      const code = `${RUN}-${haFlag === "true" ? "ha" : "lg"}-${kieu === "treo" ? "tr" : "tc"}`;
      id = await seedAdapter(code);
      myIds.clear();
      myIds.add(id);
      expect(await ot.startOt()).toBe(true);

      // Ổn định: connected (RAM), 18 tag tốt và tươi; rồi giữ liên kết 11 s — lần ghi DB cuối của lúc khởi động ('connected', có thể là
      // lần ghi trễ ở mốc 5 s của điều tiết) đã qua ≥ 6 s, như một máy đang chạy bình thường. Trạng thái DB KHÔNG chờ ở đây — nó là việc
      // của cổng 3 (đột biến tắt cờ ghi trạng thái phải làm đỏ CỔNG 3, không làm hỏng phần dựng).
      await vi.waitFor(
        () => {
          expect(tt.layTrangThaiAdapter(id)?.tt).toBe("connected");
          expect(moiTag(id, "good")).toBe(true);
        },
        { timeout: 15_000, interval: 100 },
      );
      await ngu(11_000);
      kq.dbTruocRut = await trangThaiDb(id);
      const may = stub.layStubDangChay(`stub://${code}`);
      if (!may) throw new Error("không tìm thấy instance stub đang chạy");

      // ── RÚT CÁP ──
      const tRut = Date.now();
      may.simDatLoi(kieu === "treo" ? { treo: true } : { matKetNoi: true });
      [kq.cong1Ms, kq.cong2Ms, kq.cong3MatMs] = await Promise.all([
        doDen(tRut, () => moiTag(id, "bad"), 20, HAN_DO_MS),
        doDen(tRut, async () => (await trangThaiM10(id)) === "lost", 100, HAN_DO_MS),
        doDen(tRut, async () => (await trangThaiDb(id)) === "error", 100, HAN_DO_MS),
      ]);
      // Cáp ngoài thêm 3 s (một lần rút cáp thật không bao giờ ngắn hơn thời gian người ta cúi xuống cắm lại).
      await ngu(3000);

      // ── CẮM LẠI ──
      const tCam = Date.now();
      may.simDatLoi({});
      [kq.cong4Ms, kq.cong3CoLaiMs, kq.noiLaiMs] = await Promise.all([
        doDen(tCam, () => moiTag(id, "good"), 20, HAN_DO_MS),
        doDen(tCam, async () => (await trangThaiDb(id)) === "connected", 100, HAN_DO_MS),
        doDen(tCam, () => tt.layTrangThaiAdapter(id)?.tt === "connected", 10, HAN_DO_MS),
      ]);
      kq.ingestCham = ingestCham.filter((x) => x.t >= tRut - 3000).map((x) => `${x.t - tRut}+${x.ms}`);
      kq.vongSuKienTre = vongSuKienTre.filter((x) => x.t >= tRut - 3000).map((x) => `${x.t - tRut}+${x.ms}`);
      console.log(`[r0nt] ${nhan} / ${kieu}: ${JSON.stringify(kq)}`);
    }, 120_000);

    afterAll(async () => {
      await ot.stopOt(); // kể cả khi phần dựng đỏ: nhánh sau phải khởi động từ trạng thái sạch
    }, 30_000);

    it(`cổng 1 — rút cáp ⇒ mọi tag bad (comm_lost) trong ≤ ${NGUONG.cong1} ms (bộ đệm hiện tại)`, () => {
      expect(kq.cong1Ms, `đo được ${kq.cong1Ms} ms`).toBeLessThanOrEqual(NGUONG.cong1);
    });

    it(`cổng 2 — scadaDiag.danhSach báo "lost" trong ≤ ${NGUONG.cong2} ms`, () => {
      expect(kq.cong2Ms, `đo được ${kq.cong2Ms} ms`).toBeLessThanOrEqual(NGUONG.cong2);
    });

    it(`cổng 3 — device_adapters.status: 'error' ≤ ${NGUONG.cong3} ms sau khi rút, 'connected' ≤ ${NGUONG.cong3} ms sau khi cắm lại`, () => {
      expect(kq.dbTruocRut, "trước khi rút (liên kết ổn định 11 s)").toBe("connected");
      expect(kq.cong3MatMs, `mất: đo được ${kq.cong3MatMs} ms`).toBeLessThanOrEqual(NGUONG.cong3);
      expect(kq.cong3CoLaiMs, `có lại: đo được ${kq.cong3CoLaiMs} ms`).toBeLessThanOrEqual(NGUONG.cong3);
    });

    it(`cổng 4 — cắm lại ⇒ mọi tag good (tươi) trong ≤ ${NGUONG.cong4} ms (bộ đệm hiện tại)`, () => {
      expect(kq.cong4Ms, `đo được ${kq.cong4Ms} ms`).toBeLessThanOrEqual(NGUONG.cong4);
    });
  });
});
