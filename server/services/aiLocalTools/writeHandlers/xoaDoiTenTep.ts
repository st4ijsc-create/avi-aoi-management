/**
 * ★★★ Đợt 1 · T2 (2026-10-14) — **`delete_file` + `rename_file`: HAI TOOL GHI MỚI CHO VÒNG AGENT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHÔNG CÓ HÀNG RÀO MỚI — CHỈ CÓ HÀNG RÀO CŨ ÁP CHO MỌI ĐƯỜNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Spec `2026-10-14-ai-local-dot1-loi-agent-design.md` §4: *"cùng 4 hàng rào của `applyDiff.phanQuyet`
 * cho MỌI đường liên quan (rename: cả nguồn và đích; đích phải chưa tồn tại)"*. Nên file này DÙNG
 * LẠI, không viết lại:
 *   1. CHÍNH SÁCH đường — `phanQuyetChinhSachDuong` (đúng vị từ `apply_diff` gọi; thuần, trước I/O);
 *   2. HỘP CÁT — `confineTargetUnder` (realpath/junction/hard link/thư mục) + `readConfined` (fd);
 *   3. BĂM — băm nội dung lúc phán quyết đi tới tận cửa đĩa: `xoaConfined`/`doiTenConfined` đọc lại
 *      trên fd và so (`CHANGED` ⇒ `BASE_MISMATCH`), nên tệp đổi dưới chân giữa propose và confirm
 *      KHÔNG bị xoá/dời;
 *   4. GIT — tệp phải SẠCH; miễn trừ hẹp duy nhất là sổ băm HITL (`khopSoBamHITL`).
 * Và HITL: `kind:"write"`, không `handler` ⇒ `proposeAction` → `confirmAction` → `execute()` chạy LẠI
 * cả bốn (TOCTOU). Ghi đĩa CHỈ qua `xoaTheoPhanQuyet`/`doiTenTheoPhanQuyet` (vỏ sổ HITL quanh hai cửa
 * mới ở `readToolsProgramming.ts`; `programmingFileIo.census.test.ts` khoá chúng).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ QUY TẮC GIT CHO TỆP SẼ MẤT (xoá; nguồn của đổi tên) — CHẶT HƠN `apply_diff`, VÀ ĐÂY LÀ LÝ DO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Câu hỏi đúng cho một phép XOÁ là *"nếu sai, ai dựng lại được tệp này?"*. Có đúng HAI câu trả lời:
 *   (a) **git** — tệp ĐÃ TRACK và SẠCH ⇒ `git checkout -- <tệp>` trả lại từng byte;
 *   (b) **sổ băm HITL** — băm đĩa ≡ băm lượt ghi HITL trước ⇒ toàn bộ nội dung là sản phẩm của một
 *       lượt ĐÃ QUA NGƯỜI DUYỆT, không một byte công việc người nào (checkpoint Đợt 1/T3 giữ bản sao).
 * Mọi tệp khác bị TỪ CHỐI:
 *   • thay đổi chưa commit / chưa track (`??`) ⇒ `FILE_DIRTY` (sự cố 2026-08-18 — 123 dòng mất);
 *   • **bị `.gitignore`** ⇒ `FILE_DIRTY`. `git status --porcelain` TRẦN in RỖNG cho tệp bị ignore, tức
 *     nói "sạch" về một tệp git KHÔNG có bản nào (`.local.ts`, cấu hình máy) — nên ở đây hỏi kèm
 *     `--ignored` (`!!` ⇒ không sạch). `apply_diff` giữ argv cũ (đổi là đổi hành vi đường cũ);
 *   • gốc KHÔNG có git ⇒ `GIT_STATUS_FAILED` — trừ khi (b): tệp do chính lượt AI vừa TẠO (miễn trừ
 *     tạo-vào-gốc-không-git của `apply_diff`) thì xoá/dời được; tệp người viết thì không.
 * ĐÍCH của đổi tên = một lượt TẠO ⇒ đúng luật tạo của `apply_diff`: chưa tồn tại (`DEST_EXISTS`),
 * git sạch ở đường đó (một tệp đã track mà người vừa xoá chưa commit ` D` ⇒ `FILE_DIRTY`, trừ khi
 * vắng mặt ấy là sản phẩm HITL), gốc không git ⇒ cho qua kèm cảnh báo "không có lưới hoàn tác".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KẾT QUẢ CHO CHECKPOINT/HOÀN TÁC (T3) — BĂM, KHÔNG NỘI DUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `data` mang `bamTruoc`/`bamSau`/`thayDoi[]` (hình dạng `ThayDoiTep` của `shared/agentCore/kieu.ts`).
 * Nội dung trước KHÔNG BAO GIỜ vào kết quả (thứ đi lại vào model): checkpoint chụp nội dung ở phía
 * máy chủ, ngoài kênh model. Preview (thẻ duyệt cho NGƯỜI) thì hiện trích nội dung sẽ mất, đã che bí mật.
 *
 * ⚠ Tool CHỈ cho vòng agent (`chiChoAgent`, `triggers: []`): bộ chọn trigger, bộ định tuyến LLM vận
 *   hành và planner cũ đều bỏ qua ⇒ đường cũ không đổi hành vi.
 * ⚠ Tự trị: hai tên này CHƯA có trong `autonomyPolicy` ⇒ `TYPE_UNCLASSIFIED` ⇒ bị CẤM tự trị lúc chạy
 *   (fail-closed). Xếp vào `AUTONOMY_INELIGIBLE` là việc của chủ tệp đó.
 */
