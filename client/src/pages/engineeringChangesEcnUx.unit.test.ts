/**
 * doc 80 Đợt 0 — Task 8 (ECN-03, ECN-05) — quét TĨNH `EngineeringChanges.tsx`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Hai điểm này KHÔNG kiểm được bằng test router trên server (server chỉ thấy
 * INPUT nó nhận được — không thấy client có "quên" gửi hay "quên" hỏi hay
 * không):
 *
 *  1. ECN-03 — CAS phía server (`ecnService.transitionEcn` so `status=
 *     $expectedStatus`) VÔ DỤNG nếu client không thực sự GỬI `expectedStatus`
 *     trên mỗi lượt gọi `ecn.transition`. Quét mọi lời gọi `transitionM.mutate(
 *     {...})` trong trang và đòi MỖI lời gọi mang `expectedStatus`.
 *
 *  2. ECN-05 — "duyệt/từ chối trên UI mở hộp xác nhận có ý kiến (bắt buộc với
 *     từ chối)" (task-8-brief.md). Trước bản vá, nút "Phê duyệt" gọi thẳng
 *     `transitionM.mutate(...)` trên một cú click — KHÔNG hộp thoại, không chỗ
 *     nhập ý kiến. Quét nguồn để chắc action "approve" đi qua state
 *     `approveTarget` (mở AlertDialog) như "reject" đã làm, và hộp Từ chối vẫn
 *     giữ ý kiến BẮT BUỘC (hành vi cũ — không hồi quy).
 *
 * MUTATION: gỡ nhánh `if (action === "approve") { … return; }` trong
 * `doTransition` (hoàn phê duyệt về gọi thẳng `transitionM.mutate`) ⇒ ca #2
 * đỏ; gỡ `expectedStatus` khỏi MỘT lời gọi mutate ⇒ ca #1 đỏ. Cả hai đã đo
 * (task-8-report.md).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const src = readFileSync(new URL("./EngineeringChanges.tsx", import.meta.url), "utf8");

/** Mọi lời gọi `transitionM.mutate(...)` trong trang, thân KHÔNG lồng dấu ngoặc nhọn khác
 *  (đủ dùng ở đây — không có object lồng nào trong payload transition). */
function transitionMutateCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /transitionM\.mutate\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const start = m.index;
    // Lấy 300 ký tự sau lời gọi — đủ chứa toàn bộ payload + option object ngắn
    // của mọi lời gọi hiện có trong trang này (đo thực tế dài nhất ~230 ký tự).
    calls.push(source.slice(start, start + 300));
  }
  return calls;
}

describe("★★★ doc 80 Task 8 (ECN-03, ECN-05) — EngineeringChanges.tsx (quét tĩnh)", () => {
  it("ECN-03 — MỌI lời gọi transitionM.mutate(...) đều mang expectedStatus", () => {
    const calls = transitionMutateCalls(src);
    expect(calls.length, "không tìm thấy lời gọi transitionM.mutate nào — trang đã đổi cấu trúc?").toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call, `thiếu expectedStatus trong lời gọi:\n${call}`).toContain("expectedStatus");
    }
  });

  it("ECN-05 — approve KHÔNG bắn mutate trực tiếp trên một cú click; mở hộp xác nhận trước (như reject)", () => {
    expect(src).toContain('if (action === "approve")');
    expect(src).toContain("setApproveTarget(ecn)");
    // Nhánh approve phải return TRƯỚC dòng gọi mutate trực tiếp ở cuối doTransition —
    // tức action==="approve" không rơi xuống transitionM.mutate({..., action as any}).
    const doTransitionBody = src.slice(src.indexOf("const doTransition ="), src.indexOf("const confirmReject ="));
    const approveBranch = doTransitionBody.indexOf('if (action === "approve")');
    const directMutate = doTransitionBody.indexOf("transitionM.mutate({ id: ecn.id");
    expect(approveBranch).toBeGreaterThan(-1);
    expect(directMutate).toBeGreaterThan(-1);
    expect(approveBranch, "nhánh approve phải đứng TRƯỚC lời gọi mutate trực tiếp (return sớm)").toBeLessThan(directMutate);
  });

  it("ECN-05 — hộp xác nhận PHÊ DUYỆT tồn tại, gọi confirmApprove, ý kiến TÙY CHỌN (không ép buộc như reject)", () => {
    const dialogStart = src.indexOf("<AlertDialog open={approveTarget != null}");
    expect(dialogStart, "thiếu hộp thoại xác nhận phê duyệt (<AlertDialog open={approveTarget != null}>)").toBeGreaterThan(-1);
    const dialogSrc = src.slice(dialogStart, dialogStart + 1500);
    expect(dialogSrc).toContain("approveTarget != null");
    expect(dialogSrc).toContain("onClick={confirmApprove}");
    // Nút xác nhận approve KHÔNG được disable theo độ dài approveComment (chỉ theo isPending) —
    // khác hẳn nút reject (disabled khi !rejectReason.trim()).
    expect(dialogSrc).not.toContain("!approveComment.trim()");
  });

  it("ECN-05 — hộp TỪ CHỐI vẫn giữ ý kiến BẮT BUỘC (hành vi CŨ — không hồi quy)", () => {
    expect(src).toContain("!rejectReason.trim()");
    expect(src).toContain("ecn.rejectReasonRequired");
  });
});
