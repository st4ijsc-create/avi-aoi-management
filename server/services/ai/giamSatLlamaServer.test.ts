/**
 * ★★★ Đợt 0.1 — GIÁM SÁT + TỰ KHỞI ĐỘNG LẠI `llama-server`, và cửa FAIL-CLOSED cho model chính.
 *
 * Bối cảnh đo được (2026-10-14): `:8091` chết từ 10/9, không ai dựng lại (Task Scheduler chỉ chạy
 * lúc đăng nhập); `/api/health/ai` báo `fallback: silent`; lượt sinh mã kế tiếp sẽ nạp model 21 GB
 * vào tiến trình node (TTFT 71 → 5.304 ms) và nếu sau đó llama-server được dựng lại thì hai bản
 * tranh nhau 32 GB VRAM.
 *
 * Lưới này canh BỐN thứ, mỗi thứ bằng VẬT THẬT ở đúng chỗ có thể:
 *   1. Logic quyết định (THUẦN, đồng hồ tiêm vào) — "chết" CHỈ khi KHÔNG AI NGHE CỔNG ≥ 2 lần liền;
 *      503 Loading / treo KHÔNG BAO GIỜ dẫn tới khởi động lại.
 *   2. Phép thăm dò trên SOCKET THẬT (cổng ngẫu nhiên của chính test — KHÔNG chạm :8091).
 *   3. Khoá liên tiến trình + lịch sử + tệp tạm dừng trên TỆP TẠM THẬT.
 *   4. Chờ hồi phục có giới hạn (đồng hồ/giấc ngủ tiêm vào).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import * as net from "node:net";

import {
  quyetDinhNhip,
  thamDoCong,
  thuGiuKhoa,
  nhaKhoa,
  docLichSuKhoiDong,
  demTrongCuaSo,
  dangTamDung,
  docCauHinhGiamSat,
  khoiDongTachRoi,
  GiamSatLlamaServer,
  choLlamaServerHoiPhuc,
  LoiLlamaServerChet,
  llamaServerFailClosed,
  type BoNhoNhip,
  type CauHinhGiamSat,
  type KetQuaThamDo,
} from "./giamSatLlamaServer";

const PHUT = 60_000;

// ─── thư mục tạm THẬT cho mỗi ca ────────────────────────────────────────────────────────────────
let thuMuc = "";
beforeEach(() => {
  thuMuc = fs.mkdtempSync(path.join(os.tmpdir(), "llama-wd-test-"));
});
afterEach(() => {
  try {
    fs.rmSync(thuMuc, { recursive: true, force: true });
  } catch {
    /* Windows đôi khi giữ handle vài ms — không làm đỏ ca vì dọn dẹp */
  }
});

function cfgTest(over: Partial<CauHinhGiamSat> = {}): CauHinhGiamSat {
  return {
    bat: true,
    lyDoTat: null,
    url: "http://127.0.0.1:1",
    nhipMs: 15_000,
    soLanChetLienTiep: 2,
    toiDaKhoiDong: 3,
    cuaSoMs: 30 * PHUT,
    khoaHetHanMs: 10 * PHUT,
    khoiDongHetGioMs: 6 * PHUT,
    tamDungHetHanMs: 30 * PHUT,
    thamDoHetGioMs: 2_000,
    duongTamDung: path.join(thuMuc, "llama-watchdog.pause"),
    duongKhoa: path.join(thuMuc, "llama-watchdog.lock"),
    duongLichSu: path.join(thuMuc, "llama-watchdog.history.json"),
    duongKichBan: path.join(thuMuc, "start-llama-server.ps1"),
    ...over,
  };
}

const BO_NHO_DAU: BoNhoNhip = { trangThai: "chua-kiem", demKhongNghe: 0, dangKhoiDongTu: null, boCuoc: false };

