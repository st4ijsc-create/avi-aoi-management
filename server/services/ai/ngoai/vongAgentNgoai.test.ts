/**
 * ★ Đợt 10.4b L3 — cặp bộ chuyển agent ngoài (`vongAgentNgoai.ts`) chạy với `chayVongAgent` THẬT, cổng giả trong tiến trình (KHÔNG gọi
 * nhà cung cấp thật). Ghim: nguồn gốc từng tin (fail-closed), mức MAX mọi vòng, `nguCanhDuAn` / system lõi không ra ngoài, hai lớp chặn
 * tool (không quảng bá + bộ thực thi từ chối), ánh xạ tên lõi ⇒ bộ đọc ngoài, huỷ trước khi gọi.
 */
import { describe, expect, it, vi } from "vitest";
import { CONG_CU, chayVongAgent, type SuKienAgent, type TinNhan, type WireTool } from "@shared/agentCore";
import type { KetQuaGoiNgoai, YeuCauGoiNgoai } from "./congNgoai";
import { chayToolDocNgoai, type KetQuaTool, type TrongThaiDoc } from "./congCuDocNgoai";
import { ANH_XA_TOOL_AGENT_NGOAI, TRAN_VONG_AGENT_NGOAI, taoCapAgentNgoai, type CauHinhAgentNgoai } from "./vongAgentNgoai";
import { LoiNgoai } from "./loi";

type TraLoiGia = { noiDung?: string; toolCalls?: Array<{ ten: string; thamSo: unknown }> };

function dung(kichBan: TraLoiGia[], them: Partial<CauHinhAgentNgoai> = {}) {
  const yeuCau: YeuCauGoiNgoai[] = [];
  let i = 0;
  const goi = vi.fn(async (yc: YeuCauGoiNgoai): Promise<KetQuaGoiNgoai> => {
    yeuCau.push(yc);
    const b = kichBan[Math.min(i++, kichBan.length - 1)]!;
    return { noiDung: b.noiDung ?? "", toolCalls: b.toolCalls ?? [], khongTinCay: true, tokenVao: 100, tokenRa: 20, chiPhiUocUsd: 0.001, callId: 900 + i } as unknown as KetQuaGoiNgoai;
  });
  const chayTool = vi.fn(async (ten: string, thamSo: Record<string, unknown>): Promise<KetQuaTool> => ({ ok: true, path: String(thamSo.path ?? "."), noiDung: `<<<KQ ${ten} ${JSON.stringify(thamSo)}>>>` }));
  const doc: TrongThaiDoc = { byte: 0, tep: 0, tranByte: 262_144, tranTep: 50 };
  const cap = taoCapAgentNgoai({
    dich: { nhaCungCap: "anthropic", model: "claude-x" },
    runId: "11111111-2222-3333-4444-555555555555",
    user: { id: 7, role: "user" },
    nhaMay: 1,
    cauHoi: "hàm xacMinh nằm ở đâu?",
    lichSu: [],
    ngonNgu: "vi",
    goc: "D:/du-an",
    doc,
    goi,
    chayTool,
    ...them,
  });
  return { cap, goi, chayTool, yeuCau };
}

async function chay(d: ReturnType<typeof dung>, o: { lichSu?: TinNhan[]; nguCanhDuAn?: string; cauHoi?: string } = {}) {
  const suKien: SuKienAgent[] = [];
  const kq = await chayVongAgent({
    cauHoi: o.cauHoi ?? "hàm xacMinh nằm ở đâu?",
    lichSu: o.lichSu ?? [],
    cheDo: "hoi",
    runId: "11111111-2222-3333-4444-555555555555",
    nguCanhDuAn: o.nguCanhDuAn ?? "",
    goiModel: d.cap.goiModel,
    boThucThi: d.cap.boThucThi,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { soLuotToiDa: 6 },
  });
  return { kq, suKien };
}

