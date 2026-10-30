/** Đợt 11.3-C · UX-D02 — CỔNG DUYỆT KẾ HOẠCH của lõi: ghi/lệnh chỉ chạy sau khi NGƯỜI duyệt kế hoạch; đổi bước ⇒ duyệt lại; fail-closed. */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { bamKeHoach, chuanHoaKeHoach, lamSachBuoc, TRAN_KY_TU_BUOC_KE_HOACH, TRAN_SO_BUOC_KE_HOACH, type CongKeHoach, type KetQuaChoDuyetKeHoach } from "./keHoach";
import type { BoThucThi, CheDoAgent, GoiModel, LyDoDung, ManhModel, SuKienAgent, TinNhan, WireToolCall } from "./kieu";

const goi = (id: string, ten: string, thamSo: Record<string, unknown>): WireToolCall => ({ id, type: "function", function: { name: ten, arguments: JSON.stringify(thamSo) } });
const todo = (id: string, ...nd: string[]) => goi(id, "todo_write", { todos: nd.map((content, i) => ({ content, status: i === 0 ? "in_progress" : "pending" })) });
const todoTT = (id: string, tt: string[], nd: string[]) => goi(id, "todo_write", { todos: nd.map((content, i) => ({ content, status: tt[i] })) });
const ghi = (id: string, p = "a.ts") => goi(id, "write_file", { path: p, content: "x" });
const lenh = (id: string) => goi(id, "run_command", { command: "npm test" });

interface Tuy {
  luot: WireToolCall[][];
  cheDo?: CheDoAgent;
  choDuyet?: CongKeHoach["choDuyet"] | null; // null ⇒ không truyền cổng
  signal?: AbortSignal;
  dongHo?: () => number;
  msToiDa?: number;
}

async function chay(o: Tuy) {
  const suKien: SuKienAgent[] = [];
  const daChay: string[] = [];
  const lichSu: TinNhan[][] = [];
  let i = 0;
  const goiModel: GoiModel = (v) => {
    lichSu.push(structuredClone(v.tinNhan));
    const k = i++;
    const tcs = o.luot[k] ?? [];
    return (async function* (): AsyncGenerator<ManhModel> {
      yield { loai: "xong", toolCalls: tcs, usage: { vao: 10, ra: 5 } };
    })();
  };
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c),
    chay: async (g) => {
      daChay.push(g.ten);
      return { ok: true, choModel: "ok" };
    },
  };
  const cong: CongKeHoach | undefined = o.choDuyet === null ? undefined : { choDuyet: o.choDuyet ?? (async () => ({ ketQua: "duyet", luc: "2026-10-31T00:00:00.000Z" })) };
  const kq = await chayVongAgent({
    cauHoi: "q",
    cheDo: o.cheDo ?? "sua",
    runId: "r",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: o.signal ?? new AbortController().signal,
    ...(o.dongHo ? { dongHo: o.dongHo } : {}),
    ...(o.msToiDa ? { gioiHan: { msToiDa: o.msToiDa } } : {}),
    ...(cong ? { congKeHoach: cong } : {}),
  });
  return { kq, suKien, daChay, lichSu };
}
const loai = (s: SuKienAgent[], l: string) => s.filter((e) => e.loai === l);
const ketQuaTool = (s: SuKienAgent[], id: string) => s.find((e) => e.loai === "ket-qua-tool" && e.id === id) as Extract<SuKienAgent, { loai: "ket-qua-tool" }> | undefined;

