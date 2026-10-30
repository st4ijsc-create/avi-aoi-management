/** Đợt 11.8 · UX-C06 — sự kiện `ngu-canh-day` (≥ 80 %) và lời nhắc tóm tắt NOTES.md (tuỳ chọn, mặc định TẮT). */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { cauNhacTomTatNguCanh } from "./loiNhac";
import { NGUONG_NGU_CANH_DAY_PHAN_TRAM, type BoThucThi, type CheDoAgent, type GoiModel, type ManhModel, type SuKienAgent, type TinNhan } from "./kieu";

/** `vaoTheoLuot[i]` = token vào báo ở lượt model i (ngân sách 1000 ⇒ vao/10 = %). */
function chay(o: { vaoTheoLuot: number[]; cheDo?: CheDoAgent; nhac?: boolean }) {
  const suKien: SuKienAgent[] = [];
  const nhanDuoc: TinNhan[][] = [];
  let i = 0;
  const goiModel: GoiModel = (v) => {
    nhanDuoc.push(structuredClone(v.tinNhan));
    const k = i++;
    const vao = o.vaoTheoLuot[k] ?? 0;
    const cuoi = k >= o.vaoTheoLuot.length - 1;
    return (async function* (): AsyncGenerator<ManhModel> {
      yield {
        loai: "xong",
        toolCalls: cuoi ? [] : [{ id: `c${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `f${k}` }) } }],
        usage: { vao, ra: 5 },
      };
    })();
  };
  const bo: BoThucThi = { congCu: (c) => congCuTheoCheDo(c), chay: async () => ({ ok: true, choModel: "x" }) };
  return chayVongAgent({
    cauHoi: "q",
    cheDo: o.cheDo ?? "sua",
    runId: "r",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { nganSachNguCanhToken: 1000 },
    ...(o.nhac !== undefined ? { nhacTomTatKhiDay: o.nhac } : {}),
  }).then(() => ({ suKien, nhanDuoc }));
}

describe("ngu-canh-day", () => {
  it("ngưỡng thống nhất 80 %", () => {
    expect(NGUONG_NGU_CANH_DAY_PHAN_TRAM).toBe(80);
  });
  it("★★★ phát ĐÚNG MỘT lần khi lượt model đầu tiên chạm ≥ 80 %, kèm số %", async () => {
    const { suKien } = await chay({ vaoTheoLuot: [300, 790, 800, 900, 950] });
    const ev = suKien.filter((e) => e.loai === "ngu-canh-day");
    expect(ev).toEqual([{ loai: "ngu-canh-day", phanTram: 80 }]);
  });
  it("dưới 80 % ⇒ không phát", async () => {
    const { suKien } = await chay({ vaoTheoLuot: [300, 600, 794] });
    expect(suKien.some((e) => e.loai === "ngu-canh-day")).toBe(false);
  });
  it("mặc định KHÔNG nhắc model (lịch sử không có tin nhắc); sự kiện vẫn phát", async () => {
    const { suKien, nhanDuoc } = await chay({ vaoTheoLuot: [850, 860, 870] });
    expect(suKien.some((e) => e.loai === "ngu-canh-day")).toBe(true);
    expect(JSON.stringify(nhanDuoc)).not.toContain("NOTES.md");
  });
  it("★★★ bật nhắc ở sua ⇒ nhắc MỘT lần, ở đầu lượt model kế, sau tin tool hợp lệ", async () => {
    const { nhanDuoc } = await chay({ vaoTheoLuot: [850, 860, 870, 880], nhac: true });
    const nhac = cauNhacTomTatNguCanh(85);
    const soLan = nhanDuoc.filter((ds) => ds.some((m) => m.role === "user" && m.content === nhac)).length;
    expect(soLan).toBe(3); // lượt 2,3,4 đều thấy (lịch sử giữ); nhưng chỉ ĐƯỢC THÊM một lần
    const lanThem = nhanDuoc[3]!.filter((m) => m.role === "user" && m.content === nhac).length;
    expect(lanThem).toBe(1);
    const ds = nhanDuoc[1]!;
    const i = ds.findIndex((m) => m.content === nhac);
    expect(ds[i - 1]!.role).toBe("tool");
  });
  it("bật nhắc nhưng chế độ hoi (không có công cụ ghi) ⇒ KHÔNG nhắc", async () => {
    const { nhanDuoc } = await chay({ vaoTheoLuot: [850, 860], nhac: true, cheDo: "hoi" });
    expect(JSON.stringify(nhanDuoc)).not.toContain("NOTES.md");
  });
  it("lời nhắc nêu NOTES.md, người dùng duyệt, không bắt đầu việc mới", () => {
    const t = cauNhacTomTatNguCanh(81);
    expect(t).toContain("81%");
    expect(t).toMatch(/NOTES\.md/);
    expect(t).toMatch(/user reviews and approves/);
    expect(t).toMatch(/Do not start new work/);
  });
});
