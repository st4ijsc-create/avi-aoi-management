/**
 * ★ Đợt 12 H3.2 — mô tả khai báo mỗi model: khớp basename, mặc định cho model lạ, bộ dựng thân llama-server đọc kênh nghĩ từ mô tả, census
 * khoá cờ template chỉ viết ở `moTaModel.ts`. Byte-y-hệt với Qwen3.6 ghim ở `aiLlamaServerClient.thanYeuCau.test.ts` (ảnh chụp).
 * ĐỘT BIẾN PHẢI BẮT: model "khong" vẫn gửi kwargs · đổi tên trường ngân sách · khớp có đuôi .gguf / thư mục sai · model lạ khác mặc định.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MO_TA_MAC_DINH, MO_TA_MODEL, moTaCho } from "./moTaModel";
import { lapCoTatSuyLuan, lapNganSachNghi } from "../../server/services/aiLlamaServerClient";

describe("moTaCho", () => {
  it("khớp basename bỏ thư mục + đuôi .gguf, không phân biệt hoa thường", () => {
    expect(moTaCho("D:/SOURCES/16.AI/Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf").id).toBe("qwen3.6-35b-a3b");
    expect(moTaCho("qwen3.6-35b-a3b-ud-q4_k_xl").id).toBe("qwen3.6-35b-a3b");
    expect(moTaCho("Qwen3-4B-Instruct-2507-Q4_K_M.gguf").id).toBe("qwen3-4b");
    expect(moTaCho("mxbai-embed-large-v1-f16.gguf").id).toBe("mxbai-embed");
  });
  it("không khớp / rỗng ⇒ MO_TA_MAC_DINH (= hành vi trước H3.2)", () => {
    for (const m of [undefined, null, "", "model-la.gguf", "Qwen3-VL-8B.gguf"]) expect(moTaCho(m)).toBe(MO_TA_MAC_DINH);
    expect(MO_TA_MAC_DINH.nghi).toEqual({ kieu: "kwargs", tat: { enable_thinking: false }, giu: { preserve_thinking: true }, truongNganSach: "thinking_budget_tokens" });
    expect(MO_TA_MAC_DINH.nguCanh.macDinh).toBe(65_536);
  });
  it("dữ liệu thuần: mọi mô tả đóng băng, id không trùng", () => {
    expect(new Set(MO_TA_MODEL.map((m) => m.id)).size).toBe(MO_TA_MODEL.length);
    for (const m of [MO_TA_MAC_DINH, ...MO_TA_MODEL]) expect(Object.isFrozen(m) && Object.isFrozen(m.nghi)).toBe(true);
  });
});

describe("bộ dựng thân đọc mô tả", () => {
  it("Qwen3.6: tắt / giữ / ngân sách như trước", () => {
    const b: Record<string, unknown> = { model: "Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf" };
    lapCoTatSuyLuan(b, true, true);
    lapNganSachNghi(b, 300, false);
    expect(b).toEqual({ model: b.model, chat_template_kwargs: { enable_thinking: false, preserve_thinking: true }, thinking_budget_tokens: 300 });
  });
  it("model KHÔNG có kênh nghĩ (nhúng) ⇒ không kwargs, không trường ngân sách", () => {
    const b: Record<string, unknown> = { model: "mxbai-embed-large-v1-f16" };
    lapCoTatSuyLuan(b, true, true);
    lapNganSachNghi(b, 300, false);
    expect(b).toEqual({ model: "mxbai-embed-large-v1-f16" });
  });
  it("thân chưa có model (lưới cũ) ⇒ mô tả mặc định", () => {
    const b: Record<string, unknown> = {};
    lapCoTatSuyLuan(b, true, false);
    expect(b).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });
});

describe("census — khoá cờ template chỉ VIẾT ở moTaModel.ts", () => {
  it("enable_thinking / preserve_thinking / thinking_budget_tokens (ngoài chú thích) chỉ ở moTaModel.ts + danh sách trắng ĐẦU VÀO của /v1", () => {
    const GOC = path.join(__dirname, "../..");
    const thay: string[] = [];
    const duyet = (d: string) => {
      for (const ten of fs.readdirSync(d)) {
        const p = path.join(d, ten);
        if (fs.statSync(p).isDirectory()) {
          if (ten !== "node_modules" && ten !== "dist") duyet(p);
        } else if (/\.(ts|tsx|mjs)$/.test(ten) && !/\.test\./.test(ten)) {
          const s = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
          // VIẾT khoá = khoá đối tượng (`enable_thinking:` / `"enable_thinking":`) hoặc gán thuộc tính (`.thinking_budget_tokens =`);
          // chữ trong thông điệp lỗi ("…enable_thinking=false…") không phải điểm dựng thân ⇒ không tính
          if (/\b(enable_thinking|preserve_thinking|thinking_budget_tokens)["']?\s*\??\s*:|\.(enable_thinking|preserve_thinking|thinking_budget_tokens)\s*=[^=]/.test(s)) {
            thay.push(path.relative(GOC, p).replace(/\\/g, "/"));
          }
        }
      }
    };
    duyet(path.join(GOC, "server"));
    duyet(path.join(GOC, "shared"));
    expect(thay.sort()).toEqual([
      "server/routes/openaiGateway.ts", // đọc chat_template_kwargs.enable_thinking của CLIENT (danh sách trắng đầu vào), không dựng thân
      "shared/ai/moTaModel.ts",
    ]);
  });
});
