/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-2** — **AUTOMOCK KHÔNG ĐƯỢC NUỐT MỘT VỊ TỪ AN NINH.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ***∀ lượt `vi.mock(<đường dẫn>)` KHÔNG có factory trong `server/**\/*.test.ts`: bề mặt xuất của
 * module đích KHÔNG được chứa `server/db/auth.ts`.***
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO — HÌNH DẠNG "KHÔNG THỂ ỒN ÀO THEO CẤU TẠO"
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Báo cáo nhóm B bác bỏ lớp *"bản giả thiếu khoá ⇒ lưới xanh trên mã đã bị thay"* bằng lý lẽ
 * *"872/880 = 99,1% bề mặt tầng `db` là **hàm**; khoá hàm thiếu ⇒ `undefined(...)` ⇒ **TypeError**
 * ⇒ ồn ào"*. Lý lẽ ấy đúng **chỉ cho** `vi.mock(path, () => ({…}))` — hình dạng **factory**, nơi
 * khoá **VẮNG MẶT**. Repo còn hình dạng thứ hai: `vi.mock(path)` **không factory** ⇒ vitest
 * **automock**, mọi export thành **spy TỒN TẠI trả `undefined`**. Khoá **có mặt**. Không `TypeError`.
 *
 * ⇒ Con số **99,1% là HÀM** không phải lý do yên tâm — nó **chính là cơ chế** khiến automock im
 *   lặng: một hàm **có thật** trả `undefined`. §3 dưới đây đo điều đó **trên chính file này**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI PHÉP ĐO CỦA TÔI ĐÃ NÓI DỐI TRƯỚC KHI RA ĐƯỢC CON SỐ NÀY — CẢ HAI ĐƯỢC GHIM Ở §2
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. `git grep -nE 'vi\.mock\("[^"]*db[^"]*"\)\s*;'` ⇒ **5**. Cùng mẫu ấy qua ripgrep ⇒ **21**.
 *     `git grep -E` (POSIX ERE) **không hiểu `\s`** ⇒ một con số nhỏ hơn 4 lần, hình dạng đúng.
 *  2. Vị từ đầu của tôi hỏi *"bao đóng **LƯỢT NHẬP** của module đích có chạm `db/auth.ts` không"*
 *     ⇒ **9** vi phạm. **SAI**: `vi.mock` chỉ vô hiệu **bề mặt XUẤT của chính module ấy**, không vô
 *     hiệu cây phụ thuộc của nó. Đi theo **cạnh RE-EXPORT** (`export * from` / `export {…} from`)
 *     ⇒ **1**. Tám cái kia là dương tính giả **có hình dạng đúng của một kết luận thật**.
 *     ⇒ §2b hiệu chuẩn đúng chỗ ấy bằng hai module dựng sẵn: một cái **NHẬP** `db/auth`, một cái
 *       **RE-EXPORT** `db/auth`. Chỉ cái thứ hai được xếp là nguy hiểm.
 *
 * **Số thật hôm nay**: **30** lượt automock trong `server/**\/*.test.ts`, **1** trong số đó nuốt
 * `db/auth` (`server/edgeDownloadProxy.test.ts:15`, `vi.mock("../server/db")` — thùng
 * `server/db/index.ts` `export * from "./auth"`). Nó **đã được vá** sang dạng factory trong cùng
 * lượt này, nên tập vi phạm hôm nay là **RỖNG** — và chốt một con số đang bằng 0 thì rẻ.
 *
 * ⚠ **PHẠM VI CÓ CHỦ Ý HẸP.** Không áp cơ chế cho cả 1.526 lượt `vi.mock` của repo: Pha 8 đã đo
 *   rằng một tập ngoại lệ 624 phần tử **không phải một cổng**. Ở đây lượng từ chỉ nói về đúng bề
 *   mặt mà một lượt im lặng **mở được một cổng an ninh**.
 */
import { describe, it, expect, vi } from "vitest";

