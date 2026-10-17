/**
 * ★★★ Đợt 3c (2026-10-17) — ĐIỂM NỐI của "Chạy & Xem trước": singleton trình quản lý (deps THẬT), sổ vé, cấu hình
 * proxy xem trước, khởi động/tắt. Logic nằm ở `quanLyUngDung.ts` / `proxyXemTruoc.ts` (lưới riêng, deps tiêm).
 *
 * Cấu hình (đọc lúc khởi động):
 *   • `AI_PREVIEW_PORT_RANGE`   — dải cổng ứng dụng (mặc định 5100–5199).
 *   • `AI_PREVIEW_PROXY_PORT`   — cổng proxy xem trước. **VẮNG ⇒ XEM TRƯỚC TẮT** (chạy ứng dụng vẫn được): một
 *                                 listener mạng MỚI là quyết định của người triển khai, không bật ngầm theo bản cập
 *                                 nhật. Cổng trùng cổng ứng dụng / rơi vào dải xem trước ⇒ TỪ CHỐI khởi động proxy.
 *   • `AI_PREVIEW_PROXY_HOST`   — địa chỉ nghe của proxy (mặc định `0.0.0.0` để máy trạm LAN xem được).
 *   • `AI_PREVIEW_PUBLIC_ORIGIN`— origin trình duyệt dùng để tới proxy. **BẮT BUỘC và PHẢI KHÁC SITE** với ứng dụng
 *                                 (`cungSite.ts`): vắng ⇒ TẮT (`THIEU_ORIGIN_RIENG`); méo ⇒ `ORIGIN_KHONG_HOP_LE`;
 *                                 nhóm loopback "tên" (localhost/127.0.0.1/::1) hoặc cùng site với một origin trong
 *                                 `ALLOWED_ORIGINS` ⇒ `ORIGIN_CUNG_SITE`. ⚠ Trước bản vá (rà f4b504dc5) vắng biến này
 *                                 thì suy `<host của yêu cầu>:<cổng proxy>` = CÙNG HOST ⇒ cookie-tossing. Máy dev:
 *                                 `AI_PREVIEW_PUBLIC_ORIGIN=http://127.0.0.2:5099` + `AI_PREVIEW_PROXY_HOST=127.0.0.2`.
 *                                 Lúc cấp vé, tuyến `/api/ai/preview` còn so với host ỨNG DỤNG của chính yêu cầu.
 */
import type http from "node:http";
import { gietCayTienTrinh } from "../../aiLocalTools/repoCommandSandbox";
import { logCrudOperation } from "../../auditTrailService";
import { coNgheCong, congTrongThat, docDaiCong, trongDai, type DaiCong } from "./capCong";
import { sinhUngDungThat } from "./cuaSinhUngDung";
import { GOI_Y_CAU_HINH_ORIGIN_RIENG, cungSite, laNhomLoopbackTen } from "./cungSite";
import { KhoVeXemTruoc, taoMayChuXemTruoc } from "./proxyXemTruoc";
import { QuanLyUngDung, type SuKienAuditUngDung } from "./quanLyUngDung";

export const BIEN_CONG_PROXY = "AI_PREVIEW_PROXY_PORT";
export const BIEN_HOST_PROXY = "AI_PREVIEW_PROXY_HOST";
export const BIEN_ORIGIN_CONG_KHAI = "AI_PREVIEW_PUBLIC_ORIGIN";

export interface CauHinhXemTruoc {
  bat: boolean;
  cong: number | null;
  host: string;
  originCongKhai: string | null;
  dai: DaiCong;
  /** Lý do TẮT khi `bat=false` (mã máy-đọc-được). */
  lyDoTat:
    | "CHUA_CAU_HINH"
    | "CONG_KHONG_HOP_LE"
    | "TRUNG_CONG_UNG_DUNG"
    | "TRUNG_DAI_XEM_TRUOC"
    | "THIEU_ORIGIN_RIENG"
    | "ORIGIN_KHONG_HOP_LE"
    | "ORIGIN_CUNG_SITE"
    | null;
}

export function docCauHinhXemTruoc(env: NodeJS.ProcessEnv = process.env, congUngDung?: number): CauHinhXemTruoc {
  const dai = docDaiCong(env);
  const host = String(env[BIEN_HOST_PROXY] ?? "").trim() || "0.0.0.0";
  let originCongKhai: string | null = null;
  const o = String(env[BIEN_ORIGIN_CONG_KHAI] ?? "").trim();
  if (o) {
    try {
      const u = new URL(o);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.pathname === "/" && !u.username) originCongKhai = u.origin;
    } catch {
      originCongKhai = null;
    }
  }
  const tho = String(env[BIEN_CONG_PROXY] ?? "").trim();
  const tat = (lyDo: CauHinhXemTruoc["lyDoTat"]): CauHinhXemTruoc => ({ bat: false, cong: null, host, originCongKhai, dai, lyDoTat: lyDo });
  if (tho === "") return tat("CHUA_CAU_HINH");
  const cong = Number(tho);
  if (!Number.isInteger(cong) || cong < 1024 || cong > 65535) return tat("CONG_KHONG_HOP_LE");
  const ungDung = congUngDung ?? Number(env.PORT ?? 3000);
  if (cong === ungDung) return tat("TRUNG_CONG_UNG_DUNG");
  if (trongDai(cong, dai)) return tat("TRUNG_DAI_XEM_TRUOC");
  // ★★★ Vá cookie-tossing: origin RIÊNG là BẮT BUỘC và phải KHÁC SITE (cookie không tách theo cổng).
  if (o === "") return tat("THIEU_ORIGIN_RIENG");
  if (originCongKhai === null) return tat("ORIGIN_KHONG_HOP_LE");
  const hostXemTruoc = new URL(originCongKhai).hostname;
  if (laNhomLoopbackTen(hostXemTruoc)) return tat("ORIGIN_CUNG_SITE");
  for (const a of String(env.ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    let h: string | null = null;
    try {
      h = new URL(a).hostname;
    } catch {
      h = null;
    }
    if (h !== null && cungSite(h, hostXemTruoc)) return tat("ORIGIN_CUNG_SITE");
  }
  return { bat: true, cong, host, originCongKhai, dai, lyDoTat: null };
}

