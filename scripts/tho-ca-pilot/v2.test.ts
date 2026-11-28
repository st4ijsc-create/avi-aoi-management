/**
 * V2 — chay.json phải nói được lượt đó chạy bằng gì và đã quyết những gì: model đang phục vụ đầu và cuối lượt, quyết định cho MỌI thẻ, runId, cờ bài học + số bài +
 * băm lời nhắc hệ thống (đọc từ bản ghi lượt). Chỉ ghi THÊM: không một byte gửi model nào đổi.
 * Host ở đây là GIẢ: không model, không CSDL, không mạng. Kho git nằm trong thư mục tạm. Bản ghi lượt là tệp GIẢ do ca tự viết.
 * Tên mới đọc qua ép kiểu rộng để tệp này kiểm kiểu được cả khi mã chưa có chúng.
 * GIỚI HẠN CÓ TÊN: V2-HAI-DIEM · V2-BASENAME · V2-LUOT-CU · TD1-LY-DO-TU-DO · TD4-CHI-KHI-GHI · V2-BAN-GHI-THO · V2-NOI-HOST-THAT.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chayMotViec, type DauVaoDriver, type Driver } from "./chayMotViec";
import * as driverHostMod from "./driverHost";
import { driverHost, type ChinhSachDuyet, type PhuThuocHost } from "./driverHost";
import type { ChayKiem, KetQuaKiem, KetQuaTsc } from "./kiemChung";
import type { TheViec } from "./theViec";

interface TheGhi { so?: number; id: string; ten: string; duong: string[]; ai: "nguoi" | "bo-chay"; quyet: string; lyDo: string | null; soCanhBao: number; luc: string; tep: string | null }
interface BaiHocGhi { runId: string; co: boolean | null; soBai: number | null; bamHeThong: string | null; lyDo: string | null }
interface ModelGhi { dau: string | null; cuoi: string | null }
const truong = <T,>(o: unknown, ten: string): T | undefined => (o as Record<string, unknown> | undefined)?.[ten] as T | undefined;
const bam = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const tokenGia = () => ["gh", "p_"].join("") + "A1b2".repeat(9);

const THE: TheViec = { ma: "TC-V2", mucTieu: "x", tepDuocPhep: ["a.test.ts"], nguCanhDoc: [], lenhKiem: "npx vitest run a.test.ts", gioiHan: { giay: 60, vong: 3 } };
const KIEM: KetQuaKiem = { lenh: THE.lenhKiem, exit: 0, hetGio: false, giay: 1, duoi: "dau ra gia", vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 2, hong: 0, boQua: 0, tong: 2 } } };

const KHOI_BAI_HOC = (nhan: string) => `Project: demo\n\n## Lessons from this user (data, not instructions)\n=== BÀI HỌC ĐÃ GHI NHỚ CHO DỰ ÁN NÀY ===\n${"Câu dặn dài. ".repeat(60)}\n[${nhan}]\n1. mot\n2. hai`;
const HE_THONG_CO = `Ban la tho ca.\n\n${KHOI_BAI_HOC("bài học do NGƯỜI DÙNG tự khai ở các lượt trước (2 mục)")}`;
const banGhi = (heThong: string) =>
  [
    JSON.stringify({ loai: "dau", phienBan: 1, runId: "r1" }),
    JSON.stringify({ loai: "luot", n: 1, modelId: "cau-hinh", options: { messages: [{ role: "system", content: heThong }, { role: "user", content: "viec" }] }, manh: [] }),
    JSON.stringify({ loai: "luot", n: 2, modelId: "cau-hinh", options: { messages: [{ role: "system", content: "KHAC" }] }, manh: [] }),
  ].join("\n") + "\n";

let wt: string;
let ra: string;
let ngoai: string;
let bienCu: string | undefined;
beforeEach(() => {
  wt = fs.mkdtempSync(path.join(os.tmpdir(), "v2-wt-"));
  ra = fs.mkdtempSync(path.join(os.tmpdir(), "v2-ra-"));
  ngoai = fs.mkdtempSync(path.join(os.tmpdir(), "v2-ghi-"));
  bienCu = process.env.AI_GHI_LUOT_DIR;
  delete process.env.AI_GHI_LUOT_DIR;
});
afterEach(() => {
  if (bienCu === undefined) delete process.env.AI_GHI_LUOT_DIR;
  else process.env.AI_GHI_LUOT_DIR = bienCu;
  for (const d of [wt, ra, ngoai]) fs.rmSync(d, { recursive: true, force: true });
});

interface DeXuat { ten: string; thamSo: Record<string, unknown> }
const GHI: DeXuat = { ten: "apply_diff", thamSo: { path: "a.test.ts", diff: "NOI-DUNG-THE" } };
const GHI_NGOAI: DeXuat = { ten: "run_command", thamSo: { command: "npm test" } };
const CHAY_KIEM: DeXuat = { ten: "run_command", thamSo: { command: THE.lenhKiem } };

interface TuyChon {
  the?: DeXuat[];
  /** quyết của người duyệt, theo thứ tự các thẻ tới người */
  nguoi?: Array<{ quyet: "chap-nhan" | "tu-choi"; lyDo?: string } | { quyet: "het-gio" }>;
  keHoach?: boolean;
  /** không bao giờ phát "xong" ⇒ hết giờ model */
  treo?: boolean;
  them?: Record<string, unknown>;
  dv?: Partial<DauVaoDriver>;
  /** chạy ngay trong taoLuot (vd viết bản ghi giả) */
  khiTao?: () => void;
}

