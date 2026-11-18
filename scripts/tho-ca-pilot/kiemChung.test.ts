import { describe, it, expect } from "vitest";
import { chayLenhKiem, envChoTsc, envSachChoTienTrinhCon, demCaTest, laLenhVitest, loiTscTrongTep, phanTichVitest, quyetKetCuc, type KetQuaKiem, type KetQuaTsc } from "./kiemChung";
import type { KetQuaDotBien } from "./dotBien";

const kiem = (o: Partial<KetQuaKiem> = {}): KetQuaKiem => ({
  lenh: "npx vitest run a.test.ts",
  exit: 0,
  hetGio: false,
  giay: 1,
  duoi: "",
  vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 5, hong: 0, boQua: 0, tong: 5 } },
  ...o,
});
const quyet = (k: KetQuaKiem | null, over: Partial<Parameters<typeof quyetKetCuc>[0]> = {}) =>
  quyetKetCuc({ truoc: "xong", dungVitest: true, tepTest: [{ duong: "a.test.ts", soCa: 5 }], kiem: k, ...over });

describe("phanTichVitest — đọc CẢ dòng Test Files lẫn Tests", () => {
  it("xanh", () => {
    const r = phanTichVitest(" Test Files  2 passed (2)\n      Tests  14 passed (14)\n");
    expect(r.tep).toEqual({ dat: 2, hong: 0, boQua: 0, tong: 2 });
    expect(r.ca).toEqual({ dat: 14, hong: 0, boQua: 0, tong: 14 });
  });
  it("đỏ + bỏ qua + mã màu", () => {
    const r = phanTichVitest("\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m1 failed\x1b[39m | 1 passed\x1b[22m (2)\n      Tests  2 failed | 10 passed | 1 skipped (13)\n");
    expect(r.tep).toEqual({ dat: 1, hong: 1, boQua: 0, tong: 2 });
    expect(r.ca).toEqual({ dat: 10, hong: 2, boQua: 1, tong: 13 });
  });
  it("★ tệp hỏng khi nạp: có Test Files failed nhưng KHÔNG có dòng Tests ⇒ ca null (bẫy: chỉ đọc Tests thì thấy gì cả)", () => {
    const r = phanTichVitest(" Test Files  1 failed (1)\n");
    expect(r.tep?.hong).toBe(1);
    expect(r.ca).toBeNull();
  });
  it("không có dòng nào ⇒ cả hai null", () => {
    expect(phanTichVitest("No test files found, exiting with code 1")).toEqual({ tep: null, ca: null });
  });
  it("chuỗi 'Test Files' trong nội dung dòng khác không bị nhận nhầm", () => {
    expect(phanTichVitest("stdout | x\nlog: Test Files  9 passed (9) lạ\n").tep).toBeNull();
  });
});

describe("demCaTest — đếm tĩnh ca chạy được", () => {
  it("đếm it/test, kể cả .only/.each, bỏ .skip/.todo và chú thích", () => {
    const src = `
      // it("trong chu thich", () => {});
      /* test("cung vay", () => {}); */
      describe("g", () => {
        it("a", () => {});
        test("b", () => {});
        it.only("c", () => {});
        it.each([1, 2])("d %i", () => {});
        it.skip("e", () => {});
        it.todo("f");
        test.skip("g", () => {});
      });`;
    expect(demCaTest(src)).toBe(4);
  });
  it("tệp không có ca ⇒ 0 (chỉ import + describe rỗng)", () => {
    expect(demCaTest(`import { describe } from "vitest";\ndescribe("x", () => {});\n`)).toBe(0);
  });
  it("không nhận nhầm hậu tố: split/commit/emit không phải it(", () => {
    expect(demCaTest(`const a = permit(1); const b = commit(2); x.emit("e");`)).toBe(0);
  });
});

