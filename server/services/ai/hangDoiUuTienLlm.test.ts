/**
 * Lưới cho `hangDoiUuTienLlm.ts` — Đợt 0.3, cổng ưu tiên trước llama-server (1 slot × 64k).
 *
 * Canh đúng những HỨA HẸN của cổng, mỗi hứa hẹn một ca:
 *   • thứ tự theo MỨC (tuong-tac > agent > nen), FIFO TRONG mức;
 *   • chống đói: `nen` chờ quá ngưỡng được nâng lên ngang `tuong-tac` (theo thứ tự đến);
 *   • rời hàng khi `AbortSignal` huỷ; trần độ dài hàng; trần thời gian chờ;
 *   • nhả slot khi fn ném / khi generator bị `return()` sớm;
 *   • ngữ cảnh mức lan qua `await` và mặc định `tuong-tac` khi không có ngữ cảnh;
 *   • cờ tắt `LLM_PRIORITY_GATE_ENABLED=false` ⇒ đi thẳng, không xếp hàng.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CongUuTienLlm,
  LoiHangDoiLlmBiHuy,
  LoiHangDoiLlmHetGioCho,
  LoiHangDoiLlmQuaTai,
  chayVoiUuTien,
  congUuTienBat,
  laLoiHangDoiLlm,
  mucUuTienHienTai,
  quaCongUuTien,
  quaCongUuTienLuong,
  soSlotLlamaServer,
  thongKeHangDoiLlm,
  __datLaiCongUuTienChoTest,
  chayVoiNgheCho,
} from "./hangDoiUuTienLlm";

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/** Một "việc" giữ slot cho tới khi test gọi `xong()`. */
function viecGiuSlot() {
  let xong!: () => void;
  const p = new Promise<void>((r) => (xong = r));
  return { p, xong };
}

const ENV_KEYS = [
  "LLM_PRIORITY_GATE_ENABLED",
  "LLM_PRIORITY_GATE_CONCURRENCY",
  "LLAMA_SERVER_SLOTS",
  "LLAMA_SERVER_PARALLEL",
  "LLM_PRIORITY_GATE_QUEUE_MAX",
  "LLM_PRIORITY_GATE_WAIT_MS",
  "LLM_PRIORITY_GATE_AGING_MS",
];
let envCu: Record<string, string | undefined> = {};
beforeEach(() => {
  envCu = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  __datLaiCongUuTienChoTest();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envCu[k] === undefined) delete process.env[k];
    else process.env[k] = envCu[k];
  }
  __datLaiCongUuTienChoTest();
});

describe("CongUuTienLlm — thứ tự", () => {
  it("lượt CHỜ được phục vụ theo mức: tuong-tac trước agent trước nen, bất kể thứ tự đến", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const giu = viecGiuSlot();
    const thuTu: string[] = [];
    const dang = cong.chay("tuong-tac", () => giu.p);
    await tick();
    const ps = [
      cong.chay("nen", async () => void thuTu.push("nen-1")),
      cong.chay("agent", async () => void thuTu.push("agent-1")),
      cong.chay("nen", async () => void thuTu.push("nen-2")),
      cong.chay("tuong-tac", async () => void thuTu.push("tt-1")),
      cong.chay("agent", async () => void thuTu.push("agent-2")),
      cong.chay("tuong-tac", async () => void thuTu.push("tt-2")),
    ];
    await tick();
    expect(cong.thongKe().dangCho).toEqual({ "tuong-tac": 2, agent: 2, nen: 2 });
    giu.xong();
    await Promise.all([dang, ...ps]);
    expect(thuTu).toEqual(["tt-1", "tt-2", "agent-1", "agent-2", "nen-1", "nen-2"]);
  });

  it("không bao giờ vượt số slot (soSlot=2 ⇒ tối đa 2 lượt chạy cùng lúc)", async () => {
    const cong = new CongUuTienLlm({ soSlot: 2, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    let dangChay = 0;
    let dinh = 0;
    await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        cong.chay(i % 2 ? "nen" : "tuong-tac", async () => {
          dangChay++;
          dinh = Math.max(dinh, dangChay);
          await tick(3);
          dangChay--;
        }),
      ),
    );
    expect(dinh).toBe(2);
    expect(cong.thongKe().dangChay).toBe(0);
  });
});

