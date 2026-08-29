/**
 * BG-40 ⛔ — lưới cho Task 1 (`.superpowers/sdd/2026-08-30-aoi-pha1d-truoc-khoi-b/task-1-brief.md`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * TRƯỚC bản vá: `isPermanentSubmitError` chỉ nhận diện `TRPCError` — mọi lỗi Postgres (kể cả
 * `22001` chuỗi quá dài, `23505` vi phạm ràng buộc) rơi vào nhánh TẠM THỜI. Kết hợp với
 * `backfillInspections` `break` thoát CẢ VÒNG khi gặp lỗi tạm thời ở đầu hàng, MỘT bo hỏng
 * (vd `productModel` 101 ký tự — hợp đồng v2.0 chưa có `.max()`, BG-27) khiến hàng đợi KẸT
 * VĨNH VIỄN: bo hỏng nằm đầu, mọi bo lành xếp sau không bao giờ được thử lấy. Đo THẬT trên mã
 * TRƯỚC bản vá (script tái hiện, KHÔNG suy từ đọc mã — xem `task-1-report.md`): 1 bo độc +
 * 4 bo lành, 20 lượt rút ⇒ `drained=0` ở CẢ 20 lượt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * BỐN MỆNH ĐỀ (task-1-brief.md)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *   1. `22001` và `23505` (kể cả bọc `DrizzleQueryError` qua `.cause`) ⇒ `isPermanentSubmitError = true`.
 *   2. ★ CHỐNG SIẾT QUÁ — lỗi kết nối/timeout (không SQLSTATE, hoặc SQLSTATE lớp 08/53/57P)
 *      ⇒ vẫn `false`. Xếp nhầm chúng thành vĩnh viễn = mất bo khi DB chỉ chớp nháy.
 *   3. ★★★ TRUNG TÂM — 1 bo độc + 4 bo lành, rút hàng MỘT lượt ⇒ 4 bo lành ĐƯỢC ghi, bo độc
 *      vào dead-letter. Kèm ca riêng: một bo TẠM THỜI THẬT (không được xếp permanent) cũng
 *      KHÔNG được chặn các bo lành phía sau (bỏ chặn-đầu-hàng, không chỉ nhờ phân loại).
 *   4. Quá trần `attempts` (`INSPECTION_STORE_FORWARD_MAX_ATTEMPTS`) ⇒ dead-letter CÓ GHI
 *      NHẬN (file dead-letter + không lặng lẽ biến mất khỏi mọi dấu vết), không phải vứt câm.
 *
 * Đột biến BẮT BUỘC (chạy thủ công, không phải test trong file này — xem task-1-report.md):
 * hoàn nguyên `isPermanentSubmitError` về bản chỉ nhận `TRPCError` ⇒ mệnh đề 1 và 3 phải ĐỎ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  isPermanentSubmitError,
  bufferSubmission,
  backfillInspections,
  bufferedInspectionCount,
  getInspectionStoreForwardStatus,
  setProcessFn,
  setDedupFn,
  _resetInspectionStoreForward,
  type BufferedSubmission,
} from "./inspectionStoreForward";

function submission(serial: string, extra: Partial<BufferedSubmission> = {}): BufferedSubmission {
  return {
    apiKey: "TEST-KEY",
    serialNumber: serial,
    inspectionTime: "2026-07-04T08:00:00.000Z",
    overallResult: "OK",
    measurements: [],
    ...extra,
  };
}

/** Lỗi driver postgres.js thô — `code` nằm THẲNG trên lỗi. */
function pgErr(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** Lỗi bọc kiểu drizzle-orm ≥0.44 (`DrizzleQueryError`) — mã thật nằm ở `.cause`. */
function drizzleWrapped(code: string, message: string): Error {
  return Object.assign(new Error(`Failed query: INSERT INTO product_inspections ...`), {
    cause: pgErr(code, message),
  });
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(
    os.tmpdir(),
    `insp-sf-bg40-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.INSPECTION_STORE_FORWARD_MAX;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_AGE_MS;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_BYTES;
  delete process.env.INSPECTION_STORE_FORWARD_DRAIN_BATCH;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_ATTEMPTS;
  _resetInspectionStoreForward();
});

afterEach(async () => {
  _resetInspectionStoreForward();
  for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
    try {
      await fs.unlink(f);
    } catch {
      /* may not exist */
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("mệnh đề 1 — 22001/23505 ⇒ isPermanentSubmitError = true", () => {
  it("lỗi driver thô (code thẳng trên err)", () => {
    expect(isPermanentSubmitError(pgErr("22001", "value too long for type character varying(100)"))).toBe(true);
    expect(isPermanentSubmitError(pgErr("23505", "duplicate key value violates unique constraint"))).toBe(true);
  });

  it("lỗi bọc kiểu drizzle-orm (mã thật nằm ở .cause, không phải top-level)", () => {
    expect(isPermanentSubmitError(drizzleWrapped("22001", "value too long"))).toBe(true);
    expect(isPermanentSubmitError(drizzleWrapped("23505", "duplicate key"))).toBe(true);
  });

  it("cả lớp 22xxx/23xxx nói chung (không chỉ hai mã ví dụ) — vd 22003 tràn số, 23503 khoá ngoại, 23502 not-null", () => {
    expect(isPermanentSubmitError(pgErr("22003", "numeric value out of range"))).toBe(true);
    expect(isPermanentSubmitError(pgErr("23503", "violates foreign key constraint"))).toBe(true);
    expect(isPermanentSubmitError(pgErr("23502", "null value in column violates not-null constraint"))).toBe(true);
  });

  it("TRPCError permanent GIỮ NGUYÊN hành vi cũ (không hồi quy)", () => {
    expect(isPermanentSubmitError(new TRPCError({ code: "UNAUTHORIZED" }))).toBe(true);
    expect(isPermanentSubmitError(new TRPCError({ code: "BAD_REQUEST" }))).toBe(true);
  });

  it("TRPCError INTERNAL_SERVER_ERROR bọc lỗi 22xxx/23xxx thật ở .cause (tRPC middleware bọc lỗi tầng dưới) ⇒ vẫn nhận ra qua .cause", () => {
    expect(
      isPermanentSubmitError(
        new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: pgErr("22001", "value too long") }),
      ),
    ).toBe(true);
  });
});

describe("mệnh đề 2 — ★ CHỐNG SIẾT QUÁ: lỗi kết nối/timeout vẫn TẠM THỜI", () => {
  it("ECONNREFUSED/ETIMEDOUT (mã lỗi Node, không phải SQLSTATE) ⇒ false", () => {
    expect(isPermanentSubmitError(new Error("connect ECONNREFUSED 127.0.0.1:5434"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("ETIMEDOUT", "connection timed out"))).toBe(false);
  });

  it("SQLSTATE lớp KẾT NỐI (08xxx/53xxx/57Pxx — KHÁC lớp 22/23) ⇒ false", () => {
    expect(isPermanentSubmitError(pgErr("08006", "could not connect to server"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("08001", "unable to connect to server"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("53300", "too many connections for role"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("57P03", "the database system is starting up"))).toBe(false);
  });

  it("lỗi kết nối bọc kiểu drizzle-orm cũng vẫn TẠM THỜI (không đi qua ranh giới 22/23)", () => {
    expect(isPermanentSubmitError(drizzleWrapped("08006", "could not connect to server"))).toBe(false);
  });

  it("TRPCError INTERNAL_SERVER_ERROR và Error trần không code — không hồi quy", () => {
    expect(isPermanentSubmitError(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }))).toBe(false);
    expect(isPermanentSubmitError(new Error("something broke"))).toBe(false);
  });
});

describe("mệnh đề 3 — ★★★ TRUNG TÂM: 1 bo độc KHÔNG chặn 4 bo lành phía sau", () => {
  it("1 bo độc (Postgres 22001) + 4 bo lành, rút hàng MỘT lượt ⇒ 4 bo lành ĐƯỢC ghi, bo độc vào dead-letter", async () => {
    const good: string[] = [];
    setProcessFn(async (p) => {
      if (p.serialNumber === "SN-BAD") {
        throw pgErr("22001", "value too long for type character varying(100)");
      }
      good.push(p.serialNumber);
      return { inspectionId: 100 + good.length };
    });
    setDedupFn(async () => false);

    // Bo độc xếp hàng ĐẦU TIÊN — đúng kịch bản thật (bo hỏng tới trước, DB vẫn khoẻ).
    await bufferSubmission(submission("SN-BAD"));
    await bufferSubmission(submission("SN-GOOD-1"));
    await bufferSubmission(submission("SN-GOOD-2"));
    await bufferSubmission(submission("SN-GOOD-3"));
    await bufferSubmission(submission("SN-GOOD-4"));
    expect(bufferedInspectionCount()).toBe(5);

    const bf = await backfillInspections();

    expect(bf.drained).toBe(4); // ★ TRƯỚC bản vá: drained=0 (xem task-1-report.md)
    expect(bf.deadLettered).toBe(1);
    expect(bf.remaining).toBe(0);
    expect(good).toEqual(["SN-GOOD-1", "SN-GOOD-2", "SN-GOOD-3", "SN-GOOD-4"]);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-BAD");
    expect(dead).toContain("22001");
  });

  it("bo độc lỗi TẠM THỜI THẬT (không phải permanent — chưa vượt trần) cũng KHÔNG chặn 4 bo lành phía sau", async () => {
    // Ca này canh RIÊNG việc bỏ break ở backfillInspections (BG-40 việc 3) — độc lập
    // với phân loại lỗi (việc 1): SN-STUCK ném lỗi TẠM THỜI THẬT (generic Error, mãi
    // mãi thất bại — mô phỏng một hàng bị khoá/deadlock riêng cho payload này), KHÔNG
    // bao giờ được isPermanentSubmitError xếp vĩnh viễn. Nếu vẫn còn `break`, các bo
    // lành phía sau sẽ không được thử — giống hệt hiện trạng đo được TRƯỚC bản vá.
    const good: string[] = [];
    setProcessFn(async (p) => {
      if (p.serialNumber === "SN-STUCK") throw new Error("connect ECONNREFUSED (mô phỏng lỗi riêng của hàng này)");
      good.push(p.serialNumber);
      return { inspectionId: 1 };
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-STUCK"));
    await bufferSubmission(submission("SN-GOOD-1"));
    await bufferSubmission(submission("SN-GOOD-2"));
    await bufferSubmission(submission("SN-GOOD-3"));
    await bufferSubmission(submission("SN-GOOD-4"));

    const bf = await backfillInspections();

    expect(bf.drained).toBe(4);
    expect(bf.deadLettered).toBe(0); // chưa vượt trần — vẫn TẠM THỜI, còn nằm hàng đợi
    expect(bf.remaining).toBe(1);
    expect(good).toEqual(["SN-GOOD-1", "SN-GOOD-2", "SN-GOOD-3", "SN-GOOD-4"]);
    expect(bufferedInspectionCount()).toBe(1); // SN-STUCK vẫn còn, chờ lượt sau
  });

  it("bo độc dead-letter KHÔNG ăn mất ngân sách của các bo lành khi có NHIỀU bo độc xen kẽ", async () => {
    const good: string[] = [];
    setProcessFn(async (p) => {
      if (p.serialNumber.startsWith("BAD")) throw pgErr("23505", "duplicate key value violates unique constraint");
      good.push(p.serialNumber);
      return { inspectionId: 1 };
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("BAD-1"));
    await bufferSubmission(submission("GOOD-1"));
    await bufferSubmission(submission("BAD-2"));
    await bufferSubmission(submission("GOOD-2"));
    await bufferSubmission(submission("BAD-3"));

    const bf = await backfillInspections();
    expect(bf.drained).toBe(2);
    expect(bf.deadLettered).toBe(3);
    expect(bf.remaining).toBe(0);
    expect(good).toEqual(["GOOD-1", "GOOD-2"]);
  });
});

describe("mệnh đề 4 — quá trần attempts ⇒ dead-letter CÓ GHI NHẬN, không vứt im lặng", () => {
  it("trần cấu hình qua INSPECTION_STORE_FORWARD_MAX_ATTEMPTS — vượt trần ⇒ dead-letter kèm ghi chú lý do", async () => {
    process.env.INSPECTION_STORE_FORWARD_MAX_ATTEMPTS = "3"; // đọc live tại thời điểm gọi, không cần reset lại

    const processFn = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED (DB gián đoạn dài)");
    });
    setProcessFn(processFn);
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-KET"));

    let bf = await backfillInspections();
    expect(bf.drained).toBe(0);
    expect(bf.deadLettered).toBe(0);
    expect(bf.remaining).toBe(1); // lượt 1: attempts=1, chưa vượt trần=3

    bf = await backfillInspections();
    expect(bf.deadLettered).toBe(0);
    expect(bf.remaining).toBe(1); // lượt 2: attempts=2, chưa vượt trần

    bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1); // lượt 3: attempts=3 ⇒ VƯỢT trần ⇒ dead-letter
    expect(bf.remaining).toBe(0);
    expect(processFn).toHaveBeenCalledTimes(3);

    // "có ghi nhận": không biến mất im lặng — có mặt trong file dead-letter kèm lý do,
    // và không nằm trong ledger applied (một bản sửa đúng gửi lại sau này sẽ KHÔNG bị
    // coi là trùng lặp — giữ đúng cam kết IDEMPOTENCY của docblock đầu file).
    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-KET");
    expect(dead).toContain("vượt trần");
    expect(dead).toContain("attempts\":3");

    const st = getInspectionStoreForwardStatus();
    expect(st.deadLettered).toBe(1);
    expect(st.bufferedCount).toBe(0);
    expect(st.maxAttempts).toBe(3);
  });

  it("mặc định KHÔNG cấu hình vẫn là 20 (khuôn env-var sẵn có — envInt fallback)", () => {
    const st = getInspectionStoreForwardStatus();
    expect(st.maxAttempts).toBe(20);
  });

  it("một mục chưa từng vượt trần KHÔNG bị dead-letter dù nhiều lượt rút thất bại xen kẽ thành công của mục khác", async () => {
    process.env.INSPECTION_STORE_FORWARD_MAX_ATTEMPTS = "5";

    setProcessFn(async (p) => {
      if (p.serialNumber === "SN-KET") throw new Error("db down");
      return { inspectionId: 1 };
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-KET"));
    for (let t = 0; t < 4; t++) {
      const bf = await backfillInspections();
      expect(bf.deadLettered).toBe(0);
    }
    expect(bufferedInspectionCount()).toBe(1); // 4 lượt < trần 5 — còn nguyên trong hàng đợi
  });
});

describe("cờ TẮT ⇒ hành vi y hệt trước (docblock HONESTY) — không hồi quy bởi bản vá này", () => {
  it("buffer/backfill là no-op khi INSPECTION_STORE_FORWARD_ENABLED=false", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    const r = await bufferSubmission(submission("SN-OFF"));
    expect(r.buffered).toBe(false);
    const bf = await backfillInspections();
    expect(bf.enabled).toBe(false);
    expect(bf.drained).toBe(0);
  });
});
