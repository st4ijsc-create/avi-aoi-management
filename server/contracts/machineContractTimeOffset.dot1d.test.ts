/**
 * doc 81 Đợt 1D final wave 3 — M2 + M7 (final review, ruling R-1D-l). THUẦN, không DB.
 *
 * M2: `validateMachinePayload` là công cụ TỰ KIỂM của đối tác (machineContract.validate) và được tài liệu hoá "không
 *     ném". Khi INGEST_REQUIRE_PACKAGE_TIME_OFFSET bật, mốc thời gian TRẦN làm refinement NÉM `TimeOffsetRequiredError`
 *     (cần ném để tRPC giữ mã — xem docblock lỗi) ⇒ trước đây validate ném ra 500. Nay: báo cáo có cấu trúc.
 * M7: câu chữ lỗi đi tới máy qua REST (`message`) và làm fallback appError ⇒ KHÔNG mang tên cờ .env; token máy đọc
 *     `time_offset_required` giữ nguyên.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateMachinePayload } from "./machineDataContract";
import { mauHopLe } from "./machineDataContractV2.test-helpers";
import { TimeOffsetRequiredError } from "../utils/timeOffsetPolicy";

/** Tên cờ .env kiểu UPPER_SNAKE_CASE (≥ 2 đoạn). */
const ENV_VAR_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/;

let truoc: string | undefined;
beforeEach(() => {
  truoc = process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
});
afterEach(() => {
  if (truoc === undefined) delete process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
  else process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = truoc;
});

describe("M2 — validateMachinePayload KHÔNG ném khi cờ mốc gói BẬT", () => {
  it("cờ BẬT + completedAt TRẦN ⇒ trả {ok:false, errors:[completedAt … time_offset_required]}, không ném", () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = mauHopLe();
    expect(p.completedAt).toBe("2026-08-18T09:30:14.400"); // chuỗi trần (mẫu máy thật)
    let r: ReturnType<typeof validateMachinePayload> | undefined;
    expect(() => {
      r = validateMachinePayload("2.0", p);
    }).not.toThrow();
    expect(r!.ok).toBe(false);
    expect(r!.version).toBe("2.0");
    expect(r!.errors).toHaveLength(1);
    expect(r!.errors![0].path).toMatch(/startedAt|completedAt/);
    expect(r!.errors![0].message).toContain("time_offset_required");
    expect(r!.errors![0].message).not.toMatch(ENV_VAR_RE);
  });

  it("cờ BẬT + mốc CÓ múi giờ ⇒ ok:true; cờ TẮT (mặc định) + mốc trần ⇒ ok:true như cũ", () => {
    process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
    const p = mauHopLe();
    p.startedAt = "2026-08-18T09:30:00.000+07:00";
    p.completedAt = "2026-08-18T09:30:14.400Z";
    expect(validateMachinePayload("2.0", p)).toEqual({ ok: true, version: "2.0" });
    delete process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
    expect(validateMachinePayload("2.0", mauHopLe())).toEqual({ ok: true, version: "2.0" });
  });
});

describe("M7 — câu lỗi thiếu múi giờ không mang tên cờ .env", () => {
  it.each(["inspectionTime", "completedAt", "startedAt"] as const)("%s ⇒ giữ token time_offset_required, không tên cờ", (field) => {
    const e = new TimeOffsetRequiredError(field, "2026-08-18T09:30:14");
    expect(e.message).toContain("time_offset_required");
    expect(e.message).toContain(field);
    expect(e.message).not.toMatch(ENV_VAR_RE);
    expect(e.appParams).toEqual({ field, reason: "timeOffsetRequired" });
  });
});
