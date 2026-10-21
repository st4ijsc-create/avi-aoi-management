/**
 * ★★ Đợt 7.1 — bộ lập lịch khe nặng. Đồng hồ giả (vitest) — mọi mốc thời gian là ms giả, không chờ thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MucUuTien } from "../hangDoiUuTienLlm";
import { CAU_HINH_MAC_DINH, KheNang, LoiKheNang, type BoPhucVuKheNang, type CauHinhKheNang } from "./kheNang";

const DOI_MS = 30_000;

function dung(o: { cauHinh?: Partial<CauHinhKheNang>; giu?: string | null; hongKhi?: (m: string) => boolean } = {}) {
  const sv = { giu: o.giu === undefined ? "A" : o.giu, doi: [] as string[] };
  const bo: BoPhucVuKheNang = {
    modelDangGiu: async () => sv.giu,
    doiSang: (m) =>
      new Promise<void>((res, rej) =>
        setTimeout(() => {
          sv.doi.push(m);
          if (o.hongKhi?.(m)) {
            sv.giu = "A"; // DieuPhoiDoiModel quay về nhà
            rej(new Error("sinh thử hỏng"));
          } else {
            sv.giu = m;
            res();
          }
        }, DOI_MS),
      ),
  };
  const kn = new KheNang(bo, { ...CAU_HINH_MAC_DINH, ...o.cauHinh }, () => "A");
  const nhatKy: { model: string; den: number; vao: number | null; loi: string | null }[] = [];
  /** Một lượt sinh chữ: xin khe, chạy `ms`, nhả. */
  const goi = (model: string, muc: MucUuTien, ms = 2_000, signal?: AbortSignal) => {
    const dong = { model, den: Date.now(), vao: null as number | null, loi: null as string | null };
    nhatKy.push(dong);
    return kn
      .cho(model, muc, signal)
      .then(async (nha) => {
        dong.vao = Date.now();
        await new Promise((r) => setTimeout(r, ms));
        nha();
      })
      .catch((e: LoiKheNang) => {
        dong.loi = e.code;
      });
  };
  return { sv, kn, goi, nhatKy };
}

