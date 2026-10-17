/**
 * ★★★ ĐỢT 4B — `GoiModel` của lõi agent dùng chung, gọi `/v1/chat/completions` (stream + `tools` GỐC) bằng TOKEN
 * THEO NGƯỜI DÙNG (`Authorization: Bearer avgw_…`, device flow). Thay kênh KB-QA cũ (trần 900 token, tắt nghĩ,
 * giao thức văn bản) — khảo sát VSCode P0-4.
 *
 * - Suy luận: `delta.reasoning_content` ⇒ mảnh `nghi` (KHÔNG BAO GIỜ thành chữ hay hành động).
 * - Huỷ: `signal` của lõi đi thẳng vào `fetch` + vòng đọc.
 * - Lỗi HTTP 401/403/429/… ⇒ `LoiModel` có thông điệp tiếng Việt chỉ đúng việc phải làm (`moTaLoiHttpV1`); 5xx/mạng
 *   ⇒ `tamThoi` (lõi thử lại tối đa 1 lần/lượt).
 * - ★ Model phát tool call TRONG suy luận ⇒ máy chủ trả khung lỗi mang dấu `TOOL_CALL_TRONG_SUY_LUAN` ⇒ hỏi lại ĐÚNG
 *   lượt đó MỘT lần với `chat_template_kwargs.enable_thinking=false` (khuôn `goiModelMayChu.ts`). ⚠ Đo 2026-10-17:
 *   cổng `/v1` CHƯA chuyển tiếp `chat_template_kwargs` xuống engine ⇒ lần hỏi lại hiện vẫn chạy với nghĩ theo mặc
 *   định máy chủ; extension đã gửi đúng ô — phần còn lại là việc của máy chủ (ghi trong báo cáo Đợt 4B).
 */
import { LoiModel, type GoiModel, type ManhModel, type TinNhan, type WireTool } from "../../../shared/agentCore/index";
import { tachKhungSse } from "../loi/khungSse";
import {
  apSuKienV1,
  laLoiToolCallTrongSuyLuan,
  moTaLoiHttpV1,
  toolCallsCuoi,
  trangThaiLuongMoi,
} from "../loi/luongV1";
import { kiemTraServerUrl } from "../loi/dangNhap";

export const TRAN_TOKEN_MOT_LUOT_MAC_DINH = 16_000;

export interface CauHinhGoiModelV1 {
  serverUrl: string;
  layToken: () => Promise<string | undefined>;
  fetch?: typeof fetch;
  /** Model logic của cổng (`chat` | `code` | …). Mặc định `chat`. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Gọi khi máy chủ nói 401 (token chết) — phía gọi có thể xoá token cục bộ. */
  khi401?: () => void;
}

function sangTinNhanWire(ds: TinNhan[]): Array<Record<string, unknown>> {
  return ds.map((m) => {
    const ra: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
    if (m.role === "assistant" && m.tool_calls?.length) ra.tool_calls = m.tool_calls;
    if (m.role === "tool" && m.tool_call_id) ra.tool_call_id = m.tool_call_id;
    if (m.role === "tool" && m.name) ra.name = m.name;
    return ra;
  });
}

