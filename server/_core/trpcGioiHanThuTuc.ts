/**
 * ★★★ Giới hạn tốc độ theo SỐ THỦ TỤC NHẠY CẢM trong yêu cầu tRPC (rà bảo mật 2026-10-24, dieu-phoi duyệt mục 4).
 *
 * Vì sao: bộ giới hạn hiện có (`apiLimiter` 300/phút, `authLimiter` 30/15 phút chỉ gắn `/api/auth/`) đếm theo YÊU CẦU HTTP. Một batch tRPC chở được nhiều thủ tục
 * (đã chặn trần `TRPC_MAX_BATCH_SIZE` = 25, xem `shared/trpcBatch.ts`) nên 25 lần thử TOTP / đăng nhập vẫn chỉ tốn MỘT lượt đếm. Middleware này đếm TỪNG THỦ TỤC nhạy cảm:
 *
 *   · nhóm `2fa` — mọi MUTATION `twoFactor.*`, `user.setup2FA/verify2FA/disable2FA` (gọi verifyTotpOnce / đổi 2FA) và MỌI thủ tục đứng trên bước nâng cấp 2FA
 *     (`requireFreshTotp` / `requirePerCallFreshTotp` — tập này suy RA LÚC KHỞI ĐỘNG từ chính `appRouter`, không chép tay): 20 thủ tục / 15 phút cho MỖI khoá, khoá theo IP VÀ
 *     theo người dùng đã đăng nhập (openId trong phiên — hai khoá độc lập, vượt MỘT trong hai là 429);
 *   · nhóm `auth` — `auth.login`, `auth.setupAdmin`, `user.changePassword`, `user.updatePassword`: theo `AUTH_RATE_LIMIT` hiện có (30 / 15 phút), cùng cách khoá.
 *
 * Vượt ⇒ 429 + `Retry-After` cho CẢ yêu cầu (không thủ tục nào chạy). Store lỗi ⇒ FAIL-OPEN như các limiter hiện có (lớp chính cho TOTP là bộ đếm sai theo TÀI KHOẢN fail-closed ở tầng DB),
 * nhưng GHI LOG cảnh báo. Đứng SAU trần batch và TRƯỚC giấy phép/xác thực/tRPC.
 *
 * ⚠ KHÔNG đếm QUERY của tiền tố (`twoFactor.getStatus` được trang nào cũng hỏi) — chỉ mutation (và mọi loại với danh sách chính xác). Loại thủ tục không tra được ⇒ coi như mutation (fail-closed).
 * ⚠ Các cửa REST `/api/auth/login`, `/api/auth/verify-2fa` (oauth.ts) vẫn do `authLimiter` (per yêu cầu, không batch được).
 * ⚠ Không sửa `verifyTotpOnce` (scada-master đang sửa — bộ đếm sai theo tài khoản); đây CHỈ là middleware ở rìa.
 */
import type { NextFunction, Request, Response } from "express";
import { ipKeyGenerator, type Store } from "express-rate-limit";
import type { AnyRouter } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { AUTH_RATE_LIMIT, taoStoreDem } from "./rateLimitConfig";
import { trpcProcedureType } from "./trpcAdapter";

export type NhomNhayCam = "2fa" | "auth";

export interface CauHinhNhom {
  readonly cuaSoMs: number;
  readonly toiDa: number;
  /** Tiền tố path; CHỈ đếm MUTATION (query không đếm). */
  readonly tienTo: readonly string[];
  /** Path chính xác; đếm mọi loại thủ tục. */
  readonly chinhXac: readonly string[];
}

/**
 * ★ DANH SÁCH NHÓM — nguồn sự thật DUY NHẤT. Có CENSUS (`trpcGioiHanThuTuc.census.test.ts`): thủ tục nào gọi `verifyTotpOnce` mà không rơi vào nhóm `2fa` ⇒ ĐỎ.
 */