const tenCap = (yc: YeuCauGoiNgoai) => (yc.congCu ?? []).map((c) => c.ten).sort();
const than = (yc: YeuCauGoiNgoai) => JSON.stringify(yc.tinNhan);
async function vet(gen: AsyncIterable<unknown>) {
  const ra: unknown[] = [];
  for await (const x of gen) ra.push(x);
  return ra;
}
async function loi(p: Promise<unknown>) {
  try {
    await p;
    return "khong-nem";
  } catch (e) {
    return e instanceof LoiNgoai ? `${e.ma}:${e.chiTiet ?? ""}` : String(e);
  }
}

describe("vòng agent ngoài — đường thường", () => {
  it("read_file rồi trả lời: 2 vòng, tool chạy qua bộ đọc ngoài, kết quả vào vòng 2 là ma-repo, vết cộng dồn, không thẻ duyệt", async () => {
    const d = dung([{ toolCalls: [{ ten: "read_file", thamSo: { path: "server/a.ts" } }] }, { noiDung: "Nằm ở server/a.ts dòng 3." }]);
    const { kq, suKien } = await chay(d);
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(d.goi).toHaveBeenCalledTimes(2);
    expect(d.chayTool).toHaveBeenCalledWith("read_file", { path: "server/a.ts" }, expect.anything());
    expect(than(d.yeuCau[1]!)).toContain("<<<KQ read_file");
    expect(d.yeuCau.every((y) => y.ngu.runId === "11111111-2222-3333-4444-555555555555" && y.ngu.nguonMuc.loai === "be-mat")).toBe(true);
    expect(d.yeuCau.map((y) => (y.ngu.nguonMuc as { beMat: string }).beMat)).toEqual(["agent-turn", "agent-turn"]);
    // rà kiem-dinh v11/v12 — CẢ KHỐI `ngu` + mục đích / trần token / đích, MỌI vòng
    for (const y of d.yeuCau) {
      expect(y.ngu).toEqual({
        userId: 7,
        flowId: null,
        runId: "11111111-2222-3333-4444-555555555555",
        tuDong: false,
        nhaMayNguoiGoi: [1],
        nhaMayChuDuLieu: [1],
        nguonMuc: { loai: "be-mat", beMat: "agent-turn", phanDaGhep: expect.any(Array) },
      });
      expect({ mucDich: y.mucDich, maxTokens: y.maxTokens, dich: y.dich, dinhKem: y.dinhKem }).toEqual({ mucDich: "agent", maxTokens: 4000, dich: { nhaCungCap: "anthropic", model: "claude-x" }, dinhKem: undefined });
    }
    expect(d.cap.callIds()).toEqual([901, 902]);
    expect(d.cap.vet()).toEqual({ nhaCungCap: "anthropic", model: "claude-x", tokenVao: 200, tokenRa: 40, chiPhiUocUsd: 0.002 });
    expect(suKien.some((e) => e.loai === "can-duyet" || e.loai === "de-xuat-nho" || e.loai === "checkpoint")).toBe(false);
    expect(suKien.filter((e) => e.loai === "dang-cho-model").every((e) => (e as { phiaTruoc: number }).phiaTruoc === 0)).toBe(true);
  });

  it("không lịch sử ⇒ mọi vòng ky-thuat; CÓ lịch sử ⇒ MỌI vòng van-hanh (kể cả vòng sau tool)", async () => {
    const a = dung([{ toolCalls: [{ ten: "grep", thamSo: { pattern: "xacMinh" } }] }, { noiDung: "ok" }]);
    await chay(a);
    expect(a.yeuCau.map((y) => (y.ngu.nguonMuc as { phanDaGhep: string[] }).phanDaGhep.includes("van-hanh"))).toEqual([false, false]);
    const ls: TinNhan[] = [
      { role: "user", content: "câu trước" },
      { role: "assistant", content: "đáp trước" },
    ];
    const b = dung([{ toolCalls: [{ ten: "grep", thamSo: { pattern: "xacMinh" } }] }, { noiDung: "ok" }], { lichSu: ls });
    await chay(b, { lichSu: ls });
    expect(b.yeuCau).toHaveLength(2);
    expect(b.yeuCau.map((y) => (y.ngu.nguonMuc as { phanDaGhep: string[] }).phanDaGhep.includes("van-hanh"))).toEqual([true, true]);
  });

  it("system lõi + nguCanhDuAn (quy ước / bài học / định nghĩa agent repo) KHÔNG có trong thân gửi ra; chỉ hướng dẫn tĩnh", async () => {
    const d = dung([{ noiDung: "ok" }]);
    await chay(d, { nguCanhDuAn: "CANH-AGENTS-MD-7f3a bài học: mật khẩu kho là X" });
    const t = than(d.yeuCau[0]!);
    expect(t).not.toContain("CANH-AGENTS-MD-7f3a");
    expect(t).toContain("CHỈ ĐỌC");
    expect(d.yeuCau[0]!.tinNhan.filter((m) => (m as { vaiTro: string }).vaiTro === "system")).toHaveLength(1);
  });
});