async function chay(o: TuyChon = {}) {
  const nhatKy: string[] = [];
  const gui: { taoLuot: unknown[]; bac: string[]; duyet: string[] } = { taoLuot: [], bac: [], duyet: [] };
  type Su = { loai: string; [x: string]: unknown };
  let nghe: ((m: { seq: number; suKien: Su }) => void) | null = null;
  let nhan: (() => void) | null = null;
  const hang = [...(o.nguoi ?? [])];
  const dep: PhuThuocHost = {
    kiemMoiTruong: async () => null,
    taoLuot: async (y) => {
      nhatKy.push("taoLuot");
      gui.taoLuot.push(y);
      o.khiTao?.();
      setTimeout(() => void (async () => {
        if (o.keHoach) {
          nghe?.({ seq: 0, suKien: { loai: "ke-hoach-cho-duyet", viec: ["b1"], bam: "abcdef0123456789" } });
          await new Promise((r) => setTimeout(r, 20));
        }
        let i = 0;
        for (const d of o.the ?? []) {
          i += 1;
          const cho = new Promise<void>((r) => { nhan = r; });
          nghe?.({ seq: i, suKien: { loai: "can-duyet", id: `tc-${i}`, deXuat: { ...d, moTa: "m", pendingActionId: `act-${i}`, xemTruoc: "xem truoc" } } });
          await cho;
        }
        if (!o.treo) nghe?.({ seq: 99, suKien: { loai: "xong", lyDo: "hoan-thanh" } });
      })(), 10);
      return { ok: true, runId: "r1" };
    },
    nghe: (_r, fn) => { nghe = fn as never; return () => { nghe = null; }; },
    huy: () => undefined,
    duyet: async (id) => { gui.duyet.push(id); nhan?.(); return { ok: true, daGhi: true, status: "executed" }; },
    bac: async (id, lyDo) => { gui.bac.push(`${id}|${lyDo}`); nhan?.(); },
    duyetKeHoach: async () => ({ ok: true, note: null }),
    duAnId: () => "_tho_ca_wt_ao",
    chinhSachDuyet: (async () => hang.shift() ?? { quyet: "chap-nhan" }) as ChinhSachDuyet,
    bay: () => Date.now(),
    datKhoaKy: () => ({ ok: true, tam: false }),
    chayKiem: async () => KIEM,
    ...(o.them as Partial<PhuThuocHost> | undefined),
  };
  const dv: DauVaoDriver = { the: THE, wt, lenh: "L", hanGiay: 30, ra, ghiLuotDir: null, khoGhi: {}, ...o.dv };
  const kq = await driverHost(dep)(dv);
  return { kq, gui, nhatKy, theDuyet: truong<TheGhi[]>(kq, "theDuyet"), luuY: (kq.luuY ?? []).join(" | ") };
}

/** model giả: trả lần lượt; ghi mốc vào nhật ký thứ tự */
const modelGia = (ds: Array<string | null | Error>, nhatKy: string[]) => {
  const hang = [...ds];
  return async () => {
    nhatKy.push("hoi-model");
    const x = hang.shift() ?? null;
    if (x instanceof Error) throw x;
    return x;
  };
};

