/**
 * server/db/walCayV2PhatLai.db.test.ts
 *
 * Doc 2026-08-29 (WAL cho cây v2.0, Task 2, §QĐ-WAL-B,
 * `.superpowers/sdd/2026-08-29-aoi-wal-cho-cay-v2/task-2-brief.md`) — lưới DB THẬT
 * (KHÔNG mock `../db`) cho ĐƯỜNG PHÁT LẠI của WAL cây v2.0.
 *
 * ── Bối cảnh (đọc TRƯỚC) ─────────────────────────────────────────────────────────────
 * Task 1 (commit `deb6b8b2`) cho payload v2.0 XẾP HÀNG được khi DB chớp nháy (khoá gửi
 * riêng `dungKhoaGuiTheoHinhDang`, điều phối theo hình dạng — không đụng độ với v1.x khi
 * `serialNumber` rỗng). NHƯNG mục xếp hàng xong KHÔNG RÚT ĐƯỢC: nó vẫn phát lại qua
 * `processFn` của v1.x (`processInspectionSubmission`) — đường đó không hiểu `surfaces`,
 * sẽ ghi được một header (measurements rỗng) rồi ÂM THẦM bỏ mất cả ba cấp cây. An toàn
 * hơn mất trắng (Task 1) nhưng chưa dùng được. Task 2 (file này canh) nối
 * `ensureInspectionWalWired` (`server/routers/machineApiRouters.ts`) để phát lại v2.0 đi
 * ĐÚNG chuỗi của nó: `dichCayKetQua` → `persistInspectionAtomic({cay})` — xem
 * `submitInspectionTreeV2`/`inspectionAlreadyPersistedV2` cùng file đó.
 *
 * ── BỐN MỆNH ĐỀ canh (task-2-brief.md) ──────────────────────────────────────────────
 *   1. DB lỗi TẠM THỜI ⇒ máy nhận `queued:true`, và 0 bo trong DB.
 *   2. DB hồi phục + phát lại ⇒ ĐÚNG 1 bo, đủ BA CẤP CÂY (`inspection_surfaces/
 *      positions/captures` đúng số hàng) — đây LÀ chỗ chứng minh phát lại đi ĐÚNG đường
 *      v2.0, không phải v1.x (đột biến BẮT BUỘC #2 ép qua v1.x phải làm mệnh đề này ĐỎ).
 *   3. Máy gửi lại TRONG LÚC đang xếp hàng ⇒ vẫn ĐÚNG 1 bo (khử trùng ở HÀNG ĐỢI —
 *      `queuedKeys`/`bufferSubmission`).
 *   4. Payload CŨNG ĐÃ VÀO LIVE rồi mới phát lại ⇒ vẫn ĐÚNG 1 bo (khử trùng ở BACKFILL —
 *      ledger khoá-đã-áp-dụng `inspection_idempotency_keys` + `inspectionAlreadyPersistedV2`
 *      + phép CLAIM trong `persistInspectionAtomic`; đột biến BẮT BUỘC #1 bỏ
 *      `idempotencyKey` khi ghi phải làm mệnh đề này ĐỎ).
 * ⚠ Mệnh đề 3 và 4 là HAI ĐƯỜNG ĐÔI KHÁC NHAU — KHÔNG gộp một ca: (3) hai bản sao CÙNG
 * nằm trong HÀNG ĐỢI (chưa bản nào tới DB); (4) MỘT bản trong hàng đợi, MỘT bản ĐÃ Ở DB.
 * Payload mệnh đề 4 cố ý dùng `serialNumber` RỖNG — `uq_inspections_machine_serial_time`
 * (migration 0272) là chỉ mục RIÊNG PHẦN loại trừ serial rỗng, nên với payload này khoá
 * `idempotencyKey`/ledger LÀ HÀNG RÀO DUY NHẤT (không có hàng rào natural-key thứ hai
 * "vô tình" che giấu một lỗ ledger — xem đột biến #1).
 *
 * ── Giả lập "DB lỗi tạm thời" trên DB THẬT ──────────────────────────────────────────
 * KHÔNG `vi.mock("../db")` (sẽ tự động mock TOÀN BỘ export → không còn là lưới DB thật).
 * Thay vào đó `vi.spyOn(db, "persistInspectionAtomic")` — vá ĐÚNG một/một-vài lời gọi
 * (ném `Error` thường, KHÔNG phải `TRPCError` ⇒ `isPermanentSubmitError` phân loại TẠM
 * THỜI, giống hệt một kết nối DB chớp nháy thật) trên CHÍNH module `./index` mà
 * `machineApiRouters.ts` gọi qua `import * as db from "../db"` — cùng đường dẫn tuyệt đối
 * `server/db/index.ts`, cùng namespace object. Mọi lời gọi KHÁC (auth, tenant resolution,
 * heartbeat, SELECT nghiệm thu, và chính backfill sau khi phục hồi) vẫn chạm CSDL thật —
 * không giả một bước nào khác ngoài lời gọi bị vá.
 *
 * ── Đua (race) giữa "rút cơ hội" (opportunistic drain) và backfill tường minh ───────
 * Nhánh LIVE v2.0 (Task 2) nay tự rút hàng đợi (fire-and-forget, `void backfillInspections()
 * .catch(...)`) ngay khi nó vừa chứng minh DB sống — GIỐNG hệt nhánh v1.x đã làm từ trước.
 * Mệnh đề 4 (Bước 2) kích hoạt đúng tình huống đó: gọi `backfillInspections()` tường minh
 * ngay sau có thể chỉ thấy hàng đợi ĐÃ RỖNG (vì bản rút cơ hội chạy trước, không đồng bộ)
 * — `bf.drained===0` không phải bằng chứng "không xử lý", mà có thể là "xử lý rồi qua
 * đường khác". Vì vậy mệnh đề 4 KHÔNG chỉ đọc giá trị trả về của MỘT lời gọi
 * `backfillInspections()`, mà `choDenKhiRong()` (đợi tới khi `bufferedInspectionCount()===0`
 * hoặc hết giờ) rồi mới SELECT — bằng chứng đọc thẳng từ DB, không phụ thuộc AI rút.
 *
 * ── WORM — để lại bao nhiêu hàng (đọc TRƯỚC khi sửa file này) ──────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) ⇒ vai chạy lưới
 * này KHÔNG xoá được hàng đã ghi. File này vì vậy KHÔNG viết
 * `DELETE FROM product_inspections … .catch(() => {})` (đã đo 32 file test khác làm đúng
 * thế và tất cả là NO-OP CÂM — xem MEMORY/`ingestCayKetQua.db.test.ts`). MỘT lượt chạy
 * ĐẦY ĐỦ file này để lại ĐÚNG BA hàng `product_inspections` vĩnh viễn: mệnh đề 1+2 (MỘT
 * board — xếp hàng ở mệnh đề 1, ghi thật khi phát lại ở mệnh đề 2) · mệnh đề 3 (MỘT
 * board) · mệnh đề 4 (MỘT board — bản LIVE; bản phát lại bị khử trùng, KHÔNG tạo hàng
 * thứ hai — đúng cái đang canh). Factory/workshop/line/station/machine dựng ở `beforeAll`
 * bị khoá theo (FK RESTRICT từ ba hàng trên), cũng để lại vĩnh viễn. Ba bảng cây
 * (`inspection_surfaces/positions/captures`) KHÔNG WORM (`avi_app` CÓ quyền DELETE,
 * migration 0339) — dọn sạch trong `afterAll` cho mọi board có cây thật.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import os from "node:os";
import path from "node:path";
import * as db from "./index";
import { machineApiRouter, dungKhoaKhuTrungV2 } from "../routers/machineApiRouters";
import {
  bufferedInspectionCount,
  backfillInspections,
  _resetInspectionStoreForward,
} from "../services/inspection/inspectionStoreForward";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";
import type { TrpcContext } from "../_core/context";

const DB_URL = process.env.DATABASE_URL;
const RUN = `WCV${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `plain-${RUN}`;

process.env.MACHINE_SHARED_KEY_ALLOWED = "true"; // đường plaintext machines.apiKey — mặc định "deny" từ mig 0334
process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
process.env.INSPECTION_STORE_FORWARD_FILE = path.join(os.tmpdir(), `wal-cay-v2-${RUN}.jsonl`);

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0 };
/** inspectionId của mọi board CÓ cây thật — dọn ba bảng cây trong `afterAll`. */
const boardIdsCoCay: number[] = [];

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

