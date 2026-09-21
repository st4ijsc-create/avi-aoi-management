import { describe, it, expect } from "vitest";
import { laTenCongNghe, locBoTenCongNghe } from "./tenCongNghe";

describe("laTenCongNghe — G11 (audit 2026-09-22 · dự án thật D3)", () => {
  it("★★★ CA THẬT ĐÃ ĐO: 8 tên công nghệ từng bị bắt thành đường dẫn tệp", () => {
    for (const t of ["Node.js", "Next.js", "Vue.js", "Chart.js", "Express.js", "Three.js", "Nest.js", "Nuxt.js"]) {
      expect(laTenCongNghe(t), t).toBe(true);
    }
  });

  it("★ không phân biệt hoa thường", () => {
    expect(laTenCongNghe("node.js")).toBe(true);
    expect(laTenCongNghe("NODE.JS")).toBe(true);
    expect(laTenCongNghe("ReAcT.Ts")).toBe(true);
  });

  it("★★★ CÓ VỊ TRÍ ⇒ LÀ ĐƯỜNG DẪN THẬT, không bao giờ bị cướp", () => {
    // Đây là vế giữ cho bản vá không đánh đổi gì: repo được phép có một tệp tên như vậy.
    expect(laTenCongNghe("src/Node.js")).toBe(false);
    expect(laTenCongNghe("public/js/Three.js")).toBe(false);
    expect(laTenCongNghe("src/vendor/Chart.js")).toBe(false);
    expect(laTenCongNghe("a\\b\\Vue.js")).toBe(false);
  });

  it("★ tệp repo bình thường ⇒ false (không được chặn nhầm)", () => {
    for (const t of ["App.tsx", "index.ts", "server.js", "main.ts", "config.js", "package.json", "toolRegistry.ts", "validate.mjs"]) {
      expect(laTenCongNghe(t), t).toBe(false);
    }
  });

  it("★ đuôi KHÔNG phải họ JS/TS ⇒ luôn là tệp, kể cả thân trùng tên công nghệ", () => {
    // `node.md`, `react.json` gần như chắc chắn là tệp tài liệu/cấu hình thật trong repo.
    expect(laTenCongNghe("node.md")).toBe(false);
    expect(laTenCongNghe("react.json")).toBe(false);
    expect(laTenCongNghe("vue.css")).toBe(false);
    expect(laTenCongNghe("chart.sql")).toBe(false);
  });

  it("★ đầu vào rác ⇒ false, không ném", () => {
    for (const t of [null, undefined, "", "   ", "node", ".js", "js", "..."]) {
      expect(laTenCongNghe(t as string), String(t)).toBe(false);
    }
  });

  it("★ KHÔNG chặn các thân hay được đặt cho tệp thật", () => {
    // Danh sách này là ranh giới có chủ đích của bảng — xem docblock.
    for (const t of ["index.js", "app.ts", "main.js", "server.ts", "test.js", "utils.ts"]) {
      expect(laTenCongNghe(t), t).toBe(false);
    }
  });
});

describe("locBoTenCongNghe", () => {
  it("★★★ CA THẬT: câu D3 trích ra hai token, chỉ token công nghệ bị bỏ", () => {
    expect(locBoTenCongNghe(["Node.js", "server/routes/api.js"])).toEqual(["server/routes/api.js"]);
  });

  it("★ giữ NGUYÊN THỨ TỰ và không đụng danh sách sạch", () => {
    const sach = ["a/b.ts", "c/d.tsx", "package.json"];
    expect(locBoTenCongNghe(sach)).toEqual(sach);
  });

  it("★ lọc sạch hết ⇒ mảng rỗng (người gọi phải coi đó là 'không nêu tệp nào')", () => {
    expect(locBoTenCongNghe(["Node.js", "React.js"])).toEqual([]);
  });

  it("★ mảng rỗng ⇒ mảng rỗng", () => {
    expect(locBoTenCongNghe([])).toEqual([]);
  });
});
