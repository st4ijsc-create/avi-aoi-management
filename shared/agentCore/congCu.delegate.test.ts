import { describe, expect, it } from "vitest";
import {
  CONG_CU,
  CONG_CU_TUY_CHON,
  LOAI_CONG_CU,
  TEN_CONG_CU,
  TRAN_NHIEM_VU_GIAO,
  TRAN_SO_CONG_CU_GIAO,
  congCuTheoCheDo,
  kiemThamSo,
} from "./congCu";
import { dungLoiNhacHeThong } from "./loiNhac";
import type { CheDoAgent } from "./kieu";

const CHE_DO: CheDoAgent[] = ["hoi", "sua", "tu-dong"];
const ten = (c: CheDoAgent, them: Parameters<typeof congCuTheoCheDo>[1] = []) => congCuTheoCheDo(c, them).map((t) => t.function.name);

describe("delegate — tool TUỲ CHỌN (công tắc tắt ⇒ y hệt bản trước)", () => {
  it("nằm trong TEN_CONG_CU, là tuỳ chọn, loại 'giao'", () => {
    expect(TEN_CONG_CU).toContain("delegate");
    expect(CONG_CU_TUY_CHON.has("delegate")).toBe(true);
    expect(LOAI_CONG_CU.delegate).toBe("giao");
    expect(CONG_CU.some((t) => t.function.name === "delegate")).toBe(true);
  });
  it("mặc định KHÔNG phơi ở bất kỳ chế độ nào", () => {
    for (const c of CHE_DO) expect(ten(c)).not.toContain("delegate");
  });
  it("phơi khi người gọi liệt kê; có ở cả hoi (con sẽ bị ép chỉ-đọc ở lõi)", () => {
    for (const c of CHE_DO) expect(ten(c, ["delegate"])).toContain("delegate");
  });
  it("bật delegate chỉ THÊM đúng một tool, các tool còn lại giữ nguyên thứ tự và nội dung", () => {
    for (const c of CHE_DO) {
      const tat = congCuTheoCheDo(c);
      const bat = congCuTheoCheDo(c, ["delegate"]);
      expect(bat.filter((t) => t.function.name !== "delegate")).toEqual(tat);
      expect(bat.length).toBe(tat.length + 1);
    }
  });
  it("schema không dùng pattern/maxLength/enum cứng (grammar llama.cpp), mô tả bằng tiếng Anh", () => {
    const t = CONG_CU.find((x) => x.function.name === "delegate")!;
    const s = JSON.stringify(t);
    expect(s).not.toMatch(/"pattern"\s*:\s*"/);
    expect(s).not.toMatch(/maxLength/);
    expect(t.function.description).toMatch(/sub-?agent|delegate/i);
    expect((t.function.parameters as { required: string[] }).required.sort()).toEqual(["agent", "task"]);
  });
});

describe("delegate — kiemThamSo", () => {
  it("hợp lệ: agent + task (+ tools thu hẹp)", () => {
    const r = kiemThamSo("delegate", { agent: "kham-pha", task: " Find the retry code " });
    expect(r).toEqual({ ok: true, thamSo: { agent: "kham-pha", task: "Find the retry code" } });
    const r2 = kiemThamSo("delegate", { agent: "review", task: "x", tools: ["read_file", "grep"] });
    expect(r2.ok && r2.thamSo.tools).toEqual(["read_file", "grep"]);
    const r3 = kiemThamSo("delegate", '{"agent":"review","task":"x","tools":"[\\"grep\\"]"}');
    expect(r3.ok && r3.thamSo.tools).toEqual(["grep"]);
  });
  it("tên agent chỉ ^[a-z][a-z0-9-]{0,31}$", () => {
    for (const a of ["Kham-Pha", "../x", "a/b", "a b", "1a", "x".repeat(33), "", "kham_pha"]) {
      const r = kiemThamSo("delegate", { agent: a, task: "x" });
      expect(r.ok, a).toBe(false);
    }
  });
  it("task bắt buộc, không rỗng, có trần", () => {
    expect(kiemThamSo("delegate", { agent: "a" }).ok).toBe(false);
    expect(kiemThamSo("delegate", { agent: "a", task: "  " }).ok).toBe(false);
    expect(kiemThamSo("delegate", { agent: "a", task: "x".repeat(TRAN_NHIEM_VU_GIAO) }).ok).toBe(true);
    const qua = kiemThamSo("delegate", { agent: "a", task: "x".repeat(TRAN_NHIEM_VU_GIAO + 1) });
    expect(qua.ok).toBe(false);
    if (!qua.ok) expect(qua.loiChoModel).toContain(String(TRAN_NHIEM_VU_GIAO));
  });
  it("tools: mảng chuỗi, có trần số phần tử, không rỗng-phần-tử, không object", () => {
    const base = { agent: "a", task: "x" };
    expect(kiemThamSo("delegate", { ...base, tools: [] }).ok).toBe(false);
    expect(kiemThamSo("delegate", { ...base, tools: [1] }).ok).toBe(false);
    expect(kiemThamSo("delegate", { ...base, tools: [""] }).ok).toBe(false);
    expect(kiemThamSo("delegate", { ...base, tools: [{ a: 1 }] }).ok).toBe(false);
    expect(kiemThamSo("delegate", { ...base, tools: "read_file" }).ok).toBe(false);
    expect(kiemThamSo("delegate", { ...base, tools: Array.from({ length: TRAN_SO_CONG_CU_GIAO + 1 }, () => "grep") }).ok).toBe(false);
  });
  it("khoá lạ bị bỏ (không tiêm được model/approval/depth qua tham số)", () => {
    const r = kiemThamSo("delegate", { agent: "a", task: "x", model: "ngoai:x:y", approval: "tu-dong", depth: 9, cheDo: "tu-dong" });
    expect(r).toEqual({ ok: true, thamSo: { agent: "a", task: "x" } });
  });
});

describe("delegate — lời nhắc hệ thống", () => {
  const goc = (congCu?: string[]) => dungLoiNhacHeThong({ cheDo: "sua", ngonNgu: "vi", congCu });
  it("vắng delegate ⇒ lời nhắc GIỐNG TỪNG BYTE", () => {
    expect(goc(["read_file"])).toBe(goc(undefined));
    expect(goc(["read_file"])).not.toMatch(/delegate/);
  });
  it("có delegate ⇒ thêm đúng một quy tắc, nêu: chỉ nhận tóm tắt, con không duyệt thay", () => {
    const co = goc(["delegate"]);
    expect(co).toMatch(/delegate/);
    expect(co.length).toBeGreaterThan(goc(undefined).length);
    expect(co).toMatch(/summary/i);
  });
});
