/**
 * Đợt 7.1 — `quaKheNang` đi tắt khi sổ không có hồ sơ khe nặng; có hồ sơ ⇒ chờ đổi khe rồi mới gọi.
 */
import { afterEach, describe, expect, it } from "vitest";
import { ANH_RONG, datAnhSoModel } from "./anhSoModel";
import { CAU_HINH_MAC_DINH, KheNang } from "./kheNang";
import { __datKheNangChoTest, quaKheNang, quaKheNangLuong } from "./kheNangMacDinh";

const giu = { ...process.env };
afterEach(() => {
  process.env = { ...giu };
  datAnhSoModel(ANH_RONG);
  __datKheNangChoTest(null, false);
});

function datHoSoCoder() {
  process.env.LLAMA_SERVER_MODEL = "Nha-35B.gguf";
  delete process.env.AI_KHE_NANG_HOAN_DOI;
  datAnhSoModel({
    taiLuc: 1, vaiTro: new Map(), gan: [],
    profile: new Map([["coder", { artifactFile: "Coder-30B.gguf", slotClass: "nang", artifactStatus: "available", license: "apache-2.0", enabled: true }]]),
  });
}

describe("quaKheNang", () => {
  it("sổ rỗng ⇒ gọi thẳng, không chạm KheNang", async () => {
    let cham = 0;
    __datKheNangChoTest(new KheNang({ modelDangGiu: async () => { cham++; return "x"; }, doiSang: async () => {} }, CAU_HINH_MAC_DINH, () => "x"));
    expect(await quaKheNang("Bat-Ky", async () => 42)).toBe(42);
    expect(cham).toBe(0);
  });

  it("có hồ sơ Coder ⇒ lượt cho Coder chờ đổi khe rồi mới chạy; lượt luồng giữ khe tới hết", async () => {
    datHoSoCoder();
    const sv = { giu: "Nha-35B", doi: [] as string[] };
    const kn = new KheNang(
      { modelDangGiu: async () => sv.giu, doiSang: async (m) => { sv.doi.push(m); sv.giu = m; } },
      { ...CAU_HINH_MAC_DINH, ranhDeDoiMs: 0 },
      () => "Nha-35B",
    );
    __datKheNangChoTest(kn, true);
    const thay: string[] = [];
    await quaKheNang("Coder-30B", async () => thay.push(sv.giu));
    expect(thay).toEqual(["Coder-30B"]);
    expect(sv.doi).toEqual(["Coder-30B"]);
    async function* luong() { yield sv.giu; yield "het"; }
    const ra: string[] = [];
    for await (const x of quaKheNangLuong("Coder-30B", luong)) ra.push(x);
    expect(ra).toEqual(["Coder-30B", "het"]);
    expect(kn.thongKe().dangChay).toEqual({});
    kn.dung();
  });

  it("cờ AI_KHE_NANG_HOAN_DOI=false ⇒ đi tắt dù có hồ sơ", async () => {
    datHoSoCoder();
    process.env.AI_KHE_NANG_HOAN_DOI = "false";
    let cham = 0;
    __datKheNangChoTest(new KheNang({ modelDangGiu: async () => { cham++; return "x"; }, doiSang: async () => {} }, CAU_HINH_MAC_DINH, () => "x"));
    expect(await quaKheNang("Coder-30B", async () => "ok")).toBe("ok");
    expect(cham).toBe(0);
  });
});
