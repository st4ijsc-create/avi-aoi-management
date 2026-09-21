import { describe, it, expect } from "vitest";
import { laCauSinhMa } from "./cauSinhMa";

describe("laCauSinhMa — bản vá P11 (audit 2026-09-21)", () => {
  // ─── PHẢI BẮT: chính các câu đã đo được là HỎNG ────────────────────────────────────────────
  it.each([
    "Viết TypeScript: export class BoNhoLRU<K,V> với constructor(sucChua: number, ttlMs: number)",
    "Viết hàm TypeScript export function gopKhoang(ks) — gộp các khoảng chồng nhau",
    "Viết Python: class GioiHanTruot với __init__(self, so_luot, cua_so_ms)",
    "Viết C# trong namespace Sol: public class VongDem<T>",
    "Implement a thread-safe ring buffer in C#",
    "Write a function that merges overlapping intervals",
    "Refactor hàm này để không còn any",
    "Cài đặt thuật toán sắp xếp topo có phát hiện chu trình",
    "编写一个 LRU 缓存类",
    "Thêm unit test vitest cho hàm tinhTyLeLoi",
    "Bổ sung một endpoint mới cho service này",
  ])("★ bắt câu sinh mã: %s", (q) => {
    expect(laCauSinhMa(q)).toBe(true);
  });

  it("★★ câu ĐÃ ĐO HỎNG (nguyên văn bài H-ts1) phải được bắt — nếu sót, người dùng nhận về một TỆP LẠ", () => {
    const q =
      "Viết TypeScript: export class BoNhoLRU<K,V> với constructor(sucChua: number, ttlMs: number) " +
      "và các phương thức dat(k,v), lay(k): V|undefined, co(): number. … Chỉ trả về MỘT khối mã.";
    expect(laCauSinhMa(q)).toBe(true);
  });

  // ─── PHẢI BỎ QUA: đường NHANH (dump tức thì) không được chậm đi ────────────────────────────
  it.each([
    "đọc file server/routers.ts",
    "đọc file server/routers.ts và cho tôi xem",
    "liệt kê thư mục client/src",
    "grep executeDecision trong repo",
    "xem nội dung package.json",
    "ls server/services",
    "mở file .env",
  ])("★ KHÔNG bắt câu đọc/liệt kê tường minh: %s", (q) => {
    expect(laCauSinhMa(q)).toBe(false);
  });

  it("★ không bắt câu vận hành chứa động từ mơ hồ nhưng KHÔNG có hiện vật mã", () => {
    expect(laCauSinhMa("thêm một máy vào danh sách chuyền 2")).toBe(false);
    expect(laCauSinhMa("tạo một lô sản xuất mới cho hôm nay")).toBe(false);
    expect(laCauSinhMa("add a new operator to the shift")).toBe(false);
  });

  it("★ động từ mơ hồ + hiện vật mã ⇒ BẮT (đây là ranh giới, không phải ngẫu nhiên)", () => {
    expect(laCauSinhMa("thêm một máy vào danh sách")).toBe(false);
    expect(laCauSinhMa("thêm một hàm vào module này")).toBe(true);
  });

  it("không dấu vẫn bắt (người dùng gõ không dấu là chuyện thường)", () => {
    expect(laCauSinhMa("viet ham tinh ty le loi")).toBe(true);
    expect(laCauSinhMa("cai dat class LRU cache")).toBe(true);
  });

  it("chuỗi rỗng / rác ⇒ false, không ném", () => {
    expect(laCauSinhMa("")).toBe(false);
    expect(laCauSinhMa("   ")).toBe(false);
    expect(laCauSinhMa("???")).toBe(false);
  });

  it("yêu cầu 'chỉ trả về một khối mã' là dấu hiệu KHÔNG THỂ NHẦM, bắt bất kể động từ", () => {
    expect(laCauSinhMa("Chỉ trả về MỘT khối mã, không giải thích.")).toBe(true);
    expect(laCauSinhMa("return only a code block")).toBe(true);
  });
});