describe("CongUuTienLlm — chống đói", () => {
  it("lượt `nen` chờ quá ngưỡng được nâng lên và đi TRƯỚC lượt tuong-tac đến SAU nó", async () => {
    let bayGio = 1_000;
    const cong = new CongUuTienLlm({
      soSlot: 1,
      hangToiDa: 50,
      choToiDaMs: 60_000,
      nguongNangMs: 120_000,
      dongHo: () => bayGio,
    });
    const thuTu: string[] = [];
    const giu1 = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu1.p);
    await tick();
    const pNen = cong.chay("nen", async () => void thuTu.push("nen"));
    await tick();
    bayGio += 121_000; // nen đã chờ > 120 s
    const pTt = cong.chay("tuong-tac", async () => void thuTu.push("tt"));
    await tick();
    giu1.xong();
    await Promise.all([dang, pNen, pTt]);
    expect(thuTu).toEqual(["nen", "tt"]);
    expect(cong.thongKe().daNangChongDoi).toBe(1);
  });

  it("CHƯA quá ngưỡng thì `nen` vẫn nhường tuong-tac đến sau", async () => {
    let bayGio = 1_000;
    const cong = new CongUuTienLlm({
      soSlot: 1,
      hangToiDa: 50,
      choToiDaMs: 60_000,
      nguongNangMs: 120_000,
      dongHo: () => bayGio,
    });
    const thuTu: string[] = [];
    const giu1 = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu1.p);
    await tick();
    const pNen = cong.chay("nen", async () => void thuTu.push("nen"));
    bayGio += 119_000;
    const pTt = cong.chay("tuong-tac", async () => void thuTu.push("tt"));
    await tick();
    giu1.xong();
    await Promise.all([dang, pNen, pTt]);
    expect(thuTu).toEqual(["tt", "nen"]);
  });
});

describe("CongUuTienLlm — rời hàng / trần", () => {
  it("AbortSignal huỷ khi đang chờ ⇒ rời hàng NGAY với LoiHangDoiLlmBiHuy, fn không bao giờ chạy", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const giu = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu.p);
    await tick();
    const ac = new AbortController();
    let daChay = false;
    const p = cong.chay("tuong-tac", async () => void (daChay = true), { signal: ac.signal });
    await tick();
    expect(cong.thongKe().dangCho["tuong-tac"]).toBe(1);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(LoiHangDoiLlmBiHuy);
    expect(cong.thongKe().dangCho["tuong-tac"]).toBe(0);
    giu.xong();
    await dang;
    expect(daChay).toBe(false);
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("signal đã huỷ TỪ TRƯỚC ⇒ từ chối ngay, kể cả khi còn slot trống", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const ac = new AbortController();
    ac.abort();
    await expect(cong.chay("tuong-tac", async () => 1, { signal: ac.signal })).rejects.toBeInstanceOf(LoiHangDoiLlmBiHuy);
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("hàng đầy ⇒ LoiHangDoiLlmQuaTai (mã LLM_QUEUE_OVERLOADED)", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 1, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const giu = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu.p);
    await tick();
    const p2 = cong.chay("tuong-tac", async () => 2);
    const p3 = cong.chay("nen", async () => 3);
    await expect(p3).rejects.toBeInstanceOf(LoiHangDoiLlmQuaTai);
    await expect(p3).rejects.toMatchObject({ code: "LLM_QUEUE_OVERLOADED" });
    giu.xong();
    await expect(p2).resolves.toBe(2);
    await dang;
    expect(cong.thongKe().tuChoiQuaTai).toBe(1);
  });

  it("chờ quá trần ⇒ LoiHangDoiLlmHetGioCho và rời hàng", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 20, nguongNangMs: 60_000 });
    const giu = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu.p);
    await tick();
    const p = cong.chay("nen", async () => 1);
    await expect(p).rejects.toBeInstanceOf(LoiHangDoiLlmHetGioCho);
    expect(cong.thongKe().dangCho.nen).toBe(0);
    giu.xong();
    await dang;
  });

  it("laLoiHangDoiLlm nhận ra cả ba lỗi của cổng, không nhận lỗi thường", () => {
    expect(laLoiHangDoiLlm(new LoiHangDoiLlmQuaTai())).toBe(true);
    expect(laLoiHangDoiLlm(new LoiHangDoiLlmHetGioCho())).toBe(true);
    expect(laLoiHangDoiLlm(new LoiHangDoiLlmBiHuy())).toBe(true);
    expect(laLoiHangDoiLlm(new Error("x"))).toBe(false);
  });
});

