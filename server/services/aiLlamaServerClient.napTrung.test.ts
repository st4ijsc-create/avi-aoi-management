/**
 * ★★★ G1-D — BẤT BIẾN "KHÔNG NẠP BẢN THỨ HAI", KIỂM BẰNG **VỊ TỪ TRÊN CẤU HÌNH SỐNG**.
 *
 * VÌ SAO KHÔNG LIỆT KÊ TAY: repo này đã dính lớp lỗi "N+1" **17 lần** — một lưới liệt kê tay
 * (`expect(f("qwen3-30b…")).toBe(true)`) xanh vĩnh viễn kể cả khi người vận hành đổi
 * `LLAMA_SERVER_MODEL` sang model khác, hoặc thêm một tầng model mới vào `.env`. Lưới ở đây
 * **ĐỌC THẲNG `.env` ĐANG DEPLOY**, dựng danh sách model từ chính nó, rồi phát biểu bất biến ∀
 * trên danh sách đó. Thêm `GGUF_XYZ_MODEL` mới vào `.env` ⇒ lưới tự phủ, không phải sửa gì.
 *
 * ⚠ `vitest.setup.ts` CỐ Ý không nạp `.env` vào `process.env` (nó chỉ lấy DATABASE_URL) — nên
 * "cấu hình sống" phải được ĐỌC TỪ FILE ở đây rồi mới bơm vào một `process.env` tạm. Đó cũng là
 * điều đúng: ta muốn kiểm CẤU HÌNH NGƯỜI VẬN HÀNH ĐÃ VIẾT, không phải cấu hình mà test tự bịa.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as client from "./aiLlamaServerClient";

const ENV_FILE = resolve(process.cwd(), ".env");

/** Đọc TOÀN BỘ `.env` thành một bản đồ — chỉ dùng trong bộ nhớ của test, KHÔNG bơm vào tiến trình. */
function docEnvSong(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(ENV_FILE)) return out;
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const ENV_SONG = docEnvSong();

/**
 * DANH SÁCH MODEL — dựng bằng VỊ TỪ trên khoá `.env`, không viết tay một tên model nào.
 * Mọi khoá dạng `GGUF_*MODEL*` + `LLAMA_SERVER_MODEL` đều vào đây.
 */
function rosterModelTuEnvSong(): Array<{ key: string; value: string }> {
  return Object.entries(ENV_SONG)
    .filter(([k, v]) => /^(GGUF_.*MODEL.*|LLAMA_SERVER_MODEL)$/.test(k) && v.trim().length > 0)
    .map(([key, value]) => ({ key, value: value.trim() }));
}

const GIU_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...GIU_ENV, ...ENV_SONG };
});
afterEach(() => {
  process.env = { ...GIU_ENV };
});

describe("G1-D — cấu hình SỐNG trong .env: bất biến ∀ trên roster model", () => {
  it("cấu hình sống đọc được và CÓ bật llama-server (nếu không, cả nhóm ca dưới không có nghĩa)", () => {
    expect(Object.keys(ENV_SONG).length).toBeGreaterThan(10);
    expect(rosterModelTuEnvSong().length).toBeGreaterThan(2);
    // Tiền đề của cả file. Nếu người vận hành TẮT server thì ca này đỏ và ta biết ngay là bối
    // cảnh đã đổi — thay vì các ca dưới xanh rỗng vì vị từ luôn trả false.
    expect(client.llamaServerEnabled()).toBe(true);
  });

  it("★ ∀ model trong roster sống: shouldUseServerForText ≡ laModelServerDangGiu (KHÔNG có đường trôi)", () => {
    const roster = rosterModelTuEnvSong();
    for (const { key, value } of roster) {
      expect(
        client.shouldUseServerForText(value),
        `${key}=${value}: hai vị từ phải trả CÙNG câu trả lời — nếu lệch thì một model được coi là ` +
          `"server phục vụ" ở chỗ định tuyến nhưng "không phải của server" ở chỗ CẤM ⇒ lỗ mở lại`,
      ).toBe(client.laModelServerDangGiu(value));
    }
    // Cả nhánh `undefined` (nghĩa là "model sâu mặc định") cũng phải khớp.
    expect(client.shouldUseServerForText()).toBe(client.laModelServerDangGiu());
  });

  it("★★ ĐÚNG một tập con của roster sống bị vị từ CẤM bắt, và nó KHÔNG rỗng", () => {
    const bidieu = rosterModelTuEnvSong().filter(({ value }) => client.laModelServerDangGiu(value));
    // Không rỗng: nếu rỗng thì bất biến của cả task này chưa bao giờ được kiểm trên cấu hình thật.
    expect(bidieu.length).toBeGreaterThan(0);
    // Và mọi mục bị bắt phải cùng basename với LLAMA_SERVER_MODEL — không có mục "bắt nhầm".
    const served = (ENV_SONG.LLAMA_SERVER_MODEL || ENV_SONG.GGUF_DEFAULT_MODEL || "")
      .replace(/\.gguf$/i, "")
      .replace(/^.*[\\/]/, "");
    for (const { key, value } of bidieu) {
      expect(value.replace(/\.gguf$/i, "").replace(/^.*[\\/]/, ""), `${key} bị bắt nhầm`).toBe(served);
    }
  });

  it("★★ ∀ model KHÁC trong roster sống (FIM · fast · embed · vision · reranker · code): KHÔNG bị cấm", () => {
    const served = (ENV_SONG.LLAMA_SERVER_MODEL || "").replace(/\.gguf$/i, "").replace(/^.*[\\/]/, "");
    const khac = rosterModelTuEnvSong().filter(
      ({ value }) => value.replace(/\.gguf$/i, "").replace(/^.*[\\/]/, "") !== served,
    );
    expect(khac.length).toBeGreaterThan(0); // cấu hình sống thật sự có nhiều tầng model
    for (const { key, value } of khac) {
      expect(client.laModelServerDangGiu(value), `${key}=${value} KHÔNG được bị cấm`).toBe(false);
    }
  });

  it("tắt LLAMA_SERVER_ENABLED ⇒ vị từ CẤM tắt sạch cho toàn roster (không có cấm-ma khi server không chạy)", () => {
    process.env.LLAMA_SERVER_ENABLED = "false";
    for (const { key, value } of rosterModelTuEnvSong()) {
      expect(client.laModelServerDangGiu(value), key).toBe(false);
    }
  });
});