// ═══ 1. LOGIC QUYẾT ĐỊNH — thuần ══════════════════════════════════════════════════════════════════
describe("quyetDinhNhip — chỉ 'không ai nghe cổng' ≥ 2 lần liền mới là CHẾT", () => {
  const cfg = cfgTest();

  it("một lần không nghe ⇒ CHƯA chết, không làm gì; lần thứ hai liền ⇒ 'chet' + thử khởi động", () => {
    const a = quyetDinhNhip(BO_NHO_DAU, "khong-nghe", 0, cfg);
    expect(a.hanhDong).toBe("khong");
    expect(a.boNho.trangThai).not.toBe("chet");
    expect(a.boNho.demKhongNghe).toBe(1);

    const b = quyetDinhNhip(a.boNho, "khong-nghe", 15_000, cfg);
    expect(b.boNho.trangThai).toBe("chet");
    expect(b.hanhDong).toBe("thu-khoi-dong");
  });

  it("★ 503 Loading (đang nạp model) lặp 100 lần ⇒ KHÔNG BAO GIỜ khởi động lại", () => {
    let bn = BO_NHO_DAU;
    for (let i = 0; i < 100; i++) {
      const r = quyetDinhNhip(bn, "dang-nap", i * 15_000, cfg);
      expect(r.hanhDong).toBe("khong");
      expect(r.boNho.trangThai).toBe("dang-nap");
      bn = r.boNho;
    }
  });

  it("★ cổng có người nghe nhưng KHÔNG trả lời (treo) ⇒ không phải chết, không khởi động lại", () => {
    let bn = BO_NHO_DAU;
    for (let i = 0; i < 10; i++) {
      const r = quyetDinhNhip(bn, "khong-tra-loi", i * 15_000, cfg);
      expect(r.hanhDong).toBe("khong");
      bn = r.boNho;
    }
  });

  it("không-nghe XEN với đang-nạp ⇒ bộ đếm về 0 (hai lần phải LIÊN TIẾP)", () => {
    const a = quyetDinhNhip(BO_NHO_DAU, "khong-nghe", 0, cfg);
    const b = quyetDinhNhip(a.boNho, "dang-nap", 15_000, cfg);
    const c = quyetDinhNhip(b.boNho, "khong-nghe", 30_000, cfg);
    expect(c.hanhDong).toBe("khong");
    expect(c.boNho.demKhongNghe).toBe(1);
  });

  it("đang trong cửa sổ khởi động lại ⇒ không thử lần nữa; sống ⇒ 'xong-khoi-dong'", () => {
    const dang: BoNhoNhip = { trangThai: "dang-khoi-dong-lai", demKhongNghe: 0, dangKhoiDongTu: 0, boCuoc: false };
    for (const td of ["khong-nghe", "dang-nap", "khong-tra-loi"] as KetQuaThamDo[]) {
      const r = quyetDinhNhip(dang, td, 60_000, cfg);
      expect(r.hanhDong).toBe("khong");
      expect(r.boNho.trangThai).toBe("dang-khoi-dong-lai");
    }
    const s = quyetDinhNhip(dang, "song", 60_000, cfg);
    expect(s.hanhDong).toBe("xong-khoi-dong");
    expect(s.boNho.trangThai).toBe("song");
    expect(s.boNho.dangKhoiDongTu).toBeNull();
  });

  it("hết giờ khởi động mà vẫn không ai nghe ⇒ 'het-gio-khoi-dong', và nhịp KẾ TIẾP được thử lại ngay", () => {
    const dang: BoNhoNhip = { trangThai: "dang-khoi-dong-lai", demKhongNghe: 0, dangKhoiDongTu: 0, boCuoc: false };
    const r = quyetDinhNhip(dang, "khong-nghe", cfg.khoiDongHetGioMs + 1, cfg);
    expect(r.hanhDong).toBe("het-gio-khoi-dong");
    expect(r.boNho.dangKhoiDongTu).toBeNull();
    expect(r.boNho.trangThai).toBe("chet");
    const k = quyetDinhNhip(r.boNho, "khong-nghe", cfg.khoiDongHetGioMs + 15_001, cfg);
    expect(k.hanhDong).toBe("thu-khoi-dong");
  });

  it("bỏ cuộc là DÍNH: không-nghe mãi cũng không thử; chỉ 'song' mới gỡ", () => {
    const bc: BoNhoNhip = { trangThai: "bo-cuoc", demKhongNghe: 5, dangKhoiDongTu: null, boCuoc: true };
    for (let i = 0; i < 5; i++) {
      const r = quyetDinhNhip(bc, "khong-nghe", i * 15_000, cfg);
      expect(r.hanhDong).toBe("khong");
      expect(r.boNho.trangThai).toBe("bo-cuoc");
    }
    const s = quyetDinhNhip(bc, "song", 0, cfg);
    expect(s.boNho.trangThai).toBe("song");
    expect(s.boNho.boCuoc).toBe(false);
  });
});

