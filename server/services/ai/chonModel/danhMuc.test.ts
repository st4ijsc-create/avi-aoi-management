import { describe, expect, it } from "vitest";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import type { AnhSoModel, ProfileTrongAnh } from "../soModel/anhSoModel";
import { layDanhMucModel, uocTinhDoiKheTuSuKien } from "./danhMuc";
import { NGOAI_RONG, type PhuThuocDanhMuc } from "./kieu";

const TEP_35 = "D:\\SOURCES\\16.AI\\Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
const TEP_27 = "D:\\SOURCES\\16.AI\\Qwen3.6-27B-Q4_K_M.gguf";

function hoSo(over: Partial<ProfileTrongAnh>): ProfileTrongAnh {
  return { artifactFile: TEP_35, slotClass: "nang", artifactStatus: "available", license: "apache-2.0", enabled: true, ...over };
}

function dep(over: Partial<PhuThuocDanhMuc> = {}): PhuThuocDanhMuc {
  const profile = new Map<string, ProfileTrongAnh>([
    ["p35", hoSo({})],
    ["p27", hoSo({ artifactFile: TEP_27 })],
    ["p-unknown-license", hoSo({ license: "unknown" })],
    ["p-chua-do", hoSo({})],
    ["p-tat", hoSo({ enabled: false })],
    ["p-mat", hoSo({ artifactStatus: "missing" })],
    ["p4b", hoSo({ artifactFile: "Qwen3-4B.gguf", slotClass: "nho" })],
  ]);
  const anh: AnhSoModel = { taiLuc: 1, vaiTro: new Map(), profile, gan: [] };
  return {
    anh,
    hoSoCoDo: new Set(["p35", "p27", "p-unknown-license", "p-tat", "p-mat", "p4b"]),
    kheDangGiu: "Qwen3.6-35B-A3B-UD-Q4_K_XL",
    uocTinhDoiKheGiay: async () => 45,
    ngoai: NGOAI_RONG,
    env: {},
    ...over,
  };
}

describe("layDanhMucModel (A1)", () => {
  it("mục đầu là auto, sau đó đúng 11 vai trò gốc", async () => {
    const ds = await layDanhMucModel(1, dep());
    expect(ds[0]).toMatchObject({ ma: "auto", loai: "auto", trangThai: "san-sang" });
    const vai = ds.filter((m) => m.loai === "vai-tro");
    expect(vai).toHaveLength(11);
    expect(vai.map((m) => m.ma)).toEqual(VAI_TRO_GOC.map((v) => `vai-tro:${v.id}`));
    expect(vai[0]).toMatchObject({ nhan: VAI_TRO_GOC[0]!.id, moTa: VAI_TRO_GOC[0]!.moTa });
  });

  it("hồ sơ đang giữ ⇒ san-sang; nặng chưa giữ ⇒ can-doi-khe + ước tính; nhỏ ⇒ san-sang", async () => {
    const ds = await layDanhMucModel(1, dep());
    expect(ds.find((m) => m.ma === "ho-so:p35")).toMatchObject({ loai: "ho-so", trangThai: "san-sang" });
    expect(ds.find((m) => m.ma === "ho-so:p27")).toMatchObject({ trangThai: "can-doi-khe", uocTinhDoiKheGiay: 45 });
    expect(ds.find((m) => m.ma === "ho-so:p4b")).toMatchObject({ trangThai: "san-sang" });
  });

  it("chưa đo được thời gian đổi khe ⇒ KHÔNG có trường ước tính (không bịa số)", async () => {
    const ds = await layDanhMucModel(1, dep({ uocTinhDoiKheGiay: async () => null }));
    const p27 = ds.find((m) => m.ma === "ho-so:p27")!;
    expect(p27.trangThai).toBe("can-doi-khe");
    expect("uocTinhDoiKheGiay" in p27).toBe(false);
  });

  it("đổi khe nặng bị tắt (AI_KHE_NANG_HOAN_DOI=false) ⇒ hồ sơ nặng chưa giữ là tat", async () => {
    const ds = await layDanhMucModel(1, dep({ env: { AI_KHE_NANG_HOAN_DOI: "false" } }));
    expect(ds.find((m) => m.ma === "ho-so:p27")!.trangThai).toBe("tat");
  });

  it("giấy phép chưa khai / chưa có lượt đo ⇒ vắng; tắt / artifact mất ⇒ có, tat", async () => {
    const ma = (await layDanhMucModel(1, dep())).map((m) => m.ma);
    expect(ma).not.toContain("ho-so:p-unknown-license");
    expect(ma).not.toContain("ho-so:p-chua-do");
    const ds = await layDanhMucModel(1, dep());
    expect(ds.find((m) => m.ma === "ho-so:p-tat")!.trangThai).toBe("tat");
    expect(ds.find((m) => m.ma === "ho-so:p-mat")!.trangThai).toBe("tat");
  });

  it("không lộ đường dẫn / tên tệp / cổng ở bất kỳ trường nào", async () => {
    const ds = await layDanhMucModel(1, dep());
    // `moTa` của vai trò gốc có "/" là chữ ("TS/JS", "ST/SCL/IL") — mọi trường KHÁC không được có dấu phân cách đường dẫn.
    for (const m of ds) {
      for (const [k, v] of Object.entries(m)) {
        if (typeof v !== "string") continue;
        expect(v, `${m.ma}.${k}`).not.toMatch(/\\|:\d{2,5}\b|\.gguf/i);
        if (k !== "moTa") expect(v, `${m.ma}.${k}`).not.toContain("/");
      }
    }
    const s = JSON.stringify(ds);
    expect(s).not.toContain("8091");
    expect(s).not.toContain("Qwen3.6");
  });

  it("model ngoài đã bật ⇒ mục ngoai; rỗng ⇒ không có", async () => {
    const ngoai = { layModelDaBat: async () => [{ nhaCungCap: "anthropic", model: "claude-opus-5-5", nhan: "Claude Opus 5.5" }] };
    const ds = await layDanhMucModel(1, dep({ ngoai }));
    expect(ds.find((m) => m.loai === "ngoai")).toMatchObject({
      ma: "ngoai:anthropic:claude-opus-5-5",
      nhaCungCap: "anthropic",
      trangThai: "san-sang",
      duocDungO: ["luong", "kiem-dinh"], // ★ 10.4 D7 — chat/coding/agent CHƯA (10.4b)
    });
    expect((await layDanhMucModel(1, dep())).some((m) => m.loai === "ngoai")).toBe(false);
    // mục không phải ngoai KHÔNG mang duocDungO
    expect((await layDanhMucModel(1, dep({ ngoai }))).filter((m) => m.loai !== "ngoai").every((m) => m.duocDungO === undefined)).toBe(true);
  });
});

describe("uocTinhDoiKheTuSuKien", () => {
  it("trung vị ms ÷ 1000; không sự kiện ⇒ null", async () => {
    const db = (rows: unknown[]) => ({ execute: async () => rows });
    expect(await uocTinhDoiKheTuSuKien(db([{ ms: "40000" }, { ms: "50000" }, { ms: "60000" }]))).toBe(50);
    expect(await uocTinhDoiKheTuSuKien(db([{ ms: 40000 }, { ms: 51000 }]))).toBe(46);
    expect(await uocTinhDoiKheTuSuKien(db([]))).toBeNull();
    expect(await uocTinhDoiKheTuSuKien({ execute: async () => ({ rows: [{ ms: 9000 }] }) })).toBe(9);
  });
});