describe("trần vòng do bộ chuyển giữ (rà kiem-dinh v25)", () => {
  it("model LUÔN đòi tool, lõi cho tới 30 lượt ⇒ ĐÚNG 6 lần gọi cổng, vòng 6 KHÔNG chạy tool, lượt kết thúc bằng câu báo hết vòng", async () => {
    // mỗi vòng một mẫu KHÁC (lõi dừng `lap-lai` khi lặp y hệt — không phải trần cần đo)
    const d = dung(Array.from({ length: 10 }, (_, i) => ({ toolCalls: [{ ten: "grep", thamSo: { pattern: `mau${i}` } }] })));
    const suKien: SuKienAgent[] = [];
    const kq = await chayVongAgent({
      cauHoi: "hàm xacMinh nằm ở đâu?",
      cheDo: "hoi",
      runId: "11111111-2222-3333-4444-555555555555",
      nguCanhDuAn: "",
      goiModel: d.cap.goiModel,
      boThucThi: d.cap.boThucThi,
      phat: (e) => suKien.push(e),
      signal: new AbortController().signal,
      gioiHan: { soLuotToiDa: 30 },
    });
    expect(d.goi).toHaveBeenCalledTimes(TRAN_VONG_AGENT_NGOAI);
    expect(TRAN_VONG_AGENT_NGOAI).toBe(6);
    expect(d.chayTool).toHaveBeenCalledTimes(TRAN_VONG_AGENT_NGOAI - 1);
    expect(kq.lyDo).toBe("hoan-thanh");
    expect(suKien.some((e) => e.loai === "chu" && e.noiDung.includes("hết số vòng"))).toBe(true);
  });

  it("gọi GoiModel lần thứ 7 trên cùng cặp ⇒ NGOAI_VUOT_TRAN TRƯỚC khi gọi cổng", async () => {
    const d = dung([{ noiDung: "ok" }]);
    const mot = () => vet(d.cap.goiModel({ tinNhan: [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }], congCu: CONG_CU, signal: new AbortController().signal }));
    for (let i = 0; i < TRAN_VONG_AGENT_NGOAI; i++) await mot();
    expect(await loi(mot())).toBe("NGOAI_VUOT_TRAN:vong-agent");
    expect(d.goi).toHaveBeenCalledTimes(TRAN_VONG_AGENT_NGOAI);
  });
});