// ═══ 2. THĂM DÒ trên socket THẬT ════════════════════════════════════════════════════════════════
describe("thamDoCong — phân biệt sống / đang nạp / treo / không ai nghe (socket thật, cổng ngẫu nhiên)", () => {
  const dong: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (dong.length) await dong.pop()!();
  });

  async function moHttp(status: number): Promise<string> {
    const srv = http.createServer((_req, res) => {
      res.statusCode = status;
      res.end(status === 503 ? '{"error":{"code":503,"message":"Loading model"}}' : '{"status":"ok"}');
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    dong.push(() => new Promise<void>((r) => srv.close(() => r())));
    return `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`;
  }

  it("200 ⇒ 'song'", async () => {
    expect(await thamDoCong(await moHttp(200), 2000)).toBe("song");
  });

  it("★ 503 (Loading model) ⇒ 'dang-nap' — KHÔNG phải chết", async () => {
    expect(await thamDoCong(await moHttp(503), 2000)).toBe("dang-nap");
  });

  it("★ không ai nghe cổng (ECONNREFUSED) ⇒ 'khong-nghe'", async () => {
    const srv = net.createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as net.AddressInfo).port;
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await thamDoCong(`http://127.0.0.1:${port}`, 3000)).toBe("khong-nghe");
  });

  it("★ nhận TCP rồi im (treo) ⇒ 'khong-tra-loi', trong đúng trần thời gian", async () => {
    const socks: net.Socket[] = [];
    const srv = net.createServer((s) => socks.push(s));
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    dong.push(
      () =>
        new Promise<void>((r) => {
          socks.forEach((s) => s.destroy());
          srv.close(() => r());
        }),
    );
    const t0 = Date.now();
    const kq = await thamDoCong(`http://127.0.0.1:${(srv.address() as net.AddressInfo).port}`, 300);
    expect(kq).toBe("khong-tra-loi");
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});

