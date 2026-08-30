/**
 * Pha 1E Task 1 (BG-64 + BG-66 + BG-67 ⛔) — `.superpowers/sdd/2026-08-31-aoi-pha1e-sau-muc-do/
 * task-1-brief.md`. Review lượt 5 bác bỏ "mốc son" vòng sửa 2 — ba lỗ này là hậu quả CỦA CHÍNH
 * các bản vá trước (xem docblock đầu `inspectionStoreForward.ts`, mục "2026-08-31 (Pha 1E Task 1)").
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * BG-64 — `isPermanentSubmitError` bỏ sót đúng lớp nguy hiểm nhất
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * TRƯỚC bản vá: `ZodError` (chuỗi quá cỡ, ném trần từ `metaJsonSchema.parse()` gọi tay — không
 * qua `.input()` nên không được tRPC bọc `TRPCError(BAD_REQUEST)`), lỗi JSZip (`Can't find end
 * of central directory` — JSZip không có class lỗi riêng), `SyntaxError` của `JSON.parse` đều
 * TẠM THỜI ⇒ retry vô hạn cho payload KHÔNG BAO GIỜ đọc được. Đây đúng là hai nửa của commit
 * `1c3c74ef` (BG-52) cắn nhau: nửa thêm `.max()` (đúng) làm chốt chặn ĐẾM ở `aoiPackageRouter.
 * commit` (BG-52) yếu đi cho ĐÚNG lớp payload nó nhắm tới.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * BG-66 — `maxStuckMs` đo từ lúc XẾP HÀNG (`enqueuedAt`), không đo "kẹt"
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * TRƯỚC bản vá: mục nằm 25h, `attempts=0` (CHƯA TỪNG được `backfillInspections()` thử), gặp lỗi
 * tạm thời LẦN ĐẦU TIÊN → dead-letter NGAY vì `Date.now()-enqueuedAt` đã vượt 24h — dù nó chưa
 * hề có cơ hội retry nào. Kịch bản thật: tắt bảo trì cuối tuần → `restoreInspectionWal` khôi
 * phục nguyên `enqueuedAt` → tick đầu sau khởi động gặp MỘT lỗi tạm thời → mọi mục >24h chết
 * cùng lúc.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * BG-67 — một tick quét TOÀN hàng đợi, không trần
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * `budget` (vòng sửa 2) chỉ giảm khi có CÔNG VIỆC THẬT — một hàng đợi TOÀN lỗi tạm thời không
 * giảm `budget` bao giờ ⇒ vòng quét đi hết `queue.length`. Đo THẬT: 20.000 mục = 40.000 lời gọi
 * DB MỘT TICK; với DB "hố đen" (`connect_timeout=30s`) ⇒ ~333 GIỜ một tick, suốt thời gian đó
 * `draining=true` chặn MỌI lượt `backfillInspections()` khác.
 *
 * Đột biến bắt buộc (chạy thủ công, KHÔNG phải test trong file này — xem task-1-report.md):
 *   (a) hoàn nguyên phân loại (bỏ ZodError/SyntaxError/JSZip) ⇒ mệnh đề 1 ĐỎ.
 *   (b) đổi mốc `xuLyLoiPhatLai` về `entry.enqueuedAt` ⇒ mệnh đề 3 ĐỎ.
 *   (c) gỡ trần quét (`gioiHanQuet`/`maxScanPerTick`, quay lại `while (i < queue.length ...)`) ⇒
 *       mệnh đề 6 ĐỎ.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { TRPCError } from "@trpc/server";
import { z, ZodError } from "zod";
import {
  isPermanentSubmitError,
  bufferSubmission,
  backfillInspections,
  bufferedInspectionCount,
  getInspectionStoreForwardStatus,
  restoreInspectionWal,
  setProcessFn,
  setDedupFn,
  _resetInspectionStoreForward,
  type BufferedSubmission,
} from "./inspectionStoreForward";

function submission(serial: string, extra: Partial<BufferedSubmission> = {}): BufferedSubmission {
  return {
    apiKey: "TEST-KEY-BALOWAL",
    serialNumber: serial,
    inspectionTime: "2026-07-04T08:00:00.000Z",
    overallResult: "OK",
    measurements: [],
    ...extra,
  };
}

function pgErr(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

let walPath: string;

beforeEach(() => {
  walPath = path.join(
    os.tmpdir(),
    `insp-sf-baloWal-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.INSPECTION_STORE_FORWARD_MAX;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_AGE_MS;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_BYTES;
  delete process.env.INSPECTION_STORE_FORWARD_DRAIN_BATCH;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_STUCK_MS;
  delete process.env.INSPECTION_STORE_FORWARD_MAX_SCAN_PER_TICK;
  _resetInspectionStoreForward();
});

afterEach(async () => {
  _resetInspectionStoreForward();
  vi.useRealTimers();
  for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
    try {
      await fs.unlink(f);
    } catch {
      /* may not exist */
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 1 — ZodError · lỗi giải nén (JSZip) · SyntaxError ⇒ VĨNH VIỄN
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 1 — BG-64: ba chế độ hỏng phổ biến nhất của payload ⇒ isPermanentSubmitError=true", () => {
  it("ZodError (chuỗi quá cỡ — đúng hình dạng .max() của BG-52 sinh ra)", () => {
    const schema = z.object({ note: z.string().max(50) });
    let loi: unknown;
    try {
      schema.parse({ note: "x".repeat(200) });
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(ZodError);
    expect(isPermanentSubmitError(loi)).toBe(true); // ★ TRƯỚC BG-64: false (xem task-1-report.md)
  });

  it("lỗi JSZip THẬT (archive corrupt) — 'Can't find end of central directory'", async () => {
    let loi: unknown;
    try {
      await JSZip.loadAsync(Buffer.from("khong-phai-file-zip-hop-le"));
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(Error);
    expect((loi as Error).message).toContain("central directory");
    expect(isPermanentSubmitError(loi)).toBe(true); // ★ TRƯỚC BG-64: false
  });

  it("SyntaxError của JSON.parse (meta.json hỏng byte)", () => {
    let loi: unknown;
    try {
      JSON.parse("{ day khong phai JSON hop le");
    } catch (e) {
      loi = e;
    }
    expect(loi).toBeInstanceOf(SyntaxError);
    expect(isPermanentSubmitError(loi)).toBe(true); // ★ TRƯỚC BG-64: false
  });

  it("ZodError bọc trong .cause của TRPCError KHÔNG-vĩnh-viễn (INTERNAL_SERVER_ERROR) — vẫn nhận ra qua đi bộ .cause", () => {
    const zodErr = (() => {
      try {
        z.string().max(5).parse("qua-dai");
      } catch (e) {
        return e;
      }
    })();
    const wrapped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: zodErr });
    expect(isPermanentSubmitError(wrapped)).toBe(true);
  });

  it("một payload dùng lỗi ZodError, đưa qua backfillInspections() ⇒ dead-letter NGAY, không chờ trần thời gian", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
    try {
      setProcessFn(async () => {
        const schema = z.object({ note: z.string().max(10) });
        schema.parse({ note: "x".repeat(999) }); // ném ZodError
        return { inspectionId: 1 };
      });
      setDedupFn(async () => false);

      await bufferSubmission(submission("SN-ZOD"));
      const bf = await backfillInspections(); // MỘT lượt duy nhất, 0 thời gian trôi qua
      expect(bf.deadLettered).toBe(1);
      expect(bf.remaining).toBe(0);

      const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
      expect(dead).toContain("SN-ZOD");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 2 — ★ CHỐNG SIẾT QUÁ: lỗi kết nối vẫn TẠM THỜI (không hồi quy do BG-64)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 2 — CHỐNG SIẾT QUÁ: BG-64 KHÔNG đụng ranh giới lỗi kết nối", () => {
  it("ECONNREFUSED / 08006 / 57P03 ⇒ vẫn false (không phải ZodError/SyntaxError/JSZip)", () => {
    expect(isPermanentSubmitError(new Error("connect ECONNREFUSED 127.0.0.1:5434"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("08006", "could not connect to server"))).toBe(false);
    expect(isPermanentSubmitError(pgErr("57P03", "the database system is starting up"))).toBe(false);
  });

  it("TRPCError INTERNAL_SERVER_ERROR trần (không cause) ⇒ vẫn false", () => {
    expect(isPermanentSubmitError(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 3 + 4 — BG-66: mốc là LẦN HỎNG ĐẦU TIÊN, không phải lúc xếp hàng
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 3 — mục nằm 25h CHƯA TỪNG được thử, hỏng LẦN ĐẦU ⇒ KHÔNG dead-letter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
  });

  it("buffer rồi KHÔNG gọi backfillInspections() suốt 25h (mô phỏng tắt bảo trì) — lượt đầu tiên gặp lỗi tạm thời", async () => {
    await bufferSubmission(submission("SN-25H-LAN-DAU"));
    vi.setSystemTime(new Date(Date.now() + 25 * 60 * 60 * 1000)); // nhảy 25h, KHÔNG gọi backfill trong lúc đó

    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (lỗi tạm thời LẦN ĐẦU sau khi thức dậy)");
    });
    setDedupFn(async () => false);

    const bf = await backfillInspections(); // lượt ĐẦU TIÊN cho entry này
    expect(bf.deadLettered).toBe(0); // ★ TRƯỚC BG-66: 1 (enqueuedAt cách đây 25h ≥ trần 24h)
    expect(bf.remaining).toBe(1);

    const raw = await fs.readFile(walPath, "utf8");
    const entry = JSON.parse(raw.trim()) as { attempts: number; lanHongDauMs?: number };
    expect(entry.attempts).toBe(1);
    expect(entry.lanHongDauMs).toBe(Date.now()); // mốc vừa được set NGAY LÚC NÀY, không phải lúc buffer
  });
});

describe("Mệnh đề 4 — hỏng LIÊN TỤC vượt maxStuckMs (từ LẦN HỎNG ĐẦU TIÊN) ⇒ dead-letter, thông điệp đúng THỜI GIAN KẸT", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
  });

  it("nằm chờ 40h (KHÔNG tính) rồi hỏng liên tục thêm 24h (TÍNH) ⇒ dead-letter ở đúng mốc 24h kể từ lần hỏng đầu, không phải 64h kể từ lúc xếp hàng", async () => {
    await bufferSubmission(submission("SN-KET-LIEN-TUC"));
    vi.setSystemTime(new Date(Date.now() + 40 * 60 * 60 * 1000)); // 40h KHÔNG ai đụng tới — không tính vào đồng hồ kẹt

    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (kẹt liên tục)");
    });
    setDedupFn(async () => false);

    const bfDau = await backfillInspections(); // lần hỏng ĐẦU TIÊN — lanHongDauMs bắt đầu chạy TỪ ĐÂY
    expect(bfDau.deadLettered).toBe(0);

    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000)); // +24h kể từ lần hỏng đầu (tổng 64h kể từ lúc xếp hàng)
    const bf = await backfillInspections();
    expect(bf.deadLettered).toBe(1);
    expect(bf.remaining).toBe(0);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-KET-LIEN-TUC");
    expect(dead).toContain("kẹt quá 24.0h liên tục");
    expect(dead).not.toContain("64.0h"); // sanity — KHÔNG bị tính nhầm từ lúc xếp hàng (đó là bug BG-66)
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 5 — hỏng → THÀNH CÔNG → hỏng lại ⇒ đồng hồ RESET (không kế thừa đợt trước)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 5 — BG-66: đồng hồ 'kẹt' KHÔNG kế thừa qua các đợt (hỏng → thành công → hỏng lại)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T00:00:00.000Z"));
  });

  it("đợt A hỏng rồi THÀNH CÔNG (drain) — đợt B (mục MỚI) hỏng lại nhiều giờ sau đó KHÔNG kế thừa thời gian đã trôi của đợt A", async () => {
    setDedupFn(async () => false);

    // ── Đợt A: hỏng một lần rồi PHỤC HỒI (processFn thành công) ──
    let epAShouldFail = true;
    setProcessFn(async () => {
      if (epAShouldFail) throw new Error("connect ECONNREFUSED (đợt A, lần đầu)");
      return { inspectionId: 1 };
    });
    await bufferSubmission(submission("SN-EPISODE-A"));
    vi.setSystemTime(new Date(Date.now() + 20 * 60 * 60 * 1000)); // T0+20h
    const bfAFail = await backfillInspections(); // lần hỏng ĐẦU TIÊN của đợt A — lanHongDauMs = T0+20h
    expect(bfAFail.deadLettered).toBe(0);
    expect(bfAFail.remaining).toBe(1);

    vi.setSystemTime(new Date(Date.now() + 5 * 60 * 1000)); // +5 phút, vẫn còn TRONG hàng đợi
    epAShouldFail = false; // DB hồi phục
    const bfADrain = await backfillInspections();
    expect(bfADrain.drained).toBe(1); // ★ THÀNH CÔNG — entry A bị gỡ khỏi hàng đợi hoàn toàn
    expect(bufferedInspectionCount()).toBe(0);

    // ── Đợt B: một mục MỚI (khác serial ⇒ khác key), xuất hiện SAU KHI đợt A đã đóng lại,
    // tại thời điểm đã CÁCH lần hỏng đầu tiên của đợt A hơn 24h (T0+20h → giờ là T0+45h, tức
    // đã 25h "kể từ lần hỏng của đợt A"). Nếu đồng hồ bị lẫn giữa các đợt (vd một biến
    // module-level dùng chung thay vì trường riêng trên từng WalEntry), đợt B sẽ bị dead-letter
    // NGAY ở lần hỏng đầu tiên của CHÍNH NÓ — sai. ──
    vi.setSystemTime(new Date(Date.now() + (45 - 20) * 60 * 60 * 1000 - 5 * 60 * 1000)); // T0+45h
    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (đợt B, lần đầu)");
    });
    await bufferSubmission(submission("SN-EPISODE-B"));
    const bfBFirstFail = await backfillInspections(); // lần hỏng ĐẦU TIÊN của đợt B
    expect(bfBFirstFail.deadLettered).toBe(0); // ★ nếu đồng hồ KHÔNG reset, đây sẽ SAI (dead-letter oan)
    expect(bfBFirstFail.remaining).toBe(1);

    // +23h kể từ lần hỏng ĐẦU TIÊN của đợt B (< trần 24h) ⇒ vẫn CHƯA dead-letter.
    vi.setSystemTime(new Date(Date.now() + 23 * 60 * 60 * 1000));
    const bfBStillOk = await backfillInspections();
    expect(bfBStillOk.deadLettered).toBe(0);

    // +2h nữa (tổng 25h kể từ lần hỏng đầu của đợt B) ⇒ vượt trần 24h ⇒ dead-letter.
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
    const bfBDead = await backfillInspections();
    expect(bfBDead.deadLettered).toBe(1);

    const dead = await fs.readFile(walPath.replace(/\.jsonl$/, "") + ".dead.jsonl", "utf8");
    expect(dead).toContain("SN-EPISODE-B");
    expect(dead).not.toContain("SN-EPISODE-A"); // đợt A đã THÀNH CÔNG — không bao giờ vào dead-letter
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 6 — BG-67: 20.000 mục, MỘT tick ⇒ số lời gọi DB ≤ trần quét (không phải 40.000)
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 6 — BG-67: trần quét TÁCH khỏi budget", () => {
  it("20.000 mục toàn lỗi tạm thời (dựng qua restoreInspectionWal — KHÔNG gọi bufferSubmission 20.000 lần, tránh O(n²) ghi file mirror), MỘT tick ⇒ số lời gọi DB ĐẾM ĐƯỢC ≤ trần quét mặc định, KHÔNG PHẢI 40.000", async () => {
    const SO_MUC = 20000;
    const lines: string[] = [];
    for (let n = 0; n < SO_MUC; n++) {
      const payload = submission(`SN${String(n).padStart(5, "0")}`);
      lines.push(JSON.stringify({ key: `key-${n}`, enqueuedAt: Date.now(), attempts: 0, payload }));
    }
    await fs.writeFile(walPath, lines.join("\n") + "\n", "utf8");
    const restored = await restoreInspectionWal();
    expect(restored).toBe(SO_MUC);
    expect(bufferedInspectionCount()).toBe(SO_MUC);

    let dedupCalls = 0;
    let processCalls = 0;
    setDedupFn(async () => {
      dedupCalls += 1;
      return false;
    });
    setProcessFn(async () => {
      processCalls += 1;
      throw new Error("connect ECONNREFUSED (mô phỏng DB không phản hồi)");
    });

    const trầnQuét = getInspectionStoreForwardStatus().maxScanPerTick;
    expect(trầnQuét).toBe(2000); // mặc định — xem maxScanPerTick()

    const bf = await backfillInspections(); // MỘT tick duy nhất
    const tongLoiGoiDb = dedupCalls + processCalls;

    // ★★★ Con số ĐẾM ĐƯỢC, không phải suy diễn từ test xanh:
    expect(dedupCalls).toBe(trầnQuét); // 2.000 mục được quét = 2.000 lời gọi dedupFn
    expect(processCalls).toBe(trầnQuét); // dedupFn trả false ⇒ processFn luôn được gọi tiếp = 2.000
    expect(tongLoiGoiDb).toBe(2 * trầnQuét); // = 4.000
    expect(tongLoiGoiDb).toBeLessThan(40000); // ★ TRƯỚC BG-67: 40.000 (= 2 × 20.000, xem docblock đầu file)
    expect(bf.remaining).toBe(SO_MUC); // không mục nào bị mất — tất cả vẫn TẠM THỜI, còn trong hàng đợi
  });

  it("không đói hàng đuôi qua NHIỀU tick (con trỏ xoay vòng): 500 mục, trần quét=100, 5 tick ⇒ MỌI mục được chạm ĐÚNG một lần, 0 mục attempts=0", async () => {
    process.env.INSPECTION_STORE_FORWARD_MAX_SCAN_PER_TICK = "100";
    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED (mô phỏng DB gián đoạn)");
    });
    setDedupFn(async () => false);

    for (let n = 0; n < 500; n++) {
      await bufferSubmission(submission(`SN-TAIL-${String(n).padStart(3, "0")}`));
    }
    expect(bufferedInspectionCount()).toBe(500);

    for (let tick = 0; tick < 5; tick++) {
      const bf = await backfillInspections();
      expect(bf.deadLettered).toBe(0);
    }

    const raw = await fs.readFile(walPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(500);
    const attemptsList = lines.map((l) => (JSON.parse(l) as { attempts: number }).attempts);
    const chuaDuocThuLanNao = attemptsList.filter((a) => a === 0);
    expect(chuaDuocThuLanNao).toEqual([]); // ★ không mục nào bị đói — con trỏ xoay vòng đã chạm HẾT
    expect(attemptsList.every((a) => a === 1)).toBe(true); // 5 tick × 100/tick = 500 lượt chạm, mỗi mục ĐÚNG 1 lần
  });

  it("cấu hình được qua INSPECTION_STORE_FORWARD_MAX_SCAN_PER_TICK", () => {
    process.env.INSPECTION_STORE_FORWARD_MAX_SCAN_PER_TICK = "777";
    expect(getInspectionStoreForwardStatus().maxScanPerTick).toBe(777);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mệnh đề 7 — ★ CHỐNG HỒI QUY: mệnh đề vòng sửa 2 (200 mục, 0 dead-letter, 0 chưa-thử) SỐNG SÓT
// qua bản vá BG-67 (kiểm ĐỘC LẬP tại đây — bộ đầy đủ nằm ở
// inspectionStoreForwardKhongChanDauHang.test.ts, describe "V2-1").
// ═══════════════════════════════════════════════════════════════════════════════
describe("Mệnh đề 7 — CHỐNG HỒI QUY: trần quét (mặc định 2.000) KHÔNG tái tạo lỗ C-1 cho 200 mục", () => {
  it("200 mục toàn lỗi tạm thời, 25 lượt ⇒ vẫn 0 dead-letter, 0 mục attempts=0 (như vòng sửa 2)", async () => {
    setProcessFn(async () => {
      throw pgErr("08006", "could not connect to server");
    });
    setDedupFn(async () => false);

    for (let n = 0; n < 200; n++) {
      await bufferSubmission(submission(`SN-REG-${String(n).padStart(3, "0")}`));
    }

    let bf: Awaited<ReturnType<typeof backfillInspections>> | undefined;
    for (let tick = 0; tick < 25; tick++) {
      bf = await backfillInspections();
    }

    expect(bf!.deadLettered).toBe(0);
    expect(bufferedInspectionCount()).toBe(200);

    const raw = await fs.readFile(walPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    const attemptsList = lines.map((l) => (JSON.parse(l) as { attempts: number }).attempts);
    expect(attemptsList.filter((a) => a === 0)).toEqual([]);
    expect(attemptsList.every((a) => a === 25)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// cờ TẮT ⇒ hành vi y hệt trước (docblock HONESTY) — không hồi quy bởi bản vá này
// ═══════════════════════════════════════════════════════════════════════════════
describe("cờ TẮT ⇒ hành vi y hệt trước — không hồi quy bởi Pha 1E Task 1", () => {
  it("buffer/backfill là no-op khi INSPECTION_STORE_FORWARD_ENABLED=false", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    const r = await bufferSubmission(submission("SN-OFF"));
    expect(r.buffered).toBe(false);
    const bf = await backfillInspections();
    expect(bf.enabled).toBe(false);
    expect(bf.drained).toBe(0);
  });
});
