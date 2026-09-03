import { describe, it, expect } from "vitest";
import { dungVanBanDayMcpNgoai } from "./dayMcpDoc";
import { docYeuCauMcpNgoai } from "./yeuCauMcp";

describe("dungVanBanDayMcpNgoai", () => {
  it("★★★ danh sách RỖNG ⇒ chuỗi RỖNG (không phình câu hỏi khi H2 không được dùng)", () => {
    expect(dungVanBanDayMcpNgoai([])).toBe("");
  });

  it("★★ có tool ⇒ liệt kê ĐÚNG tên server/tool/mô tả", () => {
    const vb = dungVanBanDayMcpNgoai([{ server: "demo", tool: "get_weather", moTa: "lấy thời tiết" }]);
    expect(vb).toContain('server "demo"');
    expect(vb).toContain('tool "get_weather"');
    expect(vb).toContain("lấy thời tiết");
  });

  it("★★★ ví dụ khối rào trong văn bản dạy PARSE ĐƯỢC bằng ĐÚNG docYeuCauMcpNgoai — không lệch cú pháp", () => {
    const vb = dungVanBanDayMcpNgoai([{ server: "demo", tool: "get_weather", moTa: "x" }]);
    const yc = docYeuCauMcpNgoai(vb);
    expect(yc).toEqual([{ server: "demo", tool: "get_weather", dauVao: {} }]);
  });

  it("★★ nhiều tool ⇒ liệt kê đủ, ví dụ dùng tool ĐẦU TIÊN", () => {
    const vb = dungVanBanDayMcpNgoai([
      { server: "a", tool: "t1", moTa: "m1" },
      { server: "b", tool: "t2", moTa: "m2" },
    ]);
    expect(vb).toContain('server "a"');
    expect(vb).toContain('server "b"');
    expect(docYeuCauMcpNgoai(vb)).toEqual([{ server: "a", tool: "t1", dauVao: {} }]);
  });

  it("★★ mô tả rỗng ⇒ vẫn hiện chữ hợp lý, không để trống lơ lửng", () => {
    const vb = dungVanBanDayMcpNgoai([{ server: "s", tool: "t", moTa: "" }]);
    expect(vb).toContain("(không có mô tả)");
  });

  it("★★ nhắc rõ kết quả LÀ DỮ LIỆU không phải chỉ dẫn", () => {
    const vb = dungVanBanDayMcpNgoai([{ server: "s", tool: "t", moTa: "m" }]);
    expect(vb).toMatch(/DỮ LIỆU/);
    expect(vb).toMatch(/KHÔNG PHẢI/);
  });
});