// ═══ 3. KHOÁ LIÊN TIẾN TRÌNH — tệp thật ═════════════════════════════════════════════════════════
describe("thuGiuKhoa — tệp `wx` độc quyền, PID + mốc giờ, hết hạn khi cũ hoặc chủ đã chết", () => {
  it("người thứ nhất giữ được; người thứ hai (PID khác, còn sống) bị từ chối và thấy chủ", () => {
    const duong = path.join(thuMuc, "k.lock");
    const a = thuGiuKhoa(duong, { bayGio: 1000, hetHanMs: 10 * PHUT, pid: 111, laPidSong: () => true });
    expect(a.duoc).toBe(true);
    const b = thuGiuKhoa(duong, { bayGio: 2000, hetHanMs: 10 * PHUT, pid: 222, laPidSong: () => true });
    expect(b.duoc).toBe(false);
    if (!b.duoc) expect(b.chu?.pid).toBe(111);
  });

  it("khoá cũ hơn 10 phút ⇒ coi là hết hạn, người sau giành được", () => {
    const duong = path.join(thuMuc, "k.lock");
    expect(thuGiuKhoa(duong, { bayGio: 0, hetHanMs: 10 * PHUT, pid: 111, laPidSong: () => true }).duoc).toBe(true);
    const b = thuGiuKhoa(duong, { bayGio: 10 * PHUT + 1, hetHanMs: 10 * PHUT, pid: 222, laPidSong: () => true });
    expect(b.duoc).toBe(true);
  });

  it("PID chủ khoá đã chết ⇒ hết hạn ngay, dù khoá còn mới", () => {
    const duong = path.join(thuMuc, "k.lock");
    expect(thuGiuKhoa(duong, { bayGio: 0, hetHanMs: 10 * PHUT, pid: 111, laPidSong: () => true }).duoc).toBe(true);
    const b = thuGiuKhoa(duong, { bayGio: 1000, hetHanMs: 10 * PHUT, pid: 222, laPidSong: (p) => p !== 111 });
    expect(b.duoc).toBe(true);
  });

  it("nhả chỉ khi đúng token của mình — không xoá khoá của người khác", () => {
    const duong = path.join(thuMuc, "k.lock");
    const a = thuGiuKhoa(duong, { bayGio: 0, hetHanMs: 10 * PHUT, pid: 111, laPidSong: () => true });
    expect(nhaKhoa(duong, "token-gia")).toBe(false);
    expect(fs.existsSync(duong)).toBe(true);
    if (a.duoc) expect(nhaKhoa(duong, a.token)).toBe(true);
    expect(fs.existsSync(duong)).toBe(false);
  });

  it("tệp khoá hỏng (không phải JSON) ⇒ coi là hết hạn, không kẹt mãi", () => {
    const duong = path.join(thuMuc, "k.lock");
    fs.writeFileSync(duong, "rác");
    expect(thuGiuKhoa(duong, { bayGio: 0, hetHanMs: 10 * PHUT, pid: 1, laPidSong: () => true }).duoc).toBe(true);
  });
});

// ═══ 4. TỆP TẠM DỪNG — tệp thật ═════════════════════════════════════════════════════════════════
describe("dangTamDung — tệp đánh dấu có hạn dùng (chống kẹt vĩnh viễn khi doi-model.ps1 chết giữa chừng)", () => {
  it("không có tệp ⇒ không tạm dừng; có tệp mới ⇒ tạm dừng; tệp cũ quá hạn ⇒ bỏ qua", () => {
    const duong = path.join(thuMuc, "p.pause");
    expect(dangTamDung(duong, Date.now(), 30 * PHUT)).toBe(false);
    fs.writeFileSync(duong, "doi-model");
    expect(dangTamDung(duong, Date.now(), 30 * PHUT)).toBe(true);
    expect(dangTamDung(duong, Date.now() + 31 * PHUT, 30 * PHUT)).toBe(false);
  });
});

// ═══ 5. GIÁM SÁT đầy đủ — đồng hồ + thăm dò + trình spawn TIÊM VÀO, tệp khoá/lịch sử/tạm dừng THẬT ══
function dungGiamSat(o: {
  cfg: CauHinhGiamSat;
  thamDo: () => KetQuaThamDo;
  dongHo: { t: number };
  pid?: number;
  laPidSong?: (pid: number) => boolean;
}) {
  const spawnLan: number[] = [];
  const gs = new GiamSatLlamaServer({
    cfg: o.cfg,
    bayGio: () => o.dongHo.t,
    thamDo: async () => o.thamDo(),
    khoiDong: () => {
      spawnLan.push(o.dongHo.t);
    },
    pid: o.pid ?? 4242,
    laPidSong: o.laPidSong ?? (() => true),
    log: { warn: () => {}, error: () => {}, info: () => {} },
  });
  return { gs, spawnLan };
}

