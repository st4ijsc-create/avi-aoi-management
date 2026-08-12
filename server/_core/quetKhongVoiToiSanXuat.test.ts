/**
 * ★★★★ Pha 9 nhóm B · **B7a — "MÃ SẢN XUẤT CHỈ PHỤC VỤ LƯỚI": ĐO CÁI HẠI, ĐỪNG DỌN CÁI CHỖ.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐỀ BÀI BAN ĐẦU LÀ "ĐƯA `quetDiemXacThuc.ts` VỀ ĐÚNG CHỖ". PHÉP ĐO ĐỔI HẲN BẢN VÁ.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/_core/quetDiemXacThuc.ts` là mã **sản xuất** (không phải `*.test.ts`) mà **chỉ** hai lưới
 * dùng. Đúng. Nhưng đếm thật thì nó **không đơn độc** — có **BỐN** module cùng hình dạng:
 *
 *     server/_core/quetDiemXacThuc.ts          server/routers/hoXacThucScan.ts
 *     server/routers/deployProcedureScan.ts    server/services/vram/vramStateFieldPaths.ts
 *
 * Chúng nằm ở **ba** thư mục khác nhau. ⇒ Dời một file sang một thư mục "đúng" **không tạo ra một
 * biên giới cưỡng chế được** — nó chỉ dời một file, và ba file kia (cộng file thứ năm ai đó viết
 * tuần sau) vẫn ở nguyên chỗ cũ. Đây đúng lớp lỗi *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CÁI HẠI THẬT LÀ GÌ — VÀ NÓ LÀ MỘT CON SỐ, KHÔNG PHẢI MỘT CẢM GIÁC VỀ KIẾN TRÚC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cả bốn module đều `import ts from "typescript"`. Và `typescript@5.9.3` nằm trong
 * **`devDependencies`**, KHÔNG phải `dependencies`. Lượt `build` chạy esbuild với
 * `--packages=external`, tức **không gói** thư viện nào vào `dist/` — mọi lượt nhập trở thành một
 * lượt nạp **lúc chạy**. ⇒ Nếu **một** module sản xuất có đường tới một trong bốn file này, thì:
 *
 *   · máy phát triển: **chạy tốt** (`node_modules` có đủ cả devDependencies) — nên không ai thấy;
 *   · máy sản xuất (`npm ci --omit=dev`): `Cannot find module 'typescript'` ⇒ **máy chủ không boot**.
 *
 * Đó là một lỗi **chỉ xuất hiện ở nơi không ai ngồi xem**, y hệt cơ chế của B5 (`npm run check`
 * OOM chỉ ở lượt chạy NGUỘI). ⇒ *"Đúng chỗ"* nay có một định nghĩa **kiểm được**:
 *
 *   ***∀ module CÓ ĐƯỜNG TỚI từ một điểm vào sản xuất: KHÔNG được nhập `typescript`.***
 *
 * Không phải *"file quét phải nằm ở thư mục X"* — mà *"file quét phải KHÔNG VỚI TỚI ĐƯỢC"*. Bốn
 * module trên thoả điều kiện ấy hôm nay, nên chúng **đã ở đúng chỗ**, và ô dưới đây là thứ giữ cho
 * điều đó còn đúng ngày mai.
 *
 * ⚠⚠ VÌ SAO ĐÂY LÀ MỘT CỔNG THẬT CHỨ KHÔNG PHẢI MỘT ẢNH CHỤP: số vi phạm hôm nay là **0**. Bài học
 *    §4c của `hangRaoKhongAiCanh.test.ts` nói đúng chuyện này — một tập ngoại lệ 624 phần tử không
 *    phải một cổng; một lượng từ có **0** ngoại lệ thì là.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ MỘT LỖI THIẾT BỊ ĐÃ ĐO ĐƯỢC TRONG CHÍNH LƯỢT DỰNG LƯỚI NÀY — VÀ NÓ SUÝT ĐẺ RA MỘT BÁO ĐỘNG
 *    CÓ **ĐÚNG HÌNH DẠNG** MỘT PHÁT HIỆN THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản dò đầu tiên hỏi `git grep -l "deployProcedureScan"` và tìm thấy `server/_core/trpc.ts` cùng
 * `server/routers/vramRouter.ts` — **hai file chạy thật, ở lõi tRPC**. Kết luận suýt viết ra:
 * *"lõi tRPC kéo `typescript` vào bản chạy sản xuất"*. Đọc lại thì **cả hai chỉ nhắc tên trong
 * BÌNH LUẬN**, không có lượt nhập nào. Đúng bài học của nhóm A hôm nay: một ô dùng `indexOf`/`grep`
 * xanh-hay-đỏ theo **chuỗi trong bình luận**, không theo **cấu trúc**. ⇒ Lưới này đi bằng **AST**,
 * và phép với-tới đi theo **lượt nhập phân giải được trên đĩa**, không theo chính tả.
 *
 * ⚠ VÙNG MÙ ĐƯỢC KHAI:
 *  1. Phép với-tới chỉ đi theo **đường dẫn tương đối** phân giải được (`./x`, `../y`). Một lượt nạp
 *     qua alias runtime hoặc qua chuỗi dựng động nằm ngoài tầm.
 *  2. Ô này canh **`typescript`**, không canh mọi `devDependency`. Đo được: ba gói dev khác **có**
 *     bị nhập từ vùng với-tới (`vite`, `ws`, `pdf-parse`) — nhưng cả ba đều qua `await import(…)`
 *     **có điều kiện** hoặc `import type` (bị xoá lúc biên dịch), nên không phải điều kiện boot.
 *     Nới ô này ra cả `devDependencies` sẽ **bắt nhầm** ba chỗ ấy ⇒ ghi vào §Nợ mới, không nới.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const TEST_DIR = fileURLToPath(new URL(".", import.meta.url)); // …/server/_core
const GOC = join(TEST_DIR, "..", "..");

const PKG = JSON.parse(readFileSync(join(GOC, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * ★★★ Điểm vào sản xuất — **SUY TỪ script `build`**, không viết tay.
 * Thêm một `esbuild <entry>` vào `build` ⇒ điểm vào ấy tự vào lượng từ. Một danh sách viết tay ở
 * đây sẽ là danh sách có phần tử thứ N+1, và phần tử ấy là cái không được canh.
 */
