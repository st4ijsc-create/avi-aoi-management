/**
 * Dựng cây thư mục cố định trên đĩa THẬT (scratchpad, KHÔNG phải `sandbox-projects/`) cho lưới
 * real-host. Chạy TRƯỚC khi VSCode mở (từ `runTest.ts`, tiến trình Node bình thường — không phải
 * extension host), nên được dùng `node:fs` tự do — tệp này nằm NGOÀI `vscode-extension/src/`.
 *
 * ⚠ Mỗi ca lưới có TỆP RIÊNG, không dùng chung — hai tệp lưới cùng ghi/đọc một tệp trong CÙNG một
 *   lượt chạy VSCode thật (Mocha nạp mọi *.test.js vào MỘT process) sẽ giẫm lên nhau.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const TEN = {
  // dùng bởi writeDiskReal.test.ts
  GHI_OK: "ghi-that-1.txt",
  GHI_XUNG_DOT: "ghi-that-2.txt",
  // dùng bởi eolBom.test.ts
  EOL_CRLF: "eol-crlf.txt",
  EOL_LF: "eol-lf.txt",
  EOL_BOM: "eol-bom.txt",
  EOL_BOM_DONG2: "eol-bom-dong2.txt",
  EOL_MIXED: "eol-mixed.txt",
  // dùng bởi diffProvider.test.ts
  VN: "Tệp tiếng Việt có dấu.txt",
};

export const NOI_DUNG = {
  GHI_OK: "dong 1\ndong 2\ndong 3\n",
  GHI_XUNG_DOT: "chi mot dong\n",
  EOL_CRLF: "L1\r\nL2\r\nL3\r\n",
  EOL_LF: "P1\nP2\nP3\n",
  // Thân LF-thuần đi SAU ba byte BOM (ghép ở `prepareSingleRoot`) — KHÔNG gõ ký tự BOM trực tiếp
  // vào mã nguồn TS (dễ bị công cụ/EOL của git nuốt mất mà không ai thấy).
  EOL_BOM_BODY: "L1\nL2\nL3\n",
  EOL_MIXED: "M1\r\nM2\nM3\r\nM4\n",
  VN: "Nội dung có dấu: ăâêôơư đ — dòng gốc\n",
};

const BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);

export function prepareSingleRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, TEN.GHI_OK), NOI_DUNG.GHI_OK, "utf8");
  writeFileSync(join(root, TEN.GHI_XUNG_DOT), NOI_DUNG.GHI_XUNG_DOT, "utf8");
  writeFileSync(join(root, TEN.EOL_CRLF), NOI_DUNG.EOL_CRLF, "utf8");
  writeFileSync(join(root, TEN.EOL_LF), NOI_DUNG.EOL_LF, "utf8");
  // BOM thật: ghi BUFFER (3 byte BOM + nội dung utf8), không dựa vào chuỗi JS tự thêm BOM.
  const bomFile = Buffer.concat([BOM_BYTES, Buffer.from(NOI_DUNG.EOL_BOM_BODY, "utf8")]);
  writeFileSync(join(root, TEN.EOL_BOM), bomFile);
  writeFileSync(join(root, TEN.EOL_BOM_DONG2), bomFile);
  writeFileSync(join(root, TEN.EOL_MIXED), NOI_DUNG.EOL_MIXED, "utf8");
  writeFileSync(join(root, TEN.VN), NOI_DUNG.VN, "utf8");
}

/** Workspace HAI GỐC: `app/x.ts` và `lib/x.ts` cùng tồn tại THẬT — đúng ca `giaiDuongDeXuat` phải từ chối. */
export function prepareMultiRoot(base: string): { wsFile: string; appRoot: string; libRoot: string } {
  rmSync(base, { recursive: true, force: true });
  const appRoot = join(base, "app");
  const libRoot = join(base, "lib");
  mkdirSync(appRoot, { recursive: true });
  mkdirSync(libRoot, { recursive: true });
  writeFileSync(join(appRoot, "x.ts"), 'export const goc = "app";\n', "utf8");
  writeFileSync(join(libRoot, "x.ts"), 'export const goc = "lib";\n', "utf8");
  // Chỉ tồn tại ở MỘT gốc (lib/) — dùng để đo nhánh "khớp đúng 1 ứng viên, dù không phải gốc đang
  // chọn" của `giaiDuongDeXuat`, khác hẳn ca "x.ts" (khớp CẢ HAI, phải từ chối) ở trên.
  writeFileSync(join(libRoot, "only-in-lib.ts"), 'export const chiO = "lib";\n', "utf8");
  const wsFile = join(base, "hai-goc.code-workspace");
  writeFileSync(wsFile, JSON.stringify({ folders: [{ path: "app" }, { path: "lib" }] }, null, 2), "utf8");
  return { wsFile, appRoot, libRoot };
}