/**
 * ★ CORS của ứng dụng chính KHÔNG được phản chiếu origin xem trước (kể cả nhánh dev "phản chiếu mọi origin"):
 * script do AI sinh chạy ở origin ấy. `true` ⇔ origin trỏ tới cổng proxy, hoặc trùng `AI_PREVIEW_PUBLIC_ORIGIN`.
 */
export function laOriginXemTruoc(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return false;
  const ch = docCauHinhXemTruoc(env);
  try {
    const u = new URL(origin);
    const cong = Number(u.port || (u.protocol === "https:" ? 443 : 80));
    if (ch.originCongKhai && u.origin === ch.originCongKhai) return true;
    const tho = Number(String(env[BIEN_CONG_PROXY] ?? "").trim());
    return Number.isInteger(tho) && tho > 0 && cong === tho;
  } catch {
    return false;
  }
}

function ghiAuditThat(e: SuKienAuditUngDung): void {
  void logCrudOperation(
    { userId: e.userId, source: e.userId === null ? "system" : "trpc" },
    {
      action: e.loai === "chay" ? "ai_app_start" : "ai_app_stop",
      entityType: "ai_ung_dung_xem_truoc",
      entityName: e.projectId,
      details: {
        operation: e.loai === "chay" ? "AI_APP_START" : "AI_APP_STOP",
        metadata: { projectId: e.projectId, cong: e.cong, lenh: e.lenh, lyDo: e.lyDo ?? null, chuaXacNhanChet: e.chuaXacNhanChet ?? false },
      },
      status: "success",
    },
  );
}

let ql: QuanLyUngDung | null = null;
let dongHoNhanRoi: NodeJS.Timeout | null = null;

export function quanLyUngDung(): QuanLyUngDung {
  if (ql) return ql;
  ql = new QuanLyUngDung(docDaiCong(), {
    sinh: sinhUngDungThat,
    giet: gietCayTienTrinh,
    bayGio: Date.now,
    congTrong: congTrongThat,
    thuKetNoi: (c) => coNgheCong(c),
    ghiAudit: ghiAuditThat,
  });
  dongHoNhanRoi = setInterval(() => {
    void ql?.kiemNhanRoi().catch(() => {});
  }, 60_000);
  dongHoNhanRoi.unref();
  return ql;
}

export const khoVeXemTruoc = new KhoVeXemTruoc();

let mayProxy: http.Server | null = null;

/** Khởi động proxy xem trước nếu được cấu hình. Không ném: lỗi ⇒ log + xem trước TẮT, ứng dụng chính chạy tiếp. */
export function khoiDongProxyXemTruoc(congUngDung: number): CauHinhXemTruoc {
  const ch = docCauHinhXemTruoc(process.env, congUngDung);
  if (!ch.bat || ch.cong === null) {
    if (ch.lyDoTat !== "CHUA_CAU_HINH") {
      const goiY = /ORIGIN/.test(String(ch.lyDoTat)) ? ` — ${GOI_Y_CAU_HINH_ORIGIN_RIENG}` : "";
      console.warn(`[XemTruoc] proxy TẮT: ${ch.lyDoTat} (${BIEN_CONG_PROXY}/${BIEN_ORIGIN_CONG_KHAI})${goiY}`);
    }
    return ch;
  }
  const q = quanLyUngDung();
  if (!ch.originCongKhai) return ch; // `bat` đã đòi origin riêng — giữ cho kiểu chặt.
  mayProxy = taoMayChuXemTruoc({
    hostCongKhai: new URL(ch.originCongKhai).hostname,
    kho: khoVeXemTruoc,
    nguon: {
      congCuaDuAn: (id) => q.congCuaDuAn(id),
      chuSoHuu: (id) => q.trangThai(id)?.chuSoHuu ?? null,
      cham: (id) => q.cham(id),
    },
    dai: ch.dai,
  });
  mayProxy.on("error", (e) => console.error(`[XemTruoc] proxy lỗi: ${(e as Error).message}`));
  mayProxy.listen(ch.cong, ch.host, () =>
    console.log(`[XemTruoc] proxy xem trước nghe ${ch.host}:${ch.cong}, origin công khai ${ch.originCongKhai} (dải ứng dụng ${ch.dai.tu}-${ch.dai.den})`),
  );
  return ch;
}

/** Tắt máy: dừng MỌI ứng dụng đang chạy (giết cây) + đóng proxy. */
export async function tatChayUngDung(): Promise<void> {
  if (dongHoNhanRoi) clearInterval(dongHoNhanRoi);
  dongHoNhanRoi = null;
  if (mayProxy) {
    mayProxy.closeAllConnections();
    mayProxy.close();
    mayProxy = null;
  }
  if (ql) await ql.dungHet();
}
