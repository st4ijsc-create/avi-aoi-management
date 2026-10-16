/**
 * shared/agentCore — vòng agent (spec Đợt 1 §3 "Vòng").
 *
 * gửi model (system + ngữ cảnh dự án + lịch sử + câu hỏi) → stream `chu`/`nghi` → có `toolCalls` ⇒ chạy LẦN LƯỢT qua
 * `boThucThi.chay` (phát `goi-tool`/`ket-qua-tool`), nối `role:"tool"` có `tool_call_id` → lặp; không tool call ⇒ `hoan-thanh`.
 *
 * Bất biến:
 * - Tool CHỈ đến từ `toolCalls` của mảnh `xong` của model. Kết quả tool và chữ của model là DỮ LIỆU — không bao giờ
 *   bị quét tìm lệnh (một kết quả chứa chuỗi giống tool call KHÔNG làm vòng gọi tool).
 * - Không ném vì lỗi của model/tool: lỗi tham số, tool sai chế độ, bộ thực thi ném ⇒ kết quả lỗi cho model đọc.
 * - Lịch sử trả về luôn HỢP LỆ: mọi assistant có tool_calls được theo sau bởi đủ tin `tool` cùng id (lời gọi không chạy
 *   vì vòng dừng nhận kết quả tổng hợp `[not executed: …]`).
 * - Huỷ (`signal`) ngắt NGAY cả lúc đang chờ model lẫn lúc đang chờ `boThucThi.chay` (kể cả khi bên kia không nghe signal);
 *   signal truyền xuống model/bộ thực thi bị abort để chúng tự dừng. Khi vòng kết thúc (bất kỳ lý do), signal trong cũng bị
 *   abort để dọn việc còn treo.
 */
import { CONG_CU_TODO_WRITE, chuanHoaThamSo, kiemThamSo } from "./congCu";
import { dungLoiNhacHeThong } from "./loiNhac";
import { catDauDuoi, nenLichSu, uocLuongTokenMacDinh, type UocLuongToken } from "./nguCanh";
import {
  GIOI_HAN_MAC_DINH,
  MA_MENH_LENH_TRONG_DU_LIEU,
  laLoiTamThoi,
  type BoThucThi,
  type CheDoAgent,
  type GioiHanVong,
  type GoiModel,
  type KetQuaTool,
  type LoiGoiTool,
  type LyDoDung,
  type ManhModel,
  type NgonNgu,
  type SuKienAgent,
  type TinNhan,
  type ViecKeHoach,
  type WireTool,
  type WireToolCall,
} from "./kieu";

export interface DauVaoVongAgent {
  cauHoi: string;
  /** hội thoại trước (không gồm system — tin `system` trong đây bị bỏ, lõi tự dựng system) */
  lichSu?: TinNhan[];
  cheDo: CheDoAgent;
  runId: string;
  nguCanhDuAn: string;
  goiModel: GoiModel;
  boThucThi: BoThucThi;
  phat: (e: SuKienAgent) => void;
  signal: AbortSignal;
  gioiHan?: Partial<GioiHanVong>;
  dongHo?: () => number;
  /** (mở rộng) ngôn ngữ trả lời — mặc định `vi` */
  ngonNgu?: NgonNgu;
  /** (mở rộng) ước lượng token tiêm vào — server truyền `uocLuongSoToken`; mặc định 2,8 ký tự/token */
  uocLuongToken?: UocLuongToken;
}

export interface KetQuaVongAgent {
  lyDo: LyDoDung;
  tinNhan: TinNhan[];
}

const HUY = Symbol("huy");
const TRAN_TOM_TAT = 300;

type KetQuaLuotModel =
  | { loai: "ok"; chu: string; nghi: string; toolCalls: WireToolCall[]; usage?: { vao: number; ra: number; nghi?: number } }
  | { loai: "huy" }
  | { loai: "het-gio"; chu: string }
  | { loai: "loi"; loi: unknown };

const thongDiepLoi = (e: unknown) => (e instanceof Error ? e.message : String(e));

function rutGon(s: string, tran: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= tran ? t : `${t.slice(0, tran - 1)}…`;
}

const TRANG_THAI_VIEC: Record<string, ViecKeHoach["trangThai"]> = {
  pending: "cho",
  in_progress: "dang-lam",
  completed: "xong",
};

