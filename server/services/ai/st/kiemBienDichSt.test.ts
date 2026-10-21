/**
 * ★★ Đợt 9 — lõi vòng kiểm biên dịch ST (bề mặt tương tác). I/O tiêm vào (biên dịch giả, model giả) + một ca biên dịch
 * THẬT bằng docker RuSTy (bỏ qua có thông báo nếu ảnh vắng).
 */
import { describe, expect, it } from "vitest";
import type { KetQuaBienDichST } from "../../flow/lib/bienDichST";
import { LoiBienDichST, coAnhST } from "../../flow/lib/bienDichST";
import { ghepMaST, kiemBienDichBat, kiemVaSuaST, nhanKiemBienDich } from "./kiemBienDichSt";
import { trichMaST } from "./trichMaST";

const FB_DUNG = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x;\nEND_FUNCTION_BLOCK";
const FB_SAI = "FUNCTION_BLOCK A\nVAR_INPUT x : BOOL; END_VAR\nVAR_OUTPUT y : BOOL; END_VAR\n  y := x AND ;\nEND_FUNCTION_BLOCK";
const tl = (ma: string, nhan = "st") => `Đây là mã:\n\`\`\`${nhan}\n${ma}\n\`\`\`\nGiải thích ngắn.`;
const loi = (dong: number): KetQuaBienDichST => ({ ok: false, chanDoan: [{ tep: "ma.st", dong, cot: 3, mucDo: "error", ma: "E007", thongDiep: "Unexpected token" }], ms: 5 });
const sach: KetQuaBienDichST = { ok: true, chanDoan: [], ms: 5 };
const bdGia = async (ma: string) => (ma.includes("AND ;") ? loi(4) : sach);

describe("trichMaST — nghi ngờ thì BỎ QUA", () => {
  it("lấy khối nhãn st/scl/iecst; KHÔNG lấy nhãn khác dù thân giống ST; khối không nhãn chỉ khi có cặp POU đầy đủ", () => {
    expect(trichMaST(tl(FB_DUNG)).length).toBe(1);
    expect(trichMaST(tl(FB_DUNG, "iecst")).length).toBe(1);
    expect(trichMaST(tl(FB_DUNG, "python")).length).toBe(0);
    expect(trichMaST(tl(FB_DUNG, "ts")).length).toBe(0);
    expect(trichMaST(tl(FB_DUNG, "")).length).toBe(1);
    expect(trichMaST(tl("x := 1;", "")).length).toBe(0); // không có POU
    expect(trichMaST(tl("def f():\n    pass\nFUNCTION_BLOCK A\nEND_FUNCTION_BLOCK", "")).length).toBe(0); // lẫn Python
    expect(trichMaST(FB_DUNG).length).toBe(0); // không có rào ⇒ không đoán
    expect(trichMaST(`<think>\`\`\`st\n${FB_SAI}\n\`\`\`</think>\n${tl(FB_DUNG)}`).map((k) => k.ma.includes("AND ;"))).toEqual([false]);
  });

  it("SCL: nhãn scl hoặc dấu hiệu TIA ⇒ laScl; ghép chuẩn hoá SCL → ST, giữ số dòng", () => {
    const scl = 'FUNCTION_BLOCK "A"\n{ S7_Optimized_Access := \'TRUE\' }\nVERSION : 0.1\nVAR_INPUT x : Bool; END_VAR\nVAR_OUTPUT y : Bool; END_VAR\nBEGIN\n  #y := #x;\nEND_FUNCTION_BLOCK';
    const k = trichMaST(tl(scl, ""));
    expect(k[0].laScl).toBe(true);
    const g = ghepMaST(k);
    expect(g.phuongNgu).toBe("scl");
    expect(g.ma).not.toContain("#");
    expect(g.ma.split("\n").length).toBe(scl.split("\n").length + 1);
  });
});

