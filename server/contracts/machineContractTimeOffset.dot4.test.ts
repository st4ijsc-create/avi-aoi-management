/**
 * doc 81 Đợt 4 Task C4 — vị trí CHÍNH XÁC của lỗi mốc thời gian lồng nhau ở công cụ tự kiểm.
 *
 * `validateMachinePayload` (machineContract.validate) chạy hợp đồng ở chế độ CHỈ KIỂM: `mocThoiGianMay` gọi
 * `ctx.addIssue` ⇒ đường dẫn lỗi là đường dẫn zod đầy đủ (vd `surfaces.0.positions.0.completedAt`), và báo ĐỦ mọi
 * mốc trần chứ không dừng ở cái đầu. Trước: refinement NÉM ⇒ chỉ còn tên trường trần ("completedAt"), mất vị trí.
 *
 * Đường ingest (parse thường — `.input()` tRPC, `metaJsonSchema.parse` cửa ZIP) KHÔNG đổi: vẫn ném
 * `TimeOffsetRequiredError` y hệt (lớp, field, appParams, message) — khẳng định so với lỗi dựng độc lập.
 * THUẦN, không DB.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateMachinePayload } from "./machineDataContract";
import { machineDataContractV2 } from "./machineDataContractV2";
import { mauHopLe } from "./machineDataContractV2.test-helpers";
import { TimeOffsetRequiredError } from "../utils/timeOffsetPolicy";

const CO_MUI = "2026-08-18T09:30:00.000+07:00";
const TRAN = "2026-08-18T09:31:00.000";

let truoc: string | undefined;
beforeEach(() => {
  truoc = process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
  process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = "true";
});
afterEach(() => {
  if (truoc === undefined) delete process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
  else process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET = truoc;
});

/** Payload: gốc CÓ múi giờ, chỉ MỘT mốc lồng sâu là trần. */
function mauLongSau() {
  const p = mauHopLe();
  p.startedAt = CO_MUI;
  p.completedAt = CO_MUI;
  p.surfaces[0].positions[0].captures[0].completedAt = TRAN;
  return p;
}

describe("C4 — validate-only: đường dẫn lỗi lồng nhau ĐÚNG", () => {
  it("★ mốc trần ở capture ⇒ path = surfaces.0.positions.0.captures.0.completedAt (không phải 'completedAt' trần)", () => {
    const r = validateMachinePayload("2.0", mauLongSau());
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([
      { path: "surfaces.0.positions.0.captures.0.completedAt", message: new TimeOffsetRequiredError("completedAt", TRAN).message },
    ]);
  });

  it("★ nhiều mốc trần ở nhiều cấp ⇒ báo ĐỦ, mỗi cái đúng vị trí", () => {
    const p = mauLongSau();
    p.startedAt = TRAN;
    p.surfaces[0].positions[0].startedAt = TRAN;
    const paths = validateMachinePayload("2.0", p).errors!.map((e) => e.path).sort();
    expect(paths).toEqual(["startedAt", "surfaces.0.positions.0.captures.0.completedAt", "surfaces.0.positions.0.startedAt"]);
  });

  it("lỗi zod khác vẫn báo kèm (không bị che): thiếu serialNumber + mốc trần ⇒ cả hai", () => {
    const p = mauLongSau();
    delete p.serialNumber;
    const paths = validateMachinePayload("2.0", p).errors!.map((e) => e.path);
    expect(paths).toContain("serialNumber");
    expect(paths).toContain("surfaces.0.positions.0.captures.0.completedAt");
  });

  it("cờ TẮT ⇒ ok như cũ", () => {
    delete process.env.INGEST_REQUIRE_PACKAGE_TIME_OFFSET;
    expect(validateMachinePayload("2.0", mauLongSau())).toEqual({ ok: true, version: "2.0" });
  });
});

describe("C4 — đường ingest KHÔNG đổi: vẫn NÉM TimeOffsetRequiredError y hệt", () => {
  function batLoi(fn: () => unknown): unknown {
    try {
      fn();
    } catch (e) {
      return e;
    }
    throw new Error("expected throw");
  }

  it("★ parse / safeParse thường (không chế độ chỉ kiểm) ⇒ ném, cùng lớp + field + appParams + message", () => {
    const ky = new TimeOffsetRequiredError("completedAt", TRAN);
    for (const e of [batLoi(() => machineDataContractV2.parse(mauLongSau())), batLoi(() => machineDataContractV2.safeParse(mauLongSau()))]) {
      expect(e).toBeInstanceOf(TimeOffsetRequiredError);
      const t = e as TimeOffsetRequiredError;
      expect({ name: t.name, field: t.field, appCode: t.appCode, appParams: t.appParams, message: t.message }).toEqual({
        name: ky.name, field: ky.field, appCode: ky.appCode, appParams: ky.appParams, message: ky.message,
      });
    }
  });

  it("★ chạy validate rồi ingest (cùng tiến trình) ⇒ chế độ chỉ kiểm KHÔNG rò: ingest vẫn ném", () => {
    validateMachinePayload("2.0", mauLongSau());
    expect(() => machineDataContractV2.parse(mauLongSau())).toThrow(TimeOffsetRequiredError);
  });

  it("validate gặp lỗi bất ngờ (payload làm zod ném) ⇒ chế độ vẫn được trả về; ingest sau đó vẫn ném", () => {
    const xau = mauLongSau();
    Object.defineProperty(xau, "serialNumber", { get() { throw new Error("getter hong"); }, enumerable: true });
    expect(() => validateMachinePayload("2.0", xau)).toThrow("getter hong");
    expect(() => machineDataContractV2.parse(mauLongSau())).toThrow(TimeOffsetRequiredError);
  });
});
