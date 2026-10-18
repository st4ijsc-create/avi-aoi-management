/**
 * BỘ "TÌM MÃ" — client SSE của `POST /api/ai/agent/runs` ở chế độ `hoi` (chỉ đọc). Khuôn `agent-f/khachAgent.mjs`
 * (phong bì `{seq, suKien}`, trần client ⇒ huỷ tường minh) nhưng GIỮ CHỮ câu trả lời để chấm:
 *   chu      = mọi sự kiện `chu` nối lại (chẩn đoán)
 *   chuCuoi  = phần `chu` SAU sự kiện tool cuối cùng (câu trả lời cuối; lời dẫn trước khi gọi tool không được chấm)
 *   tomTat   = `xong.tomTat` (máy chủ: 500 ký tự đầu của tin trợ lý cuối, đã gộp khoảng trắng)
 * Đếm: soGoiTool (mọi `goi-tool`, kể cả bị từ chối), tool{ten:số}, toolOk{ten:số ok}, toolLoi, luotMax, usage (CỘNG
 * mọi `usage`; `usageCuoi` = sự kiện cuối nếu máy chủ phát số luỹ kế).
 */
export async function hoiAgent({ base, cookie, cauHoi, projectId, tranMs, cheDo = "hoi" }) {
  const t0 = Date.now();
  const ac = new AbortController();
  const hen = setTimeout(() => ac.abort(), tranMs);
  const g = { runId: null, ms: 0, ttftMs: null, soGoiTool: 0, luotMax: 0, tool: {}, toolOk: {}, toolLoi: 0,
    usage: { vao: 0, ra: 0, nghi: 0 }, usageCuoi: null, ctxMax: null, lyDo: null, tomTat: null,
    chu: "", chuCuoi: "", deXuatNho: 0, loi: [], hetGioClient: false, http: null };
  const tenTheoId = new Map();
  try {
    const res = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: cookie },
      body: JSON.stringify({ cauHoi, projectId, cheDo }),
    });
    g.http = res.status;
    if (!res.ok) { g.loi.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); return g; }
    const dec = new TextDecoder();
    let buf = "";
    const xuLy = (o) => {
      switch (o.loai) {
        case "bat-dau": g.runId = o.runId; break;
        case "chu":
          if (g.ttftMs === null) g.ttftMs = Date.now() - t0;
          g.chu += o.noiDung ?? ""; g.chuCuoi += o.noiDung ?? ""; break;
        case "goi-tool": {
          const ten = o.goi?.ten ?? "?";
          g.soGoiTool++; g.luotMax = Math.max(g.luotMax, o.luot ?? 0);
          g.tool[ten] = (g.tool[ten] ?? 0) + 1;
          if (o.goi?.id) tenTheoId.set(o.goi.id, ten);
          g.chuCuoi = ""; break;
        }
        case "ket-qua-tool": {
          const ten = o.ten ?? tenTheoId.get(o.id) ?? "?";
          if (o.ok) g.toolOk[ten] = (g.toolOk[ten] ?? 0) + 1; else g.toolLoi++;
          g.chuCuoi = ""; break;
        }
        case "de-xuat-nho": g.deXuatNho++; break;
        case "usage":
          g.usage.vao += o.vao ?? 0; g.usage.ra += o.ra ?? 0; g.usage.nghi += o.nghi ?? 0; g.usageCuoi = o;
          if (o.ctxPhanTram != null) g.ctxMax = Math.max(g.ctxMax ?? 0, o.ctxPhanTram); break;
        case "xong": g.lyDo = o.lyDo; g.tomTat = o.tomTat ?? null; break;
        case "loi": g.loi.push(`${o.ma}: ${o.thongDiep}`); break;
        default: break;
      }
    };
    outer: for await (const c of res.body) {
      buf += dec.decode(c, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const blk = buf.slice(0, i);
        buf = buf.slice(buf.slice(i).match(/^\r?\n\r?\n/)[0].length + i);
        const data = blk.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        let o; try { o = JSON.parse(data); } catch { continue; }
        const e = o && typeof o === "object" && o.suKien && typeof o.suKien === "object" ? o.suKien : o;
        xuLy(e);
        if (e.loai === "xong") break outer;
      }
    }
  } catch (e) {
    if (ac.signal.aborted) {
      g.hetGioClient = true;
      g.loi.push(`hết trần client ${tranMs / 60000} phút`);
      if (g.runId) {
        try { await fetch(`${base}/api/ai/agent/runs/${g.runId}/huy`, { method: "POST", headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) }); }
        catch { /* bỏ qua */ }
      }
    } else g.loi.push(String(e));
  } finally {
    clearTimeout(hen);
    g.ms = Date.now() - t0;
  }
  return g;
}

/** Văn bản đem chấm: câu trả lời cuối + tóm tắt của máy chủ (một trong hai có thể rỗng). */
export const vanBanCham = (g) => `${g.chuCuoi ?? ""}\n${g.tomTat ?? ""}`;
