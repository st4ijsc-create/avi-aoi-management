/**
 * R2 — cắt THEO KÝ HIỆU cho tài liệu tham chiếu API (`chunkTheoKyHieu`). Thuần — không mock.
 * ĐỘT BIẾN PHẢI BẮT: bỏ dòng `# Kiểu` khỏi đoạn · kích hoạt khi KHÔNG có dấu · mục dài không cắt tiếp ·
 * lát tiếp mất tên ký hiệu.
 */
import { describe, it, expect } from "vitest";
import { chunkTheoKyHieu, DAU_CHUNK_KY_HIEU, chunkText } from "./kbIngestService";

const TAI_LIEU = [
  DAU_CHUNK_KY_HIEU,
  "# Microsoft.Data.SqlClient.SqlDataReader",
  "",
  "Nguồn: XML doc.",
  "",
  "## SqlDataReader.GetInt32(Int32)",
  "- Tham số `i`: The zero-based column ordinal.",
  "",
  "## SqlDataReader.GetOrdinal(String)",
  "Gets the column ordinal, given the name of the column.",
].join("\r\n");

describe("chunkTheoKyHieu", () => {
  it("không có dấu ở dòng đầu ⇒ null (tài liệu thường đi chunkText y hệt trước)", () => {
    expect(chunkTheoKyHieu("# Tiêu đề\n\n## Mục\nnội dung")).toBeNull();
    expect(chunkTheoKyHieu(`văn bản\n${DAU_CHUNK_KY_HIEU}\n## x`)).toBeNull();
  });

  it("mỗi `##` một đoạn, MỌI đoạn mang `# Kiểu`; phần mở đầu thành đoạn riêng; CRLF chuẩn hoá", () => {
    const d = chunkTheoKyHieu(TAI_LIEU)!;
    expect(d).toHaveLength(3);
    expect(d.every((x) => x.startsWith("# Microsoft.Data.SqlClient.SqlDataReader\n"))).toBe(true);
    expect(d[1]).toContain("## SqlDataReader.GetInt32(Int32)");
    expect(d[1]).not.toContain("GetOrdinal");
    expect(d[2]).toContain("## SqlDataReader.GetOrdinal(String)");
    expect(d.join("")).not.toContain("\r");
    expect(d.join("")).not.toContain(DAU_CHUNK_KY_HIEU);
  });

  it("mục dài hơn maxChars ⇒ cắt tiếp; mỗi lát vẫn mang `# Kiểu` + tên ký hiệu, không lát nào vượt trần", () => {
    const dai = [DAU_CHUNK_KY_HIEU, "# K", "## K.M()", "x".repeat(1500)].join("\n");
    const d = chunkTheoKyHieu(dai, 400)!;
    expect(d.length).toBeGreaterThan(3);
    expect(d.every((x) => x.startsWith("# K\n## K.M()"))).toBe(true);
    expect(d.slice(1).every((x) => x.includes("(tiếp)"))).toBe(true);
    expect(Math.max(...d.map((x) => x.length))).toBeLessThanOrEqual(400);
    expect(d.map((x) => x.replace(/^# K\n## K\.M\(\)( \(tiếp\))?\n/, "")).join("").length).toBe(1500);
  });

  it("đối chứng: cùng tài liệu mà thiếu dấu ⇒ chunkText trơn gộp nhiều ký hiệu vào một đoạn", () => {
    expect(chunkText(TAI_LIEU.replace(DAU_CHUNK_KY_HIEU, ""))).toHaveLength(1);
  });
});