function caller() {
  return machineApiRouter.createCaller(ctx());
}

type KetQuaSubmit = {
  success: true;
  inspectionId: number | null;
  duplicate?: boolean;
  queued?: boolean;
  submissionId?: string;
};

/** Đếm `product_inspections` theo `machineProductIndex` — khoá đếm DUY NHẤT của file
 * này (mệnh đề 4 dùng `serialNumber` RỖNG có chủ đích, không đếm được theo serial). */
async function demTheoIndex(idx: number): Promise<number> {
  const r = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM product_inspections
    WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${idx}`;
  return r[0].c;
}

/** Đếm số hàng cây theo `inspectionId`. */
async function demCay(inspectionId: number): Promise<{ surfaces: number; positions: number; captures: number }> {
  const [s] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_surfaces WHERE "inspectionId" = ${inspectionId}`;
  const [p] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_positions WHERE "inspectionId" = ${inspectionId}`;
  const [c] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_captures WHERE "inspectionId" = ${inspectionId}`;
  return { surfaces: s.c, positions: p.c, captures: c.c };
}

/** Đợi tới khi hàng đợi WAL rỗng (hoặc hết giờ) — dọn đường đua giữa "rút cơ hội"
 * (fire-and-forget) và backfill tường minh (xem docblock đầu file). */
