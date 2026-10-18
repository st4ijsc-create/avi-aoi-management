/**
 * ★★★ 2026-10-19 — TỆP CẤU HÌNH NuGet OFFLINE do MÁY CHỦ sở hữu (không phải tệp của dự án/workspace).
 *
 * Dùng bởi `aiLocalTools/repoCommandSandbox.ts` (`thamSoRestoreOffline`): restore của `dotnet build|test|restore` trỏ
 * `-p:RestoreConfigFile=<tệp này>` ⇒ NuGet KHÔNG đọc chuỗi cấu hình (nuget.config trong dự án do model ghi được, cấu
 * hình người dùng có nuget.org) mà chỉ đọc tệp này: `<clear/>` nguồn gói + thư mục dự phòng. Lý lẽ đầy đủ + quyết định
 * rủi ro: khối "RESTORE NuGet OFFLINE" ở `repoCommandSandbox.ts`.
 *
 * ⚠ Vì sao ở NGOÀI `aiLocalTools/`: lưới `programmingFileIo.census.test.ts` ghim rằng MỌI lượt chạm byte TRONG cây ấy
 *   đều là truy cập WORKSPACE đi qua hai cửa `readConfined`/`writeConfined`. Tệp này không thuộc workspace nào — nó ở
 *   thư mục tạm của máy chủ, nội dung là HẰNG của mã, đường không nhận đầu vào nào từ model.
 * ⚠ XML: chú thích KHÔNG được chứa `--` (NuGet từ chối "not valid XML" — lưới chạy thật đã bắt lần đầu).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const NOI_DUNG_NUGET_OFFLINE =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  "<!-- Sinh bởi máy chủ AI Local (nugetOfflineCauHinh.ts) — restore OFFLINE: không nguồn nào ngoài tham số source của máy chủ. -->\n" +
  "<configuration>\n" +
  "  <packageSources>\n    <clear />\n  </packageSources>\n" +
  "  <fallbackPackageFolders>\n    <clear />\n  </fallbackPackageFolders>\n" +
  "</configuration>\n";

/** Đường tệp (thư mục tạm của MÁY CHỦ — ngoài mọi dự án, hộp cát ghi của agent không với tới). */
export function duongCauHinhNugetOffline(): string {
  return path.join(os.tmpdir(), "ai-local-nuget", "NuGet.offline.config");
}

/**
 * Bảo đảm tệp tồn tại với ĐÚNG nội dung — lệch (ai sửa tay/chèn nguồn) ⇒ ghi lại (ghi tạm + đổi tên). Đọc mỗi lần gọi,
 * không nhớ đệm. `null` ⇔ không ghi được (phía gọi lùi về hành vi an toàn).
 */
export function damBaoCauHinhNugetOffline(): string | null {
  const p = duongCauHinhNugetOffline();
  try {
    if (readFileSync(p, "utf8") === NOI_DUNG_NUGET_OFFLINE) return p;
  } catch {
    /* chưa có ⇒ ghi */
  }
  try {
    mkdirSync(path.dirname(p), { recursive: true });
    const tam = `${p}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tam, NOI_DUNG_NUGET_OFFLINE, "utf8");
    renameSync(tam, p);
    return p;
  } catch {
    return null;
  }
}