const tien = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("KheNang (Đợt 7.1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("★ CỔNG 7.1 — 3 đợt A×10 · B×10 · A×10 ⇒ số lần đổi ≤ 3 + 1, mọi lượt được phục vụ đúng model", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    const p: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      p.push(goi("A", "tuong-tac"));
      await tien(1_000);
    }
    await tien(10_000);
    for (let i = 0; i < 10; i++) {
      p.push(goi("B", "nen"));
      await tien(1_000);
    }
    await tien(170_000);
    for (let i = 0; i < 10; i++) {
      p.push(goi("A", "tuong-tac"));
      await tien(1_000);
    }
    await tien(120_000);
    await Promise.all(p);
    expect(nhatKy.every((d) => d.vao !== null && d.loi === null)).toBe(true);
    expect(sv.doi.length).toBeLessThanOrEqual(4);
    expect(sv.doi).toEqual(["B", "A"]);
    kn.dung();
  });

  it("★ CỔNG 7.1 — 30 yêu cầu XEN KẼ A,B,A,B… (nền) ⇒ không đập: ≤ 3 lần đổi (gồm về nhà)", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    const p: Promise<void>[] = [];
    // Mỗi 3 s một yêu cầu (dài hơn khoảng 2 s của một lượt, ngắn hơn ngưỡng rảnh 10 s) ⇒ đổi-theo-yêu-cầu-đến sẽ
    // đổi ≥ 4 lần (đã kiểm bằng đột biến `kichHoat = true`); chính sách gom ⇒ 1 lần sang B + 1 lần về nhà.
    for (let i = 0; i < 30; i++) {
      p.push(goi(i % 2 ? "B" : "A", "nen"));
      await tien(3_000);
    }
    await tien(20 * 60_000);
    await Promise.all(p);
    expect(nhatKy.every((d) => d.vao !== null)).toBe(true);
    expect(sv.doi).toEqual(["B", "A"]);
    kn.dung();
  });

  it("★ CỔNG 7.1 — tương tác cho A KHÔNG chờ sau lượt nền của B; B đi sau khi chờ đủ 10 phút", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    // Luồng tương tác A dày (mỗi 5 s, chạy 2 s ⇒ không bao giờ rảnh 10 s); B nền đến SAU khi luồng A đã chạy.
    const p: Promise<void>[] = [goi("A", "tuong-tac", 2_000)];
    await tien(2_500);
    p.push(goi("B", "nen", 2_000));
    await tien(2_500);
    for (let t = 5_000; t < 12 * 60_000; t += 5_000) {
      p.push(goi("A", "tuong-tac", 2_000));
      await tien(5_000);
    }
    await tien(5 * 60_000);
    await Promise.all(p);
    const b = nhatKy.find((d) => d.model === "B")!;
    const aTruoc10Phut = nhatKy.filter((d) => d.model === "A" && d.den < b.den + 10 * 60_000);
    expect(aTruoc10Phut.length).toBeGreaterThan(100);
    expect(aTruoc10Phut.every((d) => d.vao === d.den), "lượt A trước mốc 10 phút được nhận NGAY").toBe(true);
    expect(b.vao! - b.den).toBeGreaterThanOrEqual(10 * 60_000);
    expect(b.vao! - b.den).toBeLessThan(10 * 60_000 + 2 * DOI_MS);
    expect(sv.doi[0]).toBe("B");
    kn.dung();
  });

  it("lưu trú tối thiểu 60 s: tương tác cho A đến 5 s sau khi đổi sang B phải chờ tới mốc 60 s", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    const pB = goi("B", "tuong-tac", 1_000);
    await tien(DOI_MS + 2_000);
    expect(sv.giu).toBe("B");
    const tDoiXong = Date.now() - 2_000;
    await tien(3_000);
    const pA = goi("A", "tuong-tac", 1_000);
    await tien(90_000);
    await Promise.all([pB, pA]);
    const a = nhatKy[1];
    expect(a.vao! - tDoiXong).toBeGreaterThanOrEqual(60_000 + DOI_MS);
    expect(sv.doi).toEqual(["B", "A"]);
    kn.dung();
  });

  it("đổi hỏng ⇒ người chờ nhận KHE_NANG_HONG; trong 60 s yêu cầu mới bị từ chối ngay; sau 60 s được thử lại", async () => {
    let hong = true;
    const { sv, kn, goi, nhatKy } = dung({ hongKhi: () => hong });
    const p1 = goi("B", "tuong-tac");
    await tien(DOI_MS + 1_000);
    await p1;
    expect(nhatKy[0].loi).toBe("KHE_NANG_HONG");
    expect(sv.giu).toBe("A");
    await goi("B", "tuong-tac");
    expect(nhatKy[1].loi).toBe("KHE_NANG_HONG");
    expect(sv.doi).toEqual(["B"]);
    // model nhà vẫn chạy bình thường trong lúc B nghỉ
    const pA = goi("A", "tuong-tac", 1_000);
    await tien(1_500);
    await pA;
    expect(nhatKy[2].vao).toBe(nhatKy[2].den);
    hong = false;
    await tien(60_000);
    const p3 = goi("B", "tuong-tac");
    await tien(DOI_MS + 5_000);
    await p3;
    expect(nhatKy[3].loi).toBeNull();
    expect(sv.doi).toEqual(["B", "B"]);
    kn.dung();
  });

  it("huỷ khi đang chờ đổi ⇒ KHE_NANG_HUY ngay; lượt đổi vẫn chạy trọn", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    const ac = new AbortController();
    const p = goi("B", "tuong-tac", 1_000, ac.signal);
    await tien(5_000);
    ac.abort();
    await p;
    expect(nhatKy[0].loi).toBe("KHE_NANG_HUY");
    await tien(DOI_MS);
    expect(sv.giu).toBe("B");
    kn.dung();
  });

  it("rảnh 15 phút ở model khác nhà ⇒ tự về nhà", async () => {
    const { sv, kn, goi } = dung();
    const p = goi("B", "tuong-tac", 1_000);
    await tien(DOI_MS + 2_000);
    await p;
    expect(sv.giu).toBe("B");
    await tien(14 * 60_000);
    expect(sv.giu).toBe("B");
    await tien(60_000 + DOI_MS + 1_000);
    expect(sv.giu).toBe("A");
    expect(sv.doi).toEqual(["B", "A"]);
    kn.dung();
  });

  it("/props không đọc được ⇒ model nhà đi tiếp, model khác KHE_NANG_SERVER", async () => {
    const { kn, goi, nhatKy } = dung({ giu: null });
    const pA = goi("A", "tuong-tac", 100);
    await tien(200);
    await pA;
    await goi("B", "tuong-tac");
    expect(nhatKy.map((d) => d.loi)).toEqual([null, "KHE_NANG_SERVER"]);
    kn.dung();
  });

  it("tuDoi:false (worker) ⇒ model khác KHE_NANG_TAT, model đang giữ đi bình thường", async () => {
    const { sv, kn, goi, nhatKy } = dung({ cauHinh: { tuDoi: false } });
    await goi("B", "nen");
    const pA = goi("A", "nen", 100);
    await tien(200);
    await pA;
    expect(nhatKy.map((d) => d.loi)).toEqual(["KHE_NANG_TAT", null]);
    expect(sv.doi).toEqual([]);
    kn.dung();
  });

  it("đích huỷ giữa lúc XẢ ⇒ thôi xả, người chờ model đang giữ được nhận lại", async () => {
    const { sv, kn, goi, nhatKy } = dung();
    const pA1 = goi("A", "tuong-tac", 20_000); // đang chạy ⇒ xả phải chờ nó
    await tien(100);
    const ac = new AbortController();
    const pB = goi("B", "tuong-tac", 1_000, ac.signal); // kích hoạt xả
    await tien(100);
    const pA2 = goi("A", "tuong-tac", 1_000); // bị giữ vì đang xả
    await tien(100);
    expect(nhatKy[2].vao).toBeNull();
    ac.abort();
    await tien(100);
    expect(nhatKy[2].vao, "hết đích ⇒ A2 được nhận ngay").not.toBeNull();
    await tien(30_000);
    await Promise.all([pA1, pB, pA2]);
    expect(sv.doi).toEqual([]);
    kn.dung();
  });
});