describe("G1-D — ngân sách ngữ cảnh MỖI SLOT", () => {
  it("cấu hình sống: trần/slot = GGUF_MAX_CTX khi lệnh khởi động không được khai trong .env", () => {
    // `.env` ghi rõ ràng buộc: *"ctx MỖI SLOT PHẢI ≥ GGUF_MAX_CTX"*. Khi không có
    // LLAMA_SERVER_CTX/_PARALLEL/_CTX_PER_SLOT thì GGUF_MAX_CTX là nguồn ĐÚNG và AN TOÀN nhất.
    const maxCtx = Number(ENV_SONG.GGUF_MAX_CTX);
    expect(Number.isFinite(maxCtx) && maxCtx > 0).toBe(true);
    expect(client.serverSlotContextTokens()).toBe(maxCtx);
  });

  it("khai `-c` và `-np` ⇒ trần/slot là PHÉP CHIA, không phải tổng (bẫy llama.cpp)", () => {
    process.env.LLAMA_SERVER_CTX = "65536";
    process.env.LLAMA_SERVER_PARALLEL = "2";
    expect(client.serverSlotContextTokens()).toBe(32768); // khớp `/props` đo sống 2026-08-16
    process.env.LLAMA_SERVER_PARALLEL = "4";
    expect(client.serverSlotContextTokens()).toBe(16384);
  });

  it("khai thẳng LLAMA_SERVER_CTX_PER_SLOT thì nó THẮNG mọi suy diễn", () => {
    process.env.LLAMA_SERVER_CTX = "65536";
    process.env.LLAMA_SERVER_PARALLEL = "2";
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "8192";
    expect(client.serverSlotContextTokens()).toBe(8192);
  });

  it("★ ước lượng token KHÔNG được LẠC QUAN: 2,8 ký tự/token bao được mẫu dày token nhất đo thật (2,85)", () => {
    // Nếu ai đó nâng hằng số lên "~4 ký tự/token" quen dùng cho tiếng Anh, ca này đỏ — vì trên
    // tiếng Việt nó ước lượng HỤT 43%, đúng hướng nguy hiểm (để lọt một prompt vượt ctx).
    expect(client.KY_TU_MOI_TOKEN_UOC_LUONG).toBeLessThanOrEqual(2.85);
    const chuoi = "x".repeat(28_000);
    expect(client.uocLuongSoToken(chuoi)).toBe(10_000);
    expect(client.uocLuongSoToken("")).toBe(0);
    expect(client.uocLuongSoToken(undefined)).toBe(0);
  });

  it("★ ngân sách cộng CẢ maxTokens — llama.cpp từ chối theo prompt + n_predict, không theo riêng prompt", () => {
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "1000";
    // 2.520 ký tự ⇒ 900 token vào. 900 + 100 = 1000 ⇒ vừa KHÍT.
    const vuaKhit = client.kiemNganSachNguCanh({ prompt: "y".repeat(2520), maxTokens: 100 });
    expect(vuaKhit.tokenVao).toBe(900);
    expect(vuaKhit.vua).toBe(true);
    // Cùng prompt đó, chỉ nới chỗ trả lời thêm 1 token ⇒ KHÔNG vừa. Đây chính là ca mà một cổng
    // "chỉ đếm prompt" sẽ cho lọt rồi để server ném.
    expect(client.kiemNganSachNguCanh({ prompt: "y".repeat(2520), maxTokens: 101 }).vua).toBe(false);
  });

  it("ngân sách tính CẢ systemPrompt (nó cũng chiếm ctx của slot)", () => {
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "1000";
    expect(client.kiemNganSachNguCanh({ prompt: "y".repeat(1400), maxTokens: 100 }).vua).toBe(true);
    expect(
      client.kiemNganSachNguCanh({ systemPrompt: "z".repeat(1400), prompt: "y".repeat(1400), maxTokens: 100 }).vua,
    ).toBe(false);
  });

  it("maxTokens không khai ⇒ dành 1024 (đúng mặc định engine dùng khi POST)", () => {
    process.env.LLAMA_SERVER_CTX_PER_SLOT = "2000";
    expect(client.kiemNganSachNguCanh({ prompt: "y" }).tokenDanhChoTraLoi).toBe(1024);
  });
});