describe("quyetKetCuc — L3a", () => {
  it("★ xanh, có ca ⇒ xong", () => {
    expect(quyet(kiem())).toEqual({ ketCuc: "xong", lyDo: null });
  });
  it("★ test ĐỎ ⇒ kiem-do (trước đây vẫn ra 'xong')", () => {
    const r = quyet(kiem({ exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 4, hong: 1, boQua: 0, tong: 5 } } }));
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toMatch(/1 ca hỏng/);
  });
  it("★ tệp hỏng khi nạp (không có dòng Tests, exit 1) ⇒ kiem-do", () => {
    expect(quyet(kiem({ exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: null } })).ketCuc).toBe("kiem-do");
  });
  it("★ 'No test files found' (exit 0, không dòng nào) ⇒ test-rong", () => {
    expect(quyet(kiem({ vitest: { tep: null, ca: null } })).ketCuc).toBe("test-rong");
  });
  it("★ vitest xanh nhưng 0 ca chạy ⇒ test-rong", () => {
    const r = quyet(kiem({ vitest: { tep: { dat: 1, hong: 0, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 0, boQua: 3, tong: 3 } } }));
    expect(r.ketCuc).toBe("test-rong");
  });
  it("★ tệp test mới 0 ca ⇒ test-rong, KHÔNG cần chạy lệnh kiểm (kiem null)", () => {
    const r = quyet(null, { tepTest: [{ duong: "a.test.ts", soCa: 3 }, { duong: "b.test.ts", soCa: 0 }] });
    expect(r.ketCuc).toBe("test-rong");
    expect(r.lyDo).toContain("b.test.ts");
  });
  it("hết hạn ⇒ kiem-do; lỗi khởi chạy ⇒ kiem-do; không có kết quả ⇒ kiem-do", () => {
    expect(quyet(kiem({ hetGio: true, exit: null })).ketCuc).toBe("kiem-do");
    expect(quyet(kiem({ loi: "spawn ENOENT", exit: null })).ketCuc).toBe("kiem-do");
    expect(quyet(null).ketCuc).toBe("kiem-do");
  });
  it("★ tệp hỏng nhưng không ca hỏng và exit 0 (dòng Test Files đỏ) ⇒ kiem-do", () => {
    const r = quyet(kiem({ exit: 0, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 3, hong: 0, boQua: 0, tong: 3 } } }));
    expect(r.ketCuc).toBe("kiem-do");
  });
  it("★ hết hạn dù đầu ra xanh và exit 0 ⇒ kiem-do (không tin dòng xanh của tiến trình bị giết)", () => {
    expect(quyet(kiem({ hetGio: true, exit: 0 })).ketCuc).toBe("kiem-do");
  });
  it("exit khác 0 dù đếm không thấy ca hỏng ⇒ kiem-do", () => {
    expect(quyet(kiem({ exit: 2 })).ketCuc).toBe("kiem-do");
  });
  it("★ STICKY: ketCuc xấu từ trước (vi-pham/het-gio/loi-driver/khong-lam) giữ nguyên dù lệnh kiểm xanh", () => {
    for (const truoc of ["vi-pham", "het-gio", "loi-driver", "khong-lam", "tu-choi"] as const) {
      expect(quyet(kiem(), { truoc }).ketCuc).toBe(truoc);
    }
  });
  it("lệnh kiểm không phải vitest: chỉ cần mã thoát", () => {
    expect(quyet(kiem({ exit: 0, vitest: { tep: null, ca: null } }), { dungVitest: false, tepTest: [] }).ketCuc).toBe("xong");
    expect(quyet(kiem({ exit: 1, vitest: { tep: null, ca: null } }), { dungVitest: false, tepTest: [] }).ketCuc).toBe("kiem-do");
  });
  it("laLenhVitest", () => {
    expect(laLenhVitest("npx vitest run x")).toBe(true);
    expect(laLenhVitest("node scripts/x.mjs")).toBe(false);
  });
});

describe("chayLenhKiem — tiến trình thật (không vitest lồng)", () => {
  it("★ chạy với env DB CHẾT, đọc đầu ra, mã thoát", async () => {
    const k = await chayLenhKiem(
      `node -e "const U=function(s){const u=new URL(s);return u.host+u.pathname}; console.log(U(process.env.DATABASE_URL) + '|' + U(process.env.TEST_DATABASE_URL)); console.log(' Test Files  1 passed (1)'); console.log('      Tests  3 passed (3)')"`,
      process.cwd(),
      60,
    );
    expect(k.exit).toBe(0);
    expect(k.hetGio).toBe(false);
    expect(k.duoi).toContain("127.0.0.1:9/aoi_management|127.0.0.1:9/aoi_management_test"); // in host+đường, không in URL (đầu ra lệnh kiểm được lọc chuỗi kết nối)
    expect(k.vitest.ca).toEqual({ dat: 3, hong: 0, boQua: 0, tong: 3 });
  });
  it("mã thoát khác 0 được báo đúng", async () => {
    const k = await chayLenhKiem(`node -e "process.exit(7)"`, process.cwd(), 60);
    expect(k.exit).toBe(7);
  });
  it("★ hết hạn ⇒ hetGio, giết tiến trình", async () => {
    const k = await chayLenhKiem(`node -e "setTimeout(()=>{}, 60000)"`, process.cwd(), 1);
    expect(k.hetGio).toBe(true);
    expect(k.exit).toBeNull();
    expect(k.giay).toBeLessThan(20);
  });
});

