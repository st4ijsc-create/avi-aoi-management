/**
 * Đợt 12 · H5.4 — lõi: móc `luuLichSu` ở ranh giới an toàn: (a) TRƯỚC khi tool chạy (đã chờ), (b) sau kết quả tool; bỏ system; lỗi nuốt; con không chụp;
 * vắng móc ⇒ như cũ từng byte.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { bamNoiDung, type DinhNghiaAgent } from "./dinhNghiaAgent";
import type { CauHinhGiaoViec } from "./giaoViec";
import type { BoThucThi, GoiModel, ManhModel, TinNhan } from "./kieu";

interface Luot {
  chu?: string;
  tool?: Array<{ ten: string; args: Record<string, unknown> }>;
}
function modelGia(kb: Luot[], yeuCau?: string[]): GoiModel {
  let i = 0;
  return (v) => {
    yeuCau?.push(JSON.stringify(v.tinNhan));
    const l = kb[i] ?? { chu: "xong" };
    const stt = i++;
    return (async function* (): AsyncGenerator<ManhModel> {
      if (l.chu) yield { loai: "chu", noiDung: l.chu };
      yield { loai: "xong", toolCalls: (l.tool ?? []).map((t, k) => ({ id: `c${stt}_${k}`, type: "function" as const, function: { name: t.ten, arguments: JSON.stringify(t.args) } })) };
    })();
  };
}

interface Chup {
  runId: string;
  buoc: number;
  tinNhan: TinNhan[];
}
async function chay(o: { kb: Luot[]; luu?: (c: Chup) => void | Promise<void>; trinhTu?: string[]; giaoViec?: CauHinhGiaoViec; yeuCau?: string[] }) {
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c, o.giaoViec ? ["delegate"] : []),
    async chay(goi) {
      o.trinhTu?.push(`tool:${goi.ten}`);
      return { ok: true, choModel: `kq ${goi.ten}` };
    },
  };
  return chayVongAgent({
    cauHoi: "hỏi gì đó",
    cheDo: "sua",
    runId: "run-1",
    nguCanhDuAn: "",
    goiModel: modelGia(o.kb, o.yeuCau),
    boThucThi: bo,
    phat: () => undefined,
    signal: new AbortController().signal,
    ...(o.luu ? { luuLichSu: o.luu } : {}),
    ...(o.giaoViec ? { giaoViec: o.giaoViec } : {}),
  });
}
const VAI_TRO = (c: Chup) => c.tinNhan.map((m) => m.role).join(",");

describe("luuLichSu", () => {
  it("★★★ chụp (a) TRƯỚC khi tool chạy rồi (b) SAU kết quả; thứ tự: chụp(a) → tool → chụp(b)", async () => {
    const tt: string[] = [];
    const chup: Chup[] = [];
    await chay({
      kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { chu: "xong" }],
      trinhTu: tt,
      luu: (c) => {
        tt.push(`chup:${VAI_TRO(c)}`);
        chup.push(structuredClone(c));
      },
    });
    expect(tt).toEqual(["chup:user,assistant", "tool:read_file", "chup:user,assistant,tool"]);
    expect(chup.every((c) => c.runId === "run-1")).toBe(true);
    // (a): tin assistant có tool_calls, CHƯA có kết quả ⇒ đúng thứ cần để đánh dấu "outcome unknown"
    expect(chup[0]!.tinNhan.at(-1)).toMatchObject({ role: "assistant", tool_calls: [{ function: { name: "read_file" } }] });
    expect(chup[1]!.tinNhan.at(-1)).toMatchObject({ role: "tool", content: "kq read_file" });
  });

  it("★ bản chụp BỎ system (lõi dựng lại khi tiếp tục) và mang câu hỏi gốc", async () => {
    const chup: Chup[] = [];
    await chay({ kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { chu: "xong" }], luu: (c) => void chup.push(structuredClone(c)) });
    for (const c of chup) {
      expect(c.tinNhan.some((m) => m.role === "system")).toBe(false);
      expect(c.tinNhan[0]).toMatchObject({ role: "user", content: "hỏi gì đó" });
    }
  });

  it("`buoc` là số lượt model (tăng dần)", async () => {
    const chup: Chup[] = [];
    await chay({
      kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { tool: [{ ten: "grep", args: { pattern: "x" } }] }, { chu: "xong" }],
      luu: (c) => void chup.push(structuredClone(c)),
    });
    expect(chup.map((c) => c.buoc)).toEqual([1, 1, 2, 2]);
  });

  it("★★★ móc được CHỜ: tool KHÔNG chạy trước khi móc (bất đồng bộ chậm) xong", async () => {
    const tt: string[] = [];
    await chay({
      kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { chu: "xong" }],
      trinhTu: tt,
      luu: async (c) => {
        if (c.tinNhan.at(-1)?.role === "assistant") {
          await new Promise((r) => setTimeout(r, 40));
          tt.push("chup-a-xong");
        }
      },
    });
    expect(tt.indexOf("chup-a-xong")).toBeLessThan(tt.indexOf("tool:read_file"));
  });

  it("móc ném / từ chối ⇒ lượt chạy KHÔNG hỏng", async () => {
    for (const luu of [
      () => {
        throw new Error("đĩa đầy");
      },
      () => Promise.reject(new Error("db chết")),
    ]) {
      const kq = await chay({ kb: [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { chu: "xong" }], luu });
      expect(kq.lyDo).toBe("hoan-thanh");
    }
  });

  it("lượt trả lời cuối (không tool) KHÔNG chụp thêm (xong ⇒ host xoá bản lưu)", async () => {
    const chup: Chup[] = [];
    await chay({ kb: [{ chu: "trả lời luôn" }], luu: (c) => void chup.push(c) });
    expect(chup).toHaveLength(0);
  });

  it("★★★ vắng móc ⇒ yêu cầu gửi model GIỐNG từng byte so với có móc (móc chỉ ĐỌC)", async () => {
    const a: string[] = [];
    const b: string[] = [];
    const kb = [{ tool: [{ ten: "read_file", args: { path: "a.ts" } }] }, { chu: "xong" }];
    await chay({ kb, yeuCau: a });
    await chay({ kb, yeuCau: b, luu: () => undefined });
    expect(a).toEqual(b);
  });

  it("★★★ agent CON không chụp (móc chỉ của vòng gốc, runId gốc)", async () => {
    const dn: DinhNghiaAgent = { ten: "kham-pha", moTa: "x", congCu: ["read_file"], model: "auto", cheDo: "hoi", than: "You explore.", bam: bamNoiDung("x"), nguon: "dungSan" };
    const cfg: CauHinhGiaoViec = {
      doSauHienTai: 0,
      async tra() {
        return { ok: true, dn };
      },
      async batDauCon() {
        return { ok: true, runId: "con-1", goiModel: modelGia([{ tool: [{ ten: "read_file", args: { path: "b.ts" } }] }, { chu: "con xong" }]), ketThuc: () => undefined };
      },
    };
    const chup: Chup[] = [];
    await chay({ kb: [{ tool: [{ ten: "delegate", args: { agent: "kham-pha", task: "t" } }] }, { chu: "cha xong" }], giaoViec: cfg, luu: (c) => void chup.push(structuredClone(c)) });
    expect(chup.length).toBeGreaterThan(0);
    expect(chup.every((c) => c.runId === "run-1")).toBe(true);
    expect(JSON.stringify(chup)).not.toContain("b.ts"); // việc của con không lọt vào bản lưu của gốc (cha chỉ thấy tóm tắt)
  });
});
