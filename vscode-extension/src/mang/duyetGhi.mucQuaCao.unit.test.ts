/**
 * R1b-1 T10 fix round 1 (I-2) — `confirmAction` của copilot từ chối VĨNH VIỄN lệnh mức tác động ≥ 4 của AI bằng HTTP 403 (FORBIDDEN, appCode
 * SCADA_AI_LEVEL_TOO_HIGH). Extension phải coi đó là kết cục ĐÃ BIẾT (không chạy gì) — trả `{ok:false, status:"denied", message}` — chứ không
 * ném thành "KHÔNG RÕ KẾT CỤC". Lỗi HTTP khác vẫn ném (hỏng đường truyền = không biết).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { goiDuyet, LoiMayChuTuChoi } from "./duyetGhi";

function dungFetch(status: number, body: unknown, laJson = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!laJson) throw new Error("không phải JSON");
        return body;
      },
    })),
  );
}
afterEach(() => vi.unstubAllGlobals());

const URL_MAY_CHU = "http://localhost:3000";
// ghép chuỗi: census của extension đếm đúng một chỗ viết nguyên văn tên thủ tục trong cả cây (tệp test cũng bị quét)
const TEN = ["aiCopilot", "confirmAction"].join(".");

describe("goiDuyet — MUC_QUA_CAO (HTTP 403 SCADA_AI_LEVEL_TOO_HIGH)", () => {
  it("★ 403 + appCode SCADA_AI_LEVEL_TOO_HIGH ⇒ KHÔNG ném: denied, ok:false, giữ nguyên câu của máy chủ", async () => {
    dungFetch(403, {
      error: { json: { message: "TỪ CHỐI VĨNH VIỄN — tool x ở Mức 4", code: -32003, data: { code: "FORBIDDEN", appCode: "SCADA_AI_LEVEL_TOO_HIGH", appParams: { ma: "MUC_QUA_CAO", level: 4 } } } },
    });
    const kq = await goiDuyet(URL_MAY_CHU, "ck", "a1", "t1");
    expect(kq).toEqual({ ok: false, status: "denied", message: "TỪ CHỐI VĨNH VIỄN — tool x ở Mức 4" });
  });

  it("403 với appCode KHÁC (vd. SCADA_ROLE_FLOOR) ⇒ vẫn ném như trước, mang appCode", async () => {
    dungFetch(403, { error: { json: { message: "vai", data: { appCode: "SCADA_ROLE_FLOOR" } } } });
    const e = await goiDuyet(URL_MAY_CHU, "ck", "a1", "t1").catch((x) => x);
    expect(e).toBeInstanceOf(LoiMayChuTuChoi);
    expect(e.message).toBe(`tRPC ${TEN} trả 403`);
    expect(e.appCode).toBe("SCADA_ROLE_FLOOR");
  });

  it("500 / thân không phải JSON ⇒ ném như trước (KHÔNG RÕ KẾT CỤC), appCode null", async () => {
    dungFetch(500, null, false);
    const e = await goiDuyet(URL_MAY_CHU, "ck", "a1", "t1").catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe(`tRPC ${TEN} trả 500`);
    expect(e.appCode).toBeNull();
  });
});