export const NHOM_THU_TUC_NHAY_CAM: Readonly<Record<NhomNhayCam, CauHinhNhom>> = {
  "2fa": {
    cuaSoMs: 15 * 60 * 1000,
    toiDa: 20,
    tienTo: ["twoFactor."],
    // ⚠ scadaCommands.confirm CỐ Ý KHÔNG có ở đây (R1a final I-1, 2026-10-24): TOTP của nó đã chặn theo TÀI KHOẢN bởi khoá T16 trong verifyTotpOnce;
    // nhóm 20/15 phút chung IP + người sẽ bóp lệnh HMI mức 1/3 thường ngày. Miễn trừ ghi ở census kiemXacThucTheoMuc (trpcGioiHanThuTuc.census.test.ts).
    // ⚠ scadaCommands.dungMay (STOP HMI, R1b-1 Task 2) CỐ Ý KHÔNG thuộc nhóm nào: STOP không bao giờ bị phần mềm chặn; không xác minh TOTP
    // (census MIEN_TRU_KHONG_GIOI_HAN).
    // kiem-dinh P1-2 (2026-10-24): ba mutation cấu hình kênh / chế độ M12 xác minh TOTP tươi qua kiemXacThucTheoMuc (mức 5) ⇒ thuộc nhóm (việc hiếm).
    // R1b-1 Task 9 (2026-10-24): mappingAsCode.applyImport (lô đụng tag được bảo vệ) xác minh qua `kiemTotpCauHinh` ⇒ thuộc nhóm (việc hiếm).
    // ⚠ deviceAdapter.tags.create / update / delete (fix round 1) và deviceAdapter.update (fix round 2) CỐ Ý KHÔNG có ở đây (phán quyết T9 a):
    // nhóm đếm theo PATH ở rìa ⇒ mọi lượt sửa tag / adapter thường ngày (kể cả công tắc Bật) sẽ ăn chung xô 20 / 15 phút theo IP với 2FA /
    // deploy — một NAT nhà máy bị khoá khỏi mọi thủ tục 2fa; dò mã đã chặn theo TÀI KHOẢN bởi T16. Miễn trừ ghi ở census kiemXacThucTheoMuc.
    chinhXac: [
      "user.setup2FA",
      "user.verify2FA",
      "user.disable2FA",
      "scadaKenh.capNhat",
      "scadaKenh.cheDo.dat",
      "scadaKenh.cheDo.go",
      "mappingAsCode.applyImport",
    ],
  },
  auth: {
    cuaSoMs: AUTH_RATE_LIMIT.windowMs,
    toiDa: AUTH_RATE_LIMIT.max,
    tienTo: [],
    chinhXac: ["auth.login", "auth.setupAdmin", "user.changePassword", "user.updatePassword"],
  },
};

/**
 * Tập path của MỌI thủ tục đứng trên bước nâng cấp 2FA (middleware `requireFreshTotp` / `requirePerCallFreshTotp`), suy từ router thật — thêm thủ tục `deployProcedure` mới là tự được đếm.
 * tRPC giữ middleware của thủ tục ở `_def.middlewares`; `t.middleware(fn)` trả bộ dựng có `_middlewares` — so sánh theo DANH TÍNH hàm.
 */
export function layTapThuTucStepUp(router: AnyRouter, buocNangCap: readonly unknown[]): ReadonlySet<string> {
  const fns = new Set<unknown>();
  for (const mw of buocNangCap) {
    const ds = (mw as unknown as { _middlewares?: unknown[] })._middlewares;
    if (Array.isArray(ds)) for (const f of ds) fns.add(f);
  }
  const ra = new Set<string>();
  if (fns.size === 0) return ra;
  const procedures = router._def.procedures as Record<string, unknown>;
  for (const [path, p] of Object.entries(procedures)) {
    const mws = (p as { _def?: { middlewares?: unknown[] } } | undefined)?._def?.middlewares ?? [];
    if (mws.some((m) => fns.has(m))) ra.add(path);
  }
  return ra;
}

/** Path → nhóm nhạy cảm (hoặc null). `loai` = loại thủ tục tra được từ router (undefined = không biết ⇒ coi như mutation). */
export function phanNhomThuTuc(
  path: string,
  loai: "query" | "mutation" | "subscription" | undefined,
  tapStepUp: ReadonlySet<string> = new Set(),
  nhom: Readonly<Record<NhomNhayCam, CauHinhNhom>> = NHOM_THU_TUC_NHAY_CAM,
): NhomNhayCam | null {
  for (const ten of Object.keys(nhom) as NhomNhayCam[]) {
    if (nhom[ten].chinhXac.includes(path)) return ten;
  }
  if (loai !== "query") {
    for (const ten of Object.keys(nhom) as NhomNhayCam[]) {
      if (nhom[ten].tienTo.some((t) => path.startsWith(t))) return ten;
    }
    if (tapStepUp.has(path)) return "2fa";
  }
  return null;
}

/** Các path trong một yêu cầu tRPC (batch hoặc đơn), đã giải mã %2C. */
function layCacPath(req: Request): string[] {
  let p = req.path;
  try {
    p = decodeURIComponent(p);
  } catch {
    /* path hỏng: dùng thô */
  }
  p = p.replace(/^\/+/, "");
  if (p === "") return [];
  return req.query?.batch === "1" ? p.split(",") : [p];
}