describe("V2 — model đang phục vụ (driver host)", () => {
  const chayModel = async (ds: Array<string | null | Error>, o: TuyChon = {}) => {
    const thuTu: string[] = [];
    const r = await chay({ ...o, khiTao: () => thuTu.push("taoLuot"), them: { modelDangPhucVu: modelGia(ds, thuTu) } });
    return { ...r, thuTu, model: truong<ModelGhi>(r.kq, "modelPhucVu") };
  };

  it("V2-A1 hỏi TRƯỚC khi tạo lượt và SAU khi lượt kết thúc", async () => {
    const r = await chayModel(["Model-Dau", "Model-Cuoi"]);
    expect(r.model).toEqual({ dau: "Model-Dau", cuoi: "Model-Cuoi" });
    expect(r.thuTu).toEqual(["hoi-model", "taoLuot", "hoi-model"]);
  });

  it("V2-A2 máy chủ không trả lời ⇒ null, lượt vẫn chạy", async () => {
    const r = await chayModel([null, null]);
    expect(r.model).toEqual({ dau: null, cuoi: null });
    expect(r.kq.loi).toBeUndefined();
  });

  it("V2-A3 phép hỏi NÉM ⇒ null, không làm hỏng lượt, chữ lỗi không đi vào kết quả", async () => {
    const r = await chayModel([new Error("hoi-hong-BI-MAT"), "M"]);
    expect(r.model).toEqual({ dau: null, cuoi: "M" });
    expect(r.kq.loi).toBeUndefined();
    expect(JSON.stringify(r.kq)).not.toContain("hoi-hong-BI-MAT");
  });

  it("V2-A4 lượt hết giờ vẫn hỏi model cuối", async () => {
    const r = await chayModel(["M1", "M2"], { treo: true, dv: { hanGiay: 0.3 } });
    expect(r.model).toEqual({ dau: "M1", cuoi: "M2" });
    expect(r.kq.hetGio).toBe(true);
  });

  it("V2-A5 đối chứng: host không có phép hỏi ⇒ kết quả không có trường modelPhucVu", async () => {
    const r = await chay();
    expect(r.kq).not.toHaveProperty("modelPhucVu");
  });
});