describe("hai lớp chặn tool", () => {
  it("lớp 1 — quảng bá CHỈ read_file · list_dir · grep · todo_write dù lõi đưa đủ 15 tool + delegate", async () => {
    const d = dung([{ noiDung: "ok" }]);
    const delegate: WireTool = { type: "function", function: { name: "delegate", description: "giao việc con", parameters: { type: "object" } } };
    await vet(d.cap.goiModel({ tinNhan: [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }], congCu: [...CONG_CU, delegate], signal: new AbortController().signal }));
    expect(tenCap(d.yeuCau[0]!)).toEqual(["grep", "list_dir", "read_file", "todo_write"]);
    expect(d.cap.boThucThi.congCu("hoi").map((t) => t.function.name).sort()).toEqual(["grep", "list_dir", "read_file"]);
    expect(d.cap.boThucThi.congCu("sua")).toEqual([]);
    expect(d.cap.boThucThi.congCu("tu-dong")).toEqual([]);
  });

  it("lớp 1b — model trả tool ngoài tập (edit_file / delegate) ⇒ NGOAI_TOOL_KHONG_CAP, không thực thi gì", async () => {
    for (const ten of ["edit_file", "delegate", "run_command"]) {
      const d = dung([{ toolCalls: [{ ten, thamSo: { path: "a.ts" } }] }]);
      expect(await loi(vet(d.cap.goiModel({ tinNhan: [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }], congCu: CONG_CU, signal: new AbortController().signal }))), ten)
        .toBe(`NGOAI_TOOL_KHONG_CAP:${ten}`);
      expect(d.chayTool).not.toHaveBeenCalled();
    }
  });

  it("lớp 2 — bộ thực thi từ chối tool ngoài tập và mọi chế độ ≠ hoi, kể cả tool đọc", async () => {
    const d = dung([]);
    const ctx = (cheDo: "hoi" | "sua" | "tu-dong") => ({ cheDo, runId: "r", luot: 1, signal: new AbortController().signal, phat: () => {} });
    for (const ten of ["edit_file", "write_file", "delete_file", "rename_file", "run_command", "remember", "search_docs", "find_files", "find_symbol", "search_code", "lookup_api", "compile_st", "delegate", "toString", "__proto__"]) {
      const r = await d.cap.boThucThi.chay({ id: "x", ten, thamSo: { path: "a.ts" } }, ctx("hoi"));
      expect(r, ten).toMatchObject({ ok: false, ma: "NGOAI_TOOL_KHONG_CAP" });
    }
    for (const cheDo of ["sua", "tu-dong"] as const) {
      expect(await d.cap.boThucThi.chay({ id: "x", ten: "read_file", thamSo: { path: "a.ts" } }, ctx(cheDo))).toMatchObject({ ok: false, ma: "NGOAI_TOOL_KHONG_CAP" });
    }
    expect(d.chayTool).not.toHaveBeenCalled();
  });

  it("ánh xạ tên lõi ⇒ bộ đọc ngoài: read_file→read_file · list_dir→list_files(depth 1) · grep→grep_repo; tham số thừa bị bỏ", async () => {
    expect({ ...ANH_XA_TOOL_AGENT_NGOAI }).toEqual({ read_file: "read_file", list_dir: "list_files", grep: "grep_repo" });
    const d = dung([]);
    const ctx = { cheDo: "hoi" as const, runId: "r", luot: 1, signal: new AbortController().signal, phat: () => {} };
    await d.cap.boThucThi.chay({ id: "1", ten: "read_file", thamSo: { path: "a.ts", start_line: 1, goc: "C:/" } }, ctx);
    await d.cap.boThucThi.chay({ id: "2", ten: "list_dir", thamSo: { path: "server" } }, ctx);
    await d.cap.boThucThi.chay({ id: "3", ten: "grep", thamSo: { pattern: "x", path: "shared", include: "*.ts" } }, ctx);
    expect(d.chayTool.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["read_file", { path: "a.ts" }],
      ["list_files", { path: "server", depth: 1 }],
      ["grep_repo", { pattern: "x", path: "shared" }],
    ]);
    expect(d.chayTool.mock.calls.every((c) => c[2].goc === "D:/du-an")).toBe(true);
  });
});

