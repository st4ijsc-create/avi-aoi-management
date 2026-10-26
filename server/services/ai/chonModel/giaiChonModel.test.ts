import { describe, expect, it } from "vitest";
import { VAI_TRO_GOC } from "../../../../shared/aiRoles";
import type { AnhSoModel, GanTrongAnh, ProfileTrongAnh } from "../soModel/anhSoModel";
import { dinhTuyenVaiTro } from "../soModel/dinhTuyenVaiTro";
import { giaiChonModel, type NguCanhChon } from "./giaiChonModel";
import { NGOAI_RONG, type PhuThuocDanhMuc } from "./kieu";

const TEP_35 = "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf";
const TEP_27 = "Qwen3.6-27B-Q4_K_M.gguf";
const ENV = { GGUF_DEFAULT_MODEL: TEP_35, GGUF_CODE_MODEL: TEP_35, GGUF_FAST_MODEL: TEP_35, LLAMA_SERVER_MODEL: TEP_35 };

function hoSo(over: Partial<ProfileTrongAnh>): ProfileTrongAnh {
  return { artifactFile: TEP_35, slotClass: "nang", artifactStatus: "available", license: "apache-2.0", enabled: true, ...over };
}

function gan(over: Partial<GanTrongAnh>): GanTrongAnh {
  return { roleId: "code.plc", scopeKind: "global", scopeId: null, profileId: "p35", envKey: null, fallback: [], mode: "active", ...over };
}

function dep(over: Partial<PhuThuocDanhMuc> = {}, ganThem: GanTrongAnh[] = []): PhuThuocDanhMuc {
  const anh: AnhSoModel = {
    taiLuc: 1,
    vaiTro: new Map(),
    profile: new Map([
      ["p35", hoSo({})],
      ["p27", hoSo({ artifactFile: TEP_27 })],
      ["p-unknown-license", hoSo({ license: "unknown" })],
      ["p-tat", hoSo({ enabled: false })],
    ]),
    gan: [gan({}), gan({ scopeKind: "flow", scopeId: "f1", profileId: "p27" }), ...ganThem],
  };
  return {
    anh,
    hoSoCoDo: new Set(["p35", "p27", "p-unknown-license", "p-tat"]),
    kheDangGiu: "Qwen3.6-35B-A3B-UD-Q4_K_XL",
    uocTinhDoiKheGiay: async () => 45,
    ngoai: NGOAI_RONG,
    env: ENV,
    ...over,
  };
}

const NGU: NguCanhChon = { factoryId: 1, beMatChu: true };