async function choDenKhiRong(timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (bufferedInspectionCount() > 0) {
    await backfillInspections();
    if (bufferedInspectionCount() === 0) return;
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Payload cây v2.0 hợp lệ — 1 surface/1 position/1 capture/1 component, TOÀN OK.
 * `idx` gắn vào `machineProductIndex` (khoá đếm) và vào `productId`/`startedAt` (một
 * phần khoá khử trùng — mỗi board "khác nhau" phải khác Ở ĐÓ, không phải chỉ ở index). */
function payloadCay(idx: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  const p = mauHopLe();
  delete p.productModel; // tránh lượt tra getProductModelByCode không cần thiết cho lưới này
  p.apiKey = API_KEY;
  p.machineProductIndex = idx;
  p.identity = { ...p.identity, station: `${RUN}-ST`, machine: `${RUN}-MC`, line: `${RUN}-LN` };
  p.productId = `${RUN}-PROD-${idx}`;
  p.serialNumber = `${RUN}-SN-${idx}`;
  p.overallResult = "OK";
  p.ntf = false;
  p.startedAt = `2026-08-29T${String((idx % 20) + 1).padStart(2, "0")}:00:00.000`;
  p.completedAt = `2026-08-29T${String((idx % 20) + 1).padStart(2, "0")}:00:05.000`;
  p.summary = {
    surfaces: { total: 1, pass: 1, ng: 0, ntf: 0 },
    positions: { total: 1, pass: 1, ng: 0, ntf: 0 },
    captures: { total: 1, pass: 1, ng: 0, ntf: 0 },
    components: { total: 1, pass: 1, ng: 0, ntf: 0 },
  };
  p.surfaces = [{
    name: "TOP", result: "OK", ntf: false,
    positions: [{
      positionId: "P01", positionNumber: 1, result: "OK", ntf: false,
      captures: [{
        captureId: `${RUN}-C${idx}`, captureName: "Default", index: 0, result: "OK", ntf: false,
        components: [{
          componentId: `${RUN}-COMP${idx}`, componentName: "R12",
          result: "OK", ntf: false, value: "10", lowerLimit: "9", upperLimit: "11",
        }],
      }],
    }],
  }];
  return { ...p, ...over };
}

describe.skipIf(!DB_URL)("WAL cây v2.0 — phát lại ĐÚNG ĐƯỜNG + đúng MỘT LẦN trên DB THẬT (Task 2, §QĐ-WAL-B)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'WCV factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'WCV ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'WCV line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'WCV station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${"M-" + RUN}, 'WCV machine', 'AOI', true, ${API_KEY}) RETURNING id`);

    _resetInspectionStoreForward();
  });

  afterAll(async () => {
    if (!sql) return;
    if (boardIdsCoCay.length > 0) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ANY(${boardIdsCoCay})`;
    }
    // ⚠ product_inspections LÀ WORM — CỐ Ý ĐỂ LẠI ba hàng board (xem docblock đầu file).
    // KHÔNG viết DELETE FROM product_inspections rồi .catch(() => {}) ở đây.
    await sql.end({ timeout: 5 });
  });

  it("cầu chì — nghiệm thu chạy bằng vai avi_app, KHÔNG phải superuser/bypass RLS", async () => {
    const [role] = await sql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.who).toBe("avi_app");
    expect(role.rolsuper, "chạy bằng superuser ⇒ WORM không có ý nghĩa gì").toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  // ══ Mệnh đề 1 + 2 ═══════════════════════════════════════════════════════════════════
  describe("mệnh đề 1 — DB lỗi tạm thời ⇒ queued:true, 0 bo · mệnh đề 2 — hồi phục + phát lại ⇒ đúng 1 bo, đủ ba cấp cây (ĐÚNG đường v2.0)", () => {
    const IDX = 1;

    it("mệnh đề 1 — máy nhận queued:true, KHÔNG hàng nào lọt vào DB", async () => {
      expect(await demTheoIndex(IDX)).toBe(0);

      const spy = vi.spyOn(db, "persistInspectionAtomic").mockImplementationOnce(async () => {
        throw new Error(`[test] giả lập CSDL chớp nháy (mệnh đề 1, IDX=${IDX})`);
      });
      let r: KetQuaSubmit;
      try {
        r = (await caller().submitInspection(payloadCay(IDX))) as unknown as KetQuaSubmit;
      } finally {
        spy.mockRestore();
      }
      expect(r.success).toBe(true);
      expect(r.queued, `phản hồi phải khai queued:true — nguyên văn: ${JSON.stringify(r)}`).toBe(true);
      expect(r.inspectionId).toBeNull();
      expect(r.submissionId).toBeTruthy();

      expect(await demTheoIndex(IDX), "DB lỗi tạm thời KHÔNG được để lọt một hàng nào vào DB").toBe(0);
    });

    it("mệnh đề 2 — backfill phát lại ⇒ đúng 1 bo, đủ BA CẤP CÂY — bằng chứng phát lại đi ĐÚNG đường v2.0", async () => {
      const bf = await backfillInspections();
      expect(bf.drained, `backfill phải rút được mục đã xếp hàng ở mệnh đề 1 — nguyên văn: ${JSON.stringify(bf)}`).toBe(1);

      expect(await demTheoIndex(IDX)).toBe(1);

      const [row] = await sql<{ id: number; overallResult: string }[]>`
        SELECT id, "overallResult" FROM product_inspections
        WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${IDX}`;
      expect(row, "không tìm thấy board — backfill không ghi tới DB thật").toBeTruthy();
      expect(row.overallResult).toBe("OK");
      boardIdsCoCay.push(row.id);

      const dem = await demCay(row.id);
      expect(
        dem,
        "đủ ba cấp cây — CHỈ đường v2.0 (dichCayKetQua → persistInspectionAtomic({cay})) ghi được ba bảng này; " +
          "processInspectionSubmission (v1.x) không biết `surfaces` nên sẽ để lại {0,0,0}",
      ).toEqual({ surfaces: 1, positions: 1, captures: 1 });
    });
  });

  // ══ Mệnh đề 3 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 3 — máy gửi lại TRONG LÚC đang xếp hàng ⇒ vẫn đúng 1 bo (khử trùng ở HÀNG ĐỢI)", () => {
    const IDX = 3;

    it("hai lượt gửi CÙNG payload trong lúc DB còn lỗi ⇒ CÙNG submissionId; sau khi hồi phục CHỈ MỘT bo", async () => {
      expect(await demTheoIndex(IDX)).toBe(0);
      const payload = payloadCay(IDX);

      const spy = vi.spyOn(db, "persistInspectionAtomic").mockImplementation(async () => {
        throw new Error(`[test] giả lập CSDL còn lỗi (mệnh đề 3, IDX=${IDX})`);
      });
      let r1: KetQuaSubmit, r2: KetQuaSubmit;
      try {
        r1 = (await caller().submitInspection(structuredClone(payload))) as unknown as KetQuaSubmit;
        // Máy gửi lại — CÙNG payload — TRONG LÚC bản đầu VẪN còn nằm trong hàng đợi.
        r2 = (await caller().submitInspection(structuredClone(payload))) as unknown as KetQuaSubmit;
      } finally {
        spy.mockRestore();
      }
      expect(r1.queued).toBe(true);
      expect(r2.queued).toBe(true);
      expect(r2.submissionId, "lượt gửi lại lúc đang xếp hàng phải khử trùng NGAY Ở HÀNG ĐỢI — cùng submissionId").toBe(
        r1.submissionId,
      );

      expect(await demTheoIndex(IDX), "trong lúc còn xếp hàng — chưa hàng nào tới DB").toBe(0);

      const bf = await backfillInspections();
      expect(bf.drained, `nguyên văn: ${JSON.stringify(bf)}`).toBe(1);

      expect(await demTheoIndex(IDX), "hai lượt gửi lúc xếp hàng không được tạo hai hàng").toBe(1);

      const [row] = await sql<{ id: number }[]>`
        SELECT id FROM product_inspections WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${IDX}`;
      boardIdsCoCay.push(row.id);
    });
  });

  // ══ Mệnh đề 4 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 4 — payload CŨNG ĐÃ VÀO LIVE rồi mới phát lại ⇒ vẫn đúng 1 bo (ledger khoá-đã-áp-dụng + kiểm tồn tại trên DB)", () => {
    const IDX = 4;

    it("bo landed LIVE trong lúc bản sao vẫn còn trong hàng đợi ⇒ backfill khử trùng, KHÔNG tạo hàng thứ hai", async () => {
      expect(await demTheoIndex(IDX)).toBe(0);
      // ⚠ serialNumber RỖNG cố ý — uq_inspections_machine_serial_time (0272) loại trừ serial
      // rỗng, nên với payload này CHỈ CÒN idempotencyKey/ledger là hàng rào (xem docblock).
      const payload = payloadCay(IDX, { serialNumber: "" });

      // Bước 1 — DB lỗi tạm thời ⇒ xếp hàng (KHÔNG tới DB).
      const spy1 = vi.spyOn(db, "persistInspectionAtomic").mockImplementationOnce(async () => {
        throw new Error(`[test] giả lập CSDL chớp nháy (mệnh đề 4 bước 1, IDX=${IDX})`);
      });
      let rQueued: KetQuaSubmit;
      try {
        rQueued = (await caller().submitInspection(structuredClone(payload))) as unknown as KetQuaSubmit;
      } finally {
        spy1.mockRestore();
      }
      expect(rQueued.queued).toBe(true);
      expect(await demTheoIndex(IDX)).toBe(0);

      // Bước 2 — DB hồi phục; MÁY GỬI LẠI TRỰC TIẾP (đường LIVE, KHÔNG qua hàng đợi) — thành
      // công NGAY. Bản sao ở Bước 1 VẪN còn nằm trong hàng đợi tại thời điểm này.
      const rLive = (await caller().submitInspection(structuredClone(payload))) as unknown as KetQuaSubmit;
      expect(rLive.success).toBe(true);
      expect(rLive.duplicate, "bo THẬT SỰ MỚI — bản đầu tiên landed LIVE, không phải trùng").toBe(false);
      const liveId = rLive.inspectionId as number;
      expect(await demTheoIndex(IDX), "bo đã landed LIVE").toBe(1);

      // Ledger — SELECT THẬT trên inspection_idempotency_keys, khoá dungKhoaKhuTrungV2(payload)
      // — đây LÀ "khoá-đã-áp-dụng" mà mệnh đề 4 canh, đo bằng SELECT chứ không suy diễn.
      const key = dungKhoaKhuTrungV2(structuredClone(payload) as never);
      const ledgerTruoc = await sql<{ c: number; inspectionId: number | null }[]>`
        SELECT count(*)::int AS c, max("inspectionId") AS "inspectionId" FROM inspection_idempotency_keys
        WHERE "machineId" = ${ids.machine} AND "idempotencyKey" = ${key}`;
      expect(ledgerTruoc[0].c, "ledger phải đã CLAIM khoá này từ lượt LIVE").toBe(1);

      // Bước 3 — backfill mục VẪN CÒN trong hàng đợi (từ Bước 1). Xem docblock đầu file về
      // đường đua với "rút cơ hội" (opportunistic drain) — chờ tới khi hàng đợi rỗng rồi mới
      // SELECT, KHÔNG đọc giá trị trả về của một lời gọi backfillInspections() đơn lẻ.
      await choDenKhiRong();
      expect(bufferedInspectionCount(), "hàng đợi phải rỗng sau khi chờ (xem timeout choDenKhiRong)").toBe(0);

      expect(await demTheoIndex(IDX), "payload đã vào LIVE rồi mới phát lại — KHÔNG được tạo hàng thứ hai").toBe(1);

      const [row] = await sql<{ id: number }[]>`
        SELECT id FROM product_inspections WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${IDX}`;
      expect(row.id, "hàng duy nhất phải là hàng LIVE — backfill không được tạo hàng khác").toBe(liveId);
      boardIdsCoCay.push(row.id);

      const ledgerSau = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM inspection_idempotency_keys
        WHERE "machineId" = ${ids.machine} AND "idempotencyKey" = ${key}`;
      expect(ledgerSau[0].c, "ledger vẫn ĐÚNG MỘT hàng sau backfill — không bị nhân đôi").toBe(1);
    });
  });
});
