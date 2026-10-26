/**
 * SCADA R1b-2a Task 6 — `kiemPatchKenh` (thuần): luật MỚI "nâng mức tag đang ghim DỪNG qua ngưỡng STOP HMI ⇒ STOP_PIN_GO_TRUOC" ở mọi biên,
 * và `tagId` trong params của các lỗi rút từ capNhat. Đường DB đầy đủ: scadaKenhRouter.khaiHangLoat.r1b2.db.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { DeviceTag } from "../../../drizzle/schema";
import { readAppErrorMeta } from "../../_core/appError";
import { kiemPatchKenh, patchKhaiKenh } from "./khaiKenh";

const tag = (o: Partial<DeviceTag> = {}): DeviceTag =>
  ({
    id: 77,
    adapterId: 1,
    tagKey: "k",
    address: "a",
    dataType: "int",
    writable: true,
    isEnabled: true,
    scale: null,
    offset: null,
    stopValue: null,
    channelKind: null,
    displayName: null,
    displayFormat: null,
    writeMin: null,
    writeMax: null,
    writeStep: null,
    actuationLevel: null,
    ...o,
  }) as DeviceTag;

const loi = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    const m = readAppErrorMeta(e);
    return { appCode: m?.appCode, appParams: m?.appParams as Record<string, unknown> };
  }
  throw new Error("mong đợi lỗi");
};

describe("kiemPatchKenh — gỡ ghim trước khi nâng mức (R1b-2a T6)", () => {
  it("ghim + mức 1 → 3 / 4 / 5 / NULL ⇒ STOP_PIN_GO_TRUOC {tagId}", () => {
    for (const actuationLevel of [3, 4, 5, null] as const) {
      expect(loi(() => kiemPatchKenh(tag({ stopValue: 0, actuationLevel: 1 }), [], { actuationLevel })), String(actuationLevel)).toEqual({
        appCode: "STOP_PIN_GO_TRUOC",
        appParams: { ma: "STOP_PIN_GO_TRUOC", tagKey: "k", stopValue: "0", tagId: 77 },
      });
    }
  });

  it("KHÔNG từ chối: không ghim; ghim mà mức giữ 1; ghim mức 3 → 1 (hạ vào STOP); ghim mức 3 → 5 (đã ngoài STOP HMI); ghim NULL → 1", () => {
    expect(kiemPatchKenh(tag({ actuationLevel: 1 }), [], { actuationLevel: 5 }).doi).toBe(true);
    expect(kiemPatchKenh(tag({ stopValue: 0, actuationLevel: 1 }), [], { actuationLevel: 1 }).doi).toBe(false);
    expect(kiemPatchKenh(tag({ stopValue: 0, actuationLevel: 1 }), [], { displayName: "x" }).doi).toBe(true);
    expect(kiemPatchKenh(tag({ stopValue: 0, actuationLevel: 3 }), [], { actuationLevel: 1 }).doi).toBe(true);
    expect(kiemPatchKenh(tag({ stopValue: 0, actuationLevel: 3 }), [], { actuationLevel: 5 }).doi).toBe(true);
    expect(kiemPatchKenh(tag({ stopValue: 0, actuationLevel: null }), [], { actuationLevel: 1 }).doi).toBe(true);
  });

  it("ghim `false` (bool) cũng là ghim — mức 1 → 3 ⇒ từ chối", () => {
    expect(loi(() => kiemPatchKenh(tag({ dataType: "bool", stopValue: false, actuationLevel: 1 }), [], { actuationLevel: 3 })).appCode).toBe("STOP_PIN_GO_TRUOC");
  });

  it("lỗi rút từ capNhat mang tagId: INVALID_VALUE (min > max), STOP_PIN_NGOAI_DAI, INTERLOCK_NGOAI_DAI; patch rỗng ⇒ FIELD_REQUIRED {patch, tagId}", () => {
    expect(loi(() => kiemPatchKenh(tag(), [], { writeMin: 10, writeMax: 1 })).appParams).toMatchObject({ reason: "scadaDaiMinLonHonMax", tagId: 77 });
    // T6 polish (review m-4) — hai lỗi INVALID_VALUE còn lại cũng mang tagId
    expect(loi(() => kiemPatchKenh(tag({ dataType: "string" }), [], { writeMin: 0 }))).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "writeMin", reason: "scadaDaiChiChoKenhSo", tagId: 77 },
    });
    expect(loi(() => kiemPatchKenh(tag({ writable: false }), [], { channelKind: "output" }))).toEqual({
      appCode: "INVALID_VALUE",
      appParams: { field: "channelKind", reason: "scadaKenhGhiTrenTagKhongGhi", tagId: 77 },
    });
    expect(loi(() => kiemPatchKenh(tag({ stopValue: 0 }), [], { writeMin: 5 }))).toMatchObject({ appCode: "STOP_PIN_NGOAI_DAI", appParams: { tagId: 77 } });
    const luat = [{ id: 9, name: "r", action: "reduce_speed", enabled: true, commandValue: 50 }];
    expect(loi(() => kiemPatchKenh(tag(), luat, { writeMax: 10 }))).toMatchObject({ appCode: "INTERLOCK_NGOAI_DAI", appParams: { ruleId: 9, tagId: 77 } });
    expect(loi(() => patchKhaiKenh({}, 77))).toEqual({ appCode: "FIELD_REQUIRED", appParams: { field: "patch", tagId: 77 } });
    expect(loi(() => patchKhaiKenh({}))).toEqual({ appCode: "FIELD_REQUIRED", appParams: { field: "patch" } });
  });
});