describe("CongUuTienLlm — nhả slot", () => {
  it("fn ném ⇒ slot vẫn được nhả và lượt kế tiếp chạy", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const p1 = cong.chay("tuong-tac", async () => {
      await tick(2);
      throw new Error("server hỏng");
    });
    const p2 = cong.chay("nen", async () => "ok");
    await expect(p1).rejects.toThrow("server hỏng");
    await expect(p2).resolves.toBe("ok");
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("generator bị return() sớm (client bỏ đi) ⇒ slot được nhả ở finally", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    let gocDaDong = false;
    async function* goc() {
      try {
        for (let i = 0; i < 100; i++) yield i;
      } finally {
        gocDaDong = true;
      }
    }
    const g = cong.chayLuong("tuong-tac", () => goc());
    expect((await g.next()).value).toBe(0);
    expect(cong.thongKe().dangChay).toBe(1); // giữ slot suốt vòng đời generator
    await g.return(undefined);
    expect(gocDaDong).toBe(true);
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("van an toàn: generator bị BỎ RƠI (không return) quá trần giữ ⇒ slot bị thu hồi, lượt sau chạy được", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000, giuToiDaMs: 20 });
    const g = cong.chayLuong("tuong-tac", async function* () {
      yield 1;
      yield 2;
    });
    await g.next(); // consumer bỏ đi ở đây, không return()
    await expect(cong.chay("nen", async () => "toi luot")).resolves.toBe("toi luot");
    expect(cong.thongKe().thuHoiCuong).toBe(1);
    await g.return(undefined); // nhả muộn KHÔNG được làm âm bộ đếm
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("generator ném giữa chừng ⇒ slot được nhả", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    async function* goc() {
      yield 1;
      throw new Error("đứt luồng");
    }
    const g = cong.chayLuong("tuong-tac", () => goc());
    await g.next();
    await expect(g.next()).rejects.toThrow("đứt luồng");
    expect(cong.thongKe().dangChay).toBe(0);
  });

  it("generator chờ trong hàng rồi bị huỷ ⇒ không bao giờ mở luồng gốc", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    const giu = viecGiuSlot();
    const dang = cong.chay("tuong-tac", () => giu.p);
    await tick();
    let daMo = false;
    const ac = new AbortController();
    const g = cong.chayLuong(
      "tuong-tac",
      async function* () {
        daMo = true;
        yield 1;
      },
      { signal: ac.signal },
    );
    const pNext = g.next();
    await tick();
    ac.abort();
    await expect(pNext).rejects.toBeInstanceOf(LoiHangDoiLlmBiHuy);
    giu.xong();
    await dang;
    expect(daMo).toBe(false);
    expect(cong.thongKe().dangChay).toBe(0);
  });
});

describe("ngữ cảnh mức ưu tiên (AsyncLocalStorage)", () => {
  it("mặc định khi không có ngữ cảnh là `tuong-tac`", () => {
    expect(mucUuTienHienTai()).toBe("tuong-tac");
  });

  it("lan qua await, setTimeout và lồng nhau (trong cùng thắng)", async () => {
    const thay: string[] = [];
    await chayVoiUuTien("nen", async () => {
      await tick(1);
      thay.push(mucUuTienHienTai());
      await new Promise<void>((r) =>
        setTimeout(() => {
          thay.push(mucUuTienHienTai());
          r();
        }, 1),
      );
      await chayVoiUuTien("agent", async () => {
        await tick();
        thay.push(mucUuTienHienTai());
      });
      thay.push(mucUuTienHienTai());
    });
    thay.push(mucUuTienHienTai());
    expect(thay).toEqual(["nen", "nen", "agent", "nen", "tuong-tac"]);
  });

  it("quaCongUuTien đọc mức từ ngữ cảnh: lượt `nen` nhường lượt tuong-tac không ngữ cảnh", async () => {
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "1";
    __datLaiCongUuTienChoTest();
    const thuTu: string[] = [];
    const giu = viecGiuSlot();
    const dang = quaCongUuTien(() => giu.p);
    await tick();
    const pNen = chayVoiUuTien("nen", () => quaCongUuTien(async () => void thuTu.push("nen")));
    const pTt = quaCongUuTien(async () => void thuTu.push("tt"));
    await tick();
    expect(thongKeHangDoiLlm().dangCho).toEqual({ "tuong-tac": 1, agent: 0, nen: 1 });
    giu.xong();
    await Promise.all([dang, pNen, pTt]);
    expect(thuTu).toEqual(["tt", "nen"]);
  });

  it("chayVoiNgheCho: người nghe nhận số lượt PHÍA TRƯỚC khi lượt phải xếp hàng", async () => {
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "1";
    __datLaiCongUuTienChoTest();
    const giu = viecGiuSlot();
    const dang = quaCongUuTien(() => giu.p);
    await tick();
    const pKhac = chayVoiUuTien("tuong-tac", () => quaCongUuTien(async () => 1));
    await tick();
    const nghe: number[] = [];
    const pToi = chayVoiNgheCho(
      (p) => nghe.push(p.phiaTruoc),
      () => quaCongUuTien(async () => 2),
    );
    await tick();
    giu.xong();
    await Promise.all([dang, pKhac, pToi]);
    // 1 lượt đang chạy + 1 lượt chờ cùng mức đứng trước ⇒ 2 phía trước
    expect(nghe).toEqual([2]);
  });
});