describe("L3c — tsc trên tệp model đổi", () => {
  const BS = String.fromCharCode(92);
  const dau = [
    "server/utils/msaReport.unit.test.ts(4,6): error TS2345: Argument of type 'string' is not assignable to type 'Verdict'.",
    "server/khac/co-san.ts(10,1): error TS2322: nền đã đỏ sẵn ở tệp khác.",
    `server${BS}utils${BS}b.unit.test.ts(2,3): error TS7006: Parameter 'x' implicitly has an 'any' type.`,
    "Found 3 errors.",
  ].join("\n");
  it("★ chỉ tính lỗi nằm trong tệp model đổi; lỗi nền ở tệp khác không tính nhưng đếm vào tong", () => {
    const r = loiTscTrongTep(dau, ["server/utils/msaReport.unit.test.ts", "server/utils/b.unit.test.ts"]);
    expect(r.tong).toBe(3);
    expect(r.trongTep).toHaveLength(2);
    expect(r.trongTep[0]).toContain("TS2345");
  });
  it("không tệp nào đổi khớp ⇒ 0 lỗi trong tệp", () => {
    expect(loiTscTrongTep(dau, ["server/khong/lien/quan.ts"]).trongTep).toEqual([]);
  });
  const tscOk: KetQuaTsc = { exit: 0, hetGio: false, giay: 5, loiTrongTep: [], tongLoi: 0 };
  it("★ lệnh kiểm xanh nhưng tsc có lỗi trong tệp đổi ⇒ kiem-do (vitest không kiểm kiểu)", () => {
    const r = quyet(kiem(), { tsc: { ...tscOk, exit: 2, loiTrongTep: ["server/utils/msaReport.unit.test.ts(4,6): error TS2345: x"], tongLoi: 1 } });
    expect(r.ketCuc).toBe("kiem-do");
    expect(r.lyDo).toMatch(/tsc: 1 lỗi kiểu/);
  });
  it("★ tsc hết hạn / không khởi chạy được ⇒ kiem-do (fail-closed)", () => {
    expect(quyet(kiem(), { tsc: { ...tscOk, exit: null, hetGio: true } }).ketCuc).toBe("kiem-do");
    expect(quyet(kiem(), { tsc: { ...tscOk, exit: null, loi: "spawn ENOENT" } }).ketCuc).toBe("kiem-do");
  });
  it("tsc sạch ⇒ xong; tsc vắng ⇒ xong; lệnh kiểm đỏ thì tsc không được cứu", () => {
    expect(quyet(kiem(), { tsc: tscOk }).ketCuc).toBe("xong");
    expect(quyet(kiem(), { tsc: null }).ketCuc).toBe("xong");
    expect(quyet(kiem({ exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } }), { tsc: tscOk }).ketCuc).toBe("kiem-do");
  });
});