/** Một lượt HTTP. Ném `LoiModel` (có `ma`), hoặc lỗi thô mang dấu suy-luận để vòng ngoài hỏi lại. */
async function* motLuot(
  ch: CauHinhGoiModelV1,
  vao: { tinNhan: TinNhan[]; congCu: WireTool[]; signal: AbortSignal },
  tatNghi: boolean,
): AsyncGenerator<ManhModel> {
  const kt = kiemTraServerUrl(ch.serverUrl);
  if (!kt.ok) throw new LoiModel(kt.lyDo, { ma: "SERVER_URL" });
  const token = await ch.layToken();
  if (!token) {
    throw new LoiModel(
      'Chưa có token cổng /v1. Chạy lệnh "AI Local: Đăng nhập AI Local (device flow)" để đăng nhập bằng device flow.',
      { ma: "CHUA_CO_TOKEN" },
    );
  }
  const than: Record<string, unknown> = {
    model: ch.model ?? "chat",
    messages: sangTinNhanWire(vao.tinNhan),
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: ch.maxTokens ?? TRAN_TOKEN_MOT_LUOT_MAC_DINH,
    temperature: ch.temperature ?? 0.2,
    top_p: 0.9,
    ...(vao.congCu.length ? { tools: vao.congCu, tool_choice: "auto" } : {}),
    ...(tatNghi ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  let res: Response;
  try {
    res = await (ch.fetch ?? fetch)(`${kt.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify(than),
      signal: vao.signal,
    });
  } catch (e) {
    if (vao.signal.aborted) throw e;
    throw new LoiModel(`Không nối được máy chủ ${kt.url}: ${(e as Error).message}`, { tamThoi: true, ma: "MANG" });
  }
  if (res.status !== 200 || !res.body) {
    let du: unknown = null;
    try {
      du = await res.json();
    } catch {
      du = null;
    }
    const m = moTaLoiHttpV1(res.status, du, res.headers?.get?.("retry-after"));
    if (res.status === 401) ch.khi401?.();
    throw new LoiModel(m.thongDiep, { tamThoi: m.tamThoi, ma: m.ma });
  }

  const tt = trangThaiLuongMoi();
  const giaiMa = new TextDecoder();
  let dem = "";
  let daXongDone = false;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const kq = tachKhungSse(dem, giaiMa.decode(value, { stream: true }));
      dem = kq.du;
      if (kq.hong.some((h) => h.trim() === "[DONE]")) daXongDone = true;
      for (const sk of kq.suKien) {
        for (const m of apSuKienV1(tt, sk)) yield m;
      }
      if (daXongDone) break;
    }
    if (!daXongDone && dem.trim()) {
      const kq = tachKhungSse(dem, "\n\n");
      if (kq.hong.some((h) => h.trim() === "[DONE]")) daXongDone = true;
      for (const sk of kq.suKien) for (const m of apSuKienV1(tt, sk)) yield m;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* đã đóng */
    }
  }
  if (tt.loi) {
    // Lỗi có dấu suy-luận: ném nguyên văn để vòng ngoài nhận ra (giữ dấu trong `message`).
    if (laLoiToolCallTrongSuyLuan(tt.loi)) throw Object.assign(new Error(tt.loi), { dauSuyLuan: true });
    throw new LoiModel(`Lỗi sinh chữ trên máy chủ: ${tt.loi}`, { tamThoi: true, ma: "MODEL_LOI_LUONG" });
  }
  if (!daXongDone && !tt.finishReason) {
    throw new LoiModel("Luồng /v1 đứt trước khi model trả lời xong.", { tamThoi: true, ma: "MODEL_CUT" });
  }
  yield { loai: "xong", toolCalls: toolCallsCuoi(tt), ...(tt.usage ? { usage: tt.usage } : {}) };
}

export function taoGoiModelV1(ch: CauHinhGoiModelV1): GoiModel {
  return (vao) =>
    (async function* () {
      try {
        yield* motLuot(ch, vao, false);
      } catch (e) {
        if (!(e as { dauSuyLuan?: boolean })?.dauSuyLuan || vao.signal.aborted) throw e;
        // ★ Hỏi lại ĐÚNG MỘT lần, nghĩ TẮT. Lần hai vẫn hỏng ⇒ lỗi model (không lặp).
        try {
          yield* motLuot(ch, vao, true);
        } catch (e2) {
          if ((e2 as { dauSuyLuan?: boolean })?.dauSuyLuan) {
            throw new LoiModel(
              "Model phát lời gọi tool bên trong phần suy luận hai lần liền (kể cả khi đã yêu cầu tắt nghĩ) — lượt bị bỏ để không biến chữ suy luận thành hành động.",
              { ma: "TOOL_CALL_TRONG_SUY_LUAN" },
            );
          }
          throw e2;
        }
      }
    })();
}