describe("keHoach — làm sạch + băm (thuần)", () => {
  it("băm không đổi theo trạng thái bước; đổi khi thêm/sửa/xoá/đổi chỗ", () => {
    const a = bamKeHoach([{ noiDung: "đọc mã" }, { noiDung: "sửa lỗi" }]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const ch = chuanHoaKeHoach([
      { noiDung: "đọc mã", trangThai: "xong" },
      { noiDung: "sửa lỗi", trangThai: "dang-lam" },
    ]);
    expect(ch.ok && ch.bam).toBe(a);
    expect(bamKeHoach([{ noiDung: "sửa lỗi" }, { noiDung: "đọc mã" }])).not.toBe(a);
    expect(bamKeHoach([{ noiDung: "đọc mã" }])).not.toBe(a);
    expect(bamKeHoach([{ noiDung: "đọc mã" }, { noiDung: "sửa lỗi!" }])).not.toBe(a);
  });
  it("khoảng trắng/NFC gộp: hai cách viết cùng chữ ⇒ cùng băm", () => {
    expect(bamKeHoach([{ noiDung: "  sửa   lỗi\n" }])).toBe(bamKeHoach([{ noiDung: "sửa lỗi" }]));
    expect(bamKeHoach([{ noiDung: "é" }])).toBe(bamKeHoach([{ noiDung: "é" }]));
  });
  it("ký tự ẩn/bidi/zero-width bị BỎ khỏi bước (chữ thuần)", () => {
    expect(lamSachBuoc(`a${String.fromCodePoint(0x202e)}b${String.fromCodePoint(0x200b)}c`)).toBe("abc");
    expect(lamSachBuoc(`x${String.fromCodePoint(0x00a0)}y`)).toBe("xy");
  });
  it("trần: quá nhiều bước / bước quá dài / rỗng ⇒ lỗi (không cắt âm thầm)", () => {
    const nhieu = Array.from({ length: TRAN_SO_BUOC_KE_HOACH + 1 }, (_, i) => ({ noiDung: `b${i}` }));
    expect(chuanHoaKeHoach(nhieu)).toMatchObject({ ok: false, ma: "KE_HOACH_QUA_NHIEU_BUOC" });
    expect(chuanHoaKeHoach([{ noiDung: "x".repeat(TRAN_KY_TU_BUOC_KE_HOACH + 1) }])).toMatchObject({ ok: false, ma: "KE_HOACH_BUOC_QUA_DAI" });
    expect(chuanHoaKeHoach([{ noiDung: "x".repeat(TRAN_KY_TU_BUOC_KE_HOACH) }]).ok).toBe(true);
    expect(chuanHoaKeHoach([{ noiDung: "  " }])).toMatchObject({ ok: false, ma: "KE_HOACH_BUOC_RONG" });
    expect(chuanHoaKeHoach([])).toMatchObject({ ok: false, ma: "KE_HOACH_RONG" });
  });
  it("trạng thái lạ ⇒ cho", () => {
    const ch = chuanHoaKeHoach([{ noiDung: "a", trangThai: "bay-bay" }]);
    expect(ch.ok && ch.viec[0]!.trangThai).toBe("cho");
  });
});

describe("cổng duyệt kế hoạch — lõi", () => {
  it("★★★ cổng TẮT (không truyền móc) ⇒ ghi chạy ngay, KHÔNG có sự kiện cổng, ke-hoach nguyên văn", async () => {
    const r = await chay({ luot: [[todo("t", "một bước"), ghi("w")], []], choDuyet: null });
    expect(r.daChay).toEqual(["write_file"]);
    expect(r.suKien.some((e) => e.loai.startsWith("ke-hoach-"))).toBe(false);
    expect(loai(r.suKien, "ke-hoach")).toHaveLength(1);
  });

  it("★★★ chưa có kế hoạch mà đòi ghi ⇒ PLAN_REQUIRED, bộ thực thi KHÔNG chạy, móc KHÔNG được gọi", async () => {
    let goiMoc = 0;
    const r = await chay({
      luot: [[ghi("w")], []],
      choDuyet: async () => {
        goiMoc++;
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(r.daChay).toEqual([]);
    expect(goiMoc).toBe(0);
    expect(ketQuaTool(r.suKien, "w")).toMatchObject({ ok: false, ma: "PLAN_REQUIRED" });
  });

  it("★★★ có kế hoạch ⇒ phát ke-hoach-cho-duyet (chữ thuần + băm) ⇒ móc ⇒ duyệt ⇒ ke-hoach-da-duyet ⇒ ghi chạy", async () => {
    const thuTu: string[] = [];
    let nhan: { bam: string; viec: unknown } | null = null;
    const r = await chay({
      luot: [[todo("t", "đọc", "sửa"), ghi("w")], []],
      choDuyet: async (yc) => {
        nhan = { bam: yc.bam, viec: yc.viec };
        thuTu.push("moc");
        return { ketQua: "duyet", luc: "2026-10-31T01:02:03.000Z" };
      },
    });
    expect(r.daChay).toEqual(["write_file"]);
    const cho = loai(r.suKien, "ke-hoach-cho-duyet")[0] as Extract<SuKienAgent, { loai: "ke-hoach-cho-duyet" }>;
    expect(cho.viec.map((v) => v.noiDung)).toEqual(["đọc", "sửa"]);
    expect(cho.bam).toBe(bamKeHoach([{ noiDung: "đọc" }, { noiDung: "sửa" }]));
    expect(nhan).toMatchObject({ bam: cho.bam });
    expect(loai(r.suKien, "ke-hoach-da-duyet")).toEqual([{ loai: "ke-hoach-da-duyet", bam: cho.bam, luc: "2026-10-31T01:02:03.000Z" }]);
    const ix = (l: string) => r.suKien.findIndex((e) => e.loai === l);
    expect(ix("ke-hoach-cho-duyet")).toBeLessThan(ix("ke-hoach-da-duyet"));
    expect(r.kq.lyDo).toBe("hoan-thanh");
  });

  it("đã duyệt ⇒ các tool ghi/lệnh sau đó KHÔNG hỏi lại; chỉ đọc không bao giờ hỏi", async () => {
    let n = 0;
    const r = await chay({
      luot: [[goi("r", "read_file", { path: "a" }), todo("t", "x"), ghi("w1"), lenh("c"), ghi("w2", "b.ts")], []],
      choDuyet: async () => {
        n++;
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(n).toBe(1);
    expect(r.daChay).toEqual(["read_file", "write_file", "run_command", "write_file"]);
  });

  it("★★★ (f) đổi NỘI DUNG bước sau khi duyệt ⇒ phải duyệt lại; chỉ đổi TRẠNG THÁI ⇒ không", async () => {
    const bams: string[] = [];
    const r = await chay({
      luot: [[todo("t1", "a", "b"), ghi("w1")], [todoTT("t2", ["xong", "dang-lam"], ["a", "b"]), ghi("w2", "b.ts")], [todo("t3", "a", "b", "c"), ghi("w3", "c.ts")], []],
      choDuyet: async (yc) => {
        bams.push(yc.bam);
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(bams).toHaveLength(2);
    expect(bams[1]).not.toBe(bams[0]);
    expect(r.daChay).toEqual(["write_file", "write_file", "write_file"]);
  });

  it("★★★ BÁC ⇒ lượt kết thúc `huy`, tool KHÔNG chạy, sự kiện khong-duyet lyDo bac, tin tool ghi rõ", async () => {
    const r = await chay({ luot: [[todo("t", "a"), ghi("w"), ghi("w2")], []], choDuyet: async () => ({ ketQua: "bac" }) });
    expect(r.kq.lyDo).toBe<LyDoDung>("huy");
    expect(r.daChay).toEqual([]);
    expect(loai(r.suKien, "ke-hoach-khong-duyet")).toMatchObject([{ lyDo: "bac" }]);
    expect(loai(r.suKien, "ke-hoach-da-duyet")).toHaveLength(0);
    expect(r.kq.tinNhan.filter((m) => m.role === "tool" && m.tool_call_id === "w2")).toHaveLength(1); // lời gọi sau cũng có tin (không treo)
  });

  it("HẾT GIỜ chờ ⇒ lượt kết thúc `het-gio`, khong-duyet lyDo het-gio", async () => {
    const r = await chay({ luot: [[todo("t", "a"), ghi("w")], []], choDuyet: async () => ({ ketQua: "het-gio" }) });
    expect(r.kq.lyDo).toBe<LyDoDung>("het-gio");
    expect(r.daChay).toEqual([]);
    expect(loai(r.suKien, "ke-hoach-khong-duyet")).toMatchObject([{ lyDo: "het-gio" }]);
  });

  it("★★★ FAIL-CLOSED: móc ném lỗi ⇒ coi là BÁC, không ghi", async () => {
    const r = await chay({
      luot: [[todo("t", "a"), ghi("w")], []],
      choDuyet: async () => {
        throw new Error("db chết");
      },
    });
    expect(r.kq.lyDo).toBe("huy");
    expect(r.daChay).toEqual([]);
  });

  it("★★★ kết quả lạ của móc (không phải duyet có luc) ⇒ KHÔNG ghi", async () => {
    const r = await chay({ luot: [[todo("t", "a"), ghi("w")], []], choDuyet: async () => ({ ketQua: "duyet" }) as unknown as KetQuaChoDuyetKeHoach });
    expect(r.daChay).toEqual([]);
    expect(r.kq.lyDo).toBe("huy");
  });

  it("huỷ GIỮA lúc chờ ⇒ `huy` ngay, móc nhận signal đã abort", async () => {
    const ac = new AbortController();
    let sigMoc: AbortSignal | null = null;
    const p = chay({
      luot: [[todo("t", "a"), ghi("w")], []],
      signal: ac.signal,
      choDuyet: (yc) => {
        sigMoc = yc.signal;
        queueMicrotask(() => ac.abort());
        return new Promise(() => undefined); // không bao giờ trả lời
      },
    });
    const r = await p;
    expect(r.kq.lyDo).toBe("huy");
    expect(r.daChay).toEqual([]);
    expect((sigMoc as AbortSignal | null)?.aborted).toBe(true);
  });

  it("chế độ hoi KHÔNG chịu cổng (không có tool ghi) và không gọi móc", async () => {
    let n = 0;
    const r = await chay({
      cheDo: "hoi",
      luot: [[todo("t", "a"), goi("r", "read_file", { path: "a" })], []],
      choDuyet: async () => {
        n++;
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(n).toBe(0);
    expect(r.daChay).toEqual(["read_file"]);
    expect(r.suKien.some((e) => e.loai.startsWith("ke-hoach-"))).toBe(false);
  });

  it("hoi: todo_write KHÔNG bị cổng làm sạch/chặn (vượt trần vẫn qua, như cũ)", async () => {
    const nhieu = Array.from({ length: TRAN_SO_BUOC_KE_HOACH + 5 }, (_, i) => "b" + i);
    const r = await chay({ cheDo: "hoi", luot: [[todo("t", ...nhieu)], []] });
    expect(ketQuaTool(r.suKien, "t")?.ok).toBe(true);
    expect((loai(r.suKien, "ke-hoach")[0] as Extract<SuKienAgent, { loai: "ke-hoach" }>).viec).toHaveLength(TRAN_SO_BUOC_KE_HOACH + 5);
  });

  it("host sửa bản sao viec của sự kiện/móc KHÔNG làm đổi kế hoạch của lõi (không hỏi lại vô cớ)", async () => {
    let n = 0;
    const r = await chay({
      luot: [[todo("t", "a", "b"), ghi("w1"), ghi("w2", "b.ts")], []],
      choDuyet: async (yc) => {
        n++;
        yc.viec[0]!.noiDung = "bi sua";
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(n).toBe(1);
    expect(r.daChay).toEqual(["write_file", "write_file"]);
  });

  it("tu-dong CŨNG chịu cổng", async () => {
    let n = 0;
    await chay({
      cheDo: "tu-dong",
      luot: [[todo("t", "a"), lenh("c")], []],
      choDuyet: async () => {
        n++;
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(n).toBe(1);
  });

  it("★★★ duyệt kế hoạch KHÔNG thay duyệt thẻ: lõi không phát da-duyet của thẻ; ghi vẫn đi qua bộ thực thi (nơi tạo thẻ)", async () => {
    const r = await chay({ luot: [[todo("t", "a"), ghi("w")], []] });
    expect(loai(r.suKien, "da-duyet")).toHaveLength(0);
    expect(r.daChay).toEqual(["write_file"]);
  });

  it("todo_write vượt trần ⇒ lỗi cho model, KHÔNG phát ke-hoach, kế hoạch vẫn 'chưa có' ⇒ ghi bị PLAN_REQUIRED", async () => {
    const nhieu = Array.from({ length: TRAN_SO_BUOC_KE_HOACH + 1 }, (_, i) => `b${i}`);
    const r = await chay({ luot: [[todo("t", ...nhieu), ghi("w")], []] });
    expect(ketQuaTool(r.suKien, "t")).toMatchObject({ ok: false, ma: "KE_HOACH_QUA_NHIEU_BUOC" });
    expect(loai(r.suKien, "ke-hoach")).toHaveLength(0);
    expect(ketQuaTool(r.suKien, "w")).toMatchObject({ ma: "PLAN_REQUIRED" });
    expect(r.daChay).toEqual([]);
  });

  it("★★★ bước chứa ký tự ẩn: sự kiện + băm dùng bản đã làm sạch", async () => {
    const r = await chay({ luot: [[todo("t", `sửa${String.fromCodePoint(0x202e)} lỗi`), ghi("w")], []] });
    const cho = loai(r.suKien, "ke-hoach-cho-duyet")[0] as Extract<SuKienAgent, { loai: "ke-hoach-cho-duyet" }>;
    expect(cho.viec[0]!.noiDung).toBe("sửa lỗi");
    expect(cho.bam).toBe(bamKeHoach([{ noiDung: "sửa lỗi" }]));
  });

  it("thời gian CHỜ duyệt không ăn ngân sách thời gian của lượt", async () => {
    let now = 1_000;
    const r = await chay({
      luot: [[todo("t", "a"), ghi("w")], []],
      msToiDa: 10_000,
      dongHo: () => now,
      choDuyet: async () => {
        now += 600_000; // chờ 10 phút
        return { ketQua: "duyet", luc: "t" };
      },
    });
    expect(r.kq.lyDo).toBe("hoan-thanh");
    expect(r.daChay).toEqual(["write_file"]);
  });

  it("lời nhắc hệ thống có quy tắc kế hoạch CHỈ khi cổng bật (tắt ⇒ giống từng byte)", async () => {
    const tat = await chay({ luot: [[]], choDuyet: null });
    const bat = await chay({ luot: [[]] });
    const sys = (l: TinNhan[][]) => l[0]!.find((m) => m.role === "system")!.content;
    expect(sys(bat.lichSu)).toContain("approve the plan");
    expect(sys(tat.lichSu)).not.toContain("approve the plan");
  });
});

describe("cổng duyệt kế hoạch — delegate (giao việc) cũng cần kế hoạch đã duyệt", () => {
  async function chayGiao(luot: WireToolCall[][], choDuyet: CongKeHoach["choDuyet"]) {
    const suKien: SuKienAgent[] = [];
    let tra = 0;
    let i = 0;
    const goiModel: GoiModel = () => {
      const tcs = luot[i++] ?? [];
      return (async function* (): AsyncGenerator<ManhModel> {
        yield { loai: "xong", toolCalls: tcs, usage: { vao: 10, ra: 5 } };
      })();
    };
    await chayVongAgent({
      cauHoi: "q",
      cheDo: "sua",
      runId: "r",
      nguCanhDuAn: "",
      goiModel,
      boThucThi: { congCu: (c) => congCuTheoCheDo(c, ["delegate"]), chay: async () => ({ ok: true, choModel: "ok" }) },
      phat: (e) => suKien.push(e),
      signal: new AbortController().signal,
      congKeHoach: { choDuyet },
      giaoViec: {
        doSauHienTai: 0,
        tra: async () => {
          tra++;
          return { ok: false, ma: "DINH_NGHIA_CHUA_TIN", thongDiep: "x" };
        },
        batDauCon: async () => ({ ok: false, ma: "X", thongDiep: "x" }),
      },
    });
    return { suKien, tra };
  }
  const giao = (id: string) => goi(id, "delegate", { agent: "kham-pha", task: "tim cho goi retry" });

  it("★★★ chưa có kế hoạch ⇒ PLAN_REQUIRED, không tra định nghĩa, không hỏi", async () => {
    let n = 0;
    const r = await chayGiao([[giao("g")], []], async () => {
      n++;
      return { ketQua: "duyet", luc: "t" };
    });
    expect(ketQuaTool(r.suKien, "g")).toMatchObject({ ok: false, ma: "PLAN_REQUIRED" });
    expect(r.tra).toBe(0);
    expect(n).toBe(0);
  });

  it("có kế hoạch ⇒ hỏi người; bác ⇒ dừng, không tra định nghĩa", async () => {
    const r = await chayGiao([[todo("t", "a"), giao("g")], []], async () => ({ ketQua: "bac" }));
    expect(r.tra).toBe(0);
    expect(loai(r.suKien, "ke-hoach-khong-duyet")).toHaveLength(1);
  });
});