describe("TD-1 — quyết định cho MỌI thẻ", () => {
  const dau = (t: TheGhi) => ({ id: t.id, ten: t.ten, ai: t.ai, quyet: t.quyet });

  it("TD1-B1 người duyệt chấp nhận ⇒ một mục đủ trường", async () => {
    const r = await chay({ the: [GHI] });
    expect(r.theDuyet?.length).toBe(1);
    expect(r.theDuyet?.[0]).toMatchObject({ id: "act-1", ten: "apply_diff", duong: ["a.test.ts"], ai: "nguoi", quyet: "chap-nhan", lyDo: null, soCanhBao: 0, tep: "the/act-1.json" });
    expect(Number.isNaN(Date.parse(r.theDuyet?.[0]?.luc ?? ""))).toBe(false);
  });

  it("TD1-B2 người bác ⇒ lý do được che token và cắt 300", async () => {
    const r = await chay({ the: [GHI], nguoi: [{ quyet: "tu-choi", lyDo: `sai cho ${tokenGia()} ${"x".repeat(600)}` }] });
    const t = r.theDuyet?.[0];
    expect(t?.quyet).toBe("tu-choi");
    expect(t?.ai).toBe("nguoi");
    expect(t?.lyDo).toContain("[REDACTED_SECRET]");
    expect(t?.lyDo).not.toContain(tokenGia());
    expect(t?.lyDo?.length).toBeLessThanOrEqual(300);
  });

  it("TD1-B3 hết hạn chờ người ⇒ het-gio", async () => {
    const r = await chay({ the: [GHI], nguoi: [{ quyet: "het-gio" }] });
    expect(r.theDuyet?.map(dau)).toEqual([{ id: "act-1", ten: "apply_diff", ai: "nguoi", quyet: "het-gio" }]);
  });

  it("TD1-B4 bộ chạy tự từ chối và tự chạy lệnh kiểm cũng được ghi; tổng khớp số đếm", async () => {
    const r = await chay({ the: [GHI_NGOAI, CHAY_KIEM, GHI, GHI, GHI], nguoi: [{ quyet: "chap-nhan" }, { quyet: "tu-choi", lyDo: "khong" }, { quyet: "het-gio" }] });
    expect(r.theDuyet?.map(dau)).toEqual([
      { id: "act-1", ten: "run_command", ai: "bo-chay", quyet: "tu-choi" },
      { id: "act-2", ten: "run_command", ai: "bo-chay", quyet: "tu-chay" },
      { id: "act-3", ten: "apply_diff", ai: "nguoi", quyet: "chap-nhan" },
      { id: "act-4", ten: "apply_diff", ai: "nguoi", quyet: "tu-choi" },
      { id: "act-5", ten: "apply_diff", ai: "nguoi", quyet: "het-gio" },
    ]);
    expect(r.theDuyet?.[0]?.lyDo).toContain("run_command khác LỆNH KIỂM");
    const dem = (...q: string[]) => r.theDuyet?.filter((t) => q.includes(t.quyet)).length;
    expect(dem("chap-nhan")).toBe(r.kq.duyet?.soChapNhan);
    expect(dem("tu-choi", "het-gio")).toBe(r.kq.duyet?.soTuChoi);
    expect(dem("tu-chay")).toBe(r.kq.soTuChay);
  });

  it("TD1-B5 quá trần tự chạy lệnh kiểm ⇒ thẻ thứ 9 ghi là bộ chạy từ chối", async () => {
    const r = await chay({ the: Array.from({ length: 9 }, () => CHAY_KIEM) });
    expect(r.theDuyet?.map((t) => t.quyet)).toEqual([...Array.from({ length: 8 }, () => "tu-chay"), "tu-choi"]);
    expect(r.theDuyet?.[8]?.ai).toBe("bo-chay");
  });

  it("TD1-B6 thẻ kế hoạch cũng có mục", async () => {
    const r = await chay({ keHoach: true, nguoi: [{ quyet: "chap-nhan" }] });
    expect(r.theDuyet?.map(dau)).toEqual([{ id: "kh-abcdef0123456789", ten: "ke_hoach", ai: "nguoi", quyet: "chap-nhan" }]);
  });

  it("TD1-B7 mỗi thẻ có một tệp hồ sơ riêng (nội dung thẻ + quyết định), kể cả thẻ bị bộ chạy từ chối", async () => {
    await chay({ the: [GHI_NGOAI, GHI], nguoi: [{ quyet: "tu-choi", lyDo: "khong" }] });
    const doc = (id: string) => {
      const tep = path.join(ra, "the", `${id}.json`);
      expect(fs.existsSync(tep)).toBe(true);
      return JSON.parse(fs.readFileSync(tep, "utf8")) as Record<string, unknown>;
    };
    expect(doc("act-1")).toMatchObject({ ma: "TC-V2", id: "act-1", ten: "run_command", thamSo: { command: "npm test" }, quyetDinh: { ai: "bo-chay", quyet: "tu-choi" } });
    expect(doc("act-2")).toMatchObject({ id: "act-2", thamSo: { path: "a.test.ts", diff: "NOI-DUNG-THE" }, xemTruoc: "xem truoc", quyetDinh: { ai: "nguoi", quyet: "tu-choi", lyDo: "khong" } });
  });

  it("TD1-B8 ghi hồ sơ hỏng ⇒ lượt vẫn chạy, thẻ vẫn được duyệt, có lưu ý, mục ghi tep null", async () => {
    fs.writeFileSync(path.join(ra, "the"), "day la tep, khong phai thu muc");
    const r = await chay({ the: [GHI] });
    expect(r.gui.duyet).toEqual(["act-1"]);
    expect(r.theDuyet?.[0]?.quyet).toBe("chap-nhan");
    expect(r.theDuyet?.[0]?.tep).toBeNull();
    expect(r.luuY).toContain("không ghi được hồ sơ thẻ");
    expect(r.kq.loi).toBeUndefined();
  });

  it("TD1-B9 chế độ chỉ số: giá trị bí mật không có trong lý do lẫn hồ sơ", async () => {
    const BM = "matkhau-GIA-9x";
    const r = await chay({ the: [{ ten: "apply_diff", thamSo: { path: "a.test.ts", diff: `co ${BM} trong noi dung` } }], nguoi: [{ quyet: "tu-choi", lyDo: `thay ${BM}` }], dv: { cheDoKiem: "chi-so", giaTriBiMat: [BM] } });
    expect(r.theDuyet?.length).toBe(1);
    expect(JSON.stringify(r.theDuyet)).not.toContain(BM);
    expect(fs.readFileSync(path.join(ra, "the", "act-1.json"), "utf8")).not.toContain(BM);
  });

  it("TD1-B10 id lạ không thoát ra ngoài thư mục hồ sơ", () => {
    const ten = truong<(id: string) => string>(driverHostMod, "tenTepHoSoThe");
    expect(typeof ten).toBe("function");
    expect(ten!("../..\\x/y:z")).toBe("the/______x_y_z.json");
    expect(ten!("kh-abc_1")).toBe("the/kh-abc_1.json");
  });
});

