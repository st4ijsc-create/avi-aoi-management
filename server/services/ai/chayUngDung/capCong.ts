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

/** Cổng có `listen` được trên 127.0.0.1 không (một tiến trình lạ đang giữ ⇒ false). */
export function congTrongThat(cong: number): Promise<boolean> {
  return new Promise((giai) => {
    const s = net.createServer();
    s.once("error", () => giai(false));
    s.listen(cong, "127.0.0.1", () => s.close(() => giai(true)));
  });
}

/** Có ai NGHE cổng trên 127.0.0.1 không — phép đo "ứng dụng đã sẵn sàng", không tin "đã spawn". */
export function coNgheCong(cong: number, hanMs = 400): Promise<boolean> {
  return new Promise((giai) => {
    const s = net.connect({ host: "127.0.0.1", port: cong });
    const xong = (v: boolean) => {
      s.destroy();
      giai(v);
    };
    s.setTimeout(hanMs, () => xong(false));
    s.once("connect", () => xong(true));
    s.once("error", () => xong(false));
  });
}
