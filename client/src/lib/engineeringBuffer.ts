/**
 * Doc 25 T3 — logic buffer "chưa lưu" của Engineering Workspace, tách thuần để test.
 *
 * Validate/Build luôn chạy trên artifactId (bản đã lưu), KHÔNG phải buffer đang hiển thị.
 * Vì vậy khi buffer khác nội dung bản đã lưu (dirty) UI phải cảnh báo / chặn.
 */

/** Buffer soạn thảo khác nội dung bản đã lưu → có chỉnh sửa CHƯA LƯU. */
export function computeIsDirty(code: string, artifactContent: string | null | undefined): boolean {
  return code !== (artifactContent ?? "");
}