describe("GiamSatLlamaServer — vòng đời trên tệp thật", () => {
  it("★ chết 2 nhịp ⇒ khởi động ĐÚNG MỘT lần; sống lại ⇒ nhả khoá, trạng thái 'song'", async () => {
    const cfg = cfgTest();
    const dongHo = { t: 0 };
    let td: KetQuaThamDo = "khong-nghe";
    const { gs, spawnLan } = dungGiamSat({ cfg, thamDo: () => td, dongHo });

    await gs.kiem();
    expect(spawnLan).toHaveLength(0);
    dongHo.t += 15_000;
    await gs.kiem();
    expect(spawnLan).toHaveLength(1);
    expect(gs.anhChup().trangThai).toBe("dang-khoi-dong-lai");
    expect(fs.existsSync(cfg.duongKhoa)).toBe(true); // giữ khoá suốt cửa sổ khởi động
    expect(docLichSuKhoiDong(cfg.duongLichSu)).toEqual([15_000]);

    td = "dang-nap";
    dongHo.t += 15_000;
    await gs.kiem();
    expect(gs.anhChup().trangThai).toBe("dang-khoi-dong-lai");
    expect(spawnLan).toHaveLength(1);

    td = "song";
    dongHo.t += 15_000;
    await gs.kiem();
    const a = gs.anhChup();
    expect(a.trangThai).toBe("song");
    expect(a.soLanKhoiDong).toBe(1);
    expect(fs.existsSync(cfg.duongKhoa)).toBe(false);
  });

  it("★★ chống vòng chết: tối đa 3 lần / 30 phút, lần thứ tư ⇒ 'bo-cuoc', không spawn thêm", async () => {
    const cfg = cfgTest();
    const dongHo = { t: 0 };
    const { gs, spawnLan } = dungGiamSat({ cfg, thamDo: () => "khong-nghe", dongHo });
    // Mỗi lượt khởi động hỏng hết giờ (6 phút) ⇒ trong 30 phút có chỗ cho > 3 lượt nếu không có trần.
    for (let i = 0; i < 120 && dongHo.t < 29 * PHUT; i++) {
      await gs.kiem();
      dongHo.t += 15_000;
    }
    expect(spawnLan).toHaveLength(3);
    const a = gs.anhChup();
    expect(a.trangThai).toBe("bo-cuoc");
    expect(a.lyDo).toMatch(/3/);
    expect(fs.existsSync(cfg.duongKhoa)).toBe(false); // bỏ cuộc thì không giữ khoá
  });

  it("lịch sử dùng CHUNG giữa các tiến trình: tiến trình mới đọc 3 lượt trong cửa sổ ⇒ bỏ cuộc ngay", async () => {
    const cfg = cfgTest();
    fs.writeFileSync(cfg.duongLichSu, JSON.stringify([1 * PHUT, 2 * PHUT, 3 * PHUT]));
    const dongHo = { t: 4 * PHUT };
    const { gs, spawnLan } = dungGiamSat({ cfg, thamDo: () => "khong-nghe", dongHo });
    await gs.kiem();
    dongHo.t += 15_000;
    await gs.kiem();
    expect(spawnLan).toHaveLength(0);
    expect(gs.anhChup().trangThai).toBe("bo-cuoc");
    expect(demTrongCuaSo(docLichSuKhoiDong(cfg.duongLichSu), 40 * PHUT, 30 * PHUT)).toBe(0);
  });

  it("★★ hai tiến trình (:3000 + :3010) cùng thấy chết ⇒ CHỈ MỘT khởi động; bên kia báo 'dang-khoi-dong-lai'", async () => {
    const cfg = cfgTest();
    const dongHo = { t: 0 };
    const A = dungGiamSat({ cfg, thamDo: () => "khong-nghe", dongHo, pid: 1000 });
    const B = dungGiamSat({ cfg, thamDo: () => "khong-nghe", dongHo, pid: 2000 });
    await A.gs.kiem();
    await B.gs.kiem();
    dongHo.t += 15_000;
    await A.gs.kiem();
    await B.gs.kiem();
    expect(A.spawnLan.length + B.spawnLan.length).toBe(1);
    expect(B.gs.anhChup().trangThai).toBe("dang-khoi-dong-lai");
    expect(B.gs.anhChup().nguoiKhoiDong).toBe("tien-trinh-khac");
  });

  it("★ tệp tạm dừng (doi-model.ps1) ⇒ 'tam-dung', KHÔNG khởi động dù chết bao lâu", async () => {
    const cfg = cfgTest();
    fs.writeFileSync(cfg.duongTamDung, "doi-model");
    const dongHo = { t: Date.now() };
    const { gs, spawnLan } = dungGiamSat({ cfg, thamDo: () => "khong-nghe", dongHo });
    for (let i = 0; i < 10; i++) {
      await gs.kiem();
      dongHo.t += 15_000;
    }
    expect(spawnLan).toHaveLength(0);
    expect(gs.anhChup().trangThai).toBe("tam-dung");

    // Gỡ tạm dừng ⇒ lại cần 2 nhịp LIÊN TIẾP mới coi là chết (không mang bộ đếm cũ qua).
    fs.rmSync(cfg.duongTamDung);
    await gs.kiem();
    expect(spawnLan).toHaveLength(0);
    dongHo.t += 15_000;
    await gs.kiem();
    expect(spawnLan).toHaveLength(1);
  });

  it("trình khởi động NÉM (kịch bản vắng) ⇒ lượt vẫn bị đếm, khoá được nhả, không treo ở 'dang-khoi-dong-lai'", async () => {
    const cfg = cfgTest();
    const dongHo = { t: 0 };
    const gs = new GiamSatLlamaServer({
      cfg,
      bayGio: () => dongHo.t,
      thamDo: async () => "khong-nghe",
      khoiDong: () => {
        throw new Error("không thấy kịch bản");
      },
      pid: 1,
      laPidSong: () => true,
      log: { warn: () => {}, error: () => {}, info: () => {} },
    });
    await gs.kiem();
    dongHo.t += 15_000;
    await gs.kiem();
    expect(gs.anhChup().trangThai).toBe("chet");
    expect(gs.anhChup().lyDo).toMatch(/không thấy kịch bản/);
    expect(fs.existsSync(cfg.duongKhoa)).toBe(false);
    expect(docLichSuKhoiDong(cfg.duongLichSu)).toHaveLength(1);
  });

  it("kịch bản thoát mã ≠ 0 (vd cổng bị dịch vụ khác chiếm) ⇒ kết thúc cửa sổ sớm, nhả khoá", async () => {
    const cfg = cfgTest();
    const dongHo = { t: 0 };
    let baoThoat: ((code: number | null) => void) | null = null;
    const gs = new GiamSatLlamaServer({
      cfg,
      bayGio: () => dongHo.t,
      thamDo: async () => "khong-nghe",
      khoiDong: (khiThoat) => {
        baoThoat = khiThoat;
      },
      pid: 1,
      laPidSong: () => true,
      log: { warn: () => {}, error: () => {}, info: () => {} },
    });
    await gs.kiem();
    dongHo.t += 15_000;
    await gs.kiem();
    expect(gs.anhChup().trangThai).toBe("dang-khoi-dong-lai");
    baoThoat!(3);
    expect(fs.existsSync(cfg.duongKhoa)).toBe(false);
    expect(gs.anhChup().trangThai).toBe("chet");
    expect(gs.anhChup().lyDo).toMatch(/mã 3/);
  });
});

