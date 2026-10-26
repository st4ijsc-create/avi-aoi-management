/** ★ Đợt 10.3 — một cách viết tên nhà cung cấp: CHECK SQL 0414, enum 0413 / drizzle và mã `ngoai:` dùng ĐÚNG `NHA_CUNG_CAP_NGOAI`. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { apiKeyProviderEnum } from "../../../../drizzle/schema/enums";
import { CHON_MODEL_RE, NHA_CUNG_CAP_NGOAI } from "./kieu";

const goc = path.resolve(__dirname, "../../../..");

describe("tên nhà cung cấp AI ngoài — một nguồn", () => {
  it("CHECK ai_ngoai_model_ncc_chk (0414) liệt kê ĐÚNG danh sách", () => {
    const sql = fs.readFileSync(path.join(goc, "drizzle/0414_ai_ngoai_khoa_cau_hinh.sql"), "utf8");
    const m = sql.match(/ai_ngoai_model_ncc_chk" CHECK \("nhaCungCap" IN \(([^)]*)\)\)/);
    expect(m, "không thấy CHECK nhà cung cấp").not.toBeNull();
    expect(m![1]!.split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...NHA_CUNG_CAP_NGOAI]);
  });

  it("enum apikeyprovider (0413 + drizzle) chứa mọi tên; mã ngoai:<ncc>:<model> nhận mọi tên", () => {
    const sql = fs.readFileSync(path.join(goc, "drizzle/0413_ai_ngoai_nha_cung_cap.sql"), "utf8");
    for (const ncc of NHA_CUNG_CAP_NGOAI) {
      expect(apiKeyProviderEnum.enumValues).toContain(ncc);
      if (ncc !== "openai") expect(sql).toContain(`ADD VALUE IF NOT EXISTS '${ncc}'`);
      expect(CHON_MODEL_RE.test(`ngoai:${ncc}:model-x`), ncc).toBe(true);
    }
  });
});