/** Khoá người dùng từ cookie phiên: `u:<openId>` khi cookie hợp lệ (chỉ kiểm chữ ký JWT, không chạm DB), ngược lại null. */
async function khoaNguoiMacDinh(req: Request): Promise<string | null> {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const m = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(raw);
  if (!m) return null;
  const { sdk } = await import("./sdk");
  const phien = await sdk.verifySession(decodeURIComponent(m[1]!));
  return phien ? `u:${phien.openId}` : null;
}

export interface TuyChonGioiHanThuTuc {
  readonly router: AnyRouter;
  readonly nhom?: Readonly<Record<NhomNhayCam, CauHinhNhom>>;
  readonly taoStore?: (prefix: string, cuaSoMs: number) => Store;
  readonly layKhoaNguoi?: (req: Request) => Promise<string | null>;
  /** Các middleware bước nâng cấp 2FA (`requireFreshTotp`, `requirePerCallFreshTotp` của `_core/trpc`) — truyền từ nơi gắn để module này nhẹ, test được không kéo DB. */
  readonly buocNangCap?: readonly unknown[];
  readonly tapStepUp?: ReadonlySet<string>;
  readonly now?: () => number;
}

export function trpcGioiHanThuTucMiddleware(opts: TuyChonGioiHanThuTuc) {
  const nhom = opts.nhom ?? NHOM_THU_TUC_NHAY_CAM;
  const tapStepUp = opts.tapStepUp ?? layTapThuTucStepUp(opts.router, opts.buocNangCap ?? []);
  const taoStore = opts.taoStore ?? taoStoreDem;
  const layKhoaNguoi = opts.layKhoaNguoi ?? khoaNguoiMacDinh;
  const now = opts.now ?? Date.now;
  const kho = new Map<NhomNhayCam, Store>();
  const storeCua = (ten: NhomNhayCam): Store => {
    let s = kho.get(ten);
    if (!s) {
      s = taoStore(`rl:proc:${ten}:`, nhom[ten].cuaSoMs);
      kho.set(ten, s);
    }
    return s;
  };
  const lanLogCuoi = new Map<string, number>();
  const canhBao = (loai: "store" | "vuot", msg: string, e?: unknown): void => {
    const bay = now();
    if (bay - (lanLogCuoi.get(loai) ?? 0) < 10_000) return; // mỗi LOẠI cảnh báo tối đa 1 dòng / 10 s
    lanLogCuoi.set(loai, bay);
    console.warn(msg, e instanceof Error ? e.message : (e ?? ""));
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let viPham: { nhom: NhomNhayCam; giay: number } | null = null;
    try {
      const dem = new Map<NhomNhayCam, number>();
      for (const p of layCacPath(req)) {
        const g = phanNhomThuTuc(p, trpcProcedureType(opts.router, p), tapStepUp, nhom);
        if (g) dem.set(g, (dem.get(g) ?? 0) + 1);
      }
      if (dem.size > 0) {
        const khoaIp = `ip:${ipKeyGenerator(req.ip ?? "")}`;
        let khoaNguoi: string | null = null;
        try {
          khoaNguoi = await layKhoaNguoi(req);
        } catch {
          khoaNguoi = null;
        }
        for (const [g, n] of dem) {
          const store = storeCua(g);
          for (const khoa of khoaNguoi ? [khoaIp, khoaNguoi] : [khoaIp]) {
            let hit: { totalHits: number; resetTime?: Date } | undefined;
            for (let i = 0; i < n; i++) hit = await store.increment(`${g}:${khoa}`);
            if (hit && hit.totalHits > nhom[g].toiDa) {
              const giay = Math.max(1, Math.ceil(((hit.resetTime?.getTime() ?? now() + nhom[g].cuaSoMs) - now()) / 1000));
              if (!viPham || giay > viPham.giay) viPham = { nhom: g, giay };
            }
          }
        }
      }
    } catch (e) {
      canhBao("store", "[trpc] giới hạn theo thủ tục: store lỗi — FAIL-OPEN (lớp chính là bộ đếm sai theo tài khoản)", e);
      viPham = null;
    }
    if (!viPham) return next();
    canhBao("vuot", `[trpc] giới hạn theo thủ tục: nhóm ${viPham.nhom} vượt ngưỡng (ip=${req.ip})`);
    res.status(429).setHeader("Retry-After", String(viPham.giay)).setHeader("Cache-Control", "no-store");
    res.json({
      error: {
        json: {
          message: `Quá nhiều lần thử thao tác nhạy cảm (${viPham.nhom}). Thử lại sau ${viPham.giay} giây.`,
          code: -32029,
          data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, appCode: "TRPC_GIOI_HAN_THU_TUC", nhom: viPham.nhom, retryAfterGiay: viPham.giay },
        },
      },
    });
  };
}
