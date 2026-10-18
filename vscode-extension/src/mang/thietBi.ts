/**
 * ★★★ ĐỢT 4B — DEVICE FLOW (I/O): xin mã ⇒ mở trình duyệt tới trang xác nhận ⇒ hỏi định kỳ ⇒ lưu token vào
 * SecretStorage. Mọi phụ thuộc (fetch, mở trình duyệt, ngủ, đồng hồ, lưu) TIÊM vào để lưới đo được không cần VSCode.
 *
 * Bất biến:
 * - Hỏi KHÔNG nhanh hơn `interval`; `slow_down` ⇒ +5 s (RFC 8628 §3.5).
 * - Dừng khi: có token · bị từ chối · hết hạn (đồng hồ CỤC BỘ cũng canh `expires_in`, không chỉ tin máy chủ) · huỷ.
 * - Token chỉ đi vào `luuToken` (SecretStorage) — hàm này không log, không trả token cho UI.
 */
import { kiemTraServerUrl } from "../loi/dangNhap";
import { PHAM_VI_XIN, docPhanHoiDoiMa, docPhanHoiTuThuHoi, docPhanHoiXinMa, type KetQuaTuThuHoi, type MaThietBi } from "../loi/thietBi";

export interface PhuThuocThietBi {
  serverUrl: string;
  tenThietBi: string;
  fetch?: typeof fetch;
  /** Mở URL xác nhận (VSCode: `env.openExternal`). Trả false ⇒ người dùng tự mở (URL được hiện). */
  moTrinhDuyet: (url: string, ma: MaThietBi) => Promise<boolean> | boolean;
  /** Ghi token (VSCode: `context.secrets.store`). */
  luuToken: (token: string, thongTin: { hetHanLuc?: string; tienTo?: string }) => Promise<void>;
  ngu?: (ms: number, signal?: AbortSignal) => Promise<void>;
  dongHo?: () => number;
  signal?: AbortSignal;
}

export type KetQuaThietBi =
  | { ok: true; tienTo?: string; hetHanLuc?: string }
  | { ok: false; ly: "tu-choi" | "het-han" | "huy" | "loi"; lyDo: string };

const nguMacDinh = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        res();
      },
      { once: true },
    );
  });

async function docJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function dangNhapThietBi(pt: PhuThuocThietBi): Promise<KetQuaThietBi> {
  const goiFetch = pt.fetch ?? fetch;
  const ngu = pt.ngu ?? nguMacDinh;
  const dongHo = pt.dongHo ?? Date.now;
  const kt = kiemTraServerUrl(pt.serverUrl);
  if (!kt.ok) return { ok: false, ly: "loi", lyDo: kt.lyDo };

  let xin: Response;
  try {
    xin = await goiFetch(`${kt.url}/api/ai/gateway-token/thiet-bi`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ten: pt.tenThietBi, phamVi: [...PHAM_VI_XIN] }),
      signal: pt.signal,
    });
  } catch (e) {
    if (pt.signal?.aborted) return { ok: false, ly: "huy", lyDo: "Đã huỷ đăng nhập." };
    return { ok: false, ly: "loi", lyDo: `Không nối được máy chủ ${kt.url}: ${(e as Error).message}` };
  }
  const kqXin = docPhanHoiXinMa(xin.status, await docJson(xin));
  if (!kqXin.ok) return { ok: false, ly: "loi", lyDo: kqXin.lyDo };
  const ma = kqXin.ma;

  await pt.moTrinhDuyet(`${kt.url}${ma.duongXacNhan}`, ma);

  const batDau = dongHo();
  const hanMs = ma.hetHanGiay * 1000;
  let chuKyMs = ma.chuKyGiay * 1000;
  for (;;) {
    await ngu(chuKyMs, pt.signal);
    if (pt.signal?.aborted) return { ok: false, ly: "huy", lyDo: "Đã huỷ đăng nhập." };
    if (dongHo() - batDau >= hanMs) return { ok: false, ly: "het-han", lyDo: "Mã thiết bị đã hết hạn — chạy lại lệnh đăng nhập." };
    let res: Response;
    try {
      res = await goiFetch(`${kt.url}/api/ai/gateway-token/thiet-bi/doi`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ device_code: ma.maThietBi }),
        signal: pt.signal,
      });
    } catch (e) {
      if (pt.signal?.aborted) return { ok: false, ly: "huy", lyDo: "Đã huỷ đăng nhập." };
      // Mạng chập chờn giữa chừng: hỏi tiếp tới khi hết hạn (mã vẫn sống trên máy chủ).
      void e;
      continue;
    }
    const kq = docPhanHoiDoiMa(res.status, await docJson(res));
    if (kq.loai === "xong") {
      await pt.luuToken(kq.token, { hetHanLuc: kq.hetHanLuc, tienTo: kq.tienTo });
      return { ok: true, tienTo: kq.tienTo, hetHanLuc: kq.hetHanLuc };
    }
    if (kq.loai === "cho") continue;
    if (kq.loai === "cham-lai") {
      chuKyMs += 5000;
      continue;
    }
    if (kq.loai === "tu-choi") return { ok: false, ly: "tu-choi", lyDo: "Bạn (hoặc người duyệt) đã TỪ CHỐI thiết bị này trên trang xác nhận." };
    if (kq.loai === "het-han") return { ok: false, ly: "het-han", lyDo: "Mã thiết bị đã hết hạn — chạy lại lệnh đăng nhập." };
    if (kq.tamThoi) continue;
    return { ok: false, ly: "loi", lyDo: kq.lyDo };
  }
}

/**
 * ★★★ 4B-client — ĐĂNG XUẤT THU HỒI THẬT: trình CHÍNH token đang giữ cho `POST /api/ai/gateway-token/tu-thu-hoi`.
 * Không bao giờ ném: lỗi mạng/máy chủ ⇒ `{ok:false}` để lệnh Đăng xuất VẪN xoá token cục bộ và cảnh báo người dùng rằng
 * token còn sống trên máy chủ tới khi thu hồi ở trang web. Không thân yêu cầu (máy chủ chỉ đọc header).
 */
export async function thuHoiTokenCuaMinh(pt: { serverUrl: string; token: string; fetch?: typeof fetch; signal?: AbortSignal }): Promise<KetQuaTuThuHoi> {
  const kt = kiemTraServerUrl(pt.serverUrl);
  if (!kt.ok) return { ok: false, lyDo: kt.lyDo };
  let res: Response;
  try {
    res = await (pt.fetch ?? fetch)(`${kt.url}/api/ai/gateway-token/tu-thu-hoi`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${pt.token}` },
      signal: pt.signal,
    });
  } catch (e) {
    return { ok: false, lyDo: `Không nối được máy chủ ${kt.url}: ${(e as Error).message}` };
  }
  return docPhanHoiTuThuHoi(res.status, await docJson(res));
}