// ═══ 6. CẤU HÌNH ═════════════════════════════════════════════════════════════════════════════════
describe("docCauHinhGiamSat — mặc định BẬT khi LLAMA_SERVER_ENABLED=true; tắt hẳn bằng cờ", () => {
  const coSo = { LLAMA_SERVER_ENABLED: "true", LLAMA_SERVER_URL: "http://127.0.0.1:8091" } as NodeJS.ProcessEnv;

  it("mặc định: bật, nhịp 15 s, 3 lần / 30 phút, khoá + tạm dừng trong os.tmpdir()", () => {
    const c = docCauHinhGiamSat(coSo, "D:/repo");
    expect(c.bat).toBe(true);
    expect(c.nhipMs).toBe(15_000);
    expect(c.toiDaKhoiDong).toBe(3);
    expect(c.cuaSoMs).toBe(30 * PHUT);
    expect(c.khoaHetHanMs).toBe(10 * PHUT);
    expect(path.dirname(c.duongKhoa)).toBe(os.tmpdir());
    expect(path.dirname(c.duongTamDung)).toBe(os.tmpdir());
    expect(c.duongKichBan.replace(/\\/g, "/")).toMatch(/scripts\/ai\/start-llama-server\.ps1$/);
    expect(c.khoiDongHetGioMs).toBeLessThan(c.khoaHetHanMs); // khoá không được hết hạn GIỮA lượt khởi động
  });

  it("LLAMA_WATCHDOG_ENABLED=false ⇒ tắt; LLAMA_SERVER_ENABLED khác 'true' ⇒ tắt", () => {
    expect(docCauHinhGiamSat({ ...coSo, LLAMA_WATCHDOG_ENABLED: "false" }).bat).toBe(false);
    expect(docCauHinhGiamSat({ ...coSo, LLAMA_SERVER_ENABLED: "false" }).bat).toBe(false);
  });

  it("URL không phải loopback ⇒ tắt (máy này không dựng được tiến trình ở máy khác)", () => {
    const c = docCauHinhGiamSat({ ...coSo, LLAMA_SERVER_URL: "http://10.0.0.5:8091" });
    expect(c.bat).toBe(false);
    expect(c.lyDoTat).toMatch(/loopback/);
  });

  it("LLAMA_WATCHDOG_PAUSE_FILE ghi đè đường tạm dừng", () => {
    expect(docCauHinhGiamSat({ ...coSo, LLAMA_WATCHDOG_PAUSE_FILE: "D:/x/p.pause" }).duongTamDung).toBe("D:/x/p.pause");
  });

  it("fail-closed mặc định BẬT; LLAMA_SERVER_FAIL_CLOSED=false là lối thoát tương thích", () => {
    expect(llamaServerFailClosed(coSo)).toBe(true);
    expect(llamaServerFailClosed({ ...coSo, LLAMA_SERVER_FAIL_CLOSED: "false" })).toBe(false);
  });
});

