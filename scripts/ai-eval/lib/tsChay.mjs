/**
 * CHẠY TypeScript do model sinh — MỘT nơi quyết định cách node chạy .ts cho mọi bộ chấm (codegen-chay-duoc/cham.mjs,
 * ngau-nhien/multipl-e/chay.mjs; qua cham.mjs cả Training Studio "Eval mã" của máy chủ).
 *
 * ⚠ ĐO 2026-10-30: node tự nâng lên v26.13.0 — cờ `--experimental-transform-types` BỊ GỠ ("bad option") ⇒ ts 0/3 MỌI lượt
 *   (H lẫn M) = hiện vật công cụ, không phải model. Strip-only của v26 KHÔNG thay được: enum / thuộc tính tham số ⇒
 *   ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX ⇒ chấm OAN lời giải mà transform-types từng cho qua. Node có cờ ⇒ giữ y lệnh cũ;
 *   không có ⇒ esbuild (gói của repo, như runTsx) biến đổi ĐẦY ĐỦ ra JS rồi node chạy JS.
 * Census `coTsNode.census.test.ts`: chuỗi cờ chỉ được xuất hiện trong tệp này.
 */
export const CO_BIEN_DOI_TS = "--experimental-transform-types";

/** Node đang chạy còn nhận cờ biến đổi kiểu không (v22.7–v25 có; v26 gỡ). */
export function nodeCoBienDoiTs() {
  return process.allowedNodeEnvironmentFlags.has(CO_BIEN_DOI_TS);
}

/**
 * TS ⇒ JS bằng esbuild (biến đổi đầy đủ: enum, namespace, thuộc tính tham số). `format`: "esm" | "cjs".
 * Lỗi cú pháp ⇒ NÉM (người gọi chấm TRƯỢT kèm thông điệp) — không bao giờ "cho qua" mã không biên dịch được.
 */
export async function bienDoiTs(ma, format = "esm") {
  const esbuild = await import("esbuild");
  return (await esbuild.transform(ma, { loader: "ts", format, target: "node22" })).code;
}
