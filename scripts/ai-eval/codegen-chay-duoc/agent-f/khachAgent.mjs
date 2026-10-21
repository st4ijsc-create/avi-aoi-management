/**
 * BỘ F — client SSE của API agent (thiết kế Đợt 1 §3/§4). API CHƯA tồn tại khi viết: viết theo hợp đồng.
 *   POST ${base}/api/ai/agent/runs  thân {cauHoi, projectId, cheDo:"tu-dong"}  ⇒ SSE, mỗi khối `data: <JSON có trường loai>`
 *   đọc tới sự kiện `xong`; hết trần client ⇒ POST /api/ai/agent/runs/:id/huy (client bỏ đi KHÔNG huỷ lượt chạy, §4).
 * Trả: runId, ms, ttftMs, soGoiTool, luotMax, tool{ten:số}, toolLoi, canDuyet, biBac, usage{vao,ra,nghi} (CỘNG mọi
 * sự kiện `usage` — nếu server phát số luỹ kế thì dùng `usageCuoi`), ctxMax, checkpointTep, lyDo, tomTat, loi[], http.
 */
export async function chayAgent({ base, cookie, cauHoi, projectId, tranMs }) {
  const t0 = Date.now();
  const ac = new AbortController();
  const hen = setTimeout(() => ac.abort(), tranMs);
  const g = { runId: null, ms: 0, ttftMs: null, soGoiTool: 0, luotMax: 0, tool: {}, toolOk: {}, toolMa: {}, toolLoi: 0, canDuyet: 0,
    biBac: 0, usage: { vao: 0, ra: 0, nghi: 0 }, usageCuoi: null, ctxMax: null, checkpointTep: [], lyDo: null,
    tomTat: null, loi: [], chu: 0, hetGioClient: false, http: null };
  try {
    const res = await fetch(`${base}/api/ai/agent/runs`, {
      method: "POST", signal: ac.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", Cookie: cookie },
      body: JSON.stringify({ cauHoi, projectId, cheDo: "tu-dong" }),
    });
    g.http = res.status;
    if (!res.ok) { g.loi.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); return g; }
    const dec = new TextDecoder();
    let buf = "";
    const xuLy = (o) => {
      switch (o.loai) {
        case "bat-dau": g.runId = o.runId; break;
        case "chu": if (g.ttftMs === null) g.ttftMs = Date.now() - t0; g.chu += (o.noiDung ?? "").length; break;
        case "goi-tool": g.soGoiTool++; g.luotMax = Math.max(g.luotMax, o.luot ?? 0);
          g.tool[o.goi?.ten ?? "?"] = (g.tool[o.goi?.ten ?? "?"] ?? 0) + 1; break;
        case "ket-qua-tool":
          if (!o.ok) g.toolLoi++;
          // ★ Đợt 9 — theo TÊN tool: số lượt OK + mã lỗi (kiểm nhánh của ablation `compile_st`)
          if (o.ok && o.ten) g.toolOk[o.ten] = (g.toolOk[o.ten] ?? 0) + 1;
          if (!o.ok && o.ten && o.ma) (g.toolMa[o.ten] ??= []).push(o.ma);
          break;
        case "can-duyet": g.canDuyet++; break;
        case "bi-bac": g.biBac++; break;
        case "checkpoint": g.checkpointTep.push(...(o.tep ?? [])); break;
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
        // Server (T4) gửi phong bì `{seq, suKien}` (để nối lại `?tu=n`); chấp nhận cả sự kiện trần.
        const e = o && typeof o === "object" && o.suKien && typeof o.suKien === "object" ? o.suKien : o;
        xuLy(e);
        if (e.loai === "xong") break outer;
      }
    }
  } catch (e) {
    if (ac.signal.aborted) {
      g.hetGioClient = true;
      g.loi.push(`hết trần client ${tranMs / 60000} phút`);
      // Client bỏ đi KHÔNG huỷ lượt chạy (thiết kế §4) ⇒ huỷ tường minh, kẻo lượt sau chạy chồng.
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