describe("trần chờ riêng theo ngữ cảnh", () => {
  it("chayVoiUuTien(..., {choToiDaMs}) rút trần chờ của lượt bên trong (MIN với trần chung)", async () => {
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "1";
    process.env.LLM_PRIORITY_GATE_WAIT_MS = "60000";
    __datLaiCongUuTienChoTest();
    const giu = viecGiuSlot();
    const dang = quaCongUuTien(() => giu.p);
    await tick();
    const t0 = Date.now();
    const p = chayVoiUuTien("nen", () => quaCongUuTien(async () => 1), { choToiDaMs: 20 });
    await expect(p).rejects.toBeInstanceOf(LoiHangDoiLlmHetGioCho);
    expect(Date.now() - t0).toBeLessThan(5000);
    giu.xong();
    await dang;
  });
});

describe("cấu hình + cờ tắt", () => {
  it("số slot: LLM_PRIORITY_GATE_CONCURRENCY > LLAMA_SERVER_SLOTS > LLAMA_SERVER_PARALLEL > 1", () => {
    expect(soSlotLlamaServer()).toBe(1);
    process.env.LLAMA_SERVER_PARALLEL = "3";
    expect(soSlotLlamaServer()).toBe(3);
    process.env.LLAMA_SERVER_SLOTS = "2";
    expect(soSlotLlamaServer()).toBe(2);
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "4";
    expect(soSlotLlamaServer()).toBe(4);
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "rác";
    expect(soSlotLlamaServer()).toBe(2);
  });

  it("mặc định BẬT; LLM_PRIORITY_GATE_ENABLED=false ⇒ tắt", () => {
    expect(congUuTienBat()).toBe(true);
    process.env.LLM_PRIORITY_GATE_ENABLED = "false";
    expect(congUuTienBat()).toBe(false);
  });

  it("cờ tắt ⇒ quaCongUuTien/quaCongUuTienLuong đi thẳng: không xếp hàng, không đếm", async () => {
    process.env.LLM_PRIORITY_GATE_ENABLED = "false";
    process.env.LLM_PRIORITY_GATE_CONCURRENCY = "1";
    __datLaiCongUuTienChoTest();
    let dangChay = 0;
    let dinh = 0;
    const viec = async () => {
      dangChay++;
      dinh = Math.max(dinh, dangChay);
      await tick(3);
      dangChay--;
    };
    await Promise.all([quaCongUuTien(viec), quaCongUuTien(viec), chayVoiUuTien("nen", () => quaCongUuTien(viec))]);
    expect(dinh).toBe(3); // hành vi cũ: mọi lượt đi thẳng xuống llama-server
    const g = quaCongUuTienLuong(async function* () {
      yield "a";
    });
    expect((await g.next()).value).toBe("a");
    expect(thongKeHangDoiLlm().dangChay).toBe(0);
    expect(thongKeHangDoiLlm().batCong).toBe(false);
  });

  it("thống kê: p50/max thời gian chờ gần đây + đếm đã phục vụ", async () => {
    const cong = new CongUuTienLlm({ soSlot: 1, hangToiDa: 50, choToiDaMs: 5000, nguongNangMs: 60_000 });
    await Promise.all([
      cong.chay("tuong-tac", () => tick(5)),
      cong.chay("nen", () => tick(1)),
      cong.chay("agent", () => tick(1)),
    ]);
    const tk = cong.thongKe();
    expect(tk.daPhucVu).toBe(3);
    expect(tk.choGanDay.soMau).toBe(3);
    expect(tk.choGanDay.maxMs).toBeGreaterThanOrEqual(tk.choGanDay.p50Ms);
    expect(tk.choGanDay.maxMs).toBeGreaterThan(0);
  });
});