function diemVaoSanXuat(): string[] {
  return [...PKG.scripts.build.matchAll(/esbuild\s+(\S+\.ts)/g)].map((m) => m[1]!);
}

/** Mọi đường nhập của một file (tĩnh · `export from` · `import()` động · `require`). */
function moiDuongNhap(that: string): string[] {
  const sf = ts.createSourceFile(that, readFileSync(that, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ra: string[] = [];
  const di = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
      ra.push(n.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require")) &&
      n.arguments[0] !== undefined &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      ra.push(n.arguments[0].text);
    }
    ts.forEachChild(n, di);
  };
  di(sf);
  return ra;
}

/**
 * ★★ Review TOÀN NHÁNH Pha 9 · **M-6 — ALIAS `tsconfig.paths` ĐƯỢC ĐI THEO, KHÔNG CHỈ ĐƯỜNG TƯƠNG ĐỐI.**
 *
 * Bản trước chỉ nhận `spec.startsWith(".")` ⇒ mọi lượt `import … from "@shared/x"` rơi khỏi bao
 * đóng. **Đo được**: bao đóng **1041** file theo đường tương đối; đi theo alias ⇒ **1051**; **10**
 * file bị bỏ sót, **toàn bộ** là `shared/**`.
 * ⚠ Cầu chì `VOI_TOI.size > 500` **KHÔNG THỂ** phát hiện mất mát ấy — 1041 ≫ 500. Đây đúng lớp
 *   *"cầu chì đặt ở ngưỡng không bao giờ chạm tới"*: nó canh *"bộ suy còn sống"*, không canh
 *   *"bộ suy còn ĐẦY ĐỦ"*.
 * ⚠ **VÔ HẠI HÔM NAY** (0/10 file ấy nhập `typescript` — chính phép đo ấy đã hạ nghi ngờ R-1 từ
 *   Important xuống Minor), nhưng một module quét AST đặt ở `shared/` sẽ **vô hình**.
 * ⚠ Bảng alias đọc **từ chính `tsconfig.json`**, không chép lại vào đây: giữ một bản sao thứ hai
 *   thì chỉ chứng minh bản sao ấy đúng (cùng lý lẽ với `duongCuaCong()` của `vramPha5Gate`).
 */
const ALIAS: ReadonlyArray<{ tienTo: string; goc: string }> = (() => {
  const raw = readFileSync(join(GOC, "tsconfig.json"), "utf8");
  const cfg = ts.parseConfigFileTextToJson("tsconfig.json", raw).config as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  const paths = cfg?.compilerOptions?.paths ?? {};
  const base = resolve(GOC, cfg?.compilerOptions?.baseUrl ?? ".");
  const ra: { tienTo: string; goc: string }[] = [];
  for (const [mau, dich] of Object.entries(paths)) {
    if (!mau.endsWith("/*") || dich[0] === undefined || !dich[0].endsWith("/*")) continue;
    ra.push({ tienTo: mau.slice(0, -1), goc: resolve(base, dich[0].slice(0, -1)) });
  }
  return ra;
})();

/** Phân giải một đường nhập thành file thật trên đĩa (bài học R1b: nối đường, không so chuỗi). */
function phanGiai(tu: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith(".")) {
    p = resolve(dirname(tu), spec);
  } else {
    const a = ALIAS.find((x) => spec.startsWith(x.tienTo));
    if (a === undefined) return null;
    p = resolve(a.goc, spec.slice(a.tienTo.length));
  }
  for (const c of [p, `${p}.ts`, `${p}.tsx`, join(p, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Bao đóng bắc cầu của các điểm vào — **tập VỚI TỚI**. */
function voiToi(diemVao: readonly string[]): Set<string> {
  const tham = new Set<string>();
  const hd = diemVao.map((d) => resolve(GOC, d));
  while (hd.length > 0) {
    const f = hd.pop()!;
    if (tham.has(f) || !existsSync(f)) continue;
    tham.add(f);
    for (const s of moiDuongNhap(f)) {
      const r = phanGiai(f, s);
      if (r !== null && !tham.has(r)) hd.push(r);
    }
  }
  return tham;
}

const duong = (f: string): string => relative(GOC, f).split(sep).join("/");
/** Tên GÓI của một đường nhập (`typescript/lib/x` → `typescript`, `@a/b/c` → `@a/b`). */
const tenGoi = (s: string): string => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]!);

const DIEM_VAO = diemVaoSanXuat();
const VOI_TOI = voiToi(DIEM_VAO);

/** Bốn module quét — **suy từ đĩa**, không liệt kê: mọi `.ts` không-test dưới `server/` nhập `typescript`. */
function moiFileTs(goc: string): string[] {
  const ra: string[] = [];
  const di = (d: string): void => {
    for (const e of require("node:fs").readdirSync(d, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") di(p);
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
        ra.push(p);
      }
    }
  };
  di(join(goc, "server"));
  return ra;
}
const MODULE_QUET = moiFileTs(GOC)
  .filter((f) => !/\.test\.ts$/.test(f) && !/\.spec\.ts$/.test(f))
  .filter((f) => moiDuongNhap(f).some((s) => tenGoi(s) === "typescript"))
  .map(duong)
  .sort();

describe("★★★ Pha 9 B7a §0 — CẦU CHÌ: lượng từ này KHÔNG được thoả rỗng", () => {
  it("★★★ script `build` phải cho ra ≥1 điểm vào, và cả ba đều tồn tại trên đĩa", () => {
    expect(DIEM_VAO.length, "không rút được điểm vào nào khỏi script `build` — nó đã đổi hình dạng?").toBeGreaterThan(0);
    const thieu = DIEM_VAO.filter((d) => !existsSync(resolve(GOC, d)));
    expect(thieu.join(" · "), "một điểm vào của script `build` không tồn tại trên đĩa").toBe("");
  });

  it("★★★ tập VỚI TỚI phải lớn — một tập rỗng làm mọi ô dưới đây xanh một cách vô nghĩa", () => {
    /**
     * ⚠⚠ Đây là ô chống đúng cái đã xảy ra SÁU lần trong chuỗi pha: **glob rỗng ⇒ vitest im lặng và
     *    khai XANH**. Nếu `phanGiai` hỏng (đổi đuôi file, đổi cách nối đường) thì `VOI_TOI` co về
     *    đúng 3 điểm vào và ô ∀ bên dưới **xanh vì đi tìm thứ không có ở nơi nó nhìn**.
     * ⚠ Ngưỡng cố ý ĐẶT THẤP (500) so với số đo hôm nay (1041): nó canh *"bộ suy còn sống"*, không
     *   canh *"kho mã có đúng bấy nhiêu file"* — con số sau đổi mỗi tuần và sẽ thành một lượt
     *   "cập nhật con số" vô nghĩa.
     */
    expect(VOI_TOI.size, "bao đóng với-tới co lại bất thường ⇒ `phanGiai` đã mù, mọi ô dưới vô nghĩa").toBeGreaterThan(500);

    /**
     * ★★ Review TOÀN NHÁNH Pha 9 · **M-6 — CẦU CHÌ THỨ HAI: NHÁNH ALIAS PHẢI CÒN SỐNG.**
     * ⚠⚠ Ngưỡng 500 ở trên **không thể** phát hiện lượt mù alias (đo được: 1041 khi mù, 1051 khi
     *    sáng — cả hai đều ≫ 500). Đây đúng lớp *"cầu chì đặt ở ngưỡng không bao giờ chạm tới"*.
     *    Ô này hỏi thẳng: bao đóng có chứa **ít nhất một** file `shared/**` không — tập **chỉ với
     *    tới được qua alias** (đo được: **10** file, toàn bộ `shared/**`).
     */
    expect(ALIAS.length, "không đọc được alias nào từ `tsconfig.json` — nhánh alias của `phanGiai` là mã chết").toBeGreaterThan(0);
    expect(
      [...VOI_TOI].filter((f) => duong(f).startsWith("shared/")).length,
      "bao đóng KHÔNG chứa file `shared/**` nào ⇒ `phanGiai` đã mù với alias `@shared/*` trở lại",
    ).toBeGreaterThan(0);
  });

  it("★★★ phải TÌM RA các module quét nhập `typescript` — nếu 0 thì bộ nhận diện đã chết", () => {
    /**
     * ⚠⚠ Đối chứng DƯƠNG của phép nhận diện: ô ∀ bên dưới nói *"không module VỚI TỚI nào nhập
     *    `typescript`"*. Ô ấy cũng xanh nếu phép đọc lượt nhập hỏng hoàn toàn. Ô này khẳng định
     *    chiều ngược lại trên cùng bộ suy: repo **có thật** những file nhập `typescript`.
     */
    expect(
      MODULE_QUET.length,
      "không file `.ts` sản xuất nào dưới `server/` nhập `typescript` ⇒ `moiDuongNhap` đã mù",
    ).toBeGreaterThanOrEqual(4);
  });
});

describe("★★★★ Pha 9 B7a §1 — ∀ TUYỆT ĐỐI: không module VỚI TỚI nào nhập `typescript`", () => {
  it("★★★★ `typescript` là devDependency ⇒ một lượt nhập từ vùng với-tới là một máy chủ KHÔNG BOOT ĐƯỢC", () => {
    expect(
      PKG.devDependencies?.typescript !== undefined && PKG.dependencies?.typescript === undefined,
      "`typescript` đã chuyển sang `dependencies` — nếu đó là quyết định có chủ ý thì ô này mất lý do\n" +
        "tồn tại và phải được gỡ kèm lý do; đừng để nó đứng đó canh một tiền đề không còn đúng.",
    ).toBe(true);

    const pham: string[] = [];
    for (const f of VOI_TOI) {
      for (const s of moiDuongNhap(f)) if (tenGoi(s) === "typescript") pham.push(`${duong(f)}  ← ${s}`);
    }
    expect(
      pham.sort().join("\n"),
      "MỘT MODULE CÓ ĐƯỜNG TỚI TỪ ĐIỂM VÀO SẢN XUẤT ĐANG NHẬP `typescript`.\n" +
        "⚠ `typescript` nằm trong `devDependencies`, và `npm run build` chạy esbuild với\n" +
        "  `--packages=external` ⇒ lượt nhập này trở thành một lượt nạp LÚC CHẠY.\n" +
        "⚠ Máy phát triển sẽ CHẠY TỐT (node_modules có đủ devDependencies) nên bạn sẽ không thấy gì.\n" +
        "  Máy sản xuất (`npm ci --omit=dev`) sẽ chết ở lượt boot: `Cannot find module 'typescript'`.\n" +
        "⇒ Module quét AST là công cụ của LƯỚI. Giữ nó KHÔNG VỚI TỚI ĐƯỢC: chỉ `*.test.ts` được\n" +
        "  nhập nó. Nếu mã sản xuất thật sự cần đọc AST thì đó là một quyết định phải NÓI RA.\n",
    ).toBe("");
  });

  it("★★★★ bốn module quét AST hôm nay đều KHÔNG VỚI TỚI (đối chứng dương, suy từ đĩa)", () => {
    const voiToiDuoc = MODULE_QUET.filter((d) => VOI_TOI.has(resolve(GOC, d)));
    expect(
      voiToiDuoc.join(" · "),
      "một module quét AST đã lọt vào vùng với-tới — xem thông điệp của ô trên",
    ).toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ §2 — PHÉP THỬ M3: lưới theo ĐƯỜNG THOÁT hay theo FILE?
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ô ∀ trên đọc đĩa. Ca dưới đây chạy **chính bộ suy ấy** trên một bao đóng **giả** để chứng minh nó
 * ĐỎ được — mà không phải viết một file rác vào repo. Không có ca này thì §1 là một ô *"xanh vì
 * hôm nay may mắn"*, và không ai biết nó còn răng hay không.
 * ══════════════════════════════════════════════════════════════════════════════════════════════ */
describe("★★★★ Pha 9 B7a §2 — M3: bộ suy có ĐỎ được không", () => {
  it("★★★★ một bao đóng CHỨA một module quét ⇒ phép nhận diện phải bắt", () => {
    expect(MODULE_QUET.length, "ca này cần ≥1 module quét thật làm vật liệu").toBeGreaterThan(0);
    const gia = new Set<string>([...VOI_TOI, resolve(GOC, MODULE_QUET[0]!)]);
    const pham: string[] = [];
    for (const f of gia) {
      for (const s of moiDuongNhap(f)) if (tenGoi(s) === "typescript") pham.push(duong(f));
    }
    expect(pham, "bao đóng giả CÓ chứa một module nhập `typescript` mà phép nhận diện không thấy ⇒ thước đã chết").toContain(
      MODULE_QUET[0],
    );
  });

  it("★★★★ phép VỚI TỚI đi theo LƯỢT NHẬP, không theo chính tả trong bình luận", () => {
    /**
     * ⚠⚠⚠ Đây là ca hiệu chuẩn của lỗi thiết bị đã đo được ở lượt dựng lưới này: `git grep` tìm thấy
     *    `deployProcedureScan` trong `server/_core/trpc.ts` và `server/routers/vramRouter.ts` — **hai
     *    file chạy thật** — và suýt đẻ ra kết luận *"lõi tRPC kéo `typescript` vào bản sản xuất"*.
     *    Cả hai chỉ **nhắc tên trong bình luận**. Ô này ghim rằng phép với-tới không mắc lỗi ấy.
     */
    const nhacTrongBinhLuan = ["server/_core/trpc.ts", "server/routers/vramRouter.ts"];
    for (const d of nhacTrongBinhLuan) {
      const that = resolve(GOC, d);
      expect(existsSync(that), `${d} phải tồn tại — ca hiệu chuẩn này neo vào nó`).toBe(true);
      expect(readFileSync(that, "utf8").includes("deployProcedureScan"), `${d} phải còn NHẮC tên ấy`).toBe(true);
      expect(
        moiDuongNhap(that).some((s) => s.includes("deployProcedureScan")),
        `${d} NHẮC \`deployProcedureScan\` trong bình luận nhưng KHÔNG nhập nó — nếu ô này đỏ thì một\n` +
          `lượt nhập THẬT vừa được thêm vào, và nó kéo \`typescript\` vào vùng với-tới.`,
      ).toBe(false);
    }
  });
});
