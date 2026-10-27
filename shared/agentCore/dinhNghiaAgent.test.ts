import { describe, expect, it } from "vitest";
import { TEN_CONG_CU } from "./congCu";
import {
  bamNoiDung,
  DINH_NGHIA_DUNG_SAN,
  locDinhNghiaTuRepo,
  phanTichDinhNghia,
  TRAN_BYTE_TEP_DINH_NGHIA,
  TRAN_MO_TA,
  TRAN_SO_TEP_DINH_NGHIA,
} from "./dinhNghiaAgent";

const hopLe = (them = "") =>
  `---\nname: doc-ma\ndescription: Doc ma khong sua\ntools: [read_file, grep]\nmodel: auto\napproval: hoi\n${them}---\nYou read code.\n`;

describe("bamNoiDung (SHA-256 thuần)", () => {
  it("khớp vectơ chuẩn", () => {
    expect(bamNoiDung("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(bamNoiDung("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(bamNoiDung("a".repeat(1000))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
  });
  it("UTF-8 đa byte; BOM và CRLF không đổi băm", () => {
    expect(bamNoiDung("﻿a\r\nb")).toBe(bamNoiDung("a\nb"));
    expect(bamNoiDung("a")).not.toBe(bamNoiDung("b"));
    expect(bamNoiDung("Thợ Cả")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("phanTichDinhNghia — đường hợp lệ", () => {
  it("đọc đủ trường, nguồn tuRepo, băm theo nội dung", () => {
    const r = phanTichDinhNghia("doc-ma.md", hopLe());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dn).toMatchObject({
      ten: "doc-ma",
      moTa: "Doc ma khong sua",
      congCu: ["read_file", "grep"],
      model: "auto",
      cheDo: "hoi",
      nguon: "tuRepo",
    });
    expect(r.dn.than).toBe("You read code.");
    expect(r.dn.bam).toBe(bamNoiDung(hopLe()));
  });
  it("danh sách kiểu gạch đầu dòng + CRLF + BOM", () => {
    const s = "﻿---\r\nname: a-b\r\ndescription: x\r\ntools:\r\n  - read_file\r\n  - find_files\r\n---\r\nbody";
    const r = phanTichDinhNghia("a-b.md", s);
    expect(r.ok && r.dn.congCu).toEqual(["read_file", "find_files"]);
  });
  it("thiếu approval ⇒ hoi; thiếu model ⇒ auto", () => {
    const r = phanTichDinhNghia("a.md", "---\nname: a\ndescription: d\ntools: [read_file]\n---\nb");
    expect(r.ok && r.dn.cheDo).toBe("hoi");
    expect(r.ok && r.dn.model).toBe("auto");
  });
  it("approval sua được; max_turns 1..12", () => {
    const r = phanTichDinhNghia("doc-ma.md", hopLe("max_turns: 5\n").replace("approval: hoi", "approval: sua"));
    expect(r.ok && r.dn.cheDo).toBe("sua");
    expect(r.ok && r.dn.maxLuot).toBe(5);
    expect(phanTichDinhNghia("doc-ma.md", hopLe("max_turns: 13\n")).ok).toBe(false);
    expect(phanTichDinhNghia("doc-ma.md", hopLe("max_turns: 0\n")).ok).toBe(false);
  });
  it("model cục bộ vai-tro:/ho-so: được", () => {
    expect(phanTichDinhNghia("doc-ma.md", hopLe().replace("model: auto", "model: vai-tro:lap-trinh")).ok).toBe(true);
    expect(phanTichDinhNghia("doc-ma.md", hopLe().replace("model: auto", "model: ho-so:qwen3-35b")).ok).toBe(true);
  });
});

function tu(s: string, ma: string, ten = "doc-ma.md") {
  const r = phanTichDinhNghia(ten, s);
  expect(r.ok, `phải bị từ chối: ${ma}`).toBe(false);
  if (!r.ok) expect(r.ma).toBe(ma);
}

describe("phanTichDinhNghia — từ chối (M1–M3)", () => {
  it("M1: model ngoài bị cấm", () => {
    tu(hopLe().replace("model: auto", "model: ngoai:openai:gpt-x"), "MODEL_NGOAI_CAM");
    tu(hopLe().replace("model: auto", "model: NGOAI:x:y"), "MODEL_NGOAI_CAM");
    tu(hopLe().replace("model: auto", "model: http://evil"), "MODEL_SAI");
  });
  it("approval tu-dong / lạ bị cấm", () => {
    tu(hopLe().replace("approval: hoi", "approval: tu-dong"), "APPROVAL_CAM");
    tu(hopLe().replace("approval: hoi", "approval: auto"), "APPROVAL_CAM");
  });
  it("công cụ lạ / remember / delegate / trùng / rỗng bị cấm", () => {
    tu(hopLe().replace("[read_file, grep]", "[read_file, rm_rf]"), "CONG_CU_LA");
    tu(hopLe().replace("[read_file, grep]", "[remember]"), "CONG_CU_LA");
    tu(hopLe().replace("[read_file, grep]", "[delegate]"), "CONG_CU_LA");
    tu(hopLe().replace("[read_file, grep]", "[grep, grep]"), "CONG_CU_LA");
    tu(hopLe().replace("[read_file, grep]", "[]"), "CONG_CU_RONG");
  });
  it("M2d: tên sai / không khớp tên tệp / hoa-thường / đường dẫn", () => {
    tu(hopLe(), "TEN_SAI", "khac.md");
    tu(hopLe().replace("name: doc-ma", "name: Doc-Ma"), "TEN_SAI", "Doc-Ma.md");
    for (const t of ["../doc-ma.md", "a/doc-ma.md", "a\\doc-ma.md", "doc-ma.md.md", "doc-ma.MD", ".md", "1a.md", "a".repeat(33) + ".md", "doc-ma.txt", "con..md"])
      tu(hopLe(), "TEN_SAI", t);
  });
  it("M2d: description ≤ trần, bắt buộc", () => {
    tu(hopLe().replace("Doc ma khong sua", "x".repeat(TRAN_MO_TA + 1)), "MO_TA_DAI");
    tu(hopLe().replace("description: Doc ma khong sua\n", ""), "THIEU_TRUONG");
  });
  it("M3: alias/anchor/thẻ/khối/lồng/khoá lạ/khoá lặp bị cấm", () => {
    tu(hopLe("x: &a [read_file]\n"), "KHOA_LA");
    tu(hopLe().replace("Doc ma khong sua", "*a"), "YAML_CAM");
    tu(hopLe().replace("Doc ma khong sua", "&a x"), "YAML_CAM");
    tu(hopLe().replace("Doc ma khong sua", "!!python/object x"), "YAML_CAM");
    tu(hopLe().replace("Doc ma khong sua", "|"), "YAML_CAM");
    tu(hopLe().replace("Doc ma khong sua", "{a: 1}"), "YAML_CAM");
    tu(hopLe("<<: *x\n"), "KHOA_LA");
    tu(hopLe("model2: x\n"), "KHOA_LA");
    tu(hopLe("name: doc-ma\n"), "KHOA_LAP");
    tu(hopLe("  nested: 1\n"), "YAML_CAM");
  });
  it("trần: tệp, thân, số dòng front-matter, thiếu rào, thân rỗng", () => {
    tu(hopLe() + "x".repeat(TRAN_BYTE_TEP_DINH_NGHIA), "TEP_QUA_LON");
    tu(hopLe().replace("You read code.", "x".repeat(6001)), "THAN_DAI");
    tu("name: a\n", "THIEU_RAO", "a.md");
    tu("---\nname: doc-ma\n", "THIEU_RAO");
    tu(hopLe(Array.from({ length: 41 }, (_, i) => `# c${i}\n`).join("")), "FRONT_MATTER_DAI");
    tu(hopLe().replace("You read code.", ""), "THAN_RONG");
  });
  it("tải độc kiểu billion-laughs bị từ chối nhanh", () => {
    const doc =
      "---\nname: doc-ma\ndescription: x\ntools: [read_file]\n" +
      Array.from({ length: 30 }, (_, i) => `l${i}: &a${i} [*a${Math.max(0, i - 1)}]\n`).join("") +
      "---\nb";
    const t0 = Date.now();
    tu(doc, "KHOA_LA");
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it("mọi công cụ trong TEN_CONG_CU (trừ remember, delegate) dùng được", () => {
    for (const t of TEN_CONG_CU.filter((x) => x !== "remember" && x !== "delegate")) {
      const r = phanTichDinhNghia("doc-ma.md", hopLe().replace("[read_file, grep]", `[${t}]`));
      expect(r.ok, t).toBe(true);
    }
  });
});

describe("dựng sẵn + lọc tệp repo (M2c)", () => {
  it("4 agent dựng sẵn: nguồn dungSan, chế độ ≤ sua, công cụ hợp lệ, chỉ-đọc đúng", () => {
    expect(DINH_NGHIA_DUNG_SAN.map((d) => d.ten).sort()).toEqual(["kham-pha", "plc", "review", "viet-test"]);
    for (const d of DINH_NGHIA_DUNG_SAN) {
      expect(d.nguon).toBe("dungSan");
      expect(["hoi", "sua"]).toContain(d.cheDo);
      for (const c of d.congCu) expect(TEN_CONG_CU as readonly string[]).toContain(c);
      expect(d.congCu).not.toContain("remember");
    }
    for (const n of ["kham-pha", "review", "plc"]) {
      const d = DINH_NGHIA_DUNG_SAN.find((x) => x.ten === n)!;
      expect(d.cheDo).toBe("hoi");
      for (const c of ["edit_file", "write_file", "delete_file", "rename_file", "run_command"]) expect(d.congCu).not.toContain(c);
    }
  });
  it("tệp repo trùng tên dựng sẵn bị bỏ + cảnh báo; tệp hỏng bị bỏ", () => {
    const r = locDinhNghiaTuRepo([
      { ten: "kham-pha.md", noiDung: hopLe().replace("name: doc-ma", "name: kham-pha") },
      { ten: "doc-ma.md", noiDung: hopLe() },
      { ten: "hong.md", noiDung: "rác" },
    ]);
    expect(r.nhan.map((d) => d.ten)).toEqual(["doc-ma"]);
    expect(r.nhan[0].nguon).toBe("tuRepo");
    expect(r.canhBao.map((c) => c.ma).sort()).toEqual(["THIEU_RAO", "TRUNG_DUNG_SAN"]);
  });
  it("trần số tệp: phần vượt bị bỏ có cảnh báo", () => {
    const tep = Array.from({ length: TRAN_SO_TEP_DINH_NGHIA + 3 }, (_, i) => {
      const n = `a${i}`;
      return { ten: `${n}.md`, noiDung: hopLe().replace("name: doc-ma", `name: ${n}`) };
    });
    const r = locDinhNghiaTuRepo(tep);
    expect(r.nhan.length).toBe(TRAN_SO_TEP_DINH_NGHIA);
    expect(r.canhBao.some((c) => c.ma === "QUA_SO_TEP")).toBe(true);
  });
  it("tên tệp chỉ khác hoa-thường ⇒ cả hai bị từ chối (TEN_SAI)", () => {
    const r = locDinhNghiaTuRepo([
      { ten: "doc-ma.md", noiDung: hopLe() },
      { ten: "DOC-MA.md", noiDung: hopLe().replace("name: doc-ma", "name: DOC-MA") },
    ]);
    expect(r.nhan.map((d) => d.ten)).toEqual(["doc-ma"]);
    expect(r.canhBao.map((c) => c.ma)).toEqual(["TEN_SAI"]);
  });
});
