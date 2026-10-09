/**
 * doc 81 Đợt 3b Task 2 fix 1 (R-3b-b (3)) — cổng `pass` của engineeringLayout.mjs, tách thành hàm THUẦN để test được
 * (engineeringLayout.mjs có shebang ⇒ vitest không nạp được). Dọn hàng mẫu (`meta.fixturesRemoved`) hay user đo
 * (`meta.probeUserRemoved`) HỎNG ⇒ pass=false và được in — trước đây lỗi dọn bị nuốt vào meta, hàng rò im lặng tới lần sau.
 */

/** Danh sách lỗi dọn (chuỗi để in); rỗng = dọn sạch. */
export function cleanupFailures(meta) {
  const out = [];
  if (meta?.fixturesRemoved?.error) out.push(`dọn hàng mẫu (uimetrics_) HỎNG: ${meta.fixturesRemoved.error}`);
  if (meta?.probeUserRemoved?.error) out.push(`dọn user đo HỎNG: ${meta.probeUserRemoved.error}`);
  return out;
}

/**
 * doc 81 Đợt 3b final wave (minor 4) — dòng in lỗi dọn, DÙNG CHUNG cho nhánh thường, nhánh lỗi (catch) và bộ xử lý tín hiệu:
 * rỗng khi dọn sạch, một dòng `✗ DỌN HỎNG …` khi hỏng.
 */
export function cleanupFailureLines(meta) {
  const f = cleanupFailures(meta);
  return f.length ? [`✗ DỌN HỎNG (pass=false): ${f.join(" | ")}`] : [];
}

/** Cổng pass của một lần đo (giữ NGUYÊN mọi điều kiện cũ + điều kiện dọn). */
export function runPass({ errors, meta, args }) {
  return (
    errors.length === 0 &&
    meta.outboundViolations.length === 0 &&
    cleanupFailures(meta).length === 0 &&
    (!!args["discover-tables"] ||
      (Object.keys(meta.data.drift).length === 0 &&
        meta.data.errors.length === 0 &&
        (!!args["no-selftest"] || !!meta.selfTest?.pass) &&
        (!args.mutation || !!meta.selfTest?.mutationPass)))
  );
}