describe("★ Đợt 9 (M4 tranh khe) — `khiDoiKhe`: báo khi lượt được vào SAU một lần đổi khe THỰC xảy ra lúc nó chờ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("chờ B khi khe giữ A ⇒ đổi sang B ⇒ gọi khiDoiKhe ĐÚNG một lần; lượt khớp model đang giữ ⇒ không gọi", async () => {
    const { kn } = dung({ cauHinh: { luuTruToiThieuMs: 0 } });
    const daBao: string[] = [];
    const pA = kn.cho("A", "tuong-tac", undefined, () => daBao.push("A")).then((nha) => nha());
    await tien(100);
    const pB = kn.cho("B", "tuong-tac", undefined, () => daBao.push("B")).then((nha) => nha());
    await tien(DOI_MS + 5_000);
    await Promise.all([pA, pB]);
    expect(daBao).toEqual(["B"]);
  });

  it("lượt phải XẾP HÀNG (khe đang xả để đổi) nhưng lần đổi HỎNG ⇒ vào lại model cũ KHÔNG qua đổi khe ⇒ không gọi khiDoiKhe", async () => {
    const { kn } = dung({ cauHinh: { luuTruToiThieuMs: 0 }, hongKhi: (m) => m === "B" });
    const daBao: string[] = [];
    const pA1 = kn.cho("A", "tuong-tac").then(async (nha) => {
      await new Promise((r) => setTimeout(r, 5_000));
      nha();
    });
    await tien(100);
    const pB = kn.cho("B", "tuong-tac", undefined, () => daBao.push("B")).then((nha) => nha()).catch(() => daBao.push("B-loi"));
    await tien(100);
    const pA2 = kn.cho("A", "tuong-tac", undefined, () => daBao.push("A2")).then((nha) => nha());
    await tien(5_000 + DOI_MS + 5_000);
    await Promise.all([pA1, pB, pA2]);
    expect(daBao).toEqual(["B-loi"]);
  });
});

describe("★ Đợt 9 — KHOÁ KHE: khoá còn hạn ⇒ KHÔNG gọi doiSang (kể cả 'về nhà'); hết hạn ⇒ như cũ", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  function dungKhoa(khoaToi: number | null) {
    const sv = { giu: "B" as string | null, doi: [] as string[] };
    const k = { hetHan: khoaToi };
    const bo = {
      modelDangGiu: async () => sv.giu,
      doiSang: (m: string) => new Promise<void>((res) => setTimeout(() => { sv.doi.push(m); sv.giu = m; res(); }, DOI_MS)),
      khoaKhe: () => (k.hetHan !== null && Date.now() < k.hetHan ? { chu: "mot-luot PLC", lyDo: "đo", hetHan: k.hetHan, hong: false } : null),
    };
    const kn = new KheNang(bo, { ...CAU_HINH_MAC_DINH, luuTruToiThieuMs: 0, veNhaSauMs: 60_000 }, () => "A");
    return { sv, k, kn };
  }

  it("khe giữ B (27B) + khoá ⇒ yêu cầu A (35B) bị từ chối NÓI THẬT, không gọi doiSang", async () => {
    const { sv, kn } = dungKhoa(Date.now() + 10 * 60_000);
    let loi: LoiKheNang | null = null;
    const p = kn.cho("A", "tuong-tac").catch((e) => (loi = e));
    await tien(DOI_MS + 1_000);
    await p;
    expect(sv.doi).toEqual([]);
    expect(loi!.code).toBe("KHE_NANG_KHOA");
    expect(loi!.message).toContain("mot-luot PLC");
  });

  it("khoá HẾT HẠN ⇒ đổi như cũ", async () => {
    const { sv, kn } = dungKhoa(Date.now() - 1);
    const p = kn.cho("A", "tuong-tac").then((nha) => nha());
    await tien(DOI_MS + 1_000);
    await p;
    expect(sv.doi).toEqual(["A"]);
  });

  it("'về nhà' sau rảnh cũng bị khoá chặn; khoá hết ⇒ về nhà", async () => {
    const { sv, k, kn } = dungKhoa(Date.now() + 5 * 60_000);
    const p = kn.cho("B", "tuong-tac").then((nha) => nha()); // khớp model đang giữ ⇒ vào ngay, nhả ⇒ rảnh
    await p;
    await tien(2 * 60_000);
    expect(sv.doi).toEqual([]);
    k.hetHan = Date.now() - 1;
    await tien(4 * 60_000 + DOI_MS);
    expect(sv.doi).toEqual(["A"]);
  });
});
