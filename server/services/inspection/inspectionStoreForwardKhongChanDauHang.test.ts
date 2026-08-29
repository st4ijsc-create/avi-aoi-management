/**
 * BG-40 ⛔ — lưới cho Task 1 (`.superpowers/sdd/2026-08-30-aoi-pha1d-truoc-khoi-b/task-1-brief.md`)
 * + VÒNG SỬA 2 (review toàn nhánh bác bỏ hai lời khai của vòng 1, `task-1-report.md`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * VÒNG 1 — VÌ SAO LƯỚI NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * TRƯỚC bản vá: `isPermanentSubmitError` chỉ nhận diện `TRPCError` — mọi lỗi Postgres (kể cả
 * `22001` chuỗi quá dài, `23505` vi phạm ràng buộc) rơi vào nhánh TẠM THỜI. Kết hợp với
 * `backfillInspections` `break` thoát CẢ VÒNG khi gặp lỗi tạm thời ở đầu hàng, MỘT bo hỏng
 * khiến hàng đợi KẸT VĨNH VIỄN. Đo THẬT (script tái hiện): 1 bo độc + 4 bo lành, 20 lượt rút
 * ⇒ `drained=0` ở CẢ 20 lượt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * VÒNG 2 — REVIEW BÁC BỎ HAI LỜI KHAI CỦA VÒNG 1
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * C-1: `budget` (=`drainBatch()`=50) giảm ở CẢ nhánh tạm thời ⇒ với ≥50 mục cùng lỗi tạm
 * thời, chỉ 50 mục ĐẦU hàng mỗi tick được tăng `attempts` — phần đuôi đứng ở 0 vĩnh viễn,
 * còn 50 mục đầu chạm trần ĐẾM-LƯỢT (20) sau ~83 phút và bị dead-letter VÌ MỘT LỖI THUẦN
 * TẠM THỜI. Đo THẬT trên mã vòng 1 (script tái hiện, xem `task-1-report.md`): 200 mục lỗi
 * `08006`, 25 lượt ⇒ `sauDot(remaining)=150, deadLettered=50, soMucChuaDuocThuLanNao=100,
 * soLanThu_SN000=20` (record dead-letter của SN000).
 * C-2: nhánh `dedupFn` ném lỗi vẫn `break` — LÝ DO viện dẫn ("DB tự nó hỏng, dùng chung cho
 * mọi mục") SAI: `dedupFn` có thể ném vì lý do RIÊNG của một payload (inspectionTime rác ⇒
 * `RangeError`; v2.0 thiếu `identity` ⇒ huỷ tay). Đo THẬT: 1 payload dedupFn-ném + 4 bo
 * lành, 30 lượt ⇒ `drained=0` cả 30 lượt.
 *
 * Sửa vòng 2: (a) `budget` CHỈ giảm khi một mục bị GỠ khỏi hàng đợi vì kết quả THẬT (thành
 * công hoặc dead-letter) — mục tạm-thời-ở-lại không tốn ngân sách ⇒ một tick LUÔN quét hết
 * hàng đợi hiện có; (b) trần đổi từ ĐẾM LƯỢT sang ĐO THỜI GIAN (`maxStuckMs`, mặc định 24h)
 * — số lượt gọi không tỷ lệ thuận với thời gian thật; (c) `dedupFn` ném lỗi nay xử lý GIỐNG
 * HỆT `processFn` (không `break`, có đường dead-letter, tăng `attempts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * MỆNH ĐỀ CANH (gộp cả hai vòng)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *   V1-1. `22001`/`23505` (kể cả bọc `DrizzleQueryError` qua `.cause`) ⇒ `isPermanentSubmitError = true`.
 *   V1-2. ★ CHỐNG SIẾT QUÁ — lỗi kết nối/timeout (không SQLSTATE, hoặc SQLSTATE lớp 08/53/57P) ⇒ vẫn `false`.
 *   V1-3. ★★★ 1 bo độc + 4 bo lành, rút hàng MỘT lượt ⇒ 4 bo lành ĐƯỢC ghi, bo độc vào dead-letter.
 *   V2-1. ★★★ 200 mục toàn lỗi tạm thời, 25 lượt ⇒ 0 dead-letter, 0 mục có `attempts`=0.
 *   V2-2. ★★★ 1 payload làm `dedupFn` ném + 4 bo lành, 10 lượt ⇒ 4 bo lành ĐƯỢC ghi.
 *   V2-3. ★★★ CHỐNG HỒI QUY — lỗi VĨNH VIỄN (`22001`) vẫn vào dead-letter NGAY, không chờ trần thời gian.
 *
 * Đột biến BẮT BUỘC (chạy thủ công, không phải test trong file này — xem task-1-report.md):
 *   vòng 1: hoàn nguyên `isPermanentSubmitError` về bản chỉ nhận `TRPCError` ⇒ V1-1/V1-3 ĐỎ.
 *   vòng 2: hoàn nguyên `budget` về giảm-ở-mọi-nhánh ⇒ V2-1 ĐỎ.
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
  delete process.env.INSPECTION_STORE_FORWARD_MAX_STUCK_MS;
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
describe("V1-1 — 22001/23505 ⇒ isPermanentSubmitError = true", () => {
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

describe("V1-2 — ★ CHỐNG SIẾT QUÁ: lỗi kết nối/timeout vẫn TẠM THỜI", () => {
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

describe("V1-3 — ★★★ 1 bo độc KHÔNG chặn 4 bo lành phía sau (bỏ chặn-đầu-hàng, vòng 1)", () => {
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

    expect(bf.drained).toBe(4);
    expect(bf.deadLettered).toBe(1);
    expect(bf.remaining).toBe(0);
    expect(good).toEqual(["SN-GOOD-1", "SN-GOOD-2", "SN-GOOD-3", "SN-GOOD-4"]);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-BAD");
    expect(dead).toContain("22001");
  });

  it("bo độc lỗi TẠM THỜI THẬT (không phải permanent — chưa vượt trần) cũng KHÔNG chặn 4 bo lành phía sau", async () => {
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
    expect(bf.deadLettered).toBe(0); // chưa vượt trần thời gian — vẫn TẠM THỜI, còn nằm hàng đợi
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

// ═══════════════════════════════════════════════════════════════════════════════
// VÒNG SỬA 2 — ba mệnh đề coordinator yêu cầu (review bác bỏ hai lời khai vòng 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe("V2-1 — ★★★ C-1: 200 mục toàn lỗi tạm thời KHÔNG bị đói ngân sách", () => {
  it("200 mục toàn lỗi 08006 (mất kết nối), 25 lượt rút ⇒ 0 dead-letter, 0 mục có attempts=0, MỌI mục đều được thử ĐỦ 25 lần", async () => {
    setProcessFn(async () => {
      throw pgErr("08006", "could not connect to server");
    });
    setDedupFn(async () => false);

    for (let n = 0; n < 200; n++) {
      await bufferSubmission(submission(`SN${String(n).padStart(3, "0")}`));
    }
    expect(bufferedInspectionCount()).toBe(200);

    let bf: Awaited<ReturnType<typeof backfillInspections>> | undefined;
    for (let tick = 0; tick < 25; tick++) {
      bf = await backfillInspections();
    }

    expect(bf!.deadLettered).toBe(0); // ★ TRƯỚC vòng sửa 2: deadLettered=50 (xem task-1-report.md)
    expect(bufferedInspectionCount()).toBe(200); // không mục nào mất, không mục nào dead-letter

    // Đọc THẲNG file WAL mirror để kiểm TỪNG mục — không suy diễn từ mỗi lượt trả về.
    const raw = await fs.readFile(walPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(200);
    const attemptsList = lines.map((l) => (JSON.parse(l) as { attempts: number }).attempts);
    const chuaDuocThuLanNao = attemptsList.filter((a) => a === 0);
    expect(chuaDuocThuLanNao).toEqual([]); // ★ TRƯỚC vòng sửa 2: 100 mục đứng ở 0 (xem task-1-report.md)
    // budget không còn đói mục nào: MỌI mục được thử ĐÚNG 25 lần — không lệch giữa đầu/đuôi hàng.
    expect(attemptsList.every((a) => a === 25)).toBe(true);
  });
});

describe("V2-2 — ★★★ C-2: dedupFn ném lỗi KHÔNG còn chặn-đầu-hàng", () => {
  it("1 payload làm dedupFn ném (lỗi RIÊNG kiểu RangeError — v1.x inspectionTime rác) + 4 bo lành, MỘT lượt ⇒ 4 bo lành ĐƯỢC ghi ngay", async () => {
    const good: string[] = [];
    setProcessFn(async (p) => {
      good.push(p.serialNumber);
      return { inspectionId: 1 };
    });
    setDedupFn(async (p) => {
      if (p.serialNumber === "SN-POISON") throw new RangeError("Invalid time value");
      return false;
    });

    await bufferSubmission(submission("SN-POISON"));
    await bufferSubmission(submission("SN-GOOD-1"));
    await bufferSubmission(submission("SN-GOOD-2"));
    await bufferSubmission(submission("SN-GOOD-3"));
    await bufferSubmission(submission("SN-GOOD-4"));

    const bf = await backfillInspections();
    expect(bf.drained).toBe(4); // ★ TRƯỚC vòng sửa 2: drained=0 (xem task-1-report.md)
    expect(good).toEqual(["SN-GOOD-1", "SN-GOOD-2", "SN-GOOD-3", "SN-GOOD-4"]);
    expect(bf.remaining).toBe(1); // SN-POISON vẫn còn — chưa vượt trần thời gian, chưa dead-letter
  });

  it("giữ được qua 10 lượt (khớp số reviewer nêu) — không hồi quy về drained=0", async () => {
    const good: string[] = [];
    setProcessFn(async (p) => {
      good.push(p.serialNumber);
      return { inspectionId: 1 };
    });
    setDedupFn(async (p) => {
      if (p.serialNumber === "SN-POISON") throw new TypeError("Cannot read properties of undefined (reading 'identity')");
      return false;
    });

    await bufferSubmission(submission("SN-POISON"));
    await bufferSubmission(submission("SN-GOOD-1"));
    await bufferSubmission(submission("SN-GOOD-2"));
    await bufferSubmission(submission("SN-GOOD-3"));
    await bufferSubmission(submission("SN-GOOD-4"));

    let bf: Awaited<ReturnType<typeof backfillInspections>> | undefined;
    for (let tick = 0; tick < 10; tick++) {
      bf = await backfillInspections();
    }
    expect(good).toEqual(["SN-GOOD-1", "SN-GOOD-2", "SN-GOOD-3", "SN-GOOD-4"]);
    expect(bf!.remaining).toBe(1); // SN-POISON còn kẹt (dưới trần thời gian), KHÔNG chặn ai khác
  });

  it("dedupFn ném lỗi PHÂN LOẠI ĐƯỢC là vĩnh viễn (vd 23505 từ chính câu tra dedup) ⇒ dead-letter NGAY, không chờ trần thời gian", async () => {
    setProcessFn(async () => ({ inspectionId: 1 }));
    setDedupFn(async (p) => {
      if (p.serialNumber === "SN-BAD-DEDUP") throw pgErr("23505", "duplicate key value violates unique constraint");
      return false;
    });

    await bufferSubmission(submission("SN-BAD-DEDUP"));
    const bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1);
    expect(bf.remaining).toBe(0);
  });
});

describe("V2-3 — ★★★ CHỐNG HỒI QUY: lỗi VĨNH VIỄN vẫn dead-letter NGAY (không chờ trần thời gian 24h)", () => {
  it("22001 dead-letter ở LƯỢT ĐẦU TIÊN — đồng hồ hệ thống KHÔNG hề nhích, chứng minh không phụ thuộc maxStuckMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
    try {
      setProcessFn(async () => {
        throw pgErr("22001", "value too long for type character varying(100)");
      });
      setDedupFn(async () => false);

      await bufferSubmission(submission("SN-VINH-VIEN"));
      const bf = await backfillInspections(); // MỘT lượt duy nhất, 0 thời gian trôi qua
      expect(bf.deadLettered).toBe(1);
      expect(bf.remaining).toBe(0);

      const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
      expect(dead).toContain("SN-VINH-VIEN");
      expect(dead).toContain("attempts\":0"); // dead-letter NGAY, chưa từng tăng attempts
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Trần THỜI GIAN (maxStuckMs) — thay trần đếm-lượt của vòng 1, bị C-1 bác bỏ.
// ═══════════════════════════════════════════════════════════════════════════════
describe("trần THỜI GIAN maxStuckMs (vòng sửa 2) — CHỈ áp cho mục còn TẠM THỜI, đo bằng thời gian thật", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("★ câu hỏi bắt buộc — DB gián đoạn TỪNG PHẦN 4 giờ ⇒ 0 bo bị vứt (mặc định 24h > 4h)", async () => {
    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (giả lập gián đoạn từng phần)");
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-4H"));
    for (let h = 0; h < 4; h++) {
      vi.setSystemTime(new Date(Date.now() + 60 * 60 * 1000)); // +1h mỗi vòng, tổng 4h
      const bf = await backfillInspections();
      expect(bf.deadLettered).toBe(0);
    }
    const st = getInspectionStoreForwardStatus();
    expect(st.deadLettered).toBe(0);
    expect(bufferedInspectionCount()).toBe(1); // vẫn còn nguyên — KHÔNG bị vứt
  });

  it("vượt trần mặc định 24h ⇒ dead-letter CÓ GHI NHẬN kèm lý do 'kẹt quá'", async () => {
    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (DB gián đoạn dài)");
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-KET"));
    await backfillInspections(); // tick đầu — attempts=1, chưa vượt trần

    vi.setSystemTime(new Date(Date.now() + 25 * 60 * 60 * 1000)); // nhảy 25h > trần 24h
    const bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1);
    expect(bf.remaining).toBe(0);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-KET");
    expect(dead).toContain("kẹt quá");
    // "có ghi nhận": KHÔNG nằm trong ledger applied — một bản sửa đúng gửi lại sau này sẽ
    // KHÔNG bị coi là trùng lặp, giữ đúng cam kết IDEMPOTENCY của docblock đầu file.
  });

  it("cấu hình được qua INSPECTION_STORE_FORWARD_MAX_STUCK_MS (đúng khuôn env-var sẵn có — envInt)", async () => {
    process.env.INSPECTION_STORE_FORWARD_MAX_STUCK_MS = String(60 * 60 * 1000); // 1h
    setProcessFn(async () => {
      throw new Error("db down");
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-1H"));
    await backfillInspections();
    vi.setSystemTime(new Date(Date.now() + 61 * 60 * 1000)); // 61 phút > trần 1h
    const bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1);

    const st = getInspectionStoreForwardStatus();
    expect(st.maxStuckMs).toBe(60 * 60 * 1000);
  });

  it("mặc định KHÔNG cấu hình = 24h", () => {
    const st = getInspectionStoreForwardStatus();
    expect(st.maxStuckMs).toBe(24 * 60 * 60 * 1000);
  });

  it("attempts VẪN tăng mỗi lượt thất bại (chỉ để quan sát/log — KHÔNG còn quyết định dead-letter)", async () => {
    setProcessFn(async () => {
      throw new Error("db down");
    });
    setDedupFn(async () => false);

    await bufferSubmission(submission("SN-OBS"));
    for (let t = 0; t < 5; t++) {
      await backfillInspections();
    }
    const raw = await fs.readFile(walPath, "utf8");
    const entry = JSON.parse(raw.trim()) as { attempts: number };
    expect(entry.attempts).toBe(5);
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