describe("rà kiem-dinh k1 — TỪNG tool qua bộ chuyển + bộ đọc ngoài THẬT (`chayToolDocNgoai`), đĩa giả", () => {
  const GOC = "/w/repo";
  const bang: Record<string, string> = {
    "/w/repo/src/lien-ket.ts": "/w/repo/.env",
    "/w/repo/src/a.ts": "/w/repo/src/a.ts",
    "/w/repo/src/b.ts": "/w/repo/src/b.ts",
    "/w/repo/src/anh.ts": "/w/repo/src/anh.ts",
    "/w/repo/lib": "/w/khac/lib",
    "/w/repo/src": "/w/repo/src",
    "/w/repo/.env": "/w/repo/.env",
  };
  const realpath = async (p: string) => {
    if (p in bang) return bang[p]!;
    if (p === GOC) return GOC;
    throw new Error("ENOENT");
  };
  function dungThat(tranByte = 100_000) {
    const hopCat: Array<[string, Record<string, unknown>]> = [];
    const thucThi = async (tool: string, args: Record<string, unknown>) => {
      hopCat.push([tool, args]);
      if (tool === "read_file") return { data: { content: args.path === "src/anh.ts" ? "PNG\u0000\u0001\u0002\u0000" : "x".repeat(600) } };
      if (tool === "list_files") return { data: { entries: [{ path: "src/a.ts", kind: "file" }, { path: ".env", kind: "file" }, { path: "src/lien-ket.ts", kind: "file" }] } };
      return { data: { matches: [{ path: "src/a.ts", line: 1, text: "khop" }, { path: ".env", line: 2, text: "DB_PASS=bi-mat" }, { path: "src/lien-ket.ts", line: 3, text: "TOKEN=bi-mat" }] } };
    };
    const doc: TrongThaiDoc = { byte: 0, tep: 0, tranByte, tranTep: 50 };
    const d = dung([], {
      goc: GOC,
      doc,
      chayTool: (ten, thamSo, o) => chayToolDocNgoai(ten, thamSo, o, { realpath, thucThi }),
    });
    const ctx = { cheDo: "hoi" as const, runId: "r", luot: 1, signal: new AbortController().signal, phat: () => {} };
    const goiTool = (ten: string, thamSo: Record<string, unknown>) => d.cap.boThucThi.chay({ id: "t", ten, thamSo }, ctx);
    return { goiTool, hopCat, doc };
  }

  it("read_file: .env / symlink tới .env ⇒ DENIED_SECRET (hộp cát không được gọi); nhị phân ⇒ NHI_PHAN; tệp thường ⇒ đường ĐÃ GIẢI", async () => {
    const t = dungThat();
    expect(await t.goiTool("read_file", { path: ".env" })).toMatchObject({ ok: false, ma: "DENIED_SECRET" });
    expect(await t.goiTool("read_file", { path: "src/lien-ket.ts" })).toMatchObject({ ok: false, ma: "DENIED_SECRET" });
    expect(t.hopCat).toHaveLength(0);
    expect(await t.goiTool("read_file", { path: "src/anh.ts" })).toMatchObject({ ok: false, ma: "NHI_PHAN" });
    expect(await t.goiTool("read_file", { path: "src/a.ts" })).toMatchObject({ ok: true, hienThi: { tool: "read_file", path: "src/a.ts" } });
  });

  it("list_dir: junction ra ngoài gốc ⇒ PATH_REJECTED; KẾT QUẢ lọc theo đường thật (.env + symlink tới .env bị ẩn)", async () => {
    const t = dungThat();
    expect(await t.goiTool("list_dir", { path: "lib" })).toMatchObject({ ok: false, ma: "PATH_REJECTED" });
    const r = await t.goiTool("list_dir", { path: "src" });
    expect(r.ok).toBe(true);
    expect(r.choModel).toContain("src/a.ts");
    expect(r.choModel).not.toMatch(/\.env|lien-ket/);
    expect(t.hopCat.at(-1)).toEqual(["list_files", { path: "src", depth: 1 }]);
  });

  it("grep: KẾT QUẢ lọc theo đường thật — dòng khớp trong .env / symlink tới .env không bao giờ tới model", async () => {
    const t = dungThat();
    const r = await t.goiTool("grep", { pattern: "PASS|TOKEN|khop" });
    expect(r.ok).toBe(true);
    expect(r.choModel).toContain("src/a.ts:1: khop");
    expect(r.choModel).not.toContain("bi-mat");
    expect(t.hopCat.at(-1)?.[0]).toBe("grep_repo");
  });

  it("trần byte đọc CỘNG DỒN qua mọi tool của run (read_file + list_dir + grep dùng chung một bộ đếm)", async () => {
    const t = dungThat(650);
    expect((await t.goiTool("read_file", { path: "src/a.ts" })).ok).toBe(true);
    expect(t.doc).toMatchObject({ byte: 600, tep: 1 });
    expect(await t.goiTool("read_file", { path: "src/b.ts" })).toMatchObject({ ok: false, ma: "TRAN_BYTE_DOC" });
    expect(await t.goiTool("list_dir", { path: "src" })).toMatchObject({ ok: false, ma: "TRAN_BYTE_DOC" });
    expect(await t.goiTool("grep", { pattern: "khop" })).toMatchObject({ ok: false, ma: "TRAN_BYTE_DOC" });
    expect(t.doc).toMatchObject({ byte: 600, tep: 1 });
  });
});

