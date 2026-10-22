/**
 * ★★ Đợt 9 — lõi vòng kiểm biên dịch ST (bề mặt tương tác). I/O tiêm vào (biên dịch giả, model giả) + một ca biên dịch
 * THẬT bằng docker RuSTy (bỏ qua có thông báo nếu ảnh vắng).
 */
import { describe, expect, it } from "vitest";
import type { KetQuaBienDichST } from "../../flow/lib/bienDichST";
import { LoiBienDichST, coAnhST } from "../../flow/lib/bienDichST";
import { ghepMaST, kiemBienDichBat, kiemVaSuaST, nhanKiemBienDich, tranMsVongSuaST } from "./kiemBienDichSt";
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

  it("★ (2026-10-22) nhãn GẦN-ST (pascal/iec/plc) ⇒ lấy CHỈ khi thân chắc là ST; Pascal thật / thiếu VAR / nhãn khác ⇒ bỏ", () => {
    // 27B dán ```pascal cho ~58 % khối ST thật (đo trên 60 câu trả lời) — đúng hình dạng này:
    const thatTu27B = "// tệp: src/BoPhieu2oo3.st\nFUNCTION_BLOCK BoPhieu2oo3\nVAR_INPUT\n    A : BOOL;\nEND_VAR\nVAR_OUTPUT\n    Q : BOOL;\nEND_VAR\n    IF A THEN\n        Q := TRUE;\n    END_IF;\nEND_FUNCTION_BLOCK";
    for (const n of ["pascal", "Pascal", "iec", "plc", "codesys"]) expect(trichMaST(tl(thatTu27B, n)).length, n).toBe(1);
    // Pascal THẬT — kể cả khi có chữ FUNCTION…END_FUNCTION_BLOCK lọt vào chú thích
    const pascalThat = "program Hello;\nuses crt;\nvar x: integer;\nbegin\n  { FUNCTION_BLOCK A VAR END_VAR END_FUNCTION_BLOCK }\n  writeln('hi');\nend.";
    expect(trichMaST(tl(pascalThat, "pascal")).length).toBe(0);
    const pascalThuTuc = "FUNCTION_BLOCK X\nVAR a : INT; END_VAR\nprocedure P;\nbegin\nend;\nEND_FUNCTION_BLOCK";
    expect(trichMaST(tl(pascalThuTuc, "pascal")).length).toBe(0);
    // POU nhưng KHÔNG có VAR…END_VAR ⇒ chưa chắc ⇒ bỏ
    expect(trichMaST(tl("FUNCTION_BLOCK A\n  y := x;\nEND_FUNCTION_BLOCK", "pascal")).length).toBe(0);
    // SCL TIA (có BEGIN) dưới nhãn pascal ⇒ nghi ngờ ⇒ bỏ (nhãn scl / không nhãn vẫn lấy như cũ)
    expect(trichMaST(tl('FUNCTION_BLOCK "A"\nVAR_INPUT x : Bool; END_VAR\nBEGIN\n  #y := #x;\nEND_FUNCTION_BLOCK', "pascal")).length).toBe(0);
    // nhãn KHÁC (không thuộc nhóm gần-ST) vẫn KHÔNG BAO GIỜ lấy
    for (const n of ["python", "c", "javascript", "delphi", "text"]) expect(trichMaST(tl(thatTu27B, n)).length, n).toBe(0);
  });

  it("★ TÍN HIỆU MẠNH `// tệp: *.st|*.scl` (trong khối hoặc dòng ngay trước) thay vế 'Pascal thật'; vẫn đòi POU + VAR", () => {
    const sclTia = 'FUNCTION_BLOCK "A"\nVAR_INPUT x : Bool; END_VAR\nVAR_OUTPUT y : Bool; END_VAR\nBEGIN\n  #y := #x;\nEND_FUNCTION_BLOCK';
    const k = trichMaST(tl(`// tệp: src/A.scl\n${sclTia}`, "pascal"));
    expect(k.length).toBe(1);
    expect(k[0].laScl).toBe(true);
    expect(trichMaST(`Tệp: src/A.scl\n\`\`\`pascal\n${sclTia}\n\`\`\``).length).toBe(1); // dòng NGAY TRƯỚC khối
    expect(trichMaST(tl(`// tệp: src/A.st\nFUNCTION_BLOCK A\n  BEGIN y := x; END;\nEND_FUNCTION_BLOCK`, "pascal")).length).toBe(0); // không VAR
    expect(trichMaST(tl(`// tệp: src/A.pas\n${sclTia}`, "pascal")).length).toBe(0); // đuôi khác ⇒ không phải tín hiệu
  });

  it("★ `=>` TRẦN là cú pháp IEC (gán đầu ra FB) — không bị coi là JS; `=> {` / `=> (` vẫn loại", () => {
    const fbGoiTrig = "FUNCTION_BLOCK B\nVAR_INPUT x : BOOL; END_VAR\nVAR f : F_TRIG; c : BOOL; END_VAR\n  f(CLK := x, Q => c);\nEND_FUNCTION_BLOCK";
    expect(trichMaST(tl(fbGoiTrig, "pascal")).length).toBe(1);
    expect(trichMaST(tl(fbGoiTrig, "")).length).toBe(1);
    expect(trichMaST(tl(`${fbGoiTrig}\nxs.map((a) => { return a; });`, "")).length).toBe(0); // CHỈ dấu hiệu mũi tên
    expect(trichMaST(tl(`${fbGoiTrig}\nys.forEach(a => (a + 1));`, "pascal")).length).toBe(0);
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
    expect(tinNhan[0]).toContain("- mã:4:3 E007 Unexpected token"); // hình dạng dòng lỗi CHUNG với bộ đo M (shared/stNhacSua.mjs)
    expect(tinNhan[0]).toContain("ĐẦY ĐỦ mã"); // không có dòng `// tệp:` ⇒ không đòi định dạng tệp
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

  it("★ (2026-10-22) trần thời gian cắt SAU vòng 1 ⇒ soVong = 1 (số vòng THẬT, không báo vòng tối đa)", async () => {
    let t = 0;
    let n = 0;
    const r = await kiemVaSuaST({
      cauTraLoi: tl(FB_SAI),
      goiLai: async () => ((t += 100_000), n++, tl(FB_SAI)), // vòng sửa 100 s, vẫn lỗi
      bienDich: bdGia,
      bayGio: () => t,
      tranMs: 90_000,
    });
    expect(n).toBe(1);
    expect(r).toMatchObject({ trangThai: "con-loi", soVong: 1 });
    expect(nhanKiemBienDich(r)).toContain("sau 1 vòng");
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

describe("★ (2026-10-22) lời nhắc sửa CHUNG với bộ đo M + trần thời gian theo khe", () => {
  it("khối có `// tệp:` ⇒ chẩn đoán mang ĐÚNG tên tệp model đã viết + lời nhắc đòi trả lại ĐỦ mọi tệp đúng định dạng (chữ của M)", async () => {
    const tinNhan: string[] = [];
    const coTep = (ma: string) => `\`\`\`pascal\n// tệp: src/A.st\n${ma}\n\`\`\``;
    const r = await kiemVaSuaST({
      cauTraLoi: coTep(FB_SAI),
      goiLai: async (tin) => (tinNhan.push(tin), coTep(FB_DUNG)),
      bienDich: async (m) => (m.includes("AND ;") ? loi(5) : sach), // dòng 5 của khối = dòng có lỗi (sau dòng đánh dấu)
    });
    expect(r.trangThai).toBe("da-sua");
    expect(tinNhan[0]).toContain("- src/A.st:5:3 E007");
    expect(tinNhan[0]).toContain("trả lại ĐẦY ĐỦ mọi tệp theo đúng định dạng như trước (mỗi tệp một khối mã có dòng `// tệp: …`)");
    expect(tinNhan[0]).toContain("(RuSTy, phương ngữ CODESYS)");
  });

  it("tranMsVongSuaST: hồ sơ khe NẶNG ⇒ 480 s (đủ 2 lần sinh lại 27B), ghi đè được; khe nhẹ / model lạ ⇒ 90 s", () => {
    const P = (artifactFile: string, slotClass: "nang" | "nho") => ({ artifactFile, slotClass, artifactStatus: "available", license: "apache-2.0", enabled: true });
    const anh = { taiLuc: 1, vaiTro: new Map(), gan: [], profile: new Map([["q27", P("Qwen3.6-27B-UD-Q4_K_XL.gguf", "nang")], ["q4", P("Qwen3-4B.gguf", "nho")]]) } as never;
    expect(tranMsVongSuaST("Qwen3.6-27B-UD-Q4_K_XL", {}, anh)).toBe(480_000);
    expect(tranMsVongSuaST("Qwen3.6-27B-UD-Q4_K_XL", { AI_KIEM_BIEN_DICH_ST_TRAN_MS_NANG: "600000" }, anh)).toBe(600_000);
    expect(tranMsVongSuaST("Qwen3.6-27B-UD-Q4_K_XL", { AI_KIEM_BIEN_DICH_ST_TRAN_MS_NANG: "abc" }, anh)).toBe(480_000);
    for (const m of ["Qwen3-4B", "la", undefined]) expect(tranMsVongSuaST(m, { AI_KIEM_BIEN_DICH_ST_TRAN_MS_NANG: "600000" }, anh)).toBe(90_000);
  });

  it("★ trần khe nặng cho ĐỦ 2 vòng khi mỗi lần sinh lại ~200 s (trần 90 s cũ chỉ cho 1)", async () => {
    for (const [tranMs, kyVong] of [[90_000, 1], [480_000, 2]] as const) {
      let t = 0;
      let n = 0;
      await kiemVaSuaST({ cauTraLoi: tl(FB_SAI), goiLai: async () => ((t += 200_000), n++, tl(FB_SAI)), bienDich: bdGia, bayGio: () => t, tranMs });
      expect(n, `tranMs ${tranMs}`).toBe(kyVong);
    }
  });
});
