// Đợt 10.2 — logic THUẦN của ô chọn model phía client + HỢP ĐỒNG với máy chủ (bản sao regex không được trôi).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHON_MODEL_RE, chonModelGui, docChonDaLuu, hauToTrangThai, luuChon, nhomMuc, xacThucChon, type MucModel } from "./chonModel";

const m = (ma: string, loai: MucModel["loai"], trangThai: MucModel["trangThai"] = "san-sang", extra: Partial<MucModel> = {}): MucModel => ({ ma, loai, nhan: ma, moTa: "", trangThai, ...extra });
const DM: MucModel[] = [
  m("auto", "auto"),
  m("vai-tro:code.software", "vai-tro"),
  m("vai-tro:embed", "vai-tro"),
  m("vai-tro:fim", "vai-tro"),
  m("vai-tro:vision", "vai-tro", "can-doi-khe", { uocTinhDoiKheGiay: 12.4 }),
  m("ho-so:abc", "ho-so", "tat"),
  m("ngoai:openai-compat:gpt-x", "ngoai"),
];

function mem() {
  const kho = new Map<string, string>();
  return { getItem: (k: string) => kho.get(k) ?? null, setItem: (k: string, v: string) => void kho.set(k, v), removeItem: (k: string) => void kho.delete(k) };
}
afterEach(() => vi.unstubAllGlobals());

describe("CHON_MODEL_RE — hợp đồng với máy chủ", () => {
  it("nguồn regex ở client TRÙNG máy chủ (kieu.ts)", () => {
    const src = readFileSync(resolve(__dirname, "../../../server/services/ai/chonModel/kieu.ts"), "utf8");
    const mm = /CHON_MODEL_RE\s*=\s*(\/.+\/)\s*;/.exec(src);
    expect(mm).not.toBeNull();
    expect(CHON_MODEL_RE.source).toBe(new RegExp(mm![1].slice(1, -1)).source);
  });
  it("chấp nhận bốn dạng, từ chối biểu thức / rác", () => {
    for (const ok of ["auto", "vai-tro:code.software", "ho-so:p1", "ngoai:openai-compat:gpt-x"]) expect(CHON_MODEL_RE.test(ok), ok).toBe(true);
    for (const bad of ["", "{{ x }}", "vai-tro:", "AUTO", "ngoai:x", "ho-so:a b"]) expect(CHON_MODEL_RE.test(bad), bad).toBe(false);
  });
});

describe("nhomMuc", () => {
  it("ẩn vai không sinh chữ (embed/fim/vision) ở mọi bề mặt", () => {
    const n = nhomMuc(DM, "chat");
    expect(n.vaiTro.map((x) => x.ma)).toEqual(["vai-tro:code.software"]);
  });
  it("ngoài: chat có, luồng giấu; không tự thêm mục ngoài danh mục", () => {
    expect(nhomMuc(DM, "chat").ngoai).toHaveLength(1);
    expect(nhomMuc(DM, "luong").ngoai).toHaveLength(0);
    expect(nhomMuc(DM.filter((x) => x.loai !== "ngoai"), "chat").ngoai).toHaveLength(0);
  });
  it("danh mục rỗng ⇒ vẫn có Tự động", () => expect(nhomMuc([], "chat").tuDong.ma).toBe("auto"));
});

describe("xacThucChon", () => {
  it("mã còn ⇒ giữ; mất / tắt ⇒ auto + hetHieuLuc; danh mục chưa tải ⇒ không kết luận", () => {
    expect(xacThucChon("vai-tro:code.software", DM)).toEqual({ ma: "vai-tro:code.software", hetHieuLuc: false });
    expect(xacThucChon("vai-tro:cu", DM)).toEqual({ ma: "auto", hetHieuLuc: true });
    expect(xacThucChon("ho-so:abc", DM)).toEqual({ ma: "auto", hetHieuLuc: true });
    expect(xacThucChon("vai-tro:cu", [])).toEqual({ ma: "vai-tro:cu", hetHieuLuc: false });
    expect(xacThucChon("auto", DM).hetHieuLuc).toBe(false);
  });
});

describe("hauToTrangThai", () => {
  const t = (_k: string, def: string, o?: Record<string, unknown>) => (o ? def.replace("{{n}}", String(o.n)) : def);
  it("sẵn sàng rỗng · tắt · đổi khe có số (làm tròn) · chưa đo", () => {
    expect(hauToTrangThai(DM[1], t)).toBe("");
    expect(hauToTrangThai(DM[5], t)).toBe("tắt");
    expect(hauToTrangThai(DM[4], t)).toBe("cần đổi khe ~12 s");
    expect(hauToTrangThai(m("x", "vai-tro", "can-doi-khe"), t)).toBe("cần đổi khe (chưa đo)");
  });
});

describe("lưu dính theo bề mặt", () => {
  it("lưu / đọc riêng từng bề mặt; auto xoá khoá; giá trị hỏng ⇒ auto", () => {
    vi.stubGlobal("localStorage", mem());
    luuChon("chat", "vai-tro:code.software");
    expect(docChonDaLuu("chat")).toBe("vai-tro:code.software");
    expect(docChonDaLuu("lap-trinh")).toBe("auto");
    localStorage.setItem("aiChon.agent", "{{ bậy }}");
    expect(docChonDaLuu("agent")).toBe("auto");
    luuChon("chat", "auto");
    expect(localStorage.getItem("aiChon.chat")).toBeNull();
  });
  it("localStorage ném lỗi ⇒ không văng", () => {
    const boom = () => {
      throw new Error("chan");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(docChonDaLuu("chat")).toBe("auto");
    expect(() => luuChon("chat", "ho-so:p1")).not.toThrow();
  });
});

describe("chonModelGui", () => {
  it("auto / rỗng ⇒ undefined (KHÔNG gửi trường), còn lại giữ nguyên", () => {
    expect(chonModelGui("auto")).toBeUndefined();
    expect(chonModelGui("")).toBeUndefined();
    expect(chonModelGui("ho-so:p1")).toBe("ho-so:p1");
  });
});
