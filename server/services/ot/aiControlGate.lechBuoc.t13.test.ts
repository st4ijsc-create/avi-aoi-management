/**
 * SCADA R1b-1 T13 — câu OFF_STEP trên đường AI DÙNG LẠI câu HMI: ba câu của `cauLechBuocChoAi` phải trùng TỪNG KÝ TỰ với
 * `errors.SCADA_VALUE_OFF_STEP` / `errors.SCADA_VALUE_OFF_STEP_NO_HINT` ở `client/src/i18n/locales/{vi,en,zh}.json` (máy chủ không có
 * i18next — bản chép được canh bằng test này, lệch ⇒ đỏ). Thuần, không DB.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAU_LECH_BUOC_CHO_TEST, cauLechBuocChoAi } from "./aiControlGate";

const GOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const locale = (l: string) => JSON.parse(readFileSync(join(GOC, "client/src/i18n/locales", `${l}.json`), "utf8")) as { errors: Record<string, string> };

describe("T13 — cauLechBuocChoAi: câu OFF_STEP của AI = câu HMI (locale), ba ngôn ngữ", () => {
  for (const l of ["vi", "en", "zh"] as const) {
    it(`${l}: hai khuôn trùng locale errors.*`, () => {
      const e = locale(l).errors;
      expect(CAU_LECH_BUOC_CHO_TEST.SCADA_VALUE_OFF_STEP[l]).toBe(e.SCADA_VALUE_OFF_STEP);
      expect(CAU_LECH_BUOC_CHO_TEST.SCADA_VALUE_OFF_STEP_NO_HINT[l]).toBe(e.SCADA_VALUE_OFF_STEP_NO_HINT);
    });
  }

  it("điền tham số từ DispatchResult.appError; không còn {{…}} sót", () => {
    const kq = { appError: { appCode: "SCADA_VALUE_OFF_STEP", appParams: { ma: "OFF_STEP", tagKey: "sc10cu", step: 10, goiY: 30 } } };
    expect(cauLechBuocChoAi("vi", kq)).toBe("Giá trị không nằm trên bước 10 của kênh sc10cu. Giá trị hợp lệ gần nhất: 30 — hãy chọn lại.");
    expect(cauLechBuocChoAi("en", kq)).toBe("The value is not on step 10 of channel sc10cu. Nearest valid value: 30 — please choose again.");
    expect(cauLechBuocChoAi("zh", kq)).not.toMatch(/\{\{/);
    const khong = { appError: { appCode: "SCADA_VALUE_OFF_STEP_NO_HINT", appParams: { ma: "OFF_STEP", tagKey: "t", step: 0.5 } } };
    expect(cauLechBuocChoAi("en", khong)).toBe("The value is not on step 0.5 of channel t — please choose again.");
  });

  it("không appError / mã khác ⇒ null (tool giữ câu cũ)", () => {
    expect(cauLechBuocChoAi("vi", {})).toBeNull();
    expect(cauLechBuocChoAi("vi", null)).toBeNull();
    expect(cauLechBuocChoAi("vi", { appError: { appCode: "OT_COMMAND_SUPERSEDED_BY_STOP", appParams: {} } })).toBeNull();
  });
});
