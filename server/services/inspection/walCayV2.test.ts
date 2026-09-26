/**
 * server/services/inspection/walCayV2.test.ts
 *
 * Doc 2026-08-29 (WAL cho cây v2.0) Task 1 — lưới đơn vị cho §QĐ-WAL-A
 * (`docs/superpowers/plans/2026-08-29-aoi-wal-cho-cay-v2.md`): điều phối khoá gửi HAI
 * họ (v1.x `computeSubmissionKey` / v2.0 `dungKhoaKhuTrungV2`, qua
 * `dungKhoaGuiTheoHinhDang`) + hệ quả THẬT trên buffer WAL (`inspectionStoreForward.ts`
 * đã chín — nối vào, không dựng cái thứ hai).
 *
 * ── Cái bẫy trung tâm (task-1-brief.md) ──────────────────────────────────────────────
 * `computeSubmissionKey` băm serialNumber | inspectionTime | overallResult |
 * measurements.length. Với payload v2.0: `serialNumber` RỖNG là HỢP LỆ (tài liệu máy:
 * "rỗng nếu máy chưa gửi") và v2.0 mang `surfaces` — KHÔNG BAO GIỜ có `measurements`
 * ⇒ measurements.length LUÔN là 0. Hai bo v2.0 KHÁC NHAU, cùng trạm, cùng
 * `inspectionTime`, cả hai serial rỗng, cùng `overallResult` ⇒ TRÙNG KHOÁ theo công
 * thức v1 ⇒ WAL nuốt bo thứ hai, coi là bản sao — MẤT DỮ LIỆU do chính cơ chế chống
 * mất dữ liệu.
 *
 * BỐN mệnh đề canh (task-1-brief.md §Bước 1):
 *  1. ★★★ TRUNG TÂM — hai bo v2.0 KHÁC NHAU, cùng trạm, cùng inspectionTime, cả hai
 *     serial RỖNG ⇒ HAI khoá KHÁC NHAU qua `dungKhoaGuiTheoHinhDang`. Ca ĐẦU TIÊN của
 *     describe dưới đây chạy CHÍNH cặp bo đó qua `computeSubmissionKey` (công thức v1
 *     trần) để chứng minh chúng TRÙNG — bằng chứng lỗ có thật, không suy đoán.
 *  2. Cùng một payload v2.0 (deep clone) ⇒ CÙNG khoá (tất định — không
 *     Math.random()/Date.now()).
 *  3. Payload v1.x vẫn dùng `computeSubmissionKey` — chống hồi quy, đường cũ không đổi
 *     hành vi.
 *  4. Điều phối chọn công thức THEO HÌNH DẠNG (`laHinhDangCayV2`), KHÔNG theo
 *     `schemaVersion` khai báo (trường đó optional — máy có thể không gửi, hoặc khai
 *     SAI).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  computeSubmissionKey,
  dungKhoaGuiTheoHinhDang,
  bufferSubmission,
  backfillInspections,
  bufferedInspectionCount,
  isPermanentSubmitError,
  setProcessFn,
  setDedupFn,
  _resetInspectionStoreForward,
  type BufferedSubmission,
} from "./inspectionStoreForward";
import { mauHopLe } from "../../contracts/machineDataContractV2.test-helpers";

// ── payload mẫu ───────────────────────────────────────────────────────────────────

/** Payload v2.0 HỢP LỆ (mauHopLe, đủ 4 cấp) với serial RỖNG mặc định — override qua `over`. */
function boV2(over: Record<string, unknown> = {}): BufferedSubmission {
  const p = mauHopLe();
  return { ...p, serialNumber: "", ...over } as unknown as BufferedSubmission;
}

function boV1(serial: string, extra: Partial<BufferedSubmission> = {}): BufferedSubmission {
  return {
    apiKey: "TEST-KEY",
    serialNumber: serial,
    inspectionTime: "2026-07-04T08:00:00.000Z",
    overallResult: "OK",
    measurements: [],
    ...extra,
  };
}

const CUNG_TRAM = {
  identity: {
    station: "ST1",
    machine: "M1",
    line: "L1",
    plant: "P1",
    country: "VN",
    solutionName: "InspectProAOI",
    appVersion: "1.0.0",
  },
};

let walPath: string;