describe("G1-D — bộ điều phối VRAM là LỚP THỨ HAI, và nó KHÔNG cứu được ca này một mình", () => {
  it("★★ llama-server TEXT (cổng 8091) KHÔNG bị nhận nuôi ⇒ `preempt()` KHÔNG có đường giết nó", async () => {
    /**
     * Vì sao câu này quan trọng cho G1-D: nếu lượt nạp bản thứ hai vẫn chạy, `vramLoadOutcome`
     * gọi `reclaim()` → `preempt()`. Câu hỏi sống-còn là *"preempt có thể giết mất chính
     * llama-server đang phục vụ không?"*. Câu trả lời là KHÔNG — người thi hành `orphan-pid` chỉ
     * với tới giấy phép mang dấu `#nhan-nuoi-pid=`, mà dấu đó chỉ do lượt NHẬN NUÔI tạo ra, và
     * lượt nhận nuôi đòi dòng lệnh chứa `--port <LLAMA_VISION_PORT|8081>`. Server text chạy
     * `--port 8091` ⇒ không khớp ⇒ không có giấy phép ⇒ không ai giết được.
     * ⇒ HỆ QUẢ THẬT: `preempt()` sẽ đi giết **sidecar thị giác 7,8 GB đang phục vụ** để lấy chỗ
     *   cho một lượt nạp 19 GB **vẫn còn thiếu ~11 GB**. Đó là lý do cổng G1-D phải chặn TRƯỚC,
     *   chứ không phó thác cho bộ điều phối.
     */
    const { lapKeHoachNhanNuoi, moTaSidecarNhanNuoi } = await import("./vram/vramAdoption");
    process.env.LLAMA_SERVER_BIN = "D:/SOURCES/16.AI/llama-cuda/llama-server.exe";
    delete process.env.LLAMA_VISION_PORT; // mặc định 8081 — KHÁC cổng 8091 của server text
    const sidecar = moTaSidecarNhanNuoi();
    expect(sidecar).not.toBeNull();

    const PID = 24844; // PID thật quan sát được bằng nvidia-smi lúc đo (2026-08-16)
    const keHoach = lapKeHoachNhanNuoi({
      selfKey: "self",
      rows: [],
      procs: [
        {
          pid: PID,
          ppid: 1,
          cmdline:
            'D:\\SOURCES\\16.AI\\llama-cuda\\llama-server.exe -m D:/SOURCES/16.AI/Qwen3-30B.gguf ' +
            "--host 127.0.0.1 --port 8091 -c 65536 -np 2 -fa on -ngl 999",
          ctime: 1,
        } as any,
      ],
      orphans: [{ pid: PID, name: "D:\\SOURCES\\16.AI\\llama-cuda\\llama-server.exe" } as any],
      pidDaNhanNuoi: [],
      sidecar,
    });
    expect(keHoach.nhanNuoi.map((h) => h.pid)).not.toContain(PID);
    expect(keHoach.nhanNuoi).toHaveLength(0);
  });
});

describe("G1-D — nhận dạng lỗi TRÀN NGỮ CẢNH (chỉ để nói đúng nguyên nhân, không để quyết định)", () => {
  it("bắt được câu llama.cpp thật lẫn câu OpenAI-compatible", () => {
    expect(
      client.laLoiTranNguCanh(
        new Error('[llamaServer] HTTP 400: {"error":{"message":"the request exceeds the available context size"}}'),
      ),
    ).toBe(true);
    expect(client.laLoiTranNguCanh(new Error("exceed_context_size_error"))).toBe(true);
    expect(client.laLoiTranNguCanh(new Error("This model's maximum context length is 32768 tokens"))).toBe(true);
    expect(client.laLoiTranNguCanh(new Error("n_ctx too small"))).toBe(true);
  });

  it("KHÔNG bắt nhầm lỗi mạng/timeout thường", () => {
    expect(client.laLoiTranNguCanh(new Error("fetch failed: ECONNREFUSED"))).toBe(false);
    expect(client.laLoiTranNguCanh(new Error("The operation was aborted"))).toBe(false);
    expect(client.laLoiTranNguCanh(null)).toBe(false);
  });
});