describe("TD-3 + TD-4 — runId, cờ bài học, bản ghi lượt (driver host)", () => {
  const ghiBan = (thuMuc: string, heThong: string) => () => fs.writeFileSync(path.join(thuMuc, "r1.jsonl"), banGhi(heThong));
  const baiHoc = (r: { kq: unknown }) => truong<BaiHocGhi>(r.kq, "baiHoc");

  it("TD3-G0 kết quả mang runId của lượt", async () => {
    expect(truong<string>((await chay()).kq, "runId")).toBe("r1");
  });

  it("TD4-G1 --ghi-luot được tôn trọng: biến chỉ có trong lúc lượt chạy, trả lại sau lượt", async () => {
    let trongLuot: string | undefined;
    await chay({ dv: { ghiLuotDir: ngoai }, khiTao: () => { trongLuot = process.env.AI_GHI_LUOT_DIR; } });
    expect(trongLuot).toBe(ngoai);
    expect(process.env.AI_GHI_LUOT_DIR).toBeUndefined();
  });

  it("TD4-G2 thư mục ghi có tệp cảnh báo cho người mở", async () => {
    await chay({ dv: { ghiLuotDir: ngoai } });
    expect(fs.existsSync(path.join(ngoai, "CANH-BAO.txt"))).toBe(true);
    const s = fs.readFileSync(path.join(ngoai, "CANH-BAO.txt"), "utf8");
    for (const chu of ["BẢN THÔ", "sk-ant-", "không commit", "không rời máy"]) expect(s).toContain(chu);
  });

  it("TD4-G3 có bản ghi ⇒ ghi cờ, số bài và băm tin hệ thống ĐẦU TIÊN", async () => {
    const r = await chay({ dv: { ghiLuotDir: ngoai }, khiTao: ghiBan(ngoai, HE_THONG_CO), them: { coBaiHoc: () => true } });
    expect(baiHoc(r)).toEqual({ runId: "r1", co: true, soBai: 2, bamHeThong: bam(HE_THONG_CO), lyDo: null });
  });

  it("TD4-G4 bản ghi không có khối bài học ⇒ 0 bài", async () => {
    const r = await chay({ dv: { ghiLuotDir: ngoai }, khiTao: ghiBan(ngoai, "Ban la tho ca."), them: { coBaiHoc: () => true } });
    expect(baiHoc(r)?.soBai).toBe(0);
    expect(baiHoc(r)?.bamHeThong).toBe(bam("Ban la tho ca."));
    expect(baiHoc(r)?.lyDo).toBeNull();
  });

  it("TD4-G5 bật ghi mà không thấy bản ghi ⇒ null kèm lý do VÀ một lưu ý (không im lặng)", async () => {
    const r = await chay({ dv: { ghiLuotDir: ngoai }, them: { coBaiHoc: () => true } });
    expect(baiHoc(r)?.soBai).toBeNull();
    expect(baiHoc(r)?.bamHeThong).toBeNull();
    expect(baiHoc(r)?.lyDo).toContain("không thấy bản ghi");
    expect(r.luuY).toContain("không thấy bản ghi");
  });

  it("TD4-G6 không bật ghi ⇒ vẫn ghi cờ, số bài null kèm lý do, không đặt biến", async () => {
    let trongLuot: string | undefined = "chua-hoi";
    const r = await chay({ them: { coBaiHoc: () => false }, khiTao: () => { trongLuot = process.env.AI_GHI_LUOT_DIR; } });
    expect(baiHoc(r)).toEqual({ runId: "r1", co: false, soBai: null, bamHeThong: null, lyDo: "không bật ghi lượt" });
    expect(trongLuot).toBeUndefined();
  });

  type DocBaiHoc = (noiDung: string) => { soBai: number | null; bamHeThong: string | null; lyDo: string | null };
  const doc = (s: string) => {
    const f = truong<DocBaiHoc>(driverHostMod, "docBaiHocTuBanGhi");
    expect(typeof f).toBe("function");
    return f!(s);
  };

  it.each([
    ["P1 đầu khối tiếng Anh", "lessons the USER stated in earlier turns (3 item(s))", 3],
    ["P2 đầu khối tiếng Trung", "用户在此前轮次中自述的经验（4 条）", 4],
  ])("TD4-%s ⇒ đọc đúng số bài", (_ten, nhan, so) => {
    expect(doc(banGhi(KHOI_BAI_HOC(nhan))).soBai).toBe(so);
  });

  it("TD4-P3 có khối mà không đọc được số ⇒ null kèm lý do, KHÔNG đoán 0; vẫn có băm", () => {
    const s = KHOI_BAI_HOC("dau khoi la");
    expect(doc(banGhi(s))).toMatchObject({ soBai: null, bamHeThong: bam(s) });
    expect(doc(banGhi(s)).lyDo).toContain("không đọc được số bài");
  });

  it("TD4-P4 bản ghi hỏng hoặc chưa có lượt model nào ⇒ null kèm lý do, không ném", () => {
    expect(doc("{hong\n")).toMatchObject({ soBai: null, bamHeThong: null });
    expect(doc(`${JSON.stringify({ loai: "dau" })}\n`).lyDo).toContain("chưa có lượt model");
  });
});

