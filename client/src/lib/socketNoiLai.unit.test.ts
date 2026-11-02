/**
 * socketNoiLai.unit.test.ts — ★★★ F5 đầy đủ T10: server NGẮT socket (quyền / phạm vi / phiên đổi) ⇒ client nối lại có giới hạn.
 * Socket giả + đồng hồ giả + số ngẫu nhiên giả (không mạng, không DOM).
 */
import { describe, expect, it, vi } from "vitest";
import { ganNoiLaiKhiServerNgat, treLanThu, SO_LAN_TOI_DA, TRE_TRAN_MS, type TrangThaiNoiLai } from "./socketNoiLai";

function socketGia() {
  const nghe = new Map<string, Set<(...a: any[]) => void>>();
  const s = {
    connected: false,
    active: false,
    connect: vi.fn(),
    on: (ev: string, fn: (...a: any[]) => void) => void (nghe.get(ev) ?? nghe.set(ev, new Set()).get(ev)!).add(fn),
    off: (ev: string, fn: (...a: any[]) => void) => void nghe.get(ev)?.delete(fn),
    phat: (ev: string, ...a: any[]) => [...(nghe.get(ev) ?? [])].forEach((f) => f(...a)),
    soNghe: () => [...nghe.values()].reduce((n, x) => n + x.size, 0),
  };
  return s;
}
function dongHo() {
  const hen: Array<{ fn: () => void; ms: number; huy: boolean; daChay?: boolean }> = [];
  return {
    hen,
    henGio: (fn: () => void, ms: number) => {
      const h = { fn, ms, huy: false };
      hen.push(h);
      return h;
    },
    huyHen: (h: unknown) => void ((h as { huy: boolean }).huy = true),
    chayCuoi: () => {
      const h = hen[hen.length - 1];
      if (h.huy || h.daChay) return;
      h.daChay = true;
      h.fn();
    },
  };
}

describe("T10 — nối lại sau `io server disconnect`", () => {
  it("lần đầu 1–3 s (có nhiễu), rồi lùi dần tới trần; không vượt SO_LAN_TOI_DA", () => {
    expect(treLanThu(0, 0)).toBe(1_000);
    expect(treLanThu(0, 0.999999)).toBeLessThanOrEqual(3_000);
    expect(treLanThu(0, 0.5)).toBe(2_000);
    for (let lan = 1; lan < 12; lan++) {
      for (const r of [0, 0.5, 0.99]) {
        const t = treLanThu(lan, r);
        expect(t).toBeGreaterThan(0);
        expect(t).toBeLessThanOrEqual(TRE_TRAN_MS);
      }
    }
    expect(treLanThu(10, 0.99)).toBeGreaterThan(TRE_TRAN_MS * 0.9); // ở trần (nhiễu ±50 % vẫn giữ trong trần)
  });

  it("server ngắt ⇒ `dang_noi_lai`, connect() sau trễ; nối được ⇒ `binh_thuong` + khiQuyenDoi (tải lại quyền)", () => {
    const s = socketGia();
    const dh = dongHo();
    const tt: TrangThaiNoiLai[] = [];
    const khiQuyenDoi = vi.fn();
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.5, khiQuyenDoi, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    expect(dh.hen.map((h) => h.ms)).toEqual([2_000]);
    expect(s.connect).not.toHaveBeenCalled();
    dh.chayCuoi();
    expect(s.connect).toHaveBeenCalledTimes(1);
    s.connected = true;
    s.phat("connect");
    expect(tt).toEqual(["dang_noi_lai", "binh_thuong"]);
    expect(khiQuyenDoi).toHaveBeenCalledTimes(1);
  });

  it("handshake nối lại bị từ chối UNAUTHORIZED ⇒ DỪNG thử (không hẹn thêm) + khiHetPhien (đường đăng xuất sẵn có)", () => {
    const s = socketGia();
    const dh = dongHo();
    const khiHetPhien = vi.fn();
    const tt: TrangThaiNoiLai[] = [];
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0, khiHetPhien, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    dh.chayCuoi();
    s.active = false;
    s.phat("connect_error", new Error("UNAUTHORIZED"));
    expect(khiHetPhien).toHaveBeenCalledTimes(1);
    expect(dh.hen.length).toBe(1);
    expect(tt[tt.length - 1]).toBe("het_phien");
    // lỗi tiếp theo (bất kỳ) không làm sống lại vòng thử
    s.phat("connect_error", new Error("RATE_LIMITED"));
    expect(dh.hen.length).toBe(1);
    expect(s.connect).toHaveBeenCalledTimes(1);
  });

  it("middleware từ chối vì lý do KHÁC (socket không active) ⇒ thử lại có giới hạn, rồi `dung`", () => {
    const s = socketGia();
    const dh = dongHo();
    const tt: TrangThaiNoiLai[] = [];
    ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, ngauNhien: () => 0.5, khiDoiTrangThai: (t) => tt.push(t) });
    s.phat("disconnect", "io server disconnect");
    for (let i = 0; i < SO_LAN_TOI_DA + 3; i++) {
      dh.chayCuoi();
      s.active = false;
      s.phat("connect_error", new Error("RATE_LIMITED"));
    }
    expect(s.connect).toHaveBeenCalledTimes(SO_LAN_TOI_DA);
    expect(tt[tt.length - 1]).toBe("dung");
    const tre = dh.hen.map((h) => h.ms);
    expect(tre.length).toBe(SO_LAN_TOI_DA);
    expect(tre[1]).toBeGreaterThan(tre[0]);
    expect(Math.max(...tre)).toBeLessThanOrEqual(TRE_TRAN_MS);
  });

  it("lý do ngắt KHÁC (mạng / client tự ngắt) và lỗi nối LẦN ĐẦU ⇒ không đụng tới (bộ nối lại của socket.io-client / đường đăng nhập cũ lo)", () => {
    const s = socketGia();
    const dh = dongHo();
    const khiHetPhien = vi.fn();
    const go = ganNoiLaiKhiServerNgat(s, { henGio: dh.henGio, huyHen: dh.huyHen, khiHetPhien });
    s.phat("connect_error", new Error("UNAUTHORIZED")); // lần nối đầu
    s.phat("disconnect", "transport close");
    s.phat("disconnect", "io client disconnect");
    expect(dh.hen).toEqual([]);
    expect(khiHetPhien).not.toHaveBeenCalled();
    go();
    expect(s.soNghe()).toBe(0);
  });
});
