/**
 * ★★★ Đợt 3c (2026-10-17) — TRÌNH QUẢN LÝ TIẾN TRÌNH ỨNG DỤNG: 1 tiến trình/dự án · cổng trong dải · dừng = giết
 * cây VÀ quan sát cái chết · tự dừng khi nhàn rỗi (đồng hồ TIÊM) · dừng hết khi tắt máy · nhật ký có trần + che.
 *
 * ⚠ Tiến trình con là bản GIẢ (EventEmitter) — lưới này đo LOGIC của trình quản lý. Cửa sinh thật
 *   (`cuaSinhUngDung.ts`) có lưới riêng chạy tiến trình THẬT (`cuaSinhUngDung.test.ts`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { QuanLyUngDung, type PhuThuocQuanLy, type TienTrinhUngDung, type LenhUngDung } from "./quanLyUngDung";
import { docDaiCong } from "./capCong";

class TienTrinhGia extends EventEmitter implements TienTrinhUngDung {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  daChet = false;
  constructor(public pid: number) {
    super();
  }
  chet(code: number | null = null, sig: string | null = "SIGKILL") {
    if (this.daChet) return;
    this.daChet = true;
    this.emit("exit", code, sig);
  }
}

const LENH: LenhUngDung = { file: "node", args: ["server.js"], envThem: {}, moTa: "npm run dev" };

function dung(tuyChon: { congBan?: Set<number>; tu?: number; den?: number; khongChetKhiGiet?: boolean } = {}) {
  let gio = 1_000_000;
  let pidKe = 100;
  const sinh: TienTrinhGia[] = [];
  const giet: number[] = [];
  const audit: Array<Record<string, unknown>> = [];
  const nghe = new Set<number>();
  const deps: PhuThuocQuanLy = {
    sinh: (_l, _g, cong) => {
      const p = new TienTrinhGia(++pidKe);
      (p as any).cong = cong;
      sinh.push(p);
      return p;
    },
    giet: (pid) => {
      giet.push(Number(pid));
      if (!tuyChon.khongChetKhiGiet) sinh.find((p) => p.pid === pid)?.chet(null, "SIGKILL");
      return "da-ra-lenh";
    },
    bayGio: () => gio,
    congTrong: async (c) => !(tuyChon.congBan?.has(c) ?? false),
    thuKetNoi: async (c) => nghe.has(c),
    ghiAudit: (e) => audit.push(e as any),
    anHanGietMs: 50,
  };
  const ql = new QuanLyUngDung({ tu: tuyChon.tu ?? 5100, den: tuyChon.den ?? 5102 }, deps);
  return {
    ql,
    sinh,
    giet,
    audit,
    nghe,
    toi: (ms: number) => {
      gio += ms;
    },
  };
}

describe("§1 — MỘT tiến trình mỗi dự án, cổng trong dải", () => {
  it("★★★ chạy lần hai cùng dự án ⇒ DANG_CHAY, KHÔNG sinh tiến trình thứ hai", async () => {
    const { ql, sinh } = dung();
    const a = await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    expect(a.ok).toBe(true);
    const b = await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.ma).toBe("DANG_CHAY");
    expect(sinh.length).toBe(1);
  });

  it("★★★ hai lượt chạy ĐỒNG THỜI cùng dự án (chưa await) ⇒ đúng MỘT lượt sinh", async () => {
    const { ql, sinh } = dung();
    const [a, b] = await Promise.all([
      ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH }),
      ql.chay({ projectId: "p1", goc: "/g", userId: 2, lenh: LENH }),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
    expect(sinh.length).toBe(1);
  });

  it("★★★ cổng cấp nằm TRONG dải, mỗi dự án một cổng khác nhau, bỏ qua cổng đang bị chiếm", async () => {
    const { ql } = dung({ congBan: new Set([5100]) });
    const a = await ql.chay({ projectId: "p1", goc: "/g1", userId: 1, lenh: LENH });
    const b = await ql.chay({ projectId: "p2", goc: "/g2", userId: 1, lenh: LENH });
    expect(a.ok && a.muc.cong).toBe(5101);
    expect(b.ok && b.muc.cong).toBe(5102);
  });

  it("★★ hết cổng trong dải ⇒ HET_CONG, không sinh", async () => {
    const { ql, sinh } = dung({ tu: 5100, den: 5100 });
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    const b = await ql.chay({ projectId: "p2", goc: "/g", userId: 1, lenh: LENH });
    expect(!b.ok && b.ma).toBe("HET_CONG");
    expect(sinh.length).toBe(1);
  });

  it("★★ dự án KHÁC chạy song song được (giới hạn là theo DỰ ÁN, không toàn cục)", async () => {
    const { ql, sinh } = dung();
    expect((await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH })).ok).toBe(true);
    expect((await ql.chay({ projectId: "p2", goc: "/g", userId: 1, lenh: LENH })).ok).toBe(true);
    expect(sinh.length).toBe(2);
  });

  it("★★ trạng thái: dang-khoi-dong ⇒ dang-chay khi CỔNG THẬT SỰ NGHE (không tin 'đã spawn')", async () => {
    const { ql, nghe } = dung();
    const a = await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    expect(ql.trangThai("p1")?.trangThai).toBe("dang-khoi-dong");
    await ql.lamMoiSanSang("p1");
    expect(ql.trangThai("p1")?.trangThai).toBe("dang-khoi-dong");
    nghe.add(a.ok ? a.muc.cong : -1);
    await ql.lamMoiSanSang("p1");
    expect(ql.trangThai("p1")?.trangThai).toBe("dang-chay");
  });
});

describe("§2 — DỪNG = giết CÂY và QUAN SÁT cái chết", () => {
  it("★★★ dừng ⇒ gọi giết cây đúng PID, chờ exit thật, giải phóng cổng; chạy lại được", async () => {
    const { ql, giet, sinh } = dung({ tu: 5100, den: 5100 });
    const a = await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    const d = await ql.dung("p1", "nguoi-dung", 1);
    expect(d.ok).toBe(true);
    expect(giet).toEqual([sinh[0]!.pid]);
    expect(ql.trangThai("p1")?.trangThai).toBe("da-dung");
    expect(ql.congCuaDuAn("p1")).toBeNull();
    const b = await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    expect(b.ok && b.muc.cong).toBe(a.ok ? a.muc.cong : -1);
  });

  it("★★★ ra lệnh giết mà KHÔNG thấy exit trong ân hạn ⇒ KHAI 'chưa xác nhận chết', cổng KHÔNG cấp lại", async () => {
    const { ql } = dung({ tu: 5100, den: 5100, khongChetKhiGiet: true });
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    const d = await ql.dung("p1", "nguoi-dung", 1);
    expect(d.ok && d.chuaXacNhanChet).toBe(true);
    const b = await ql.chay({ projectId: "p2", goc: "/g", userId: 1, lenh: LENH });
    expect(!b.ok && b.ma, "cổng của một tiến trình chưa chết KHÔNG được cấp cho dự án khác").toBe("HET_CONG");
  });

  it("★★ tiến trình TỰ thoát ⇒ trạng thái 'loi' (mã ≠ 0) hoặc 'da-dung', cổng được trả", async () => {
    const { ql, sinh } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    sinh[0]!.chet(1, null);
    expect(ql.trangThai("p1")?.trangThai).toBe("loi");
    expect(ql.trangThai("p1")?.maThoat).toBe(1);
    expect(ql.congCuaDuAn("p1")).toBeNull();
  });

  it("★★ dừng một dự án KHÔNG chạy ⇒ KHONG_CHAY (không giết gì)", async () => {
    const { ql, giet } = dung();
    const d = await ql.dung("x", "nguoi-dung", 1);
    expect(!d.ok && d.ma).toBe("KHONG_CHAY");
    expect(giet).toEqual([]);
  });

  it("★★★ dừng HẾT khi tắt máy ⇒ giết MỌI tiến trình đang sống", async () => {
    const { ql, giet } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    await ql.chay({ projectId: "p2", goc: "/g", userId: 1, lenh: LENH });
    await ql.dungHet();
    expect(giet.length).toBe(2);
    expect(ql.danhSach().every((m) => m.trangThai === "da-dung")).toBe(true);
  });
});

describe("§3 — TỰ DỪNG KHI NHÀN RỖI (đồng hồ tiêm)", () => {
  it("★★★ 30 phút không hoạt động ⇒ dừng, lý do 'nhan-roi', có audit", async () => {
    const { ql, toi, audit, giet } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    toi(29 * 60_000);
    expect(await ql.kiemNhanRoi()).toEqual([]);
    toi(61_000);
    expect(await ql.kiemNhanRoi()).toEqual(["p1"]);
    expect(giet.length).toBe(1);
    expect(ql.trangThai("p1")?.lyDoDung).toBe("nhan-roi");
    expect(audit.some((e) => e.loai === "dung" && e.lyDo === "nhan-roi")).toBe(true);
  });

  it("★★★ `cham` (lượt xem trước đi qua proxy) đẩy lùi mốc nhàn rỗi", async () => {
    const { ql, toi } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    toi(25 * 60_000);
    ql.cham("p1");
    toi(25 * 60_000);
    expect(await ql.kiemNhanRoi()).toEqual([]);
    toi(6 * 60_000);
    expect(await ql.kiemNhanRoi()).toEqual(["p1"]);
  });

  it("★ đọc trạng thái/nhật ký KHÔNG tính là hoạt động (một tab mở quên không giữ tiến trình sống mãi)", async () => {
    const { ql, toi } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    toi(31 * 60_000);
    ql.trangThai("p1");
    ql.nhatKy("p1");
    expect(await ql.kiemNhanRoi()).toEqual(["p1"]);
  });
});

describe("§4 — nhật ký VÒNG: có trần, ĐÃ che bí mật", () => {
  it("★★★ chuỗi bí mật trong stdout bị che trước khi vào nhật ký", async () => {
    const { ql, sinh } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    sinh[0]!.stdout.emit("data", "khoi dong xong\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD\n");
    sinh[0]!.chet(0, null);
    const txt = ql.nhatKy("p1")!.dong.join("\n");
    expect(txt).toContain("khoi dong xong");
    expect(txt).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789ABCD");
  });

  it("★★ vượt trần dòng ⇒ giữ CUỐI, khai đã cắt đầu", async () => {
    const { ql, sinh } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 1, lenh: LENH });
    for (let i = 0; i < 3000; i++) sinh[0]!.stdout.emit("data", `dong ${i}\n`);
    sinh[0]!.chet(0, null);
    const nk = ql.nhatKy("p1")!;
    expect(nk.dong.length).toBeLessThanOrEqual(1000);
    expect(nk.catDau).toBe(true);
    expect(nk.dong[nk.dong.length - 1]).toContain("dong 2999");
  });
});

describe("§5 — audit mỗi lần chạy/dừng", () => {
  it("★★★ chạy + dừng ⇒ hai sự kiện audit mang projectId, userId, cổng, lệnh", async () => {
    const { ql, audit } = dung();
    await ql.chay({ projectId: "p1", goc: "/g", userId: 9, lenh: LENH });
    await ql.dung("p1", "nguoi-dung", 9);
    expect(audit.map((e) => e.loai)).toEqual(["chay", "dung"]);
    expect(audit[0]).toMatchObject({ projectId: "p1", userId: 9, cong: 5100, lenh: "npm run dev" });
  });
});

describe("§6 — dải cổng AI_PREVIEW_PORT_RANGE", () => {
  it("★★ mặc định 5100–5199; khai hợp lệ được đọc; khai méo ⇒ mặc định (không mở cổng hệ thống)", () => {
    expect(docDaiCong({})).toEqual({ tu: 5100, den: 5199 });
    expect(docDaiCong({ AI_PREVIEW_PORT_RANGE: "6000-6009" })).toEqual({ tu: 6000, den: 6009 });
    for (const v of ["80-90", "6000", "7000-6000", "1-70000", "a-b", "5000-9000"]) {
      expect(docDaiCong({ AI_PREVIEW_PORT_RANGE: v }), v).toEqual({ tu: 5100, den: 5199 });
    }
  });
});
