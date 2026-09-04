/**
 * ★★★ ĐỢT H / TASK H2 / B2+B3 — lưới `chayPhienMcpNgoai` trên LUỒNG GIẢ (không spawn tiến trình thật,
 * cùng khuôn `mang/dongSse.unit.test.ts`/`mcpGiaoThuc.test.ts §3`). Mỗi lưới ở đây khớp ĐÚNG một
 * hình dạng B2/B3 kế hoạch đòi.
 */
import { describe, it, expect, vi } from "vitest";
import { chayPhienMcpNgoai, taoTienTrinhMcpNgoai } from "./mcpClient";

function dungGoi(id: number, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;
}

/** Luồng giả PHÁT ĐÚNG bắt tay: khi thấy client gửi initialize (đọc từ mảng `ghiDuoc`), phát trả lời. */
async function* luongGiaBatTayDung(dsChunk: string[]): AsyncGenerator<string> {
  for (const c of dsChunk) yield c;
}

describe("chayPhienMcpNgoai — bắt tay đúng, hình dạng hạnh phúc", () => {
  it("★★★ initialize → notifications/initialized → yêu cầu thật → trả kết quả yêu cầu thật (KHÔNG phải kết quả initialize)", async () => {
    const ghiDuoc: string[] = [];
    const luong = luongGiaBatTayDung([dungGoi(1, { protocolVersion: "2025-06-18" }), dungGoi(2, { tools: [{ name: "x" }] })]);
    const kq = await chayPhienMcpNgoai({
      ghi: (s) => ghiDuoc.push(s),
      dongDoc: luong,
      method: "tools/list",
      params: {},
    });
    expect(kq.ok).toBe(true);
    expect(kq.ketQua).toEqual({ tools: [{ name: "x" }] });
    // Ba dòng gửi đi: initialize (id=1), notifications/initialized (không id), yêu cầu thật (id=2).
    expect(ghiDuoc.length).toBe(3);
    expect(JSON.parse(ghiDuoc[0]!).method).toBe("initialize");
    expect(JSON.parse(ghiDuoc[1]!).method).toBe("notifications/initialized");
    expect("id" in JSON.parse(ghiDuoc[1]!)).toBe(false);
    const yc3 = JSON.parse(ghiDuoc[2]!);
    expect(yc3.method).toBe("tools/list");
    expect(yc3.id).toBe(2);
  });

  it("★★ tools/call với arguments THẬT được truyền nguyên vẹn", async () => {
    const ghiDuoc: string[] = [];
    const luong = luongGiaBatTayDung([dungGoi(1, {}), dungGoi(2, { content: [{ type: "text", text: "ok" }] })]);
    const kq = await chayPhienMcpNgoai({
      ghi: (s) => ghiDuoc.push(s),
      dongDoc: luong,
      method: "tools/call",
      params: { name: "ping", arguments: { a: 1 } },
    });
    expect(kq.ok).toBe(true);
    const yc = JSON.parse(ghiDuoc[2]!);
    expect(yc.params).toEqual({ name: "ping", arguments: { a: 1 } });
  });

  it("★★ initialize trả lỗi ⇒ KHÔNG BAO GIỜ gửi yêu cầu thật", async () => {
    const ghiDuoc: string[] = [];
    const luong = luongGiaBatTayDung([`${JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "từ chối" } })}\n`]);
    const kq = await chayPhienMcpNgoai({ ghi: (s) => ghiDuoc.push(s), dongDoc: luong, method: "tools/list", params: {} });
    expect(kq.ok).toBe(false);
    expect(kq.loi).toContain("từ chối");
    expect(ghiDuoc.length).toBe(1); // chỉ initialize, không có notifications/initialized hay yêu cầu thật
  });
});

describe("chayPhienMcpNgoai — B2: chunk cắt ngang / dòng rác / JSON hỏng KHÔNG làm sập phiên", () => {
  it("★★★ thông điệp trả lời bị CẮT NGANG giữa hai chunk vẫn được ghép đúng", async () => {
    const goi1 = dungGoi(1, {});
    const goi2 = dungGoi(2, { ok: true });
    const nuaDau = goi2.slice(0, 8);
    const nuaSau = goi2.slice(8);
    async function* luong() {
      yield goi1;
      yield nuaDau;
      yield nuaSau;
    }
    const kq = await chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {} });
    expect(kq.ok).toBe(true);
    expect(kq.ketQua).toEqual({ ok: true });
  });

  it("★★★ dòng rác xen giữa hai gói hợp lệ ⇒ bỏ qua, KHÔNG ném, vẫn tới được kết quả", async () => {
    async function* luong() {
      yield dungGoi(1, {});
      yield "rac-khong-phai-json\n";
      yield "{ json bi hong\n";
      yield dungGoi(2, { xong: true });
    }
    await expect(chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {} })).resolves.toEqual({
      ok: true,
      ketQua: { xong: true },
    });
  });
});

