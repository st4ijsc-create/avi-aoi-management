/**
 * Đợt 10.4 (T4b) — CENSUS điểm gắn nút kiểm định: mỗi bề mặt truyền ĐÚNG hình dạng ID lượt đã lưu; KHÔNG nơi nào dùng nguồn `van-ban` (đã bỏ ở 10.4); chỉ ba
 * điểm gắn được phép (thêm điểm mới phải khai ở đây + được rà). Đột biến: bỏ `chiSoLuotPhien` / đổi hình dạng nguồn ⇒ đỏ.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(__dirname, "../../../..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");
function quet(dir: string, ra: string[] = []): string[] {
  for (const t of readdirSync(dir)) {
    if (t === "node_modules" || t === "dist") continue;
    const p = join(dir, t);
    if (statSync(p).isDirectory()) quet(p, ra);
    else if (/\.(ts|tsx)$/.test(t) && !/\.(test|spec)\.(ts|tsx)$/.test(t)) ra.push(p);
  }
  return ra;
}

describe("census — điểm gắn NutKiemDinhNgoai", () => {
  it("/ai-chat: ID cuộc trò chuyện + tin nhắn ĐÃ LƯU (số), chỉ tin trợ lý", () => {
    const s = doc("client/src/pages/AIChatPage.tsx");
    expect(s).toContain('nguon={{ loai: "chat", cuocTroChuyenId: selectedConvId, tinNhanId: msg.id }}');
    expect(s).toMatch(/msg\.role !== "user" && typeof msg\.id === "number" && selectedConvId !== null/);
  });
  it("lượt agent: runId của sổ lượt chạy (máy chủ ghi)", () => {
    expect(doc("client/src/components/aiCoding/agent/DongThoiGianAgent.tsx")).toContain('nguon={{ loai: "agent", runId }}');
  });
  it("coding: phienId đã lưu + chỉ số TRONG BẢN LƯU (chiSoLuotPhien); đang stream / chưa lưu ⇒ null", () => {
    const s = doc("client/src/pages/AICodingWorkspace.tsx");
    expect(s).toContain('{ loai: "coding", phienId: sessionId, chiSoLuot: chiSoLuotPhien(transcript, i)! }');
    expect(s).toMatch(/sessionId && !isStreaming && chiSoLuotPhien\(transcript, i\) !== null/);
  });
  it("đúng ba tệp dùng <NutKiemDinhNgoai (ngoài định nghĩa + test); không nơi nào dùng nguồn van-ban", () => {
    const dung: string[] = [];
    for (const f of quet(join(GOC, "client", "src"))) {
      const rel = relative(GOC, f).split("\\").join("/");
      const s = readFileSync(f, "utf8");
      if (rel.endsWith("components/ai/NutKiemDinhNgoai.tsx")) continue;
      if (s.includes("<NutKiemDinhNgoai")) dung.push(rel);
      expect(/loai:\s*["']van-ban["']/.test(s), `${rel} dùng nguồn van-ban`).toBe(false);
    }
    expect(dung.sort()).toEqual(["client/src/components/aiCoding/agent/DongThoiGianAgent.tsx", "client/src/pages/AIChatPage.tsx", "client/src/pages/AICodingWorkspace.tsx"]);
  });
});
