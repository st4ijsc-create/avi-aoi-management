/**
 * stripThinking / StreamingThinkingStripper — G5-B (2026-08-16).
 *
 * ─── LỚP LỖI ĐANG CANH ────────────────────────────────────────────────────────────────────────
 * Chuỗi suy luận của model **rò nguyên văn ra giao diện người vận hành**. Không crash, không log
 * đỏ — chỉ là giữa câu trả lời có nội tâm của model. Ba đường rò đã xác minh trên mã cũ:
 *   (R1) thẻ ghim cứng `<think>` ⇒ model mới phát `<reasoning>`/`<thought>`/`<|think|>` ⇒ KHÔNG
 *        cắt gì, rò 100%;
 *   (R2) *fail-open ở nhánh "cắt xong rỗng"*: bản cũ trả **NGUYÊN VĂN CẢ KHỐI SUY LUẬN** khi câu
 *        trả lời chỉ có suy luận (model bị cắt giữa chừng vì hết `maxTokens` — ca RẤT hay gặp với
 *        model reasoning, router cấp 4096 token cho `hard rca/report`);
 *   (R3) thẻ **lồng nhau** ⇒ regex cặp không tham lam cắt sai mốc, để lọt phần trong + một thẻ
 *        đóng lạc ra ngoài.
 * Cộng đường thứ tư chưa từng có lưới: **streaming** — thẻ bị chẻ đôi qua hai chunk SSE.
 *
 * ─── NGUYÊN TẮC ───────────────────────────────────────────────────────────────────────────────
 * Phần lớn ca ở đây là **vị từ**, không phải liệt kê tay: "∀ tên thẻ trong tập cấu hình…",
 * "∀ điểm chẻ chunk…". Thêm một biến thể thẻ mà quên xử lý ⇒ ĐỎ, không cần ai nhớ viết ca mới.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  stripThinking,
  thinkingTagNames,
  StreamingThinkingStripper,
} from "./aiGgufEngine";

const SECRET = "NOI-TAM-CUA-MODEL";

let savedTags: string | undefined;
beforeEach(() => {
  savedTags = process.env.AI_THINKING_TAGS;
  delete process.env.AI_THINKING_TAGS;
});
afterEach(() => {
  if (savedTags === undefined) delete process.env.AI_THINKING_TAGS;
  else process.env.AI_THINKING_TAGS = savedTags;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("stripThinking — hành vi nền (giữ nguyên hợp đồng cũ)", () => {
  it("cắt một khối <think>…</think> chuẩn", () => {
    const out = stripThinking("<think>let me reason about X</think>The answer is 42.");
    expect(out.answer).toBe("The answer is 42.");
    expect(out.thinking).toContain("reason about X");
  });

  it("cắt NHIỀU khối", () => {
    const out = stripThinking("<think>a</think>Part1 <think>b</think>Part2");
    expect(out.answer).toBe("Part1 Part2");
    expect(out.thinking).toContain("a");
    expect(out.thinking).toContain("b");
  });

  it("thẻ đóng lạc ở đầu (chat template mở sẵn khối) ⇒ bỏ mọi thứ trước nó", () => {
    const out = stripThinking(`${SECRET}</think>Final answer here.`);
    expect(out.answer).toBe("Final answer here.");
    expect(out.answer).not.toContain(SECRET);
    expect(out.thinking).toContain(SECRET);
  });

  it("văn bản thường ⇒ no-op tuyệt đối", () => {
    const out = stripThinking("just a normal answer");
    expect(out.answer).toBe("just a normal answer");
    expect(out.thinking).toBe("");
    expect(out.truncated).toBe(false);
  });

  it("chuỗi rỗng / không phải chuỗi ⇒ không ném", () => {
    expect(stripThinking("").answer).toBe("");
    expect(() => stripThinking(undefined as unknown as string)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ R1 — tập thẻ CẤU HÌNH ĐƯỢC, không ghim cứng <think>", () => {
  /**
   * VỊ TỪ: mọi tên trong tập mặc định đều phải cắt được, ở CẢ hai dạng cú pháp (`<name>` và
   * `<|name|>`). Thêm một tên vào tập mà quên xử lý ⇒ ca này ĐỎ mà không ai phải viết ca mới.
   */
  it("∀ tên thẻ trong tập mặc định — cả dạng <name> lẫn <|name|> — đều bị cắt sạch", () => {
    const names = thinkingTagNames();
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain("think"); // hồi quy: biến thể gốc không được rơi khỏi tập
    for (const n of names) {
      for (const [open, close] of [
        [`<${n}>`, `</${n}>`],
        [`<|${n}|>`, `<|/${n}|>`],
      ]) {
        const out = stripThinking(`${open}${SECRET}${close}Cau tra loi.`);
        expect(out.answer, `thẻ ${open}`).toBe("Cau tra loi.");
        expect(out.answer, `thẻ ${open}`).not.toContain(SECRET);
        expect(out.thinking, `thẻ ${open}`).toContain(SECRET);
      }
    }
  });

  it("không phân biệt HOA/thường và chấp nhận thuộc tính trên thẻ mở", () => {
    expect(stripThinking(`<THINK>${SECRET}</Think>OK`).answer).toBe("OK");
    expect(stripThinking(`<think reasoning_effort="xhigh">${SECRET}</think>OK`).answer).toBe("OK");
  });

  it("AI_THINKING_TAGS THÊM thẻ lạ vào tập (và KHÔNG xoá được thẻ mặc định — chỉ cộng, fail-safe)", () => {
    process.env.AI_THINKING_TAGS = "chain_of_thought, deliberation";
    expect(thinkingTagNames()).toEqual(expect.arrayContaining(["chain_of_thought", "deliberation", "think"]));
    expect(stripThinking(`<chain_of_thought>${SECRET}</chain_of_thought>Xong.`).answer).toBe("Xong.");
    // Thẻ mặc định VẪN cắt — env chỉ cộng thêm, không thay thế.
    expect(stripThinking(`<think>${SECRET}</think>Xong.`).answer).toBe("Xong.");
  });

  it("AI_THINKING_TAGS chứa rác ⇒ bỏ qua rác, KHÔNG ném, KHÔNG làm hỏng tập mặc định", () => {
    process.env.AI_THINKING_TAGS = "((( , 123, <ok_tag>, ,";
    expect(() => thinkingTagNames()).not.toThrow();
    expect(thinkingTagNames()).toContain("think");
    expect(thinkingTagNames()).toContain("ok_tag");
    expect(thinkingTagNames()).not.toContain("(((");
  });

  it("thẻ KHÔNG thuộc tập ⇒ giữ nguyên (không cắt bừa mọi thứ trong ngoặc nhọn)", () => {
    const html = "<div>bang ket qua</div>";
    expect(stripThinking(html).answer).toBe(html);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ R2 — thẻ MỞ mà KHÔNG có thẻ đóng: phải FAIL-SAFE, không fail-open", () => {
  it("có câu trả lời trước khối bị cắt cụt ⇒ giữ câu trả lời, bỏ phần suy luận", () => {
    const out = stripThinking(`Visible answer.\n<think>${SECRET} that got cut off`);
    expect(out.answer).toBe("Visible answer.");
    expect(out.answer).not.toContain(SECRET);
    expect(out.thinking).toContain(SECRET);
    expect(out.truncated).toBe(true);
  });

  /**
   * ★★ ĐÂY LÀ CA ĐỎ TRÊN MÃ CŨ. Bản cũ có nhánh:
   *      if (!answer && text.trim()) return { answer: text.trim(), ... }
   *    ⇒ khi TOÀN BỘ đầu ra là suy luận (model hết token trước khi kịp trả lời), nó trả về
   *    **nguyên văn cả khối suy luận kèm thẻ** ra giao diện. Đó không phải fail-safe — đó là
   *    fail-open có chú thích ghi "fail-safe".
   */
  it("★ TOÀN BỘ đầu ra chỉ là suy luận ⇒ answer RỖNG, tuyệt đối KHÔNG trả nguyên văn", () => {
    for (const raw of [
      `<think>${SECRET}</think>`,
      `<think>${SECRET}`,
      `<reasoning>${SECRET}`,
      `<think>${SECRET}</think>   \n  `,
    ]) {
      const out = stripThinking(raw);
      expect(out.answer, `đầu vào: ${raw}`).toBe("");
      expect(out.answer, `đầu vào: ${raw}`).not.toContain(SECRET);
      expect(out.thinking, `đầu vào: ${raw}`).toContain(SECRET);
    }
  });

  it("thẻ mở nằm GIỮA câu ⇒ giữ hai đầu, bỏ ruột", () => {
    const out = stripThinking(`Truoc <think>${SECRET}</think> sau.`);
    expect(out.answer).toBe("Truoc  sau.");
    expect(out.answer).not.toContain(SECRET);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ R3 — thẻ LỒNG NHAU", () => {
  it("lồng hai lớp ⇒ không lọt ruột, không sót thẻ đóng lạc ra ngoài", () => {
    const out = stripThinking(`<think>ngoai <think>${SECRET}</think> con lai</think>Ket qua.`);
    expect(out.answer).toBe("Ket qua.");
    expect(out.answer).not.toContain(SECRET);
    expect(out.answer).not.toContain("con lai");
    expect(out.answer).not.toMatch(/<\/?think/i);
  });

  it("lồng chéo tên (<think> chứa <reasoning>) vẫn tính đúng độ sâu", () => {
    const out = stripThinking(`<think>a<reasoning>${SECRET}</reasoning>b</think>Ket qua.`);
    expect(out.answer).toBe("Ket qua.");
    expect(out.answer).not.toContain(SECRET);
  });

  /**
   * ★★ HAI CA DƯỚI ĐÂY SINH RA TỪ MỘT ĐỘT BIẾN SỐNG SÓT (M3, vòng đo đầu).
   *
   * Đột biến "thẻ đóng ⇒ `depth = 0` thay vì `depth--`" (tức là **bỏ đếm độ sâu**, quay lại đúng
   * hành vi sai của bản cũ) vẫn làm cho MỌI ca lồng nhau tôi viết ban đầu XANH. Lý do: các ca ấy
   * đều **bắt đầu bằng thẻ mở ở vị trí 0**, nên nhánh "thẻ đóng lạc" vô tình dọn hộ phần rác — lưới
   * đo đúng kết quả nhưng qua một cơ chế KHÁC với cơ chế nó tưởng đang canh.
   * Chỉ khi có **chữ nhìn thấy được đứng TRƯỚC** khối lồng thì hai hành vi mới tách ra.
   */
  it("★ lồng nhau CÓ CHỮ ĐỨNG TRƯỚC ⇒ không nuốt mất phần đầu câu trả lời", () => {
    const out = stripThinking(`Truoc <think>a<think>${SECRET}</think>con lai</think>Sau.`);
    expect(out.answer).toBe("Truoc Sau.");
    expect(out.answer).not.toContain(SECRET);
    expect(out.answer).not.toContain("con lai");
  });

  it("★ lồng nhau + thẻ NGOÀI không bao giờ đóng ⇒ phần sau thẻ đóng trong KHÔNG được thành câu trả lời", () => {
    const out = stripThinking(`Truoc <think>a<think>b</think>${SECRET} van dang suy`);
    expect(out.answer).toBe("Truoc");
    expect(out.answer).not.toContain(SECRET);
    expect(out.truncated).toBe(true);
  });

  /** VỊ TỪ chống rò dạng tổng quát: đầu ra KHÔNG BAO GIỜ được còn thẻ suy luận nào. */
  it("∀ mẫu méo — answer không bao giờ còn sót thẻ suy luận", () => {
    const names = thinkingTagNames();
    const patterns = [
      `<think><think>${SECRET}</think>Ket qua.`,
      `</think></think>Ket qua.`,
      `Ket qua.<think>${SECRET}`,
      `<think>${SECRET}</think><think>${SECRET}</think>Ket qua.`,
      `<think>${SECRET}</reasoning>Ket qua.`,
    ];
    const anyTag = new RegExp(`<\\s*\\|?\\s*/?\\s*(?:${names.join("|")})\\b`, "i");
    for (const p of patterns) {
      const out = stripThinking(p);
      expect(out.answer, `mẫu: ${p}`).not.toMatch(anyTag);
      expect(out.answer, `mẫu: ${p}`).not.toContain(SECRET);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★ R4 — ĐƯỜNG STREAMING: thẻ bị chẻ đôi qua hai chunk", () => {
  function chay(chunks: string[], opts?: { startInsideThinking?: boolean }): { text: string; s: StreamingThinkingStripper } {
    const s = new StreamingThinkingStripper(opts);
    let text = "";
    for (const c of chunks) text += s.push(c);
    text += s.flush();
    return { text, s };
  }

  it("không có thẻ ⇒ KHÔNG mất một ký tự nào (đuôi giữ lại phải được xả ở flush)", () => {
    const { text } = chay(["Xin ", "chao ", "the ", "gioi."]);
    expect(text).toBe("Xin chao the gioi.");
  });

  it("★ thẻ MỞ bị chẻ đôi qua hai chunk ⇒ vẫn cắt, không rò", () => {
    const { text } = chay(["Truoc <thi", `nk>${SECRET}</think>Sau.`]);
    expect(text).not.toContain(SECRET);
    expect(text).toBe("Truoc Sau.");
  });

  it("★ thẻ ĐÓNG bị chẻ đôi qua hai chunk ⇒ vẫn cắt, không rò", () => {
    const { text } = chay([`<think>${SECRET}</th`, "ink>Ket qua."]);
    expect(text).not.toContain(SECRET);
    expect(text).toBe("Ket qua.");
  });

  it("★ VỊ TỪ — ∀ điểm chẻ của cùng một chuỗi, đầu ra streaming KHỚP đầu ra một-lượt", () => {
    const full = `Mo dau. <think>${SECRET} nhieu dong\nva xuong dong</think>Ket qua cuoi.`;
    const batch = stripThinking(full).answer;
    for (let i = 1; i < full.length; i++) {
      const { text } = chay([full.slice(0, i), full.slice(i)]);
      expect(text, `chẻ tại ${i}`).not.toContain(SECRET);
      expect(text.trim(), `chẻ tại ${i}`).toBe(batch);
    }
  });

  it("★ VỊ TỪ — chẻ thành chunk 1 ký tự (trường hợp token-by-token thật) vẫn không rò", () => {
    const full = `A<reasoning>${SECRET}</reasoning>B<|think|>${SECRET}<|/think|>C`;
    const { text } = chay(full.split(""));
    expect(text).not.toContain(SECRET);
    expect(text).toBe("ABC");
  });

  it("luồng ĐỨT giữa khối suy luận (chưa có thẻ đóng) ⇒ flush KHÔNG rò gì", () => {
    const { text, s } = chay([`Ket qua.<think>${SECRET} bi cat`]);
    expect(text).toBe("Ket qua.");
    expect(text).not.toContain(SECRET);
    expect(s.truncated).toBe(true);
    expect(s.thinking).toContain(SECRET);
  });

  it("luồng đứt ngay GIỮA một thẻ (`<thi`) ⇒ không phun mảnh thẻ ra giao diện", () => {
    const { text, s } = chay(["Ket qua.<thi"]);
    expect(text).toBe("Ket qua.");
    expect(s.truncated).toBe(true);
  });

  /**
   * ★ CA NÀY SINH RA TỪ MỘT ĐỘT BIẾN SỐNG SÓT (M4b, vòng đo đầu). Đột biến "flush() phun luôn phần
   * đang giữ dù còn ở TRONG khối suy luận" vẫn XANH với mọi ca streaming tôi viết ban đầu, vì
   * `push()` đã dốc sạch bộ đệm vào `thoughts` — bộ đệm lúc flush chỉ còn khi có **mảnh thẻ dở nằm
   * BÊN TRONG khối suy luận**. Đó chính là hình dạng duy nhất nhánh ấy tồn tại để canh.
   */
  it("★ đứt giữa MỘT THẺ nằm BÊN TRONG khối suy luận ⇒ flush không phun mảnh nào", () => {
    const { text, s } = chay([`Ket qua.<think>${SECRET} <thi`]);
    expect(text).toBe("Ket qua.");
    expect(text).not.toMatch(/<\/?th/i);
    expect(s.truncated).toBe(true);
    expect(s.thinking).toContain(SECRET);
  });

  it("`<` thường trong văn bản (a < b) KHÔNG bị giữ lại vĩnh viễn", () => {
    const { text } = chay(["neu a < b thi ", "dung"]);
    expect(text).toBe("neu a < b thi dung");
  });

  /**
   * ★ Lỗ THẬT của streaming, và cách đóng: khi chat template MỞ SẴN `<think>`, đầu ra bắt đầu
   * NGAY TRONG khối suy luận và thẻ đầu tiên nhìn thấy là `</think>`. Một lượt phát đã rời máy
   * chủ thì KHÔNG rút lại được ⇒ bên gọi PHẢI khai `startInsideThinking`.
   */
  it("★ template mở sẵn khối: KHÔNG khai ⇒ rò (đo được); CÓ khai ⇒ sạch", () => {
    const chunks = [`${SECRET} dang suy`, "</think>Ket qua."];
    expect(chay(chunks).text).toContain(SECRET); // ĐO THẲNG cái lỗ, không giấu nó
    const { text } = chay(chunks, { startInsideThinking: true });
    expect(text).not.toContain(SECRET);
    expect(text).toBe("Ket qua.");
  });

  it("push nhận giá trị không phải chuỗi ⇒ không ném, không rò", () => {
    const s = new StreamingThinkingStripper();
    expect(() => s.push(undefined as unknown as string)).not.toThrow();
    expect(s.push(null as unknown as string)).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★ KHỐI NÀY SINH RA TỪ HAI ĐỘT BIẾN **SỐNG SÓT** ở G5-C (M10, M11) — và chúng sống sót vì một
 * lý do đáng giá hơn cả việc giết chúng.
 *
 * Hai đột biến ấy gỡ lượt `cat.flush()` khỏi ống SSE và khỏi ops-chat. **Không một ca nào đỏ.**
 * Đo trực tiếp (`push()` từng ký tự rồi `flush()`) cho ra kết quả này:
 *
 *      "Ty le: a < b va 3<"  →  out="Ty le: a < b va 3"  flush=""   mất 1 ký tự
 *      "Ket qua <th"          →  out="Ket qua "           flush=""   mất 3 ký tự
 *      "Ket qua </"           →  out="Ket qua "           flush=""   mất 2 ký tự
 *      "Binh thuong."         →  out="Binh thuong."       flush=""   mất 0
 *
 * CHỨNG MINH vì sao `flush()` KHÔNG BAO GIỜ nhả chữ khi `depth===0`: `push()` kết thúc bằng
 * `this.buf = hold >= 0 ? rest.slice(hold) : ""`, nên bộ đệm còn lại **luôn bắt đầu ĐÚNG tại dấu
 * `<`**; `flush()` trả `rest.slice(0, hold)` với `hold === 0` ⇒ chuỗi rỗng. Vậy M10/M11 là **đột
 * biến TƯƠNG ĐƯƠNG**: chúng gỡ một thứ không thể tạo ra đầu ra quan sát được. Giá trị thật của
 * lượt `flush()` ở hai ống là **sổ sách** (`truncated`, `thinking`, dọn trạng thái), không phải chữ.
 *
 * ⚠ HỆ QUẢ PHẢI KHAI, KHÔNG ĐƯỢC GIẤU: bộ cắt **CÓ nuốt ký tự** — nhưng chỉ ở đúng một hình dạng:
 * luồng KẾT THÚC ngay giữa một mảnh trông như thẻ. Mất tối đa bằng độ dài mảnh ấy. Mọi luồng không
 * kết thúc bằng `<…` đều đúng từng ký tự (các ca ở trên và ở §6 của hai lưới G5-C).
 *
 * VÌ SAO KHÔNG "SỬA": đổi `flush()` thành phun mảnh dở ra sẽ mâu thuẫn với ca có chủ ý ở trên
 * ("luồng đứt ngay GIỮA một thẻ ⇒ không phun mảnh thẻ ra giao diện") — đánh đổi một lựa chọn
 * an-toàn-có-chủ-ý lấy 1–3 ký tự. Thay vào đó, **ghim bất biến** để nó không đổi trong im lặng:
 * nếu ai đó nới chính sách giữ (giữ thêm chữ thường), ca dưới ĐỎ và buộc phải xem lại lượt
 * `flush()` ở CẢ HAI ống — chỗ mà lúc ấy `flush()` mới thật sự gánh chữ.
 */
describe("★★ BẤT BIẾN ghim từ đột biến tương đương M10/M11 — flush() không gánh chữ", () => {
  it("∀ chuỗi không có thẻ: flush() trả RỖNG, và phần mất chỉ là mảnh-giống-thẻ ở cuối", () => {
    const mau = [
      { vao: "Binh thuong.", mat: 0 },
      { vao: "Ty le: a < b va 3<", mat: 1 },
      { vao: "Ket qua </", mat: 2 },
      { vao: "Ket qua <th", mat: 3 },
      { vao: "a < b va c > d, xong.", mat: 0 },
    ];
    for (const m of mau) {
      const s = new StreamingThinkingStripper();
      let out = "";
      for (const c of m.vao.split("")) out += s.push(c);
      const con = s.flush();
      expect(con, `flush() phải RỖNG cho ${JSON.stringify(m.vao)} — nếu ĐỎ, chính sách giữ đã đổi ⇒ xem lại flush ở OngPhatSSE và generateWithOllamaStream`).toBe("");
      expect(m.vao.length - out.length, `số ký tự mất cho ${JSON.stringify(m.vao)}`).toBe(m.mat);
    }
  });

  it("mảnh giữ lại (nếu có) LUÔN bắt đầu bằng `<` — đây là cơ chế làm flush() rỗng", () => {
    // Nếu bất biến này vỡ, `flush()` có thể gánh chữ thật ⇒ hai ống PHẢI gọi nó (và M10/M11 hết
    // tương đương). Ca này là cái chuông cho tình huống đó.
    for (const vao of ["Ket qua <th", "3<", "abc</", "xyz<|"]) {
      const s = new StreamingThinkingStripper();
      let out = "";
      for (const c of vao.split("")) out += s.push(c);
      const conLai = vao.slice(out.length);
      expect(conLai.startsWith("<"), `phần chưa nhả của ${JSON.stringify(vao)} = ${JSON.stringify(conLai)}`).toBe(true);
    }
  });
});