describe("nguồn gốc từng tin — fail-closed", () => {
  const goiThang = (d: ReturnType<typeof dung>, tinNhan: TinNhan[]) => loi(vet(d.cap.goiModel({ tinNhan, congCu: CONG_CU, signal: new AbortController().signal })));

  it("tin tool với id KHÔNG do bộ chuyển phát ⇒ NGOAI_KHONG_QUA_BO_GHEP, không gọi cổng", async () => {
    const d = dung([{ noiDung: "ok" }]);
    expect(await goiThang(d, [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }, { role: "tool", tool_call_id: "gia-1", name: "read_file", content: "dữ liệu vận hành" }])).toBe("NGOAI_KHONG_QUA_BO_GHEP:tool-khong-dang-ky");
    expect(d.goi).not.toHaveBeenCalled();
  });

  it("tin user không phải câu hỏi / lịch sử / câu nhắc tĩnh của lõi ⇒ NGOAI_KHONG_QUA_BO_GHEP", async () => {
    const d = dung([{ noiDung: "ok" }]);
    expect(await goiThang(d, [{ role: "user", content: "chèn từ đâu đó" }])).toBe("NGOAI_KHONG_QUA_BO_GHEP:user-khong-ro-nguon");
    expect(d.goi).not.toHaveBeenCalled();
  });

  it("tin lịch sử là van-hanh dù vai assistant (không bị hạ thành dau-ra-model)", async () => {
    const ls: TinNhan[] = [{ role: "assistant", content: "đáp cũ chứa số liệu ca 2" }];
    const d = dung([{ noiDung: "ok" }], { lichSu: ls });
    await vet(d.cap.goiModel({ tinNhan: [...ls, { role: "user", content: "hàm xacMinh nằm ở đâu?" }], congCu: CONG_CU, signal: new AbortController().signal }));
    expect((d.yeuCau[0]!.ngu.nguonMuc as { phanDaGhep: string[] }).phanDaGhep).toContain("van-hanh");
  });

  it("sàn mức: lượt khai có lịch sử (client / phiên) mà danh sách gửi đi không còn tin van-hanh nào ⇒ ném san-muc, không gọi cổng", async () => {
    const d = dung([{ noiDung: "ok" }], { lichSu: [{ role: "user", content: "câu trước" }] });
    expect(await goiThang(d, [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }])).toBe("NGOAI_KHONG_QUA_BO_GHEP:san-muc");
    expect(d.goi).not.toHaveBeenCalled();
  });

  it("huỷ TRƯỚC khi gọi ⇒ không gọi cổng (không phí, không egress)", async () => {
    const d = dung([{ noiDung: "ok" }]);
    const ac = new AbortController();
    ac.abort();
    await vet(d.cap.goiModel({ tinNhan: [{ role: "user", content: "hàm xacMinh nằm ở đâu?" }], congCu: CONG_CU, signal: ac.signal }));
    expect(d.goi).not.toHaveBeenCalled();
  });
});