// ═══ 7. SPAWN tách rời — trình spawn tiêm vào để soi THAM SỐ, không chạy PowerShell thật ═══════
describe("khoiDongTachRoi — PowerShell tách rời, không giữ ống", () => {
  it("powershell.exe -NoProfile -ExecutionPolicy Bypass -File <kịch bản>, detached, stdio ignore, unref", () => {
    const kichBan = path.join(thuMuc, "start-llama-server.ps1");
    fs.writeFileSync(kichBan, "# giả");
    const unref = vi.fn();
    const on = vi.fn();
    const spawnFn = vi.fn(() => ({ pid: 77, unref, on }) as any);
    const r = khoiDongTachRoi(kichBan, { spawnFn, cwd: thuMuc });
    expect(r.pid).toBe(77);
    const [lenh, thamSo, tuyChon] = spawnFn.mock.calls[0] as unknown as [string, string[], any];
    expect(lenh).toBe("powershell.exe");
    expect(thamSo).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", kichBan]);
    expect(tuyChon.detached).toBe(true);
    expect(tuyChon.stdio).toBe("ignore");
    expect(tuyChon.windowsHide).toBe(true);
    expect(unref).toHaveBeenCalled();
    // ★ phải nghe 'error': spawn ENOENT phát sự kiện BẤT ĐỒNG BỘ, không nghe ⇒ sập cả tiến trình node.
    expect(on.mock.calls.map((c) => c[0])).toContain("error");
  });

  it("kịch bản vắng ⇒ ném trước khi spawn", () => {
    const spawnFn = vi.fn();
    expect(() => khoiDongTachRoi(path.join(thuMuc, "khong-co.ps1"), { spawnFn: spawnFn as any })).toThrow(/không thấy/i);
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

// ═══ 8. CHỜ HỒI PHỤC có giới hạn (cửa fail-closed) ═══════════════════════════════════════════════
describe("choLlamaServerHoiPhuc — chờ có trần cho giám sát dựng lại", () => {
  const env = { LLAMA_SERVER_ENABLED: "true", LLAMA_SERVER_URL: "http://127.0.0.1:8091" } as NodeJS.ProcessEnv;

  function dongHoGia() {
    const d = { t: 0 };
    return { d, bayGio: () => d.t, ngu: async (ms: number) => void (d.t += ms) };
  }

  it("server sống lại trong lúc chờ ⇒ { song: true }", async () => {
    const { bayGio, ngu } = dongHoGia();
    let n = 0;
    const kq = await choLlamaServerHoiPhuc({ thamDoKhoe: async () => ++n >= 3, env, bayGio, ngu, hanMs: 120_000, nhipMs: 2000 });
    expect(kq.song).toBe(true);
    expect(n).toBe(3);
  });

  it("vẫn chết tới hạn ⇒ { song:false, lyDo:'het-han' } sau ĐÚNG trần (không chờ quá)", async () => {
    const { d, bayGio, ngu } = dongHoGia();
    const kq = await choLlamaServerHoiPhuc({ thamDoKhoe: async () => false, env, bayGio, ngu, hanMs: 120_000, nhipMs: 2000 });
    expect(kq.song).toBe(false);
    expect(kq.lyDo).toBe("het-han");
    expect(d.t).toBeGreaterThanOrEqual(120_000);
    expect(d.t).toBeLessThan(125_000);
  });

  it("giám sát TẮT (LLAMA_WATCHDOG_ENABLED=false) ⇒ không ai dựng lại ⇒ trả NGAY, không chờ", async () => {
    const { d, bayGio, ngu } = dongHoGia();
    const tham = vi.fn(async () => false);
    const kq = await choLlamaServerHoiPhuc({
      thamDoKhoe: tham,
      env: { ...env, LLAMA_WATCHDOG_ENABLED: "false" },
      bayGio,
      ngu,
      hanMs: 120_000,
    });
    expect(kq.lyDo).toBe("giam-sat-tat");
    expect(d.t).toBe(0);
  });

  it("người gọi huỷ ⇒ dừng chờ ngay", async () => {
    const { bayGio, ngu } = dongHoGia();
    const ac = new AbortController();
    ac.abort();
    const kq = await choLlamaServerHoiPhuc({ thamDoKhoe: async () => false, env, bayGio, ngu, signal: ac.signal });
    expect(kq.lyDo).toBe("huy");
  });

  it("LoiLlamaServerChet mang mã máy đọc được + câu tiếng Việt nói thật", () => {
    const e = new LoiLlamaServerChet({ modelId: "Qwen3.6-35B-A3B", viTri: "generation", lyDo: "het-han", daChoMs: 120_000, trangThai: "dang-khoi-dong-lai" });
    expect(e.code).toBe("LLAMA_SERVER_DOWN");
    expect(e.message).toMatch(/khởi động lại/);
    expect(e.message).toMatch(/KHÔNG nạp/);
    const b = new LoiLlamaServerChet({ modelId: "m", viTri: "x", lyDo: "bo-cuoc", daChoMs: 0, trangThai: "bo-cuoc" });
    expect(b.message).toMatch(/không khởi động được/);
  });
});
