/**
 * ★ 2026-11-03 (do-model, dieu-phoi duyệt) — GỐC THƯ MỤC TẠM của MỘT lượt vitest: `%TEMP%/aoi-vitest/<pid>-<ngẫu nhiên>/`.
 *
 * Đo 2026-11-03: `vitest.setup.ts` từng `mkdtemp` HAI thư mục (`vitest-rml-pending-*`, `vitest-khoa-khe-*`) thẳng dưới `os.tmpdir()`
 * cho MỖI tệp test và không bao giờ xoá ⇒ %TEMP% phình 1,28 triệu mục ⇒ `lstat(%TEMP%)` 300–600 ms ⇒ mọi test dùng repo tạm
 * (grep census, phát lại fixture…) đỏ chập chờn theo tải. Nay: thư mục tạm của setup nằm DƯỚI gốc của lượt (`inject("aoiTamLuot")`),
 * mỗi tệp tự xoá phần của mình ở `afterAll`; teardown ở đây xoá cả gốc lượt (lưới an toàn khi một tiến trình con bị giết).
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

declare module "vitest" {
  export interface ProvidedContext {
    aoiTamLuot: string;
  }
}

/** Thư mục cha DUY NHẤT dưới `os.tmpdir()` mà lưới được tạo (không mục nào khác ở gốc %TEMP%). */
export const TEN_GOC_TAM_LUOI = "aoi-vitest";

export default function setup({ provide }: { provide: (k: "aoiTamLuot", v: string) => void }): () => void {
  const goc = resolve(tmpdir(), TEN_GOC_TAM_LUOI);
  mkdirSync(goc, { recursive: true });
  const luot = mkdtempSync(resolve(goc, `${process.pid}-`));
  provide("aoiTamLuot", luot);
  return () => {
    try {
      rmSync(luot, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* best-effort: còn sót thì vẫn nằm trong aoi-vitest/, không ở gốc %TEMP% */
    }
  };
}
