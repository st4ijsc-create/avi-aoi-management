/**
 * GĐ1 unit tests — C5 role map + zh language detection.
 */
import { describe, it, expect } from "vitest";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import { detectLanguage } from "./aiLocalKnowledgeService";

describe("C5 — mapAppRoleToAiRole", () => {
  it("maps the agreed app roles to AI roles", () => {
    expect(mapAppRoleToAiRole("admin")).toBe("it_admin");
    expect(mapAppRoleToAiRole("supervisor")).toBe("manager");
    expect(mapAppRoleToAiRole("quality_inspector")).toBe("engineer");
    expect(mapAppRoleToAiRole("maintenance")).toBe("engineer");
    expect(mapAppRoleToAiRole("operator")).toBe("worker");
    expect(mapAppRoleToAiRole("viewer")).toBe("worker");
    expect(mapAppRoleToAiRole("user")).toBe("worker");
  });

  it("defaults unknown / missing roles to worker (safe)", () => {
    expect(mapAppRoleToAiRole(undefined)).toBe("worker");
    expect(mapAppRoleToAiRole(null)).toBe("worker");
    expect(mapAppRoleToAiRole("")).toBe("worker");
    expect(mapAppRoleToAiRole("some_custom_role_from_builder")).toBe("worker");
  });

  it("is case-insensitive", () => {
    expect(mapAppRoleToAiRole("ADMIN")).toBe("it_admin");
    expect(mapAppRoleToAiRole("  Supervisor  ")).toBe("manager");
  });
});

describe("zh — detectLanguage", () => {
  it("detects Chinese (Han characters)", () => {
    expect(detectLanguage("这台机器现在怎么样？")).toBe("zh");
    expect(detectLanguage("如何配置 AOI 检测参数？")).toBe("zh");
  });

  it("still detects Vietnamese", () => {
    expect(detectLanguage("máy này sao rồi")).toBe("vi");
    expect(detectLanguage("huong dan cau hinh he thong")).toBe("vi");
  });

  it("still detects English", () => {
    expect(detectLanguage("machine status report")).toBe("en");
  });

  // ★★★ TASK V11 — B3: kỹ sư gõ tiếng Việt KHÔNG DẤU (thói quen gõ nhanh, đặc biệt khi câu hỏi
  // trộn thuật ngữ lập trình tiếng Anh — "Node.js", "MQTT", "broker") từng lọt qua CẢ HAI lưới cũ
  // (không dấu ⇒ `viPattern` trượt; 9 cụm từ cố định của `viKeywords` không phủ hết) ⇒ rơi về "en"
  // SAI, kéo theo trả lời tiếng Anh cho câu hỏi tiếng Việt. Đo SỐNG được trước khi vá:
  // "Viet module Node.js ket noi MQTT broker va nhan message" -> "en". Xem
  // `VI_PARTICLE_RE`/docblock cạnh `detectLanguage` cho danh sách từ nối đã chọn (loại các từ
  // ngắn/mơ hồ trùng tiếng Anh hoặc viết tắt kỹ thuật: la/co/ai/ba/se/da/ra/the/do/can).
  it("B3 — tiếng Việt KHÔNG DẤU lẫn thuật ngữ lập trình tiếng Anh vẫn nhận diện đúng \"vi\"", () => {
    expect(detectLanguage("Viet module Node.js ket noi MQTT broker va nhan message")).toBe("vi");
    expect(detectLanguage("Viet ham C# mo cong COM3 baud 9600 doc du lieu lien tuc")).toBe("vi");
    expect(detectLanguage("toi muon viet mot Flask endpoint nhan file upload")).toBe("vi");
  });

  it("B3 đối chứng — câu tiếng Anh thật (không có từ nối tiếng Việt) vẫn nhận diện đúng \"en\"", () => {
    expect(detectLanguage("Node.js Express MQTT broker module")).toBe("en");
    expect(detectLanguage("How do I configure a REST API endpoint")).toBe("en");
  });
});