describe("quyetKetCuc — L3b đột biến", () => {
  const db = (o: Partial<KetQuaDotBien> = {}): KetQuaDotBien => ({ tong: 2, do: 2, song: 0, khongApDung: 0, chiTiet: [], khoiPhucSach: true, tepLa: [], ...o });
  it("★ tất cả đột biến bị bắt ⇒ xong", () => {
    expect(quyet(kiem(), { dotBien: db() }).ketCuc).toBe("xong");
  });
  it("★ có đột biến SỐNG ⇒ dot-bien-song, nêu đột biến", () => {
    const r = quyet(kiem(), { dotBien: db({ do: 1, song: 1, chiTiet: [{ tep: "a.ts", tim: "n > 0", ketQua: "song", giay: 1 }] }) });
    expect(r.ketCuc).toBe("dot-bien-song");
    expect(r.lyDo).toContain('a.ts: "n > 0"');
  });
  it("★ không áp dụng được / không kết luận ⇒ kiem-do (không âm thầm coi là bắt được)", () => {
    expect(quyet(kiem(), { dotBien: db({ do: 1, khongApDung: 1 }) }).ketCuc).toBe("kiem-do");
  });
  it("★ khôi phục không sạch hoặc tệp lạ ⇒ vi-pham (đi trước kết quả đột biến)", () => {
    expect(quyet(kiem(), { dotBien: db({ khoiPhucSach: false }) }).ketCuc).toBe("vi-pham");
    expect(quyet(kiem(), { dotBien: db({ tepLa: ["x.txt"], song: 1 }) }).ketCuc).toBe("vi-pham");
  });
  it("STICKY: đột biến không cứu được ketCuc xấu có sẵn; tsc đỏ thì đột biến không được che", () => {
    expect(quyet(kiem(), { truoc: "vi-pham", dotBien: db() }).ketCuc).toBe("vi-pham");
    expect(quyet(kiem({ exit: 1, vitest: { tep: { dat: 0, hong: 1, boQua: 0, tong: 1 }, ca: { dat: 0, hong: 1, boQua: 0, tong: 1 } } }), { dotBien: db() }).ketCuc).toBe("kiem-do");
  });
});

describe("envSachChoTienTrinhCon — test do model viết KHÔNG được thừa kế bí mật của tiến trình pilot", () => {
  it("★ gỡ biến tên bí mật + *_KEY_FILE; giữ biến thường; ép DB chết", () => {
    const r = envSachChoTienTrinhCon({
      PATH: "p",
      LLAMA_SERVER_URL: "http://127.0.0.1:8091",
      LLAMA_SERVER_API_KEY: "sk-that",
      LLAMA_SERVER_API_KEY_FILE: "D:/bi-mat/khoa.txt",
      JWT_SECRET: "j",
      SESSION_SECRET: "s",
      OPENAI_API_KEY: "o",
      DB_PASSWORD: "x",
      GGUF_API_TOKEN: "t",
      SECRET_ENCRYPTION_KEY: "e",
      ADMIN_PASSWORD_FILE: "f",
      SIGNING_KEY_FILE: "k",
      DATABASE_URL: "postgres://aoi:that@127.0.0.1:5434/aoi_management",
    });
    expect(Object.keys(r).sort()).toEqual(["DATABASE_URL", "LLAMA_SERVER_URL", "PATH", "TEST_DATABASE_URL"]);
    expect(r.DATABASE_URL).toContain("127.0.0.1:9/");
    expect(r.TEST_DATABASE_URL).toContain("127.0.0.1:9/");
  });
  it("★ tiến trình con THẬT (chayLenhKiem) không thấy khoá / đường dẫn khoá của tiến trình cha", async () => {
    process.env.LLAMA_SERVER_API_KEY_FILE = "D:/bi-mat/khoa-that.txt";
    process.env.LLAMA_SERVER_API_KEY = "sk-that-123";
    try {
      const k = await chayLenhKiem(`node -e "console.log('F=' + process.env.LLAMA_SERVER_API_KEY_FILE + ' K=' + process.env.LLAMA_SERVER_API_KEY + ' D=' + new URL(process.env.DATABASE_URL).host)"`, process.cwd(), 60);
      expect(k.duoi).toContain("F=undefined K=undefined");
      expect(k.duoi).toContain("127.0.0.1:9");
      expect(k.duoi).not.toMatch(/khoa-that|sk-that/);
    } finally {
      delete process.env.LLAMA_SERVER_API_KEY_FILE;
      delete process.env.LLAMA_SERVER_API_KEY;
    }
  });
});

describe("envChoTsc", () => {
  it("★ tsc cũng KHÔNG thừa kế bí mật; có heap 12 GB và DB chết", () => {
    const r = envChoTsc({ PATH: "p", LLAMA_SERVER_API_KEY_FILE: "D:/bi-mat/k.txt", JWT_SECRET: "j", SIGNING_KEY_FILE: "k" });
    expect(Object.keys(r).sort()).toEqual(["DATABASE_URL", "FORCE_COLOR", "NODE_OPTIONS", "NO_COLOR", "PATH", "TEST_DATABASE_URL"]);
    expect(r.NODE_OPTIONS).toBe("--max-old-space-size=12288");
    expect(r.DATABASE_URL).toContain("127.0.0.1:9/");
  });
});
