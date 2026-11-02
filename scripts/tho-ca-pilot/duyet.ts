/**
 * Pilot "Thợ Cả nhận việc" — LỆNH TRẢ LỜI của người duyệt (dieu-phoi) cho một thẻ đang chờ của driver `host`.
 *
 *   npx tsx scripts/tho-ca-pilot/duyet.ts --ma TC-01 --id <pendingActionId> --chap-nhan|--tu-choi [--ly-do "..."] [--ra <thư mục>]
 *
 * Chỉ ghi `<ra>/<mã>.quyet.json` NẾU hồ sơ đang chờ (`<mã>.cho-duyet.json`) có đúng `id` đó — id lệch/không có hồ sơ ⇒ từ chối, không ghi
 * (không trả lời nhầm thẻ, không "duyệt trước"). Bộ chạy mới là bên gọi `confirmAction`; lệnh này không chạm DB, không chạm worktree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ghiNguyenTu, tepChoDuyet, tepQuyet } from "./driverHost";

export interface ThamSoDuyet {
  ma: string;
  id: string;
  quyet: "chap-nhan" | "tu-choi";
  lyDo?: string;
  ra: string;
}
export type KetQuaDuyet = { ok: true; tep: string } | { ok: false; loi: string };

export function ghiQuyet(p: ThamSoDuyet): KetQuaDuyet {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,30}$/.test(p.ma)) return { ok: false, loi: "mã không hợp lệ" };
  let cho: { id?: unknown };
  try {
    cho = JSON.parse(fs.readFileSync(tepChoDuyet(p.ra, p.ma), "utf8")) as { id?: unknown };
  } catch {
    return { ok: false, loi: `không có hồ sơ chờ duyệt cho ${p.ma} trong ${p.ra}` };
  }
  if (cho.id !== p.id) return { ok: false, loi: `id không khớp hồ sơ đang chờ (đang chờ: ${String(cho.id)})` };
  const tep = tepQuyet(p.ra, p.ma);
  ghiNguyenTu(tep, JSON.stringify({ id: p.id, quyet: p.quyet, ...(p.lyDo ? { lyDo: p.lyDo } : {}), luc: new Date().toISOString() }));
  return { ok: true, tep };
}

function main(): number {
  const argv = process.argv.slice(2);
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "1";
  const chap = o["chap-nhan"] !== undefined;
  const tuChoi = o["tu-choi"] !== undefined;
  if (!o.ma || !o.id || chap === tuChoi) {
    process.stderr.write('dùng: duyet.ts --ma <mã> --id <pendingId> (--chap-nhan | --tu-choi) [--ly-do "..."] [--ra <thư mục>]\n');
    return 2;
  }
  const kq = ghiQuyet({ ma: o.ma, id: o.id, quyet: chap ? "chap-nhan" : "tu-choi", lyDo: o["ly-do"], ra: o.ra ?? path.join(os.tmpdir(), "tho-ca-pilot") });
  process.stdout.write(`${JSON.stringify(kq)}\n`);
  return kq.ok ? 0 : 1;
}

if (process.argv[1] && /duyet\.(ts|js)$/.test(process.argv[1])) process.exit(main());