describe("giaiChonModel (A2)", () => {
  it.each([undefined, "", "auto"])("%s ⇒ null (giữ đường cũ)", async (v) => {
    expect(await giaiChonModel(v, NGU, dep())).toBeNull();
  });

  it("vai-tro:code.plc + phạm vi flow ⇒ local, model/nguồn BẰNG dinhTuyenVaiTro cùng tham số (gán phạm vi thắng global)", async () => {
    const d = dep();
    const kq = await giaiChonModel("vai-tro:code.plc", { ...NGU, phamVi: { flowId: "f1", beMat: "luong" } }, d);
    const ky = dinhTuyenVaiTro({ vaiTro: "code.plc", phamVi: { flowId: "f1", beMat: "luong" }, khongDoiKhe: false, kheDangGiu: d.kheDangGiu }, d.anh, ENV);
    expect(kq).toMatchObject({ loai: "local", vaiTro: "code.plc", modelId: ky.model, nguon: ky.nguon, phamVi: "flow" });
    expect(kq).toMatchObject({ modelId: "Qwen3.6-27B-Q4_K_M", canDoiKhe: true });
  });

  it("vai nhẹ trên bề mặt Luồng ⇒ khongDoiKhe mặc định (không kéo đổi khe)", async () => {
    const d = dep({}, [gan({ roleId: "chat", profileId: "p27" })]);
    const kq = await giaiChonModel("vai-tro:chat", { ...NGU, phamVi: { flowId: "f9", beMat: "luong" } }, d);
    expect(kq).toMatchObject({ loai: "local", canDoiKhe: false, nguon: "du-phong" });
  });

  it("vai-tro không sinh chữ trên bề mặt chữ ⇒ BAD_REQUEST chonModelKhongSinhChu", async () => {
    for (const v of ["embed", "rerank", "vision"]) {
      await expect(giaiChonModel(`vai-tro:${v}`, NGU, dep())).rejects.toMatchObject({
        code: "BAD_REQUEST",
        cause: { appParams: { reason: "chonModelKhongSinhChu" } },
      });
    }
    expect(await giaiChonModel("vai-tro:embed", { ...NGU, beMatChu: false }, dep())).toMatchObject({ loai: "local" });
  });

  it("ho-so:p35 đang giữ ⇒ tệp p35, không đổi khe; ho-so:p27 ⇒ canDoiKhe + ước tính", async () => {
    expect(await giaiChonModel("ho-so:p35", NGU, dep())).toEqual({
      loai: "local",
      modelId: "Qwen3.6-35B-A3B-UD-Q4_K_XL",
      vaiTro: "ho-so",
      nguon: "chon-tuong-minh",
      phamVi: null,
      canDoiKhe: false,
    });
    expect(await giaiChonModel("ho-so:p27", NGU, dep())).toMatchObject({ canDoiKhe: true, uocTinhDoiKheGiay: 45 });
    const vang = await giaiChonModel("ho-so:p27", NGU, dep({ uocTinhDoiKheGiay: async () => null }));
    expect(vang && "uocTinhDoiKheGiay" in vang).toBe(false);
  });

  it.each(["ho-so:p-unknown-license", "ho-so:khong-co", "ho-so:p-tat", "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf", "code", "../x", "vai-tro:", "vai-tro:khong-co"])(
    "%s ⇒ BAD_REQUEST, lời lỗi nêu dạng hợp lệ",
    async (v) => {
      const p = giaiChonModel(v, NGU, dep());
      await expect(p).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p).rejects.toThrow(/vai-tro:<id>.*ho-so:<id>/);
    },
  );

  it("ngoai: có trong danh mục nhà máy ⇒ loai ngoai; không có / khớp regex mà chưa bật / nhà máy null ⇒ NOT_FOUND", async () => {
    const ngoai = {
      layModelDaBat: async (f: number | null) => (f === 1 ? [{ nhaCungCap: "anthropic", model: "claude-opus-5-5", nhan: "x" }] : []),
    };
    expect(await giaiChonModel("ngoai:anthropic:claude-opus-5-5", NGU, dep({ ngoai }))).toEqual({
      loai: "ngoai",
      nhaCungCap: "anthropic",
      model: "claude-opus-5-5",
    });
    for (const [ma, f] of [["ngoai:anthropic:claude-gia-hop-le", 1], ["ngoai:anthropic:claude-opus-5-5", null], ["ngoai:anthropic:claude-opus-5-5", 2]] as const) {
      await expect(giaiChonModel(ma, { ...NGU, factoryId: f }, dep({ ngoai }))).rejects.toMatchObject({
        code: "NOT_FOUND",
        cause: { appParams: { reason: "modelNgoaiKhongTonTaiHoacNgoaiPhamVi" } },
      });
    }
  });

  it("BẤT BIẾN: mọi vai-tro:* và ho-so:* ra local dù danh mục ngoài KHÔNG rỗng và gán trỏ tới chuỗi giống 'ngoai:'", async () => {
    const ngoai = { layModelDaBat: async () => [{ nhaCungCap: "anthropic", model: "claude-opus-5-5", nhan: "x" }] };
    const d = dep({ ngoai }, [gan({ roleId: "chat", profileId: "ngoai:anthropic:claude-opus-5-5" }), gan({ roleId: "summarize", envKey: null, profileId: null, fallback: ["ngoai:anthropic:claude-opus-5-5"] })]);
    for (const v of VAI_TRO_GOC) {
      const kq = await giaiChonModel(`vai-tro:${v.id}`, { ...NGU, beMatChu: false }, d);
      expect(kq?.loai, v.id).toBe("local");
      expect(JSON.stringify(kq)).not.toContain("anthropic");
    }
    for (const id of ["p35", "p27"]) expect((await giaiChonModel(`ho-so:${id}`, NGU, d))?.loai).toBe("local");
    expect(await giaiChonModel("auto", NGU, d)).toBeNull();
  });
});
