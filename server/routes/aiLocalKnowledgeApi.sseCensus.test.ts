/**
 * ★ CENSUS (2026-09-22) — **mọi kiểu `StreamEvent` mà service phát PHẢI có `case` ở dây SSE của route.**
 *
 * Lớp lỗi bắt được sống cùng ngày: F1/F2 thêm `usage` và `reasoning` vào `StreamEvent`, lưới tầng service xanh, nhưng
 * `switch (evt.type)` trong `/api/ai/local-kb/stream` là DANH SÁCH TRẮNG ⇒ hai kiểu mới rơi im lặng; thanh trạng thái hiện
 * `—`, bảng "đang nghĩ" trống — không lỗi nào đỏ. Đây là lớp *"đường thứ N quên"* (cùng họ với `chat_template_kwargs`
 * lắp tay từng builder). Lưới này đọc MÃ NGUỒN hai bên và đối chiếu, để kiểu thứ 13 không lặp lại chuyện của kiểu 11–12.
 *
 * ⚠ Cố ý đọc nguồn thay vì import kiểu: kiểu TypeScript bị xoá lúc chạy, không đếm được.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Các literal `type: "x"` trong khối `export type StreamEvent = … ;` của service. */
function kieuServicePhat(): string[] {
  const src = readFileSync(resolve(process.cwd(), "server/services/aiLocalKnowledgeService.ts"), "utf8");
  const dau = src.indexOf("export type StreamEvent =");
  expect(dau, "không tìm thấy `export type StreamEvent =` trong service").toBeGreaterThan(0);
  // Khối kết thúc ở dấu `;` đầu tiên đứng đầu dòng sau khối union (các nhánh `| {…}` không có `;` riêng).
  const sau = src.indexOf("\n;", dau) > 0 ? src.indexOf("\n;", dau) : src.indexOf("};\n", dau) + 2;
  const khoi = bocChuThich(src.slice(dau, sau > dau ? sau : dau + 20000));
  const kieu = new Set<string>();
  for (const m of khoi.matchAll(/type:\s*"([a-z_]+)"/g)) kieu.add(m[1]);
  return [...kieu].sort();
}

/** Các `case "x":` trong route SSE. */
function kieuRouteXuLy(): string[] {
  const src = bocChuThich(readFileSync(resolve(process.cwd(), "server/routes/aiLocalKnowledgeApi.ts"), "utf8"));
  const kieu = new Set<string>();
  for (const m of src.matchAll(/case\s+"([a-z_]+)"\s*:/g)) kieu.add(m[1]);
  return [...kieu].sort();
}

/**
 * Kiểu KHAI trong union nhưng chưa có NƠI PHÁT nào — được miễn `case` CHỈ khi vẫn không ai phát; lưới thứ hai canh điều
 * đó: hễ có nơi phát ⇒ phải nối dây (bỏ khỏi danh sách này) ⇒ đỏ đúng chỗ.
 * Lịch sử: 2026-09-22 census lộ `agent_plan`/`agent_step` (0 điểm phát, 0 consumer — di sản "kế hoạch tác nhân" chưa nối);
 * đã XOÁ khỏi union cùng ngày (B8) ⇒ danh sách rỗng. Giữ cơ chế cho lần sau.
 */
const KIEU_KHAI_MA_KHONG_PHAT: ReadonlySet<string> = new Set<string>([]);

/** Số điểm PHÁT (`type: "x"`) của một kiểu trong service, KHÔNG tính khối khai báo union. */
function soDiemPhat(kieu: string): number {
  const src = bocChuThich(readFileSync(resolve(process.cwd(), "server/services/aiLocalKnowledgeService.ts"), "utf8"));
  const dau = src.indexOf("export type StreamEvent =");
  const sau = src.indexOf("\n;", dau) > 0 ? src.indexOf("\n;", dau) : src.indexOf("};\n", dau) + 2;
  const ngoaiUnion = src.slice(0, dau) + src.slice(sau);
  return (ngoaiUnion.match(new RegExp(`type:\\s*"${kieu}"`, "g")) || []).length;
}

describe("SSE census — StreamEvent (service) ⊆ case (route)", () => {
  it("★★★ mọi kiểu service phát đều có `case` ở route — kiểu mới thêm mà quên dây ⇒ ĐỎ ở đây, không im lặng ở màn hình", () => {
    const phat = kieuServicePhat().filter((k) => !KIEU_KHAI_MA_KHONG_PHAT.has(k));
    const xuLy = new Set(kieuRouteXuLy());
    expect(phat.length, "phải bóc được ≥ 8 kiểu từ union").toBeGreaterThanOrEqual(8);
    const thieu = phat.filter((k) => !xuLy.has(k));
    expect(
      thieu,
      `Route /api/ai/local-kb/stream KHÔNG có case cho: ${thieu.join(", ")}. Thêm case (hoặc, nếu cố ý không phát, ` +
        `ghi vào KIEU_CO_Y_KHONG_PHAT của lưới này kèm lý do).`,
    ).toEqual([]);
  });

  it("★★ kiểu được miễn `case` phải THẬT SỰ không ai phát — có nơi phát ⇒ phải nối dây, không được núp trong danh sách miễn", () => {
    for (const k of KIEU_KHAI_MA_KHONG_PHAT) {
      expect(soDiemPhat(k), `"${k}" nay có nơi phát trong service ⇒ thêm case ở route và bỏ khỏi KIEU_KHAI_MA_KHONG_PHAT`).toBe(0);
    }
    // B8: hai kiểu chết đã xoá — không được quay lại union mà không có nơi phát + case.
    expect(kieuServicePhat()).not.toEqual(expect.arrayContaining(["agent_plan"]));
    expect(kieuServicePhat()).not.toEqual(expect.arrayContaining(["agent_step"]));
    // Đối chứng: một kiểu đang phát thật phải đếm được ≥ 1 (chỉ báo âm tính biết KÊU trên ca dương).
    expect(soDiemPhat("usage")).toBeGreaterThanOrEqual(2);
    expect(soDiemPhat("reasoning")).toBeGreaterThanOrEqual(2);
  });

  it("hai kiểu F1/F2 có thật trong cả hai bên (ca dương đã biết — chỉ báo phải biết KÊU)", () => {
    expect(kieuServicePhat()).toEqual(expect.arrayContaining(["usage", "reasoning", "token", "done"]));
    expect(kieuRouteXuLy()).toEqual(expect.arrayContaining(["usage", "reasoning", "token", "done"]));
  });
});