/**
 * ⚠⚠⚠ **DÒNG NÀY LÀ VẬT LIỆU CỦA §3, KHÔNG PHẢI MỘT LƯỢT TIỆN TAY.** File này **cố ý** automock
 * đúng cái thùng mà lượng từ cấm, để §3 chứng minh **bằng hành vi** rằng hình dạng ấy im lặng.
 * Nó được tha khỏi §4 bằng **`import.meta.url`** — một cơ chế, không phải một danh sách đường dẫn:
 * một file MỚI không thể tự cấp cho mình quyền ấy, và §4b ghim rằng tập được tha có **đúng một**
 * phần tử và nó **chính là file này**.
 */
vi.mock("../db");

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as db from "../db";
import { biChanBoiCongDoiMatKhau } from "@shared/buocDoiMatKhau";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");
const CHINH_FILE = fileURLToPath(import.meta.url);

/** Module khai **mọi** vị từ an ninh của tầng `db` (mật khẩu · phiên · bí mật · mã dự phòng). */
const FILE_VI_TU_AN_NINH = resolve(GOC, "server", "db", "auth.ts");

const duong = (f: string): string => relative(GOC, f).split(sep).join("/");

function moiFileTest(goc: string, ra: string[] = []): string[] {
  if (!existsSync(goc)) return ra;
  for (const e of readdirSync(goc, { withFileTypes: true })) {
    const p = join(goc, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") moiFileTest(p, ra);
    } else if (e.name.endsWith(".test.ts")) ra.push(p);
  }
  return ra;
}

/**
 * Mọi lượt **RE-EXPORT** của một file (`export * from "x"` / `export {a} from "x"`).
 *
 * ⚠⚠ **CHỈ re-export, KHÔNG import.** Đây là chỗ phép đo thứ hai của tôi nói dối: `vi.mock(M)` thay
 *    **bề mặt xuất của M**, nên chỉ những gì M **xuất lại** mới bị nuốt theo. Một lượt `import` là
 *    một phụ thuộc **bên trong** M, và automock **không** chạm tới nó.
 */
