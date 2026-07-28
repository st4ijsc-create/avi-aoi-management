/**
 * Final-fix round, Task 6 (SECURITY) — regression test for a cache-based bypass of the
 * Studio-corpus role gate, found while auditing `answerQuestion`/`streamAnswer`'s callers.
 *
 * BỐI CẢNH: `answerCache` (aiLocalKnowledgeService.ts) is keyed by `getCacheKey(question, topK,
 * userRole)`, where `userRole` is this file's own "tone" `UserRole` (worker/engineer/manager/
 * it_admin — for answer PHRASING, see the module header), NOT the RBAC role. Multiple DISTINCT
 * real RBAC roles collapse onto the SAME tone value via `mapAppRoleToAiRole`
 * (server/routers/aiChatRouter.ts) — e.g. "quality_inspector", "maintenance", and "engineer"
 * (the real RBAC role) all map to tone "engineer". Without `studioEligible` in the cache key, an
 * ineligible caller (real role "maintenance", tone "engineer") asking the SAME question within
 * the cache TTL as an eligible caller (real role "engineer", same tone) would receive the
 * ELIGIBLE caller's CACHED KbAnswerResult — Studio citations/contexts baked into `answer` and
 * all — completely bypassing the retrieveKnowledge()-level gate via the cache. This test proves
 * `getCacheKey` can never produce the same key for an eligible vs. ineligible caller, even when
 * every other input (question/topK/tone-role) is identical.
 */
import { describe, it, expect } from "vitest";
import { getCacheKey } from "./aiLocalKnowledgeService";

describe("getCacheKey — Task 6 (SECURITY) studioEligible must be part of the cache key", () => {
  it("SAME question/topK/tone-role, khác studioEligible ⇒ KHÁC key (không thể đụng cache)", () => {
    const eligibleKey = getCacheKey("hỏi về AOI", 5, "engineer", true);
    const ineligibleKey = getCacheKey("hỏi về AOI", 5, "engineer", false);
    expect(eligibleKey).not.toBe(ineligibleKey);
  });

  it("mô phỏng đúng kịch bản rò rỉ: 'engineer' (RBAC thật, đủ quyền) và 'maintenance' (RBAC thật, không đủ quyền) cùng ánh xạ tone 'engineer' — vẫn phải khác key", () => {
    // mapAppRoleToAiRole: "engineer" → tone "engineer"; "maintenance" → tone "engineer" (cùng
    // giá trị!). Nếu code gọi getCacheKey mà không truyền studioEligible tương ứng đúng vai trò
    // RBAC thật, hai key này sẽ TRÙNG NHAU. Test này khoá bằng chứng "không được trùng" ở đúng
    // các giá trị studioEligible mà mỗi RBAC role thật sẽ tính ra qua canAccessStudioCorpus.
    const sameToneRole = "engineer"; // tone value BOTH real roles collapse onto
    const keyForRealEngineer = getCacheKey("câu hỏi giống hệt", 5, sameToneRole, true); // canAccessStudioCorpus("engineer") === true
    const keyForRealMaintenance = getCacheKey("câu hỏi giống hệt", 5, sameToneRole, false); // canAccessStudioCorpus("maintenance") === false
    expect(keyForRealEngineer).not.toBe(keyForRealMaintenance);
  });

  it("default studioEligible=false (an toàn theo hướng đóng nếu caller quên truyền)", () => {
    const withDefault = getCacheKey("hỏi về AOI", 5, "engineer");
    const explicitFalse = getCacheKey("hỏi về AOI", 5, "engineer", false);
    expect(withDefault).toBe(explicitFalse);
  });

  it("mọi tham số khác giữ nguyên hành vi cũ (question/topK/tone-role vẫn phân biệt key như trước)", () => {
    expect(getCacheKey("a", 5, "engineer", true)).not.toBe(getCacheKey("b", 5, "engineer", true));
    expect(getCacheKey("a", 5, "engineer", true)).not.toBe(getCacheKey("a", 10, "engineer", true));
    expect(getCacheKey("a", 5, "engineer", true)).not.toBe(getCacheKey("a", 5, "manager", true));
  });
});