describe("chayPhienMcpNgoai — B3: TRẦN THỜI GIAN", () => {
  it("★★★ server KHÔNG BAO GIỜ trả lời (treo) ⇒ hetGio:true trong khoảng trần đã đặt, KHÔNG treo lưới mãi mãi", async () => {
    async function* luong(): AsyncGenerator<string> {
      // Chờ lâu hơn hẳn trần — mô phỏng server treo.
      await new Promise((r) => setTimeout(r, 500));
      yield dungGoi(1, {});
    }
    const kq = await chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {}, tranMs: 30 });
    expect(kq.ok).toBe(false);
    expect(kq.hetGio).toBe(true);
  }, 2000);

  it("★★ server đóng luồng (done:true) trước khi trả lời ⇒ báo lỗi rành mạch, không phải treo", async () => {
    async function* luong(): AsyncGenerator<string> {
      // không yield gì — kết thúc ngay.
    }
    const kq = await chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {} });
    expect(kq.ok).toBe(false);
    expect(kq.loi).toMatch(/đóng kết nối/);
  });
});

describe("chayPhienMcpNgoai — B3: TRẦN KÍCH THƯỚC ĐẦU RA (streaming, chặn SỚM)", () => {
  it("★★★ server phun VƯỢT TRẦN byte ⇒ bị cắt đứt (vuotTranKichThuoc:true), KHÔNG tích luỹ vô hạn", async () => {
    let soChunkDaKeo = 0;
    async function* luong(): AsyncGenerator<string> {
      // Sau initialize, phun rất nhiều rác (không newline) để tích byte mà không bao giờ đóng dòng.
      yield dungGoi(1, {});
      for (let i = 0; i < 100; i++) {
        soChunkDaKeo++;
        yield "x".repeat(2000); // không \n ⇒ không tách thành dòng, chỉ tích byte
      }
    }
    const kq = await chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {}, tranByte: 5000 });
    expect(kq.ok).toBe(false);
    expect(kq.vuotTranKichThuoc).toBe(true);
    // Bị cắt đứt sớm — không đọc hết 100 chunk (2000*100=200000 byte >> trần 5000).
    expect(soChunkDaKeo).toBeLessThan(100);
  });

  it("★★ dưới trần ⇒ hoàn tất bình thường", async () => {
    async function* luong() {
      yield dungGoi(1, {});
      yield dungGoi(2, { nho: true });
    }
    const kq = await chayPhienMcpNgoai({ ghi: () => {}, dongDoc: luong(), method: "tools/list", params: {}, tranByte: 5000 });
    expect(kq.ok).toBe(true);
  });
});

/**
 * ★★★ ĐỢT H / TASK H4 — `taoTienTrinhMcpNgoai`: `spawn()` NÉM ĐỒNG BỘ (không chỉ bắn 'error') phải
 * KHÔNG làm hàm này ném ra ngoài. Đo LIVE trên Windows thật (`npx.cmd` không shell:true) tái hiện
 * đúng `Error: spawn EINVAL` NÉM ĐỒNG BỘ tại lời gọi `spawn()` — mock `node:child_process` ở đây để
 * lưới chạy được trên MỌI hệ điều hành (không phụ thuộc hành vi spawn cụ thể của Windows).
 */
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    throw Object.assign(new Error("spawn EINVAL"), { code: "EINVAL", errno: -4071, syscall: "spawn" });
  }),
}));

describe("taoTienTrinhMcpNgoai — spawn() NÉM ĐỒNG BỘ (vd EINVAL trên Windows) KHÔNG được thoát ra ngoài", () => {
  it("★★★ KHÔNG ném — trả về kênh 'chết' mà chayPhienMcpNgoai đọc được graceful (ok:false, KHÔNG throw)", async () => {
    const cfg = { ten: "x", lenh: "npx.cmd", doi: ["-y", "pkg"], moi: {} };
    // NHÁNH KIA của bản vá: TRƯỚC bản vá, dòng dưới đây NÉM ra ngoài (test đỏ) — sau bản vá, không ném.
    expect(() => taoTienTrinhMcpNgoai(cfg)).not.toThrow();
    const kenh = taoTienTrinhMcpNgoai(cfg);
    // `chayPhienMcpNgoai` (đường gọi THẬT của `mcpDieuPhoi.ts#goiMotPhien`) phải đọc được kênh này
    // mà KHÔNG throw, và phải kết luận rành mạch (không treo, không ok:true giả).
    const kq = await chayPhienMcpNgoai({ ghi: kenh.ghi, dongDoc: kenh.dongDoc, method: "tools/list", params: {} });
    expect(kq.ok).toBe(false);
    expect(kq.loi).toMatch(/đóng kết nối/);
    kenh.dong(); // không được ném dù tiến trình chưa từng thật sự tồn tại
  });
});