function doiCanhReExport(ma: string): string[] {
  const sf = ts.createSourceFile("x.ts", ma, ts.ScriptTarget.Latest, true);
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      ra.push(n.moduleSpecifier.text);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Bản đọc-đĩa của {@link doiCanhReExport} — một bộ suy, hai người gọi. */
const moiReExport = (f: string): string[] => doiCanhReExport(readFileSync(f, "utf8"));

/** Phân giải một đường nhập **tương đối** thành file thật (bài học R1b: nối đường, không so chuỗi). */
function phanGiai(tu: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const p = resolve(dirname(tu), spec);
  for (const c of [p, `${p}.ts`, `${p}.tsx`, join(p, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Bao đóng **BỀ MẶT XUẤT** của một module — đi theo cạnh re-export. */
function beMatXuat(goc: string): Set<string> {
  const tham = new Set<string>();
  const hd = [goc];
  while (hd.length > 0) {
    const f = hd.pop()!;
    if (tham.has(f) || !existsSync(f)) continue;
    tham.add(f);
    for (const s of moiReExport(f)) {
      const r = phanGiai(f, s);
      if (r !== null && !tham.has(r)) hd.push(r);
    }
  }
  return tham;
}

export type LuotAutomock = { file: string; dong: number; spec: string; dich: string | null };

/** Mọi `vi.mock(<chuỗi>)` **một đối số** (⇒ automock) trong một nguồn. */
function moiAutomock(fileThat: string, ma: string): LuotAutomock[] {
  const sf = ts.createSourceFile(fileThat, ma, ts.ScriptTarget.Latest, true);
  const ra: LuotAutomock[] = [];
  const di = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      n.expression.name.text === "mock" &&
      n.arguments.length === 1 &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const spec = n.arguments[0].text;
      ra.push({
        file: fileThat,
        dong: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
        spec,
        dich: phanGiai(fileThat, spec),
      });
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/** Lượt automock này có nuốt một vị từ an ninh không. */
const nuotViTuAnNinh = (m: LuotAutomock): boolean =>
  m.dich !== null && beMatXuat(m.dich).has(FILE_VI_TU_AN_NINH);

const MOI_FILE_TEST = moiFileTest(join(GOC, "server"));
const MOI_AUTOMOCK = MOI_FILE_TEST.flatMap((f) => moiAutomock(f, readFileSync(f, "utf8")));
/** Tha **đúng file này** — vật liệu của §3. Cơ chế, không phải danh sách (xem §4b). */
const THA = MOI_AUTOMOCK.filter((m) => resolve(m.file) === resolve(CHINH_FILE));
const nhan = (m: LuotAutomock) => `${duong(m.file)}:${m.dong}  ← ${m.spec}`;

describe("★★★★ Pha 9 I-2 §1 — CẦU CHÌ: thước còn sống và thấy kho mã thật", () => {
  it("★★★ quét ra đủ nhiều file test và đủ nhiều lượt automock", () => {
    /**
     * ⚠⚠ Glob rỗng ⇒ vitest im lặng khai XANH (**đã sáu lần**). Không có ô này, §4 xanh vì đi tìm
     *    thứ không có ở nơi nó nhìn.
     */
    expect(MOI_FILE_TEST.length, "quét `server/**` ra quá ít file test — phạm vi đã hỏng?").toBeGreaterThanOrEqual(300);
    expect(
      MOI_AUTOMOCK.length,
      "0 lượt `vi.mock` một-đối-số trong toàn `server/**` — bộ nhận diện đã chết (đo được 2026-08-12: 30)",
    ).toBeGreaterThanOrEqual(20);
  });

  it("★★★ file khai vị từ an ninh TỒN TẠI (lượng từ neo vào một file THẬT)", () => {
    expect(existsSync(FILE_VI_TU_AN_NINH), `${duong(FILE_VI_TU_AN_NINH)} không còn — lượng từ mất mỏ neo`).toBe(true);
  });
});

describe("★★★★ Pha 9 I-2 §2 — HIỆU CHUẨN bằng ĐÁP SỐ BIẾT TRƯỚC (gồm hai lượt thiết bị nói dối)", () => {
  it("★★★ đáp số biết trước: thùng `server/db/index.ts` CÓ nuốt `db/auth.ts`", () => {
    const thung = resolve(GOC, "server", "db", "index.ts");
    expect(existsSync(thung)).toBe(true);
    expect(
      beMatXuat(thung).has(FILE_VI_TU_AN_NINH),
      "thùng `db` `export * from \"./auth\"` mà thước khai KHÔNG nuốt ⇒ thước đã mù, mọi màu xanh dưới vô nghĩa",
    ).toBe(true);
  });

  it("★★★★ §2b thước phân biệt RE-EXPORT với IMPORT (lượt đo thứ hai của tôi sai đúng chỗ này)", () => {
    /**
     * ⚠⚠⚠ Vị từ đầu của tôi đi theo **lượt nhập** ⇒ **9** vi phạm; đi theo **re-export** ⇒ **1**.
     *    Tám cái kia là dương tính giả **mang đúng hình dạng của một kết luận thật** — đúng lớp lỗi
     *    nguy hiểm nhất của chuỗi pha này. Hai module dựng sẵn dưới đây ghim rằng thước hết mắc.
     */
    const maNhap = `import { getUserById } from "./auth";\nexport function f(){ return getUserById; }`;
    const maReExport = `export * from "./auth";`;
    expect(
      doiCanhReExport(maNhap),
      "một lượt IMPORT bị đếm là re-export ⇒ thước sinh dương tính giả (đã đo: 9 thay vì 1)",
    ).toEqual([]);
    expect(
      doiCanhReExport(maReExport),
      "một lượt RE-EXPORT KHÔNG được đếm ⇒ thước mù với đúng cạnh nguy hiểm",
    ).toEqual(["./auth"]);
  });

  it("★★★ thước phân biệt AUTOMOCK với FACTORY (1 đối số vs 2)", () => {
    const automock = `vi.mock("../db");`;
    const factory = `vi.mock("../db", () => ({ getUserById: vi.fn() }));`;
    const gia = resolve(GOC, "server", "_core", "__tong_hop.test.ts");
    expect(moiAutomock(gia, automock).length, "thước mù với một lượt automock THẬT").toBe(1);
    expect(
      moiAutomock(gia, factory).length,
      "một `vi.mock` CÓ factory bị đếm là automock ⇒ lượng từ sẽ đòi sửa đúng hình dạng ĐÃ AN TOÀN",
    ).toBe(0);
  });

  it("★★★★ M3 — một lượt automock MỚI trong FILE CHƯA TỒN TẠI ⇒ vẫn bị bắt", () => {
    /**
     * ⚠⚠ Ca phân biệt *"lưới theo ĐƯỜNG THOÁT"* với *"lưới theo FILE"*: `moiAutomock` nhận một
     *    nguồn bất kỳ, nên nguồn của một file chưa có trên đĩa vẫn vào được lượng từ.
     */
    const FILE_MOI = resolve(GOC, "server", "routers", "luoiMoiChuaTonTai.test.ts");
    const ma = `import { vi } from "vitest";\nvi.mock("../db");\nvi.mock("../db/connection");`;
    const themVao = moiAutomock(FILE_MOI, ma);
    expect(themVao.length, "lượt automock trong file mới rơi khỏi lượng từ").toBe(2);
    const pham = themVao.filter(nuotViTuAnNinh);
    expect(
      pham.map(nhan).length,
      "một lượt `vi.mock` thùng `db` MỚI không bị bắt ⇒ lưới đang canh theo FILE, không theo hình dạng",
    ).toBe(1);
    expect(pham[0]!.spec, "bắt nhầm module — `db/connection` KHÔNG xuất lại `db/auth`").toBe("../db");
  });
});

describe("★★★★ Pha 9 I-2 §3 — HÀNH VI: automock IM LẶNG, và nó mở được một cổng", () => {
  /**
   * ⚠⚠⚠ Cả khối này chạy dưới `vi.mock("../db")` **thật** ở đầu file — không phải một bản mô phỏng
   *    hình dạng automock. Đo một bản mô phỏng rồi kết luận về thứ thật là đúng lớp lỗi đã đẻ 26
   *    lượt thiết bị nói dối trong chuỗi pha này.
   */
  it("★★★★ khoá CÓ MẶT, là HÀM, và trả `undefined` — không một `TypeError` nào", async () => {
    expect(typeof (db as unknown as Record<string, unknown>).phaiDoiMatKhau, "automock không dựng được khoá ⇒ tiền đề của §3 sai").toBe("function");
    expect(await (db as unknown as { phaiDoiMatKhau: (i: number) => Promise<unknown> }).phaiDoiMatKhau(1)).toBeUndefined();
    expect(await (db as unknown as { getSessionByToken: (t: string) => Promise<unknown> }).getSessionByToken("x")).toBeUndefined();
  });

  it("★★★★ và `undefined` ấy MỞ cổng buộc-đổi-mật-khẩu — im lặng", () => {
    expect(
      biChanBoiCongDoiMatKhau("user", undefined as unknown as boolean),
      "vị từ cổng đã đổi hành vi với `undefined` — đọc lại lý lẽ của lưới này trước khi sửa con số",
    ).toBe(false);
  });

  it("★★★ ĐỐI CHỨNG: cổng THU HỒI PHIÊN thì fail-closed dưới cùng một automock", async () => {
    /**
     * ⚠ Không có ô này, §3 đọc thành *"automock mở MỌI cổng"* — sai. `chanNeuPhienDaThuHoi` đọc
     *   `getSessionByToken` ⇒ `undefined` ⇒ nhánh *"không có hàng"* ⇒ **NÉM** (lượt siết 2026-08-11).
     *   Hai cổng, hai hành vi, dưới **cùng một** bản giả: đó là thứ phân biệt một lỗ THẬT với một
     *   lời than chung chung.
     */
    const { chanNeuPhaiDoiMatKhau, chanNeuPhienDaThuHoi } = await import("./sdk");
    let loiMatKhau: string | null = null;
    try {
      await chanNeuPhaiDoiMatKhau({ id: 1, role: "user" } as never);
    } catch (e) {
      loiMatKhau = String((e as Error).message);
    }
    expect(
      loiMatKhau,
      "cổng mật khẩu NÉM dưới automock ⇒ lỗ I-2 đã đóng theo một đường khác; đọc lại lưới này",
    ).toBeNull();

    let loiPhien: string | null = null;
    try {
      await chanNeuPhienDaThuHoi("mot-ve-bat-ky");
    } catch (e) {
      loiPhien = String((e as Error).message);
    }
    expect(loiPhien, "cổng thu hồi phiên KHÔNG ném dưới automock ⇒ lượt siết 0318 đã bị gỡ").not.toBeNull();
    expect(loiPhien).toMatch(/SESSION_NOT_IN_LEDGER/);
  });
});

describe("★★★★ Pha 9 I-2 §4 — LƯỢNG TỪ CHÍNH", () => {
  it("★★★★ ∀ `vi.mock` KHÔNG factory: bề mặt xuất của module đích không chứa `server/db/auth.ts`", () => {
    const pham = MOI_AUTOMOCK.filter((m) => nuotViTuAnNinh(m) && !THA.includes(m));
    expect(
      pham.map(nhan).sort(),
      [
        "Một lượt `vi.mock(<đường dẫn>)` KHÔNG có factory nuốt trọn bề mặt của `server/db/auth.ts`.",
        "⚠ Automock thay MỌI export bằng một spy TỒN TẠI trả `undefined` ⇒ khoá CÓ MẶT, không",
        "  `TypeError` nào, và một vị từ an ninh đọc `undefined` sẽ CHO QUA — im lặng (đo ở §3).",
        "⇒ Cách đúng: đổi sang dạng FACTORY và khai đúng những khoá file này cần:",
        '     vi.mock("<đường dẫn>", () => ({ tenKhoa: vi.fn() }));',
        "  Khoá thiếu khi ấy là khoá VẮNG MẶT ⇒ `x is not a function` ⇒ ồn ào, có vết ngăn xếp.",
        "⚠ KHÔNG nới lượng từ này ra 1.526 lượt `vi.mock` của repo: Pha 8 đã đo rằng một tập ngoại",
        "  lệ 624 phần tử KHÔNG phải một cổng. Nó chỉ nói về bề mặt mở được một cổng an ninh.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("★★★★ §4b tập được THA có ĐÚNG MỘT phần tử, và nó chính là file này", () => {
    /**
     * ⚠⚠⚠ Không có ô này, `THA` là một cửa sau: ai thêm `vi.mock("../db")` vào một file khác chỉ
     *    cần lưới không nhìn tới. Cơ chế tha là **`import.meta.url`** — một file MỚI không thể tự
     *    cấp cho mình quyền ấy — và ô này ghim rằng cơ chế ấy chưa bị nới thành một danh sách.
     */
    expect(THA.length, "tập THA đã đổi kích thước — một cửa sau vừa mở, hoặc §3 đã mất vật liệu").toBe(1);
    expect(duong(THA[0]!.file)).toBe("server/_core/mockKhongFactory.test.ts");
    expect(THA[0]!.spec, "file này phải automock đúng thùng `db` — đó là vật liệu của §3").toBe("../db");
    expect(nuotViTuAnNinh(THA[0]!), "lượt automock của chính file này KHÔNG còn nuốt `db/auth` ⇒ §3 đo một tiền đề sai").toBe(true);
  });
});
