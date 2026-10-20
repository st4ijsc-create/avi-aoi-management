/**
 * ★★ Đợt 8.1 — VÒNG WORKER của Luồng AI. N vòng song song, mỗi vòng `chayMotMuc` liên tục; hết việc ⇒ ngủ `nhipMs`.
 * Khởi ở tiến trình worker (`server/worker.ts`), hoặc ở API khi `AI_FLOW_WORKER_TRONG_API=true` (máy một tiến trình).
 * Mức ưu tiên LLM theo `settings.uuTien` của luồng do node AI tự đặt (`chayVoiUuTien` quanh lời gọi) — vòng này không
 * chiếm slot llama-server nào khi rảnh. Lỗi hạ tầng (CSDL rớt) ⇒ ghi log một lần mỗi loại, ngủ lâu hơn, không chết.
 */
import { randomUUID } from "node:crypto";
import { chayMotMuc } from "./dongCo";

export interface TuyChonWorker {
  soLuong?: number;
  nhipMs?: number;
  leaseMs?: number;
}

let dangChay = false;
let dung = false;
const vongs: Promise<void>[] = [];

function ngu(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

async function vong(ten: string, nhipMs: number, leaseMs: number): Promise<void> {
  let loiCuoi = "";
  while (!dung) {
    try {
      const coViec = await chayMotMuc(ten, leaseMs);
      if (loiCuoi) {
        console.log(`[luong-ai] ${ten}: hồi phục sau lỗi hạ tầng.`);
        loiCuoi = "";
      }
      if (!coViec) await ngu(nhipMs);
    } catch (e) {
      const loai = String((e as Error)?.message ?? e).slice(0, 160);
      if (loai !== loiCuoi) console.warn(`[luong-ai] ${ten}: lỗi hạ tầng — ${loai}`);
      loiCuoi = loai;
      await ngu(Math.max(nhipMs * 10, 5_000));
    }
  }
}

/** Gọi lại lần hai = no-op. */
export function khoiChayWorkerLuong(t: TuyChonWorker = {}): void {
  if (dangChay) return;
  dangChay = true;
  dung = false;
  const so = Math.max(1, Math.min(t.soLuong ?? Number(process.env.AI_FLOW_WORKER_SO_LUONG ?? 2), 16));
  const goc = `w-${process.pid}-${randomUUID().slice(0, 6)}`;
  for (let i = 0; i < so; i++) vongs.push(vong(`${goc}-${i}`, t.nhipMs ?? 1_000, t.leaseMs ?? 5 * 60_000));
  console.log(`[luong-ai] worker Luồng AI chạy ${so} vòng (${goc}).`);
}

/** Dừng gọn: chờ các vòng xong mục đang chạy. */
export async function dungWorkerLuong(): Promise<void> {
  dung = true;
  await Promise.all(vongs.splice(0));
  dangChay = false;
}