describe("kiemVaSuaST", () => {
  it("không có mã ST ⇒ bo-qua, không gắn nhãn, không gọi biên dịch", async () => {
    let goi = 0;
    const r = await kiemVaSuaST({ cauTraLoi: "TON là bộ định thời trễ bật.", goiLai: async () => "", bienDich: async () => (goi++, sach) });
    expect(r.trangThai).toBe("bo-qua");
    expect(nhanKiemBienDich(r)).toBeNull();
    expect(goi).toBe(0);
  });

  it("bản đầu sạch ⇒ sach, không gọi lại model", async () => {
    let goiLai = 0;
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_DUNG), goiLai: async () => (goiLai++, ""), bienDich: bdGia });
    expect(r.trangThai).toBe("sach");
    expect(goiLai).toBe(0);
  });

  it("bản đầu lỗi ⇒ gửi chẩn đoán (dòng TRONG khối) ⇒ bản sửa sạch ⇒ da-sua, giữ bản đầu để hiển thị", async () => {
    const tinNhan: string[] = [];
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async (tin) => (tinNhan.push(tin), tl(FB_DUNG)), bienDich: bdGia });
    expect(r).toMatchObject({ trangThai: "da-sua", soVong: 1, soLoiDaSua: 1 });
    expect(r.cauTraLoiDau).toContain("AND ;");
    expect(r.cauTraLoiCuoi).not.toContain("AND ;");
    expect(tinNhan[0]).toContain("mã:4:3 error[E007]");
    expect(nhanKiemBienDich(r)).toContain("Đã tự sửa 1 lỗi");
  });

  it("vẫn lỗi sau 2 vòng ⇒ con-loi, đúng 2 lần gọi lại, nhãn liệt kê lỗi còn lại", async () => {
    let n = 0;
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async () => (n++, tl(FB_SAI)), bienDich: bdGia });
    expect(r.trangThai).toBe("con-loi");
    expect(n).toBe(2);
    expect(nhanKiemBienDich(r)).toContain("còn 1 lỗi");
  });

  it("trần thời gian: hết trần trước vòng ⇒ không gọi lại", async () => {
    let t = 0;
    let n = 0;
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async () => (n++, tl(FB_DUNG)), bienDich: async (m) => ((t += 100_000), bdGia(m)), bayGio: () => t, tranMs: 90_000 });
    expect(n).toBe(0);
    expect(r.trangThai).toBe("con-loi");
  });

  it("docker/ảnh vắng ⇒ khong-kiem-duoc (không ném, không chặn)", async () => {
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_DUNG), goiLai: async () => "", bienDich: async () => { throw new LoiBienDichST("thieu-anh", "ảnh vắng"); } });
    expect(r.trangThai).toBe("khong-kiem-duoc");
    expect(r.cauTraLoiCuoi).toBe(r.cauTraLoiDau);
  });

  it("bản sửa không còn khối ST ⇒ giữ bản đầu (không thay bằng chữ thuần)", async () => {
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async () => "Xin lỗi, tôi không sửa được.", bienDich: bdGia });
    expect(r.trangThai).toBe("con-loi");
    expect(r.cauTraLoiCuoi).toBe(r.cauTraLoiDau);
  });

  it("cờ AI_KIEM_BIEN_DICH_ST: mặc định off; danh sách bề mặt", () => {
    expect(kiemBienDichBat("v1", {})).toBe(false);
    expect(kiemBienDichBat("v1", { AI_KIEM_BIEN_DICH_ST: "v1,cmdk" })).toBe(true);
    expect(kiemBienDichBat("tro-ly", { AI_KIEM_BIEN_DICH_ST: "v1,cmdk" })).toBe(false);
    expect(kiemBienDichBat("tro-ly", { AI_KIEM_BIEN_DICH_ST: "all" })).toBe(true);
  });
});

describe("kiemVaSuaST × RuSTy THẬT (docker)", () => {
  it("mã sai thật ⇒ chẩn đoán thật trỏ đúng dòng trong khối; mã đúng ⇒ sạch", async (ctx) => {
    if (!(await coAnhST())) ctx.skip();
    const r = await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async () => tl(FB_DUNG) });
    expect(r.trangThai).toBe("da-sua");
    expect(r.soLoiDaSua).toBeGreaterThan(0);
  }, 120_000);
});