export async function chayVongAgent(y: DauVaoVongAgent): Promise<KetQuaVongAgent> {
  const gh: GioiHanVong = { ...GIOI_HAN_MAC_DINH, ...(y.gioiHan ?? {}) };
  const dongHo = y.dongHo ?? Date.now;
  const uoc = y.uocLuongToken ?? uocLuongTokenMacDinh;
  const batDau = dongHo();
  const hetGio = () => dongHo() - batDau >= gh.msToiDa;

  const phat = (e: SuKienAgent) => {
    try {
      y.phat(e);
    } catch {
      /* người nghe UI hỏng không được làm hỏng vòng */
    }
  };

  // signal trong: abort khi người dùng huỷ, và khi vòng kết thúc (dọn việc treo)
  const ngoai = y.signal;
  const trong = new AbortController();
  const khiHuyNgoai = () => trong.abort(ngoai.reason);
  if (ngoai.aborted) trong.abort(ngoai.reason);
  else ngoai.addEventListener("abort", khiHuyNgoai, { once: true });
  const choHuy = new Promise<typeof HUY>((res) => {
    if (trong.signal.aborted) res(HUY);
    else trong.signal.addEventListener("abort", () => res(HUY), { once: true });
  });

  // bộ tool: của bộ thực thi theo chế độ + todo_write (lõi tự xử lý) nếu thiếu
  const congCu: WireTool[] = [...y.boThucThi.congCu(y.cheDo)];
  if (!congCu.some((t) => t.function.name === "todo_write")) congCu.push(structuredClone(CONG_CU_TODO_WRITE));
  const tenDuocPhep = new Set(congCu.map((t) => t.function.name));

  const heThong = dungLoiNhacHeThong({ cheDo: y.cheDo, ngonNgu: y.ngonNgu ?? "vi" });
  let tinNhan: TinNhan[] = [
    { role: "system", content: y.nguCanhDuAn ? `${heThong}\n\n${y.nguCanhDuAn}` : heThong },
    ...(y.lichSu ?? []).filter((m) => m.role !== "system"),
    { role: "user", content: y.cauHoi },
  ];

  phat({ loai: "bat-dau", runId: y.runId, cheDo: y.cheDo });

  // ── một lượt model, ngắt được bởi huỷ ──
  async function motLuotModel(luot: number): Promise<KetQuaLuotModel> {
    let chu = "";
    let nghi = "";
    let iter: AsyncIterator<ManhModel>;
    try {
      iter = y.goiModel({ tinNhan: tinNhan.slice(), congCu, signal: trong.signal })[Symbol.asyncIterator]();
    } catch (e) {
      return ngoai.aborted ? { loai: "huy" } : { loai: "loi", loi: e };
    }
    const dong = () => {
      try {
        const r = iter.return?.();
        if (r && typeof (r as Promise<unknown>).catch === "function") (r as Promise<unknown>).catch(() => {});
      } catch {
        /* bỏ qua */
      }
    };
    try {
      for (;;) {
        const tiep = iter.next();
        tiep.catch(() => {}); // lượt bị bỏ dở vẫn có thể từ chối về sau — không để rò unhandled rejection
        const buoc = await Promise.race([tiep, choHuy]);
        if (buoc === HUY) {
          dong();
          return { loai: "huy" };
        }
        if (buoc.done) {
          return {
            loai: "loi",
            loi: Object.assign(new Error(`model stream ended without completion (turn ${luot})`), { tamThoi: true, ma: "MODEL_CUT" }),
          };
        }
        const m = buoc.value;
        if (m.loai === "chu" && m.noiDung) {
          chu += m.noiDung;
          phat({ loai: "chu", noiDung: m.noiDung });
        } else if (m.loai === "nghi" && m.noiDung) {
          nghi += m.noiDung;
          phat({ loai: "nghi", noiDung: m.noiDung });
        } else if (m.loai === "cho") {
          phat({ loai: "dang-cho-model", phiaTruoc: Number(m.phiaTruoc) || 0 });
        } else if (m.loai === "xong") {
          dong();
          return { loai: "ok", chu, nghi, toolCalls: chuanHoaToolCalls(m.toolCalls, luot), usage: m.usage };
        }
        if (hetGio()) {
          dong();
          return { loai: "het-gio", chu };
        }
      }
    } catch (e) {
      return ngoai.aborted ? { loai: "huy" } : { loai: "loi", loi: e };
    }
  }

  function chuanHoaToolCalls(tho: unknown, luot: number): WireToolCall[] {
    if (!Array.isArray(tho)) return [];
    return tho.map((t, k) => {
      const o = (t ?? {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      const args = o.function?.arguments;
      return {
        id: typeof o.id === "string" && o.id.length > 0 ? o.id : `call_${y.runId}_${luot}_${k}`,
        type: "function" as const,
        function: {
          name: typeof o.function?.name === "string" ? o.function.name : "",
          arguments: typeof args === "string" ? args : args === undefined ? "" : JSON.stringify(args),
        },
      };
    });
  }

  // ── một lần chạy tool, ngắt được bởi huỷ ──
  async function chayCoHuy(goi: LoiGoiTool, luot: number): Promise<KetQuaTool | typeof HUY> {
    const p = Promise.resolve().then(() =>
      y.boThucThi.chay(goi, { cheDo: y.cheDo, runId: y.runId, luot, signal: trong.signal, phat }),
    );
    const boc = p.then(
      (v) => ({ v }),
      (e: unknown) => ({ e }),
    );
    const r = await Promise.race([boc, choHuy]);
    if (r === HUY) return HUY;
    if ("e" in r) {
      if (ngoai.aborted) return HUY;
      return { ok: false, ma: "LOI_THUC_THI", choModel: `Tool ${goi.ten} failed: ${thongDiepLoi(r.e)}` };
    }
    const v = r.v as KetQuaTool | undefined;
    if (!v || typeof v !== "object") return { ok: false, ma: "LOI_THUC_THI", choModel: `Tool ${goi.ten} returned no result.` };
    return { ...v, choModel: typeof v.choModel === "string" ? v.choModel : String(v.choModel ?? "") };
  }

  function xuLyTodo(thamSo: Record<string, unknown>): KetQuaTool {
    const todos = (thamSo.todos as Array<{ content: string; status: string }>) ?? [];
    const viec: ViecKeHoach[] = todos.map((t) => ({ noiDung: t.content, trangThai: TRANG_THAI_VIEC[t.status] ?? "cho" }));
    phat({ loai: "ke-hoach", viec });
    const dem = (s: ViecKeHoach["trangThai"]) => viec.filter((v) => v.trangThai === s).length;
    return {
      ok: true,
      choModel: `Todo list updated: ${viec.length} items (${dem("xong")} completed, ${dem("dang-lam")} in progress, ${dem("cho")} pending).`,
    };
  }

  const boSungKhongChay = (calls: WireToolCall[], tu: number, lyDo: LyDoDung) => {
    for (let j = tu; j < calls.length; j++) {
      tinNhan.push({
        role: "tool",
        tool_call_id: calls[j].id,
        name: calls[j].function.name,
        content: `[not executed: the run stopped (${lyDo})]`,
      });
    }
  };

  let luot = 0;
  let tokenRa = 0;
  let khoaLap = "";
  let demLap = 0;
  let lyDo: LyDoDung;

  try {
    vong: for (;;) {
      if (ngoai.aborted) {
        lyDo = "huy";
        break;
      }
      if (hetGio()) {
        lyDo = "het-gio";
        break;
      }
      if (luot >= gh.soLuotToiDa) {
        lyDo = "het-luot";
        break;
      }
      luot++;

      tinNhan = nenLichSu(tinNhan, { nganSachToken: gh.nganSachNguCanhToken, uocLuong: uoc }).tinNhan;

      // gọi model, thử lại tối đa 1 lần cho lỗi tạm thời (mỗi lượt)
      let kq: Extract<KetQuaLuotModel, { loai: "ok" }> | undefined;
      for (let thu = 0; !kq; thu++) {
        const r = await motLuotModel(luot);
        if (r.loai === "ok") kq = r;
        else if (r.loai === "huy") {
          lyDo = "huy";
          break vong;
        } else if (r.loai === "het-gio") {
          if (r.chu) tinNhan.push({ role: "assistant", content: r.chu });
          lyDo = "het-gio";
          break vong;
        } else if (laLoiTamThoi(r.loi) && thu === 0) {
          phat({ loai: "loi", ma: "MODEL_TAM_THOI", thongDiep: `${thongDiepLoi(r.loi)} — retrying` });
        } else {
          const ma = (r.loi as { ma?: unknown })?.ma;
          phat({ loai: "loi", ma: typeof ma === "string" ? ma : "MODEL_LOI", thongDiep: thongDiepLoi(r.loi) });
          lyDo = "loi-model";
          break vong;
        }
      }

      if (kq.usage) {
        const u = kq.usage;
        phat({
          loai: "usage",
          vao: u.vao,
          ra: u.ra,
          ...(u.nghi !== undefined ? { nghi: u.nghi } : {}),
          ctxPhanTram: Math.round((u.vao * 100) / gh.nganSachNguCanhToken),
        });
        tokenRa += u.ra;
      } else {
        tokenRa += uoc(kq.chu + kq.nghi);
      }

      const calls = kq.toolCalls;
      tinNhan.push(calls.length ? { role: "assistant", content: kq.chu, tool_calls: calls } : { role: "assistant", content: kq.chu });
      if (calls.length === 0) {
        lyDo = "hoan-thanh";
        break;
      }
      if (tokenRa >= gh.tokenRaToiDa) {
        lyDo = "het-token";
        boSungKhongChay(calls, 0, lyDo);
        break;
      }

      for (let k = 0; k < calls.length; k++) {
        const tc = calls[k];
        if (ngoai.aborted || hetGio()) {
          lyDo = ngoai.aborted ? "huy" : "het-gio";
          boSungKhongChay(calls, k, lyDo);
          break vong;
        }
        const ten = tc.function.name;
        const kt = kiemThamSo(ten, tc.function.arguments);

        // lặp lại: cùng tên + cùng tham số chuẩn hoá, liên tiếp
        const khoa = `${ten}\u0000${kt.ok ? chuanHoaThamSo(kt.thamSo) : tc.function.arguments.trim()}`;
        if (khoa === khoaLap) demLap++;
        else {
          khoaLap = khoa;
          demLap = 1;
        }
        if (demLap >= 3) {
          lyDo = "lap-lai";
          boSungKhongChay(calls, k, lyDo);
          break vong;
        }

        const goi: LoiGoiTool = { id: tc.id, ten, thamSo: kt.ok ? kt.thamSo : {} };
        phat({ loai: "goi-tool", goi, luot });

        let ketQua: KetQuaTool;
        if (!tenDuocPhep.has(ten)) {
          ketQua = {
            ok: false,
            ma: "CONG_CU_KHONG_CO",
            choModel: `Tool "${ten}" is not available in this mode (${y.cheDo}). Available tools: ${[...tenDuocPhep].join(", ")}.`,
          };
        } else if (!kt.ok) {
          ketQua = { ok: false, ma: "THAM_SO_SAI", choModel: kt.loiChoModel };
        } else if (ten === "todo_write") {
          ketQua = xuLyTodo(kt.thamSo);
        } else {
          const r = await chayCoHuy(goi, luot);
          if (r === HUY) {
            lyDo = "huy";
            tinNhan.push({ role: "tool", tool_call_id: tc.id, name: ten, content: "[interrupted: the run was cancelled]" });
            boSungKhongChay(calls, k + 1, lyDo);
            break vong;
          }
          ketQua = r;
        }

        const choModel = catDauDuoi(ketQua.choModel, gh.kyTuQuanSatToiDa);
        tinNhan.push({ role: "tool", tool_call_id: tc.id, name: ten, content: choModel });
        phat({
          loai: "ket-qua-tool",
          id: tc.id,
          ten,
          ok: ketQua.ok === true,
          tomTat: rutGon(choModel, TRAN_TOM_TAT),
          ...(ketQua.ma !== undefined ? { ma: ketQua.ma } : {}),
          ...(ketQua.hienThi !== undefined ? { hienThi: ketQua.hienThi } : {}),
        });

        if (ketQua.ma === MA_MENH_LENH_TRONG_DU_LIEU) {
          lyDo = "menh-lenh-trong-du-lieu";
          boSungKhongChay(calls, k + 1, lyDo);
          break vong;
        }
      }
    }
  } finally {
    ngoai.removeEventListener("abort", khiHuyNgoai);
    if (!trong.signal.aborted) trong.abort();
  }

  const cuoi = [...tinNhan].reverse().find((m) => m.role === "assistant" && m.content.trim());
  phat({ loai: "xong", lyDo, ...(cuoi ? { tomTat: rutGon(cuoi.content, 500) } : {}) });
  return { lyDo, tinNhan };
}
