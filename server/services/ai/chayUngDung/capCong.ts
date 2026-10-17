/**
 * ★★★ Đợt 3c (2026-10-17) — DẢI CỔNG cho ứng dụng xem trước (`AI_PREVIEW_PORT_RANGE`, mặc định 5100–5199).
 *
 * ⚠ Vì sao một DẢI cố định thay vì "cổng trống bất kỳ" (`listen(0)`): proxy xem trước chỉ được phép chuyển tới
 *   cổng TRONG dải đã cấp — một hàng rào kiểm được bằng phép so số. Cổng ngẫu nhiên thì proxy không còn cách nào
 *   phân biệt "cổng của ứng dụng xem trước" với cổng 3000 / 5434 (CSDL) / 8091 (llama) của chính máy chủ.
 * ⚠ Dải méo (ngoài 1024–65535, đảo đầu, rộng hơn 1000 cổng) ⇒ RƠI VỀ MẶC ĐỊNH, không ném: một cấu hình sai không
 *   được biến thành "proxy được chuyển tới cổng hệ thống".
 */
import net from "node:net";

export interface DaiCong {
  tu: number;
  den: number;
}

export const DAI_CONG_MAC_DINH: Readonly<DaiCong> = { tu: 5100, den: 5199 };
export const BIEN_DAI_CONG = "AI_PREVIEW_PORT_RANGE";
const RONG_TOI_DA = 1000;

export function docDaiCong(env: NodeJS.ProcessEnv = process.env): DaiCong {
  const v = String(env[BIEN_DAI_CONG] ?? "").trim();
  const m = /^(\d{4,5})-(\d{4,5})$/.exec(v);
  if (!m) return { ...DAI_CONG_MAC_DINH };
  const tu = Number(m[1]);
  const den = Number(m[2]);
  if (tu < 1024 || den > 65535 || tu > den || den - tu + 1 > RONG_TOI_DA) return { ...DAI_CONG_MAC_DINH };
  return { tu, den };
}

export function trongDai(cong: unknown, dai: DaiCong): cong is number {
  return typeof cong === "number" && Number.isInteger(cong) && cong >= dai.tu && cong <= dai.den;
}

/**
 * ★★★ Vá cookie-tossing (lỗ còn lại): ĐỊA CHỈ BIND của ứng dụng xem trước.
 *
 * Ứng dụng nghe `127.0.0.1:<cổng dải>` thì trình duyệt TRÊN MÁY CHỦ mở thẳng được nó — và mã AI trong khung xem trước
 * chỉ cần `window.open("http://127.0.0.1:51xx")` (hoặc tự điều hướng khung) là chạy trên host `127.0.0.1` — CÙNG SITE
 * với ứng dụng chính mở bằng localhost/127.0.0.1 (cookie không tách theo cổng). ⇒ Ứng dụng bind một loopback KHÁC:
 *   • nguồn: `AI_PREVIEW_APP_HOST` nếu đặt, không thì `AI_PREVIEW_PROXY_HOST` (máy dev: `127.0.0.2` — cùng host với
 *     origin xem trước, vốn đã là site "không tin");
 *   • PHẢI là IPv4 `127.x.y.z` dạng đủ 4 phần, KHÁC `127.0.0.1`/`127.0.0.0`/`127.255.255.255`. Không `0.0.0.0`,
 *     `localhost`, `::1`, và KHÔNG IP LAN: ứng dụng xem trước KHÔNG có xác thực — lộ ra mạng là một lỗ khác
 *     (triển khai LAN: proxy nghe IP LAN, ứng dụng đặt `AI_PREVIEW_APP_HOST=127.0.0.3`).
 *   • sai/thiếu ⇒ KHÔNG chạy (`DIA_CHI_UNG_DUNG_KHONG_HOP_LE`). ⚠ macOS chỉ có sẵn 127.0.0.1 — cần `ifconfig lo0 alias`.
 */
export const BIEN_HOST_UNG_DUNG = "AI_PREVIEW_APP_HOST";

export type KetQuaDiaChiUngDung = { ok: true; diaChi: string } | { ok: false; ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE"; chiTiet: string };

export function laDiaChiUngDungHopLe(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) || !net.isIPv4(v)) return false;
  return v !== "127.0.0.1" && v !== "127.0.0.0" && v !== "127.255.255.255";
}

export function docDiaChiUngDung(env: NodeJS.ProcessEnv = process.env): KetQuaDiaChiUngDung {
  const rieng = String(env[BIEN_HOST_UNG_DUNG] ?? "").trim();
  const v = rieng || String(env.AI_PREVIEW_PROXY_HOST ?? "").trim();
  if (laDiaChiUngDungHopLe(v)) return { ok: true, diaChi: v };
  return {
    ok: false,
    ma: "DIA_CHI_UNG_DUNG_KHONG_HOP_LE",
    chiTiet:
      `Ứng dụng xem trước phải nghe một loopback KHÁC 127.0.0.1 (hiện: "${v || "0.0.0.0"}"). Đặt AI_PREVIEW_PROXY_HOST=127.0.0.2 ` +
      `(máy dev) hoặc AI_PREVIEW_APP_HOST=127.0.0.3 (khi proxy nghe IP LAN).`,
  };
}

/** Cổng có `listen` được trên `host` không (một tiến trình lạ đang giữ ⇒ false). */
export function congTrongThat(cong: number, host: string): Promise<boolean> {
  return new Promise((giai) => {
    const s = net.createServer();
    s.once("error", () => giai(false));
    s.listen(cong, host, () => s.close(() => giai(true)));
  });
}

/** Có ai NGHE cổng trên `host` không — phép đo "ứng dụng đã sẵn sàng" (đúng địa chỉ bind), không tin "đã spawn". */
export function coNgheCong(cong: number, host: string, hanMs = 400): Promise<boolean> {
  return new Promise((giai) => {
    const s = net.connect({ host, port: cong });
    const xong = (v: boolean) => {
      s.destroy();
      giai(v);
    };
    s.setTimeout(hanMs, () => xong(false));
    s.once("connect", () => xong(true));
    s.once("error", () => xong(false));
  });
}