describe("V2 — không đổi byte gửi model", () => {
  it("V2-N1 cùng một kịch bản, có và không có phần ghi ⇒ tham số tạo lượt và mọi chuỗi gửi model y hệt", async () => {
    const kich: TuyChon = { the: [GHI_NGOAI, CHAY_KIEM, GHI, GHI], nguoi: [{ quyet: "chap-nhan" }, { quyet: "tu-choi", lyDo: "khong dat" }] };
    const khong = await chay(kich);
    fs.rmSync(ra, { recursive: true, force: true });
    fs.mkdirSync(ra);
    const co = await chay({ ...kich, dv: { ghiLuotDir: ngoai }, khiTao: () => fs.writeFileSync(path.join(ngoai, "r1.jsonl"), banGhi(HE_THONG_CO)), them: { modelDangPhucVu: async () => "M", coBaiHoc: () => true } });
    expect(co.gui).toEqual(khong.gui);
    // phần ghi THẬT SỰ chạy ở lượt "có", không thì phép so trên vô nghĩa
    expect(co.theDuyet?.length).toBe(4);
    expect(truong<BaiHocGhi>(co.kq, "baiHoc")?.soBai).toBe(2);
  });
});

describe("V2 — trong chayMotViec: gộp vào kết quả, chốt thư mục ghi lượt", () => {
  const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8" }).stdout.trim();
  const TEP = "client/src/lib/a.test.ts";
  const VAN = `MÃ: TC-V2\nQUY TRÌNH: làm\nMỤC TIÊU: thử\nTỆP ĐƯỢC PHÉP SỬA/TẠO: ${TEP}\nLỆNH KIỂM: npx vitest run ${TEP}\nGIỚI HẠN: 1 phút, 3 vòng`;
  const VAN_SUA = `${VAN}\nLƯỢT SỬA TSC: 1\nTRẦN LƯỢT MODEL: 20\nTRẦN PHÚT: 20`;
  const NOI_DUNG = "import { it, expect } from 'vitest';\nit('x', () => { expect(1).toBe(1); });\n";
  let goc: string;
  let kho: string;
  beforeEach(() => {
    goc = fs.mkdtempSync(path.join(os.tmpdir(), "v2cmv-"));
    kho = path.join(goc, "_tho_ca_wt_v2");
    fs.mkdirSync(kho, { recursive: true });
    git(kho, "init", "-q");
    git(kho, "config", "user.email", "t@t");
    git(kho, "config", "user.name", "t");
    git(kho, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(kho, "tsconfig.tests.json"), "{}\n");
    git(kho, "add", ".");
    git(kho, "commit", "-q", "-m", "init");
  });
  afterEach(() => fs.rmSync(goc, { recursive: true, force: true }));

  const kiemXanh: ChayKiem = async (lenh) => ({ ...KIEM, lenh });
  const sach: KetQuaTsc = { exit: 0, hetGio: false, giay: 1, loiTrongTep: [], tongLoi: 0 };
  const doTrongTep: KetQuaTsc = { exit: 2, hetGio: false, giay: 1, loiTrongTep: [`${TEP}(1,1): error TS2322: x`], tongLoi: 1 };

  async function chayViec(o: { luot?: Array<Record<string, unknown>>; van?: string; tsc?: KetQuaTsc[]; them?: Record<string, unknown> } = {}) {
    const hang = [...(o.tsc ?? [])];
    const nhan: DauVaoDriver[] = [];
    const driver: Driver = async (v) => {
      nhan.push(v);
      fs.mkdirSync(path.join(v.wt, "client/src/lib"), { recursive: true });
      fs.writeFileSync(path.join(v.wt, TEP), `${NOI_DUNG}// luot ${nhan.length}\n`);
      return { vong: 1, token: { cache: null, prompt: null, soLuotModel: 5 }, ghiChu: [], hetGio: false, ...(o.luot?.[nhan.length - 1] ?? {}) };
    };
    const r = await chayMotViec({ van: o.van ?? VAN, wt: kho, base: "HEAD", driver, ra: path.join(goc, "ra"), choPhepKhoRieng: true, luat: "# l\n", chayKiem: kiemXanh, chayTsc: async () => hang.shift() ?? sach, envTran: {} as NodeJS.ProcessEnv, envNguoiChay: {}, ...(o.them as object | undefined) });
    return { r, nhan, luuY: (r.luuY ?? []).join(" | ") };
  }
  const muc = (id: string): Record<string, unknown> => ({ id, ten: "apply_diff", duong: [TEP], ai: "nguoi", quyet: "chap-nhan", lyDo: null, soCanhBao: 0, luc: "2026-11-28T00:00:00.000Z", tep: `the/${id}.json` });
  const bh = (runId: string): Record<string, unknown> => ({ runId, co: true, soBai: 0, bamHeThong: "ab", lyDo: null });
  const luot = (runId: string, dau: string | null, cuoi: string | null, id = "a1") => ({ runId, modelPhucVu: { dau, cuoi }, theDuyet: [muc(id)], baiHoc: bh(runId) });

  it("V2-C1 kết quả mang model, runId, thẻ (đánh số) và bài học; cùng một model thì không cảnh báo", async () => {
    const x = await chayViec({ luot: [luot("r1", "M", "M")] });
    expect(truong(x.r, "modelPhucVu")).toEqual({ dau: "M", cuoi: "M" });
    expect(truong(x.r, "runId")).toEqual(["r1"]);
    expect(truong<TheGhi[]>(x.r, "theDuyet")?.map((t) => [t.so, t.id])).toEqual([[1, "a1"]]);
    expect(truong(x.r, "baiHoc")).toEqual([bh("r1")]);
    expect(x.luuY).not.toContain("V2:");
    expect(x.r.ketCuc).toBe("xong");
  });

  it("V2-C2 đầu ≠ cuối ⇒ cảnh báo, KHÔNG đổi kết cục", async () => {
    const x = await chayViec({ luot: [luot("r1", "M1", "M2")] });
    expect(x.luuY).toContain("V2: model phục vụ đổi trong lượt: M1 → M2");
    expect(x.r.ketCuc).toBe("xong");
  });

  it("V2-C3 không biết model ⇒ chỉ cảnh báo, không chặn", async () => {
    const x = await chayViec({ luot: [luot("r1", null, "M")] });
    expect(x.luuY).toContain("V2: không biết model phục vụ");
    expect(x.r.ketCuc).toBe("xong");
  });

  it("V2-C4 có lượt sửa tsc: đầu của lượt đầu, cuối của lượt cuối; đổi GIỮA hai lượt cũng cảnh báo; thẻ đánh số liền", async () => {
    const x = await chayViec({ van: VAN_SUA, tsc: [doTrongTep, sach], luot: [luot("r1", "M1", "M1", "a1"), luot("r2", "M2", "M2", "a2")] });
    expect(x.nhan).toHaveLength(2);
    expect(truong(x.r, "modelPhucVu")).toEqual({ dau: "M1", cuoi: "M2" });
    expect(truong(x.r, "runId")).toEqual(["r1", "r2"]);
    expect(truong<TheGhi[]>(x.r, "theDuyet")?.map((t) => [t.so, t.id])).toEqual([[1, "a1"], [2, "a2"]]);
    expect(truong<BaiHocGhi[]>(x.r, "baiHoc")?.map((b) => b.runId)).toEqual(["r1", "r2"]);
    expect(x.luuY).toContain("V2: model phục vụ đổi trong lượt: M1 → M2");
  });

  it("V2-C5 đối chứng: driver không trả các trường này ⇒ kết quả không có chúng", async () => {
    const x = await chayViec();
    for (const k of ["modelPhucVu", "runId", "theDuyet", "baiHoc"]) expect(x.r).not.toHaveProperty(k);
  });

  const tuChoiTruocDriver = (x: Awaited<ReturnType<typeof chayViec>>, chu: string) => {
    expect(x.r.ketCuc).toBe("tu-choi");
    expect(x.r.loi).toContain(chu);
    expect(x.nhan).toHaveLength(0);
  };

  it("TD4-R1 --ghi-luot cùng --cho-phep-db ⇒ từ chối trước khi gọi driver", async () => {
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: ngoai, choPhepDb: true } }), "ghi lượt không đi cùng --cho-phep-db");
  });

  it("TD4-R2 người khởi chạy tự đặt AI_GHI_LUOT_DIR cùng --cho-phep-db ⇒ cũng từ chối (không có đường vòng)", async () => {
    tuChoiTruocDriver(await chayViec({ them: { envNguoiChay: { AI_GHI_LUOT_DIR: ngoai }, choPhepDb: true } }), "ghi lượt không đi cùng --cho-phep-db");
  });

  const RA_NGOAI = "thư mục ghi lượt phải nằm ngoài repo và mọi worktree";

  it("TD4-R3 thư mục ghi trong worktree pilot ⇒ từ chối", async () => {
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: path.join(kho, "ghi") } }), RA_NGOAI);
  });

  it("TD4-R4 thư mục ghi trong MỘT worktree khác của cùng kho ⇒ từ chối", async () => {
    const khac = path.join(goc, "wt-khac");
    git(kho, "worktree", "add", "-q", "--detach", khac, "HEAD");
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: path.join(khac, "ghi") } }), RA_NGOAI);
  });

  it("TD4-R5 thư mục ghi trong repo chứa bộ chạy ⇒ từ chối", async () => {
    const repoBoChay = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: path.join(repoBoChay, "ghi-luot-khong-duoc") } }), RA_NGOAI);
  });

  it("TD4-R6 junction ở ngoài trỏ vào worktree ⇒ vẫn từ chối (so đường thật)", async () => {
    const loi = path.join(goc, "loi-tat");
    fs.symlinkSync(kho, loi, "junction");
    try {
      tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: path.join(loi, "ghi") } }), RA_NGOAI);
    } finally {
      fs.rmdirSync(loi);
    }
  });

  it("TD4-R7 đường tương đối ⇒ từ chối", async () => {
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: "ghi-tuong-doi" } }), "thư mục ghi lượt phải là đường tuyệt đối");
  });

  it("TD4-R8 biến của người khởi chạy khác --ghi-luot ⇒ từ chối, không đoán cái nào đúng", async () => {
    tuChoiTruocDriver(await chayViec({ them: { ghiLuotDir: ngoai, envNguoiChay: { AI_GHI_LUOT_DIR: path.join(goc, "khac") } } }), "AI_GHI_LUOT_DIR khác --ghi-luot");
  });

  it("TD4-R9 chỉ có biến của người khởi chạy (cách đang dùng) ⇒ driver nhận đúng thư mục đó", async () => {
    const x = await chayViec({ them: { envNguoiChay: { AI_GHI_LUOT_DIR: ngoai } } });
    expect(x.nhan[0]?.ghiLuotDir).toBe(ngoai);
    expect(x.r.ketCuc).toBe("xong");
  });

  it("TD4-R10 đối chứng: thư mục hợp lệ ở ngoài ⇒ chạy, driver nhận thư mục", async () => {
    const x = await chayViec({ them: { ghiLuotDir: ngoai } });
    expect(x.nhan[0]?.ghiLuotDir).toBe(ngoai);
    expect(x.r.ketCuc).toBe("xong");
  });
});