import { z } from "zod";
import { gocHopCat, nganSachConLai, tieuNganSach, TRAN_BYTE_MOI_PHIEN } from "../repoSandbox";
import { confineTargetUnder, readConfined, type ConfinedTarget } from "../readToolsProgramming";
import { trangThaiGitCuaTep } from "../repoGitStatus";
import {
  TRAN_TEP,
  bam,
  cauCanhBaoKhongGit,
  doiTenTheoPhanQuyet,
  khoaNganSachApDung,
  khopSoBamHITL,
  mienKiemGitChoLuotTao,
  phanQuyetChinhSachDuong,
  trich,
  xoaTheoPhanQuyet,
} from "./applyDiff";
import { registerTool, type ActionPreview, type Tool, type ToolExecContext, type ToolLang } from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

const KIEU = "action_result" as const;
/** ★ Cùng bit với `apply_diff`: xoá/dời là GHI vào cùng đối tượng (tệp repo). */
const QUYEN = { module: "ai_repo_read", action: "canEdit" } as const;

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ + CÂU TỪ CHỐI (vi/en/zh — khuôn `applyDiff.cauTuChoi`, câu nói đúng ĐỘNG TỪ xoá/đổi tên)
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Dùng lại mã của `apply_diff` (không đẻ mã trùng nghĩa) + đúng HAI mã mới:
 *   • `NOT_FOUND`   — tệp nguồn không tồn tại (đã có trong bảng note, nghĩa y hệt);
 *   • `DEST_EXISTS` — đích đổi tên đã tồn tại ⇒ không ghi đè (khác `BASE_MISMATCH`: không ai "nhìn
 *                     phiên bản cũ", mà là chọn tên đã có chủ).
 * `BASE_MISMATCH` ở đây = cửa đĩa đọc lại thấy nội dung khác lúc phán quyết (tệp đổi dưới chân).
 */
export type MaXoaDoiTen =
  | "PATH_REJECTED"
  | "DENIED_SECRET"
  | "DENIED_DIR"
  | "DENIED_EXT"
  | "MISSING_REQUIRED_ARG"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "FILE_TOO_LARGE"
  | "BASE_MISMATCH"
  | "GIT_STATUS_FAILED"
  | "FILE_DIRTY"
  | "DEST_EXISTS"
  | "BUDGET_EXCEEDED"
  | "WRITE_ERROR";

export function cauTuChoiXoaDoiTen(ma: MaXoaDoiTen, chiTiet: string, lang: ToolLang): string {
  switch (ma) {
    case "PATH_REJECTED":
      return w(
        lang,
        `Đường dẫn bị hộp cát TỪ CHỐI (${chiTiet}). Hộp cát chặn: đường tuyệt đối, "..", ký tự NUL, ổ đĩa "C:" ở bất kỳ đoạn nào, symlink/junction trỏ ra ngoài gốc, tệp có nhiều liên kết cứng. Dùng đường TƯƠNG ĐỐI trong dự án.`,
        `Path rejected by the sandbox (${chiTiet}). Use a RELATIVE path inside the project.`,
        `路径被沙箱拒绝（${chiTiet}）。请使用项目内的相对路径。`,
      );
    case "DENIED_SECRET":
      return w(
        lang,
        `"${chiTiet}" nằm trong danh sách CẤM (bí mật: .env*, khoá riêng, chứng thư) — không xoá/đổi tên được, kể cả quản trị viên.`,
        `"${chiTiet}" is on the secret denylist (.env*, private keys, certs) — cannot be deleted or renamed.`,
        `"${chiTiet}" 在禁止列表中（.env*、私钥、证书）——不能删除或重命名。`,
      );
    case "DENIED_DIR":
      return w(
        lang,
        `"${chiTiet}" nằm trong thư mục bị hộp cát loại trừ (node_modules, .git, dist, build, uploads…).`,
        `"${chiTiet}" is inside an excluded directory (node_modules, .git, dist, build, uploads…).`,
        `"${chiTiet}" 位于被排除的目录中（node_modules、.git、dist、build、uploads…）。`,
      );
    case "DENIED_EXT":
      return w(
        lang,
        `Phần mở rộng ${chiTiet} không nằm trong danh sách TRẮNG — chỉ xoá/đổi tên tệp mã nguồn/cấu hình dạng văn bản (cả đuôi của tên MỚI).`,
        `Extension ${chiTiet} is not on the whitelist — only source/config text files can be deleted or renamed (the NEW name too).`,
        `扩展名 ${chiTiet} 不在白名单中——仅可删除/重命名源码或配置文本文件（新名称亦然）。`,
      );
    case "MISSING_REQUIRED_ARG":
      return w(
        lang,
        `Thiếu tham số bắt buộc (${chiTiet}).`,
        `Missing required argument (${chiTiet}).`,
        `缺少必填参数（${chiTiet}）。`,
      );
    case "NOT_FOUND":
      return w(
        lang,
        `Không có tệp "${chiTiet}" trong dự án — dùng find_files/list_files để tìm đúng đường.`,
        `No file "${chiTiet}" in the project — use find_files/list_files to locate it.`,
        `项目中没有文件 "${chiTiet}"——请用 find_files/list_files 查找正确路径。`,
      );
    case "NOT_A_FILE":
      return w(
        lang,
        `"${chiTiet}" là thư mục (hoặc không phải tệp thường) — tool này KHÔNG xoá/đổi tên thư mục.`,
        `"${chiTiet}" is a directory (or not a regular file) — directories are never deleted or renamed by this tool.`,
        `"${chiTiet}" 是目录（或非常规文件）——此工具不删除或重命名目录。`,
      );
    case "FILE_TOO_LARGE":
      return w(
        lang,
        `Tệp "${chiTiet}" lớn hơn trần so-khớp (${TRAN_TEP} byte) nên không băm/chụp an toàn được — từ chối.`,
        `File "${chiTiet}" exceeds the match cap (${TRAN_TEP} bytes) — refusing.`,
        `文件 "${chiTiet}" 超过匹配上限（${TRAN_TEP} 字节）——拒绝。`,
      );
    case "BASE_MISMATCH":
      return w(
        lang,
        `Nội dung "${chiTiet}" đã ĐỔI kể từ lúc đề xuất — KHÔNG xoá/dời phiên bản mới mà người duyệt chưa thấy. Đọc lại rồi đề xuất lại.`,
        `"${chiTiet}" CHANGED since it was proposed — refusing to delete/move a version the reviewer never saw. Re-read and propose again.`,
        `"${chiTiet}" 自提议以来已更改——拒绝删除/移动审核者未见过的版本。请重新读取后再提议。`,
      );
    case "GIT_STATUS_FAILED":
      return w(
        lang,
        `Không hỏi được git cho "${chiTiet}" (dự án chưa có git?). Không chứng minh được tệp khôi phục được thì KHÔNG xoá/dời (fail-closed). Chỉ tệp do chính lượt AI vừa tạo mới được miễn.`,
        `Could not query git for "${chiTiet}" (no git repo?). Cannot prove the file is recoverable ⇒ refusing (fail-closed). Only files the AI itself just created are exempt.`,
        `无法查询 "${chiTiet}" 的 git 状态（项目无 git？）。无法证明可恢复 ⇒ 拒绝（fail-closed）。仅 AI 刚创建的文件可豁免。`,
      );
    case "FILE_DIRTY":
      return w(
        lang,
        `"${chiTiet}" có công việc CHƯA COMMIT (sửa dở, chưa track, hoặc bị .gitignore — git không có bản nào để dựng lại) — TỪ CHỐI. Commit trước rồi đề xuất lại.`,
        `"${chiTiet}" has UNCOMMITTED work (modified, untracked, or gitignored — git has no copy to restore) — refusing. Commit first, then propose again.`,
        `"${chiTiet}" 有未提交的工作（已修改、未跟踪或被 .gitignore 忽略——git 无副本可恢复）——拒绝。请先提交再重新提议。`,
      );
    case "DEST_EXISTS":
      return w(
        lang,
        `Đích "${chiTiet}" ĐÃ TỒN TẠI — đổi tên không bao giờ ghi đè. Chọn tên khác.`,
        `Destination "${chiTiet}" ALREADY EXISTS — rename never overwrites. Choose another name.`,
        `目标 "${chiTiet}" 已存在——重命名从不覆盖。请换一个名称。`,
      );
    case "BUDGET_EXCEEDED":
      return w(
        lang,
        `Phiên đã rút hết ngân sách byte của hộp cát (${chiTiet}) — CHƯA dời tệp. Chờ cửa sổ ngân sách đặt lại.`,
        `Session exhausted the sandbox byte budget (${chiTiet}) — the file was NOT moved.`,
        `本会话已用尽沙箱字节预算（${chiTiet}）——文件未被移动。`,
      );
    case "WRITE_ERROR":
    default:
      return w(lang, `Lỗi hệ tệp: ${chiTiet}.`, `Filesystem error: ${chiTiet}.`, `文件系统错误：${chiTiet}。`);
  }
}

type Loi = { ok: false; ma: MaXoaDoiTen; chiTiet: string };

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÁN QUYẾT — dùng CHUNG cho preview VÀ execute (không đường nào ở confirm bỏ qua một hàng rào)
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Một tệp ĐANG CÓ sẽ mất khỏi đường của nó (xoá; nguồn đổi tên): rào 1–3. */
async function tepDangCo(
  duong: unknown,
  goc: string,
): Promise<{ ok: true; target: ConfinedTarget; relPath: string; hienTai: string; bamTruoc: string } | Loi> {
  const cs = phanQuyetChinhSachDuong(duong);
  if (!cs.ok) return cs;
  const c = confineTargetUnder(goc, duong);
  if (!c.ok) {
    if (c.kind === "NOT_A_FILE") return { ok: false, ma: "NOT_A_FILE", chiTiet: String(duong) };
    return { ok: false, ma: "PATH_REJECTED", chiTiet: c.reason };
  }
  if (!c.target.exists) return { ok: false, ma: "NOT_FOUND", chiTiet: c.target.relPath };
  const rd = readConfined(c.target, TRAN_TEP);
  if (!rd.ok) {
    if (rd.kind === "NOT_FOUND") return { ok: false, ma: "NOT_FOUND", chiTiet: c.target.relPath };
    if (rd.kind === "NOT_A_FILE") return { ok: false, ma: "NOT_A_FILE", chiTiet: c.target.relPath };
    if (rd.kind === "PATH_REJECTED") return { ok: false, ma: "PATH_REJECTED", chiTiet: rd.reason };
    return { ok: false, ma: "WRITE_ERROR", chiTiet: rd.message };
  }
  if (rd.truncated) return { ok: false, ma: "FILE_TOO_LARGE", chiTiet: c.target.relPath };
  return { ok: true, target: c.target, relPath: c.target.relPath, hienTai: rd.content, bamTruoc: bam(rd.content) };
}

/** Rào 4 cho tệp SẼ MẤT — xem khối "QUY TẮC GIT" ở đầu file. */
async function gitChoTepSeMat(
  goc: string,
  relPath: string,
  bamTruoc: string,
): Promise<{ ok: true; khongGit: boolean; mienHITL: boolean } | Loi> {
  const git = await trangThaiGitCuaTep(relPath, goc, { kemIgnored: true });
  const mienHITL = khopSoBamHITL(goc, relPath, bamTruoc);
  if (!git.ok) {
    if (!mienHITL) return { ok: false, ma: "GIT_STATUS_FAILED", chiTiet: relPath };
    return { ok: true, khongGit: true, mienHITL };
  }
  if (!git.sach && !mienHITL) return { ok: false, ma: "FILE_DIRTY", chiTiet: `${relPath} [git: ${git.trangThai}]` };
  return { ok: true, khongGit: false, mienHITL: !git.sach };
}

export interface PhanQuyetXoaXanh {
  ok: true;
  target: ConfinedTarget;
  relPath: string;
  goc: string;
  hienTai: string;
  bamTruoc: string;
  khongGit: boolean;
  mienHITL: boolean;
}

export async function phanQuyetXoa(p: { path?: unknown }, goc: string): Promise<PhanQuyetXoaXanh | Loi> {
  if (typeof p?.path !== "string" || p.path === "") return { ok: false, ma: "MISSING_REQUIRED_ARG", chiTiet: "path" };
  const tep = await tepDangCo(p.path, goc);
  if (!tep.ok) return tep;
  const g = await gitChoTepSeMat(goc, tep.relPath, tep.bamTruoc);
  if (!g.ok) return g;
  return { ...tep, goc, khongGit: g.khongGit, mienHITL: g.mienHITL };
}

export interface PhanQuyetDoiTenXanh {
  ok: true;
  nguon: ConfinedTarget;
  dich: ConfinedTarget;
  relNguon: string;
  relDich: string;
  goc: string;
  bytes: number;
  bamTruoc: string;
  khongGit: boolean;
  mienHITL: boolean;
}

/**
 * ★ ĐO ĐƯỢC (2026-10-17, lưới §F): `git status --porcelain -- src/moi/x.ts` khi `src/moi/` CHƯA tồn
 * tại in `warning: could not open directory 'src/moi/': No such file or directory` — và bộ chạy gộp
 * stderr vào đầu ra ⇒ `sach:false` ⇒ một lượt đổi tên vào thư mục MỚI chết oan `FILE_DIRTY`.
 * Dòng `warning:` không phải một dòng porcelain (porcelain luôn là `XY <đường>`), nên ở ĐÍCH ta chỉ
 * xét các dòng porcelain thật; một ` D`/`??` thật vẫn làm đích bẩn như cũ.
 * ⚠ `apply_diff` (tạo tệp trong thư mục mới) dùng `git.sach` nguyên văn — cùng hiện tượng có thể chạm
 *   nó; KHÔNG sửa ở đây vì đó là hành vi đường cũ (ghi trong báo cáo T2).
 */
function sachBoCanhBaoGit(trangThai: string): boolean {
  return trangThai
    .split("\n")
    .map((d) => d.trim())
    .filter((d) => d !== "" && !/^(warning|hint):/i.test(d)).length === 0;
}

export async function phanQuyetDoiTen(p: { from?: unknown; to?: unknown }, goc: string): Promise<PhanQuyetDoiTenXanh | Loi> {
  const thieu = [typeof p?.from === "string" && p.from !== "" ? "" : "from", typeof p?.to === "string" && p.to !== "" ? "" : "to"].filter(Boolean);
  if (thieu.length > 0) return { ok: false, ma: "MISSING_REQUIRED_ARG", chiTiet: thieu.join(" + ") };
  // 1. CHÍNH SÁCH cho CẢ HAI đường trước mọi I/O (một đích `.env` bị chặn trước cả khi đọc nguồn).
  for (const d of [p.from, p.to]) {
    const cs = phanQuyetChinhSachDuong(d);
    if (!cs.ok) return cs;
  }
  // 2–3. NGUỒN: có thật, là tệp, trong hộp cát, băm.
  const nguon = await tepDangCo(p.from, goc);
  if (!nguon.ok) return nguon;
  // 2. ĐÍCH: trong hộp cát và CHƯA tồn tại (thư mục có sẵn ⇒ NOT_A_FILE; tệp có sẵn ⇒ DEST_EXISTS).
  const dich = confineTargetUnder(goc, p.to);
  if (!dich.ok) {
    if (dich.kind === "NOT_A_FILE") return { ok: false, ma: "NOT_A_FILE", chiTiet: String(p.to) };
    return { ok: false, ma: "PATH_REJECTED", chiTiet: dich.reason };
  }
  if (dich.target.exists) return { ok: false, ma: "DEST_EXISTS", chiTiet: dich.target.relPath };
  // 4. GIT cho nguồn (sẽ mất khỏi đường cũ) rồi cho đích (một lượt TẠO — luật tạo của apply_diff).
  const gN = await gitChoTepSeMat(goc, nguon.relPath, nguon.bamTruoc);
  if (!gN.ok) return gN;
  const gD = await trangThaiGitCuaTep(dich.target.relPath, goc);
  let khongGitDich = false;
  if (!gD.ok) {
    if (!mienKiemGitChoLuotTao(false, gD.ok)) return { ok: false, ma: "GIT_STATUS_FAILED", chiTiet: dich.target.relPath };
    khongGitDich = true;
  } else if (!sachBoCanhBaoGit(gD.trangThai) && !khopSoBamHITL(goc, dich.target.relPath, bam(""))) {
    return { ok: false, ma: "FILE_DIRTY", chiTiet: `${dich.target.relPath} [git: ${gD.trangThai}]` };
  }
  return {
    ok: true,
    nguon: nguon.target,
    dich: dich.target,
    relNguon: nguon.relPath,
    relDich: dich.target.relPath,
    goc,
    bytes: Buffer.byteLength(nguon.hienTai, "utf8"),
    bamTruoc: nguon.bamTruoc,
    khongGit: gN.khongGit || khongGitDich,
    mienHITL: gN.mienHITL,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KẾT QUẢ
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Cùng hình dạng `ThayDoiTep` của `shared/agentCore/kieu.ts` (chép KIỂU, không nhập — lõi agent là thuần). */
interface ThayDoiTep {
  duong: string;
  loai: "xoa" | "doi-ten";
  tuDuong?: string;
  bamSau: string | null;
}

interface DuLieuXoaDoiTen {
  ok: boolean;
  /** Đường SAU thao tác: tệp đã xoá (xoá) · đích (đổi tên). */
  path: string | null;
  /** Đường cũ (chỉ đổi tên). */
  tuDuong: string | null;
  loai: "xoa" | "doi-ten" | null;
  bytes: number | null;
  /** Băm nội dung TRƯỚC — đủ để checkpoint đối chiếu; nội dung KHÔNG có ở đây. */
  bamTruoc: string | null;
  /** Băm SAU ở đường mới: `null` cho xoá (tệp vắng), = `bamTruoc` cho đổi tên. */
  bamSau: string | null;
  thayDoi: ThayDoiTep[];
}

const RONG: DuLieuXoaDoiTen = { ok: false, path: null, tuDuong: null, loai: null, bytes: null, bamTruoc: null, bamSau: null, thayDoi: [] };

/**
 * ⚠ `note` là HẰNG CHỮ VIẾT THẲNG ở từng nhánh — `toolNoteCensus.test.ts` quét mã nguồn theo dòng;
 *   `note: ma` làm lưới ấy mù (khuôn `applyDiff.execute`).
 */
function napLoi(ma: MaXoaDoiTen, chiTiet: string, title: string, lang: ToolLang) {
  const textSummary = cauTuChoiXoaDoiTen(ma, chiTiet, lang);
  const data = { ...RONG };
  switch (ma) {
    case "PATH_REJECTED":
      return { type: KIEU, title, data, note: "PATH_REJECTED", textSummary };
    case "DENIED_SECRET":
      return { type: KIEU, title, data, note: "DENIED_SECRET", textSummary };
    case "DENIED_DIR":
      return { type: KIEU, title, data, note: "DENIED_DIR", textSummary };
    case "DENIED_EXT":
      return { type: KIEU, title, data, note: "DENIED_EXT", textSummary };
    case "MISSING_REQUIRED_ARG":
      return { type: KIEU, title, data, note: "MISSING_REQUIRED_ARG", textSummary };
    case "NOT_FOUND":
      return { type: KIEU, title, data, note: "NOT_FOUND", textSummary };
    case "NOT_A_FILE":
      return { type: KIEU, title, data, note: "NOT_A_FILE", textSummary };
    case "FILE_TOO_LARGE":
      return { type: KIEU, title, data, note: "FILE_TOO_LARGE", textSummary };
    case "BASE_MISMATCH":
      return { type: KIEU, title, data, note: "BASE_MISMATCH", textSummary };
    case "GIT_STATUS_FAILED":
      return { type: KIEU, title, data, note: "GIT_STATUS_FAILED", textSummary };
    case "FILE_DIRTY":
      return { type: KIEU, title, data, note: "FILE_DIRTY", textSummary };
    case "DEST_EXISTS":
      return { type: KIEU, title, data, note: "DEST_EXISTS", textSummary };
    case "BUDGET_EXCEEDED":
      return { type: KIEU, title, data, note: "BUDGET_EXCEEDED", textSummary };
    case "WRITE_ERROR":
    default:
      return { type: KIEU, title, data, note: "WRITE_ERROR", textSummary };
  }
}

/** Kết cục cửa đĩa ⇒ mã tool. `CHANGED` = tệp đổi dưới chân ⇒ `BASE_MISMATCH`. */
function maTuCua(res: { ok: false; kind: string; reason?: string; message?: string }, rel: string): [MaXoaDoiTen, string] {
  switch (res.kind) {
    case "NOT_FOUND":
      return ["NOT_FOUND", rel];
    case "NOT_A_FILE":
      return ["NOT_A_FILE", rel];
    case "CHANGED":
      return ["BASE_MISMATCH", rel];
    case "DEST_EXISTS":
      return ["DEST_EXISTS", rel];
    case "PATH_REJECTED":
      return ["PATH_REJECTED", String(res.reason)];
    default:
      return ["WRITE_ERROR", String(res.message ?? res.kind)];
  }
}

function demDong(s: string): number {
  return s === "" ? 0 : s.split("\n").length;
}

function canhBaoKhoiPhuc(relPath: string, mienHITL: boolean, khongGit: boolean, lang: ToolLang): string {
  if (khongGit) return cauCanhBaoKhongGit(relPath, lang);
  return mienHITL
    ? w(
        lang,
        `Nội dung "${relPath}" là sản phẩm của lượt AI trước đã được duyệt (chưa commit) — git KHÔNG có bản này; chỉ checkpoint của lượt chạy mới hoàn tác được.`,
        `"${relPath}" holds content from an earlier approved AI write (uncommitted) — git has NO copy; only the run checkpoint can undo this.`,
        `"${relPath}" 的内容来自先前已批准的 AI 写入（未提交）——git 无副本；仅运行检查点可撤销。`,
      )
    : w(
        lang,
        `Tệp SẠCH và đã track — khôi phục được bằng \`git checkout -- ${relPath}\`.`,
        `Clean tracked file — recoverable with \`git checkout -- ${relPath}\`.`,
        `干净且已跟踪的文件——可用 \`git checkout -- ${relPath}\` 恢复。`,
      );
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// delete_file
// ══════════════════════════════════════════════════════════════════════════════════════════════
const thamSoXoa = z.object({ path: z.string().min(1).max(1024) }).strict();
type ThamSoXoa = z.infer<typeof thamSoXoa>;

function tomTatXoa(p: Partial<ThamSoXoa>, lang: ToolLang): string {
  return w(
    lang,
    `XOÁ tệp "${p.path ?? ""}" trong dự án (qua người duyệt; chỉ tệp git khôi phục được hoặc do AI vừa tạo).`,
    `DELETE "${p.path ?? ""}" in the project (human-reviewed; only git-recoverable or AI-created files).`,
    `删除项目文件 "${p.path ?? ""}"（需人工审核；仅限 git 可恢复或 AI 刚创建的文件）。`,
  );
}

async function xemTruocXoa(p: ThamSoXoa, ctx: ToolExecContext): Promise<ActionPreview> {
  const goc = ctx.projectRoot ?? gocHopCat();
  const pq = await phanQuyetXoa(p, goc);
  if (!pq.ok) {
    // Preview không REJECT được — nó KHAI; `execute` cưỡng chế (khuôn apply_diff).
    return {
      entityType: "repo_file",
      entityName: String(p?.path ?? ""),
      changes: [],
      warnings: [cauTuChoiXoaDoiTen(pq.ma, pq.ma === "PATH_REJECTED" ? `${String(p?.path ?? "")}: ${pq.chiTiet}` : pq.chiTiet, ctx.lang)],
      humanSummary: tomTatXoa(p, ctx.lang),
    };
  }
  const warnings = [
    w(ctx.lang, `Sẽ XOÁ "${pq.relPath}" (${demDong(pq.hienTai)} dòng). Nội dung sẽ mất ở dưới.`, `Will DELETE "${pq.relPath}" (${demDong(pq.hienTai)} lines). Content to be lost is shown below.`, `将删除 "${pq.relPath}"（${demDong(pq.hienTai)} 行）。将丢失的内容见下。`),
    canhBaoKhoiPhuc(pq.relPath, pq.mienHITL, pq.khongGit, ctx.lang),
    w(ctx.lang, `Băm ${pq.bamTruoc.slice(0, 16)}… được so LẠI lúc bạn xác nhận: tệp đổi giữa chừng ⇒ TỪ CHỐI.`, `sha256 ${pq.bamTruoc.slice(0, 16)}… is re-checked at confirm time.`, `sha256 ${pq.bamTruoc.slice(0, 16)}… 确认时会再次校验。`),
  ];
  const changes: AuditChangeField[] = [
    { field: "path", oldValue: pq.relPath, newValue: null, displayName: w(ctx.lang, "Tệp", "File", "文件") },
    { field: "sha256Before", oldValue: null, newValue: pq.bamTruoc, displayName: w(ctx.lang, "Băm TRƯỚC", "sha256 before", "前哈希") },
    { field: "sha256After", oldValue: null, newValue: null, displayName: w(ctx.lang, "Băm SAU", "sha256 after", "后哈希") },
    // ⚠ Trích ĐÃ CHE bí mật (`trich` = redactSecretsOnly + cắt) — bề mặt này vào thẻ duyệt + audit.
    { field: "content", oldValue: trich(pq.hienTai), newValue: null, displayName: w(ctx.lang, "Nội dung sẽ mất", "Content to be lost", "将丢失的内容") },
  ];
  return { entityType: "repo_file", entityName: pq.relPath, changes, warnings, humanSummary: tomTatXoa(p, ctx.lang) };
}

export const deleteFileTool: Tool<ThamSoXoa, DuLieuXoaDoiTen> = {
  name: "delete_file",
  description:
    "Xoá MỘT tệp mã nguồn trong dự án (đường TƯƠNG ĐỐI). WRITE-ACTION (HITL), quyền ai_repo_read/canEdit. " +
    "Chỉ xoá tệp git khôi phục được (đã track + sạch) hoặc tệp do lượt AI trước vừa tạo; KHÔNG xoá thư mục, " +
    ".env*/khoá, tệp bẩn/chưa track/bị ignore. Delete one project file (human-reviewed).",
  parameters: thamSoXoa,
  triggers: [],
  chiChoAgent: true,
  kind: "write",
  requiredPermission: QUYEN,
  summarize: tomTatXoa,
  preview: xemTruocXoa,
  /** ★ HARD GATE: `args` từ hàng `ai_pending_actions`; MỌI hàng rào chạy LẠI (TOCTOU tại confirm). */
  execute: async (p, ctx) => {
    const title = w(ctx.lang, "Xoá tệp trong dự án", "Delete project file", "删除项目文件");
    const goc = ctx.projectRoot ?? gocHopCat();
    const pq = await phanQuyetXoa(p, goc);
    if (!pq.ok) return napLoi(pq.ma, pq.chiTiet, title, ctx.lang);
    // Ngân sách byte KHÔNG bị trừ: lượt xoá không đưa byte nào RA khỏi hộp cát (đơn vị của sổ là byte
    // rời hộp cát — xem `TRAN_BYTE_MOI_PHIEN`) và không ghi byte nào.
    const res = xoaTheoPhanQuyet(pq);
    if (!res.ok) {
      const [ma, ct] = maTuCua(res, pq.relPath);
      return napLoi(ma, ct, title, ctx.lang);
    }
    const data: DuLieuXoaDoiTen = {
      ok: true,
      path: pq.relPath,
      tuDuong: null,
      loai: "xoa",
      bytes: res.bytes,
      bamTruoc: pq.bamTruoc,
      bamSau: null,
      thayDoi: [{ duong: pq.relPath, loai: "xoa", bamSau: null }],
    };
    return {
      type: KIEU,
      title: w(ctx.lang, `Đã xoá "${pq.relPath}"`, `Deleted "${pq.relPath}"`, `已删除 "${pq.relPath}"`),
      data,
      textSummary: w(
        ctx.lang,
        `Đã xoá "${pq.relPath}" (${res.bytes} byte). Băm trước ${pq.bamTruoc.slice(0, 12)}….`,
        `Deleted "${pq.relPath}" (${res.bytes} bytes). sha256 before ${pq.bamTruoc.slice(0, 12)}….`,
        `已删除 "${pq.relPath}"（${res.bytes} 字节）。删除前 sha256 ${pq.bamTruoc.slice(0, 12)}…。`,
      ),
    };
  },
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// rename_file
// ══════════════════════════════════════════════════════════════════════════════════════════════
const thamSoDoiTen = z.object({ from: z.string().min(1).max(1024), to: z.string().min(1).max(1024) }).strict();
type ThamSoDoiTen = z.infer<typeof thamSoDoiTen>;

function tomTatDoiTen(p: Partial<ThamSoDoiTen>, lang: ToolLang): string {
  return w(
    lang,
    `ĐỔI TÊN "${p.from ?? ""}" → "${p.to ?? ""}" trong dự án (qua người duyệt; đích phải chưa tồn tại).`,
    `RENAME "${p.from ?? ""}" → "${p.to ?? ""}" in the project (human-reviewed; destination must not exist).`,
    `重命名 "${p.from ?? ""}" → "${p.to ?? ""}"（需人工审核；目标不得已存在）。`,
  );
}

async function xemTruocDoiTen(p: ThamSoDoiTen, ctx: ToolExecContext): Promise<ActionPreview> {
  const goc = ctx.projectRoot ?? gocHopCat();
  const pq = await phanQuyetDoiTen(p, goc);
  if (!pq.ok) {
    return {
      entityType: "repo_file",
      entityName: String(p?.from ?? ""),
      changes: [],
      warnings: [cauTuChoiXoaDoiTen(pq.ma, pq.chiTiet, ctx.lang)],
      humanSummary: tomTatDoiTen(p, ctx.lang),
    };
  }
  const warnings = [
    w(ctx.lang, `Sẽ ĐỔI TÊN "${pq.relNguon}" → "${pq.relDich}" (${pq.bytes} byte, nội dung giữ nguyên từng byte; thư mục đích được tạo nếu chưa có).`, `Will RENAME "${pq.relNguon}" → "${pq.relDich}" (${pq.bytes} bytes, byte-identical; destination folder created if missing).`, `将重命名 "${pq.relNguon}" → "${pq.relDich}"（${pq.bytes} 字节，内容逐字节不变；必要时创建目标目录）。`),
    canhBaoKhoiPhuc(pq.relNguon, pq.mienHITL, pq.khongGit, ctx.lang),
    w(ctx.lang, `Băm ${pq.bamTruoc.slice(0, 16)}… được so LẠI lúc bạn xác nhận; đích bị ai đó tạo giữa chừng ⇒ TỪ CHỐI, không ghi đè.`, `sha256 ${pq.bamTruoc.slice(0, 16)}… re-checked at confirm; a destination created meanwhile ⇒ refused, never overwritten.`, `sha256 ${pq.bamTruoc.slice(0, 16)}… 确认时再次校验；期间目标被创建 ⇒ 拒绝，绝不覆盖。`),
  ];
  const changes: AuditChangeField[] = [
    { field: "path", oldValue: pq.relNguon, newValue: pq.relDich, displayName: w(ctx.lang, "Tệp", "File", "文件") },
    { field: "sha256Before", oldValue: null, newValue: pq.bamTruoc, displayName: w(ctx.lang, "Băm TRƯỚC", "sha256 before", "前哈希") },
    { field: "sha256After", oldValue: null, newValue: pq.bamTruoc, displayName: w(ctx.lang, "Băm SAU", "sha256 after", "后哈希") },
  ];
  return { entityType: "repo_file", entityName: pq.relDich, changes, warnings, humanSummary: tomTatDoiTen(p, ctx.lang) };
}

export const renameFileTool: Tool<ThamSoDoiTen, DuLieuXoaDoiTen> = {
  name: "rename_file",
  description:
    "Đổi tên/dời MỘT tệp mã nguồn trong dự án: `from` → `to` (đường TƯƠNG ĐỐI). WRITE-ACTION (HITL), quyền " +
    "ai_repo_read/canEdit. Đích phải CHƯA tồn tại (không ghi đè), đuôi đích trong danh sách trắng; nguồn chịu " +
    "cùng luật với delete_file. Rename/move one project file (human-reviewed).",
  parameters: thamSoDoiTen,
  triggers: [],
  chiChoAgent: true,
  kind: "write",
  requiredPermission: QUYEN,
  summarize: tomTatDoiTen,
  preview: xemTruocDoiTen,
  execute: async (p, ctx) => {
    const title = w(ctx.lang, "Đổi tên tệp trong dự án", "Rename project file", "重命名项目文件");
    const goc = ctx.projectRoot ?? gocHopCat();
    const pq = await phanQuyetDoiTen(p, goc);
    if (!pq.ok) return napLoi(pq.ma, pq.chiTiet, title, ctx.lang);
    // Byte GHI ở đích vào CÙNG sổ với apply_diff (cùng khoá phiên) — hỏi TRƯỚC khi chạm đĩa.
    const khoa = khoaNganSachApDung(ctx);
    const ns = nganSachConLai(khoa);
    if (ns.conLai <= 0) return napLoi("BUDGET_EXCEEDED", `${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}`, title, ctx.lang);
    const res = doiTenTheoPhanQuyet(pq);
    if (!res.ok) {
      const [ma, ct] = maTuCua(res, res.kind === "DEST_EXISTS" ? pq.relDich : pq.relNguon);
      return napLoi(ma, ct, title, ctx.lang);
    }
    tieuNganSach(khoa, res.bytes);
    const data: DuLieuXoaDoiTen = {
      ok: true,
      path: pq.relDich,
      tuDuong: pq.relNguon,
      loai: "doi-ten",
      bytes: res.bytes,
      bamTruoc: pq.bamTruoc,
      bamSau: pq.bamTruoc,
      thayDoi: [{ duong: pq.relDich, loai: "doi-ten", tuDuong: pq.relNguon, bamSau: pq.bamTruoc }],
    };
    return {
      type: KIEU,
      title: w(ctx.lang, `Đã đổi tên "${pq.relNguon}" → "${pq.relDich}"`, `Renamed "${pq.relNguon}" → "${pq.relDich}"`, `已重命名 "${pq.relNguon}" → "${pq.relDich}"`),
      data,
      textSummary: w(
        ctx.lang,
        `Đã đổi tên "${pq.relNguon}" → "${pq.relDich}" (${res.bytes} byte, băm ${pq.bamTruoc.slice(0, 12)}… không đổi).`,
        `Renamed "${pq.relNguon}" → "${pq.relDich}" (${res.bytes} bytes, sha256 ${pq.bamTruoc.slice(0, 12)}… unchanged).`,
        `已重命名 "${pq.relNguon}" → "${pq.relDich}"（${res.bytes} 字节，sha256 ${pq.bamTruoc.slice(0, 12)}… 不变）。`,
      ),
    };
  },
};

registerTool(deleteFileTool);
registerTool(renameFileTool);