beforeEach(() => {
  walPath = path.join(
    os.tmpdir(),
    `insp-sf-v2-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
  process.env.INSPECTION_STORE_FORWARD_FILE = walPath;
  process.env.INSPECTION_STORE_FORWARD_ENABLED = "true";
  delete process.env.OT_STORE_FORWARD_ENABLED;
  _resetInspectionStoreForward();
});

afterEach(async () => {
  _resetInspectionStoreForward();
  for (const f of [walPath, walPath.replace(/\.jsonl$/, "") + ".dead.jsonl"]) {
    try {
      await fs.unlink(f);
    } catch {
      /* có thể chưa tồn tại */
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("mệnh đề 1 (★★★ TRUNG TÂM) — hai bo v2.0 khác nhau, cùng trạm, cùng inspectionTime, serial rỗng", () => {
  function boA(): BufferedSubmission {
    return boV2({
      ...CUNG_TRAM,
      productId: "PROD-A",
      startedAt: "2026-08-29T02:59:50.000Z",
      inspectionTime: "2026-08-29T03:00:00.000Z",
    });
  }
  function boB(): BufferedSubmission {
    return boV2({
      ...CUNG_TRAM,
      productId: "PROD-B", // ← board THẬT SỰ khác nhau
      startedAt: "2026-08-29T03:00:05.000Z",
      inspectionTime: "2026-08-29T03:00:00.000Z", // ← CÙNG inspectionTime
    });
  }

  it("ĐỎ (bằng chứng lỗ, trước khi có dungKhoaGuiTheoHinhDang) — computeSubmissionKey (công thức v1 trần) cho hai khoá TRÙNG NHAU", () => {
    const keyA = computeSubmissionKey(boA());
    const keyB = computeSubmissionKey(boB());
    // ⚠ Đây CHÍNH LÀ lỗ: hai bo khác hẳn nhau (productId/startedAt khác) nhưng công
    // thức v1 chỉ nhìn serial(rỗng)+inspectionTime+overallResult+measurements.length(0)
    // — bốn thứ ĐỀU giống nhau ⇒ một khoá.
    expect(keyA).toBe(keyB);
  });

  it("XANH — dungKhoaGuiTheoHinhDang (điều phối theo hình dạng, §QĐ-WAL-A) cho hai khoá KHÁC NHAU", () => {
    const keyA = dungKhoaGuiTheoHinhDang(boA());
    const keyB = dungKhoaGuiTheoHinhDang(boB());
    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith("v2i-")).toBe(true);
    expect(keyB.startsWith("v2i-")).toBe(true);
  });

  it("hệ quả THẬT trên WAL — hai bo v2.0 khác nhau ⇒ HAI entry buffer riêng, không bo nào bị nuốt là 'trùng'", async () => {
    setProcessFn(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    setDedupFn(async () => false);

    const rA = await bufferSubmission(boA());
    const rB = await bufferSubmission(boB());

    expect(rA.buffered).toBe(true);
    expect(rB.buffered).toBe(true);
    // ⚠ nếu bufferSubmission còn dùng computeSubmissionKey trực tiếp, rB.duplicate sẽ
    // là true (bo B bị coi là bản sao của bo A) — đây chính là ca phải ĐỎ nếu regress.
    expect(rB.duplicate).toBe(false);
    expect(rA.key).not.toBe(rB.key);
    expect(bufferedInspectionCount()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("mệnh đề 2 — cùng một payload v2.0 (deep clone) ⇒ cùng khoá (tất định)", () => {
  it("dungKhoaGuiTheoHinhDang ổn định qua nhiều lượt gọi, không random/Date.now", () => {
    const p = boV2({ ...CUNG_TRAM, productId: "PROD-DET", startedAt: "2026-08-29T01:00:00.000Z" });
    const k1 = dungKhoaGuiTheoHinhDang(structuredClone(p));
    const k2 = dungKhoaGuiTheoHinhDang(structuredClone(p));
    const k3 = dungKhoaGuiTheoHinhDang(structuredClone(p));
    expect(k1).toBe(k2);
    expect(k2).toBe(k3);
  });

  it("buffer CÙNG payload v2.0 hai lượt (retry mạng) ⇒ lượt hai nhận diện đúng là bản sao, không tạo entry thứ hai", async () => {
    setProcessFn(async () => ({ inspectionId: 1 }));
    setDedupFn(async () => false);
    const p = boV2({ ...CUNG_TRAM, productId: "PROD-RETRY", startedAt: "2026-08-29T05:00:00.000Z" });

    const r1 = await bufferSubmission(structuredClone(p));
    const r2 = await bufferSubmission(structuredClone(p));
    expect(r1.buffered).toBe(true);
    expect(r2.duplicate).toBe(true);
    expect(r1.key).toBe(r2.key);
    expect(bufferedInspectionCount()).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("mệnh đề 3 — payload v1.x vẫn dùng computeSubmissionKey (chống hồi quy)", () => {
  it("dungKhoaGuiTheoHinhDang(payload v1.x) === computeSubmissionKey(payload v1.x) — byte-for-byte, không đổi hành vi đường cũ", () => {
    const p = boV1("SN-1");
    expect(dungKhoaGuiTheoHinhDang(p)).toBe(computeSubmissionKey(p));
  });

  it("khác serial/inspectionTime vẫn cho khoá khác nhau qua dispatcher — y hệt computeSubmissionKey trần", () => {
    const base = boV1("SN-1");
    expect(dungKhoaGuiTheoHinhDang(boV1("SN-2"))).not.toBe(dungKhoaGuiTheoHinhDang(base));
    expect(
      dungKhoaGuiTheoHinhDang(boV1("SN-1", { inspectionTime: "2026-07-04T09:00:00.000Z" })),
    ).not.toBe(dungKhoaGuiTheoHinhDang(base));
  });

  it("buffer một payload v1.x vẫn dùng khoá y hệt computeSubmissionKey trực tiếp", async () => {
    setProcessFn(async () => ({ inspectionId: 1 }));
    setDedupFn(async () => false);
    const p = boV1("SN-REG");
    const r = await bufferSubmission(p);
    expect(r.key).toBe(computeSubmissionKey(p));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("mệnh đề 4 — điều phối chọn công thức THEO HÌNH DẠNG, KHÔNG theo schemaVersion", () => {
  it("payload v2.0 KHÔNG khai schemaVersion vẫn được nhận diện đúng theo mảng surfaces (đi đường v2, không rơi về v1)", () => {
    const p = boV2({ ...CUNG_TRAM, productId: "PROD-NOVER" }) as Record<string, unknown>;
    delete p.schemaVersion;
    expect("schemaVersion" in p).toBe(false);

    const key = dungKhoaGuiTheoHinhDang(p as unknown as BufferedSubmission);
    expect(key.startsWith("v2i-")).toBe(true);
    // Phải KHÁC computeSubmissionKey — tức KHÔNG rơi về công thức v1 vì thiếu schemaVersion.
    expect(key).not.toBe(computeSubmissionKey(p as unknown as BufferedSubmission));
  });

  it("payload v2.0 khai schemaVersion SAI (\"1.1\", giả mạo) nhưng hình dạng surfaces THẬT ⇒ vẫn đi đường v2 (hình dạng thắng)", () => {
    const p = boV2({ ...CUNG_TRAM, productId: "PROD-FAKEVER", schemaVersion: "1.1" });
    const key = dungKhoaGuiTheoHinhDang(p);
    expect(key.startsWith("v2i-")).toBe(true);
  });

  it("payload v1.x (mảng measurements, không có surfaces) dù CÓ khai schemaVersion=\"2.0\" (giả mạo) vẫn KHÔNG được coi là cây — hình dạng thắng theo chiều ngược lại", () => {
    const p = boV1("SN-FAKE-V2", { schemaVersion: "2.0" });
    const key = dungKhoaGuiTheoHinhDang(p);
    expect(key).toBe(computeSubmissionKey(p)); // vẫn công thức v1 — không có `surfaces` thì không phải hình dạng cây
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe("buffer khi lỗi tạm thời — ranh giới TẠM THỜI/VĨNH VIỄN (dùng lại isPermanentSubmitError, không tự chế)", () => {
  it("phân loại lỗi giống hệt đường v1.x — không có cách phân loại RIÊNG cho v2.0", () => {
    expect(isPermanentSubmitError(new TRPCError({ code: "BAD_REQUEST" }))).toBe(true);
    expect(isPermanentSubmitError(new TRPCError({ code: "UNAUTHORIZED" }))).toBe(true);
    expect(isPermanentSubmitError(new TRPCError({ code: "INTERNAL_SERVER_ERROR" }))).toBe(false);
    expect(isPermanentSubmitError(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("payload v2.0 buffer được và replay đúng MỘT lần khi DB hồi phục (idempotent qua khoá v2)", async () => {
    const processed: BufferedSubmission[] = [];
    let dbUp = false;
    setProcessFn(async (p) => {
      if (!dbUp) throw new Error("connect ECONNREFUSED");
      processed.push(p);
      return { inspectionId: 500 };
    });
    setDedupFn(async () => false);

    const p = boV2({ ...CUNG_TRAM, productId: "PROD-REPLAY", startedAt: "2026-08-29T04:00:00.000Z" });
    const r1 = await bufferSubmission(p);
    expect(r1.buffered).toBe(true);

    // DB vẫn down → vẫn nằm trong hàng đợi.
    let bf = await backfillInspections();
    expect(bf.drained).toBe(0);
    expect(bf.remaining).toBe(1);

    dbUp = true;
    bf = await backfillInspections();
    expect(bf.drained).toBe(1);
    expect(bf.remaining).toBe(0);
    expect(processed).toHaveLength(1);
  });

  it("cờ WAL TẮT ⇒ bufferSubmission là no-op cho CẢ payload v2.0 (passthrough y hệt v1.x, không đổi mặc định)", async () => {
    process.env.INSPECTION_STORE_FORWARD_ENABLED = "false";
    const r = await bufferSubmission(boV2({ ...CUNG_TRAM, productId: "PROD-OFF" }));
    expect(r.buffered).toBe(false);
    expect(bufferedInspectionCount()).toBe(0);
  });
});
