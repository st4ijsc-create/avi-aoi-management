/**
 * ★★★ doc 79 · 2026-08-20 — **`apply_diff_batch`: MỘT THẺ DUYỆT, N HÀNH ĐỘNG, N BĂM RIÊNG.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff` nhận **đúng MỘT** `path`. Một lượt đổi tên hàm dùng ở 8 nơi = **8 vòng** đề xuất/
 * duyệt, mỗi vòng người dùng phải bấm một lần, và giữa hai lần bấm cây làm việc nằm ở trạng thái
 * **nửa vời không biên dịch được** — mà không một chỗ nào trong hệ nói ra điều đó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BA HƯỚNG ĐÃ CÂN, VÀ VÌ SAO CHỌN HƯỚNG NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * (a) **N đề xuất riêng** — 0 bề mặt mới, nhưng N cú bấm và N hàng `ai_pending_actions` với N hạn
 *     giờ riêng. Chế độ hỏng của nó KHÔNG phải "phiền": người duyệt 3/8 rồi bỏ dở ⇒ repo nửa vời
 *     **và không có một chỗ nào ghi lại rằng nó nửa vời**. Đây là hiện trạng, và nó là thứ đang
 *     bị than phiền.
 * (b) **một tool ghi MỚI nhận mảng** — một cú bấm. Đúng cơ chế, nhưng nếu nó tự dựng lại bốn hàng
 *     rào thì ta có **bản sao thứ hai của chính sách ghi**, tức lớp lỗi tệ nhất có thể có ở đây.
 * (c) **một thẻ duyệt gom N hành động, mỗi hành động giữ băm neo riêng** — đúng NGHĨA cần có.
 *     Hiện thực nó ở tầng `ai_pending_actions` (một hàng chở N hành động) sẽ phải sửa
 *     `proposeAction`/`confirmAction` — mặt tiếp xúc **dùng chung cho 27 write tool**, gồm cả lệnh
 *     xuống máy. Đặt rủi ro ở đó để giải một bài toán của tác nhân lập trình là đặt sai chỗ.
 *
 * ⇒ **CHỌN: NGHĨA của (c), CƠ CHẾ của (b).** Một tool ghi mới, nhưng nó là một **VỎ CHỨA** thuần:
 *   mọi phán quyết gọi thẳng `phanQuyet()` của `applyDiff.ts`, mọi lượt ghi gọi thẳng
 *   `ghiTheoPhanQuyet()`. **Không một dòng chính sách nào được chép lại ở đây.** Hệ quả đo được:
 *   `programmingFileIo.census` vẫn thấy đúng hai cửa và đúng một điểm gọi `writeConfined`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BẤT BIẾN KHÔNG ĐƯỢC PHÁ: **MỖI TỆP MỘT BĂM RIÊNG**, KIỂM LẠI Ở LÚC XÁC NHẬN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không tồn tại "một băm cho cả lô", và điều đó đúng **theo CẤU TẠO** chứ không nhờ một lời dặn:
 * hàm ghi (`ghiTheoPhanQuyet`) chỉ nhận `PhanQuyetXanh`, và `PhanQuyetXanh` chỉ ra đời từ
 * `phanQuyet(mộtTệp, gốc)` — vốn so `băm(đĩa)` với `băm(original)` **của chính tệp ấy**. Muốn ghi
 * tệp thứ ba thì phải có `PhanQuyetXanh` thứ ba, tức phải có băm thứ ba khớp. Vòng phán quyết
 * chạy LẠI toàn bộ ở `execute` (sau khi người bấm), đúng khuôn TOCTOU của `apply_diff`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ GHI TỪNG PHẦN — **KHÔNG NGUYÊN TỬ, VÀ CÓ BÁO CÁO**. Nói thẳng vì im lặng ở đây là nói dối.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai pha, cố ý:
 *   • **PHA 1 — PHÁN QUYẾT TOÀN LÔ.** Chạy `phanQuyet` cho **mọi** tệp trước khi ghi một byte.
 *     Bất kỳ tệp nào đỏ ⇒ **TỪ CHỐI CẢ LÔ**, đĩa không đổi. Nhờ đó tình huống trong brief ("tệp 1
 *     ghi xong mà tệp 3 hỏng băm") **không xảy ra được** ở đường thường: băm hỏng bị bắt ở pha 1.
 *   • **PHA 2 — GHI.** Chỉ còn hỏng được vì hệ tệp (đầy đĩa, EACCES, tệp bị khoá). Khi ấy tệp
 *     1..k−1 ĐÃ trên đĩa ⇒ trả `BATCH_PARTIAL` kèm **danh sách chính xác** tệp nào đã ghi, tệp nào
 *     chưa, và băm của từng tệp.
 * ⚠ **KHÔNG hoàn nguyên tự động.** Hoàn nguyên là một lượt GHI nữa, và một lượt ghi trong đúng
 *   hoàn cảnh vừa làm lượt trước hỏng thì cũng hỏng được — để lại một trạng thái thứ ba mà không
 *   ai mô tả nổi. Ta trả về sự thật đầy đủ và để người quyết (họ có `git diff`, `git checkout`).
 * ⚠ Cửa sổ đua còn lại: giữa cuối pha 1 và lượt ghi cuối pha 2 (đơn vị mili giây). Nó tồn tại ở
 *   `apply_diff` một tệp y hệt và không thu hẹp được nếu không khoá tệp — nói ra, không giấu.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ ĐỢT 3 (2026-08-23) — LÔ NÀY **GIỮ ÁP-TẤT-CẢ**, không nhận `selectedHunkIds`. CỐ Ý, không dở dang
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff` (một tệp) nay cho người duyệt CHỌN KHỐI thật (`aiCopilotActions.confirmAction` +
 * `selectedHunkIds`). Lô nhiều tệp thì KHÔNG — và gửi `selectedHunkIds` cho một confirm của tool
 * này bị từ chối thẳng (`HUNK_IDS_INVALID`, xem `apLuaChonKhoi`), không âm thầm áp tất cả. Lý do
 * để dành chứ không làm nửa vời: chọn-khối-theo-từng-tệp cần MỖI TỆP MỘT KẾ HOẠCH KHỐI riêng
 * (`keHoachKhoiDuyet` chạy N lần), một hình dạng dây `{fileIndex, hunkIndex}` thay vì một mảng số
 * trần, và một UI thẻ duyệt PHÂN TRANG theo tệp — ba thứ ấy là một đợt riêng; một bản "tạm" nhét
 * mảng phẳng vào lô là mở đúng lỗ "chỉ số trỏ nhầm tệp" mà không lưới nào hiện có canh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ NGÂN SÁCH TOKEN — **LÔ NÀY KHÔNG CHỞ MỘT TOKEN NÀO LÊN MODEL.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây là tầng ĐỀ XUẤT, không phải tầng prompt. Model được gọi **một tệp một lượt** ở
 * `aiLocalKnowledgeService.streamCodingSuaNhieuTep`, mỗi lượt cân riêng bằng chính
 * `dungKhoiLichSu`/`kiemNganSachNguCanh` — nên trần slot 32.768 gặp phải **N lần một tệp**, chứ
 * không bao giờ là "N tệp trong một prompt". Trần `TRAN_TEP_MOI_LO` ở đây là trần của **thẻ duyệt**
 * (bao nhiêu diff một người đọc nổi trong một lần bấm), không phải trần token.
 *
 * ⚠ HITL + tự trị: `kind:"write"` ⇒ mọi lượt qua `proposeAction`/`confirmAction`. Tool này nằm
 *   trong `AUTONOMY_INELIGIBLE` cùng lý lẽ của `apply_diff`, và bị `locQuyetDinhLLMLapTrinh` chặn
 *   không cho **bộ chọn LLM** khởi xướng — LLM không đọc tệp nên `original` của nó luôn là phỏng
 *   đoán, và một lô phỏng đoán chỉ nhân cái sai lên N lần.
 */
import { z } from "zod";
import {
  cauTuChoi,
  ghiTheoPhanQuyet,
  khoaNganSachApDung,
  phanQuyet,
  thamSoMotTep,
  trich,
  type MaApplyDiff,
  type PhanQuyet,
  type PhanQuyetXanh,
  type ThamSo as ThamSoMotTep,
} from "./applyDiff";
import { TRAN_BYTE_MOI_PHIEN, gocHopCat, nganSachConLai, tieuNganSach } from "../repoSandbox";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

const KIEU = "action_result" as const;

/**
 * ★ TRẦN SỐ TỆP MỘT LÔ — **trần của THẺ DUYỆT, không phải trần token.**
 *
 * Con số này trả lời *"một người đọc nổi bao nhiêu diff trước khi bấm duyệt?"*. Đặt cao hơn thì
 * cái nút "Duyệt & ghi" biến thành một cú bấm mù — tức phá đúng thứ HITL sinh ra để giữ. Model
 * được gọi MỘT TỆP MỘT LƯỢT ở tầng trên, nên trần token không liên quan tới con số này.
 */
export const TRAN_TEP_MOI_LO = 8;

/** ★ CÙNG quyền với `apply_diff` — ghi lô không phải một quyền mới, chỉ là nhiều lượt ghi cùng lúc. */
const QUYEN = { module: "ai_repo_read", action: "canEdit" } as const;

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ MÁY-ĐỌC-ĐƯỢC — ba mã RIÊNG của lô; mọi mã còn lại DÙNG LẠI của `apply_diff`
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Chỉ ba mã mới, và mỗi mã là một hành động KHÁC của người vận hành:
 *   • `BATCH_REJECTED`       — ít nhất một tệp đỏ ở pha PHÁN QUYẾT ⇒ **cả lô bị từ chối, 0 byte ghi**.
 *                              Câu trả về nêu ĐÍCH DANH tệp nào và mã từ chối nào của `apply_diff`.
 *   • `BATCH_PARTIAL`        — pha GHI hỏng giữa chừng (lỗi hệ tệp) ⇒ **một phần đã trên đĩa**.
 *                              Đây là mã quan trọng nhất của file này: nó tồn tại để trạng thái
 *                              nửa vời KHÔNG BAO GIỜ im lặng.
 *   • `BATCH_DUPLICATE_PATH` — cùng một tệp xuất hiện hai lần trong lô. Mục thứ hai neo băm vào
 *                              nội dung TRƯỚC khi mục thứ nhất ghi ⇒ nó đã cũ ngay lúc sinh ra.
 *                              Từ chối cả lô thay vì áp một cái chắc chắn sai.
 */
type MaLo = "BATCH_REJECTED" | "BATCH_PARTIAL" | "BATCH_DUPLICATE_PATH";
type MaBatKy = MaLo | MaApplyDiff;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// THAM SỐ
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface ThamSoLo {
  files: ThamSoMotTep[];
}

const thamSo = z
  .object({
    files: z.array(thamSoMotTep).min(1).max(TRAN_TEP_MOI_LO),
  })
  .strict();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÁN QUYẾT TOÀN LÔ — pha 1, dùng CHUNG cho `preview` và `execute`
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface MucDo {
  /** Vị trí trong lô, 1-based — để câu từ chối chỉ đúng mục người dùng đang nhìn. */
  readonly stt: number;
  readonly duongVao: string;
  readonly pq: PhanQuyet;
}

type PhanQuyetLo =
  | { ok: true; muc: Array<{ stt: number; pq: PhanQuyetXanh; modified: string }> }
  | { ok: false; ma: MaBatKy; chiTiet: string };

/**
 * ★ Chạy `phanQuyet` cho MỌI tệp, rồi mới kết luận. **Không dừng ở tệp đỏ đầu tiên** — người dùng
 * cần thấy hết chỗ hỏng trong một lượt, thay vì sửa một cái rồi lại đâm vào cái kế tiếp.
 *
 * ⚠ Trùng đường dẫn được xét trên `relPath` **đã chuẩn hoá bởi hộp cát**, không trên chuỗi thô:
 *   `src/a.ts` và `./src/a.ts` là cùng một tệp, và một phép so chuỗi thô sẽ bỏ lọt.
 */
async function phanQuyetLo(p: Partial<ThamSoLo>, goc: string, lang: ToolLang): Promise<PhanQuyetLo> {
  const ds = Array.isArray(p.files) ? p.files : [];
  if (ds.length === 0) {
    return { ok: false, ma: "MISSING_REQUIRED_ARG", chiTiet: "files[]" };
  }
  if (ds.length > TRAN_TEP_MOI_LO) {
    return { ok: false, ma: "BATCH_REJECTED", chiTiet: `${ds.length} > ${TRAN_TEP_MOI_LO}` };
  }

  const kq: MucDo[] = [];
  for (let i = 0; i < ds.length; i++) {
    kq.push({ stt: i + 1, duongVao: String(ds[i]?.path ?? ""), pq: await phanQuyet(ds[i] ?? {}, goc) });
  }

  const do_ = kq.filter((m) => !m.pq.ok);
  if (do_.length > 0) {
    const chiTiet = do_
      .map((m) => {
        const e = m.pq as Extract<PhanQuyet, { ok: false }>;
        return `#${m.stt} ${m.duongVao} → ${e.ma}: ${cauTuChoi(e.ma, e.chiTiet, lang)}`;
      })
      .join("\n");
    return { ok: false, ma: "BATCH_REJECTED", chiTiet };
  }

  const daThay = new Map<string, number>();
  for (const m of kq) {
    const rel = (m.pq as PhanQuyetXanh).relPath;
    const truoc = daThay.get(rel);
    if (truoc !== undefined) return { ok: false, ma: "BATCH_DUPLICATE_PATH", chiTiet: `${rel} (#${truoc} và #${m.stt})` };
    daThay.set(rel, m.stt);
  }

  return {
    ok: true,
    muc: kq.map((m, i) => ({ stt: m.stt, pq: m.pq as PhanQuyetXanh, modified: String(ds[i]?.modified ?? "") })),
  };
}

function cauTuChoiLo(ma: MaBatKy, chiTiet: string, lang: ToolLang): string {
  switch (ma) {
    case "BATCH_REJECTED":
      return w(
        lang,
        `LÔ BỊ TỪ CHỐI TOÀN BỘ — KHÔNG một byte nào được ghi. Ít nhất một tệp không qua được hàng rào, và một lô chỉ áp được khi MỌI tệp đều qua (áp một nửa là để lại cây mã không biên dịch được mà không ai ghi lại điều đó). Chi tiết từng mục:\n${chiTiet}`,
        `THE WHOLE BATCH WAS REJECTED — nothing was written. At least one file failed a guard, and a batch only applies when EVERY file passes. Per-item detail:\n${chiTiet}`,
        `整批被拒绝——未写入任何字节。至少有一个文件未通过防护；只有全部文件通过时才会应用整批。各项详情：\n${chiTiet}`,
      );
    case "BATCH_DUPLICATE_PATH":
      return w(
        lang,
        `Cùng một tệp xuất hiện HAI LẦN trong lô: ${chiTiet}. Mục thứ hai neo băm vào nội dung TRƯỚC khi mục thứ nhất ghi, nên nó đã cũ ngay lúc sinh ra. Hãy gộp cả hai thay đổi vào MỘT mục.`,
        `The same file appears TWICE in the batch: ${chiTiet}. The second item anchors its hash to the content BEFORE the first item writes. Merge both changes into ONE item.`,
        `同一文件在批次中出现两次：${chiTiet}。第二项的哈希锚定在第一项写入之前的内容上。请合并为一项。`,
      );
    case "BATCH_PARTIAL":
      return w(
        lang,
        `⚠ LÔ ÁP MỘT PHẦN — cây làm việc đang ở trạng thái NỬA VỜI. Đây không phải một lượt từ chối: một số tệp ĐÃ ĐƯỢC GHI xuống đĩa trước khi hệ tệp báo lỗi.\n${chiTiet}\nHãy kiểm bằng "git diff" và quyết định hoàn nguyên (git checkout --) hay đề xuất lại phần còn lại.`,
        `⚠ BATCH PARTIALLY APPLIED — the working tree is in a HALF-DONE state. Some files WERE written to disk before the filesystem failed.\n${chiTiet}\nInspect with "git diff" and decide whether to revert or re-propose the rest.`,
        `⚠ 批次部分应用——工作区处于半完成状态。文件系统出错前已有部分文件写入磁盘。\n${chiTiet}\n请用 "git diff" 检查，并决定回滚或重新提议其余部分。`,
      );
    default:
      return cauTuChoi(ma, chiTiet, lang);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PREVIEW — PHÁN QUYẾT + MÔ TẢ. **KHÔNG GHI GÌ.**
// ══════════════════════════════════════════════════════════════════════════════════════════════
function tomTat(p: Partial<ThamSoLo>, lang: ToolLang): string {
  const n = Array.isArray(p.files) ? p.files.length : 0;
  const ten = (Array.isArray(p.files) ? p.files : []).map((f) => String(f?.path ?? "")).join(", ");
  return w(
    lang,
    `Áp thay đổi vào ${n} tệp trong repo trong MỘT lượt duyệt (${ten}). Mỗi tệp có băm neo RIÊNG, kiểm lại lúc bạn xác nhận; một tệp hỏng ⇒ TỪ CHỐI cả lô.`,
    `Apply changes to ${n} repo files in ONE approval (${ten}). Each file keeps its OWN anchor hash, re-checked at confirm; one bad file ⇒ the whole batch is refused.`,
    `在一次审批中对仓库 ${n} 个文件应用更改（${ten}）。每个文件保留各自的锚定哈希，确认时重新校验；任一文件失败则拒绝整批。`,
  );
}

async function xemTruoc(p: ThamSoLo, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const goc = ctx.projectRoot ?? gocHopCat();
  const ten = w(ctx.lang, `Lô ${p.files?.length ?? 0} tệp`, `Batch of ${p.files?.length ?? 0} files`, `${p.files?.length ?? 0} 个文件的批次`);

  const pl = await phanQuyetLo(p, goc, ctx.lang);
  if (!pl.ok) {
    // Preview KHÔNG từ chối được (nó luôn trả một ActionPreview) — nó KHAI ra, `execute` cưỡng chế.
    warnings.push(cauTuChoiLo(pl.ma, pl.chiTiet, ctx.lang));
    return { entityType: "repo_file_batch", entityName: ten, changes: [], warnings, humanSummary: tomTat(p, ctx.lang) };
  }

  warnings.push(
    w(
      ctx.lang,
      `${pl.muc.length} tệp, MỖI TỆP MỘT BĂM NEO RIÊNG — cả ${pl.muc.length} băm được so LẠI lúc bạn bấm duyệt. Nếu bất kỳ tệp nào đổi dưới chân trong lúc bạn cân nhắc, CẢ LÔ bị từ chối và đĩa không đổi một byte.`,
      `${pl.muc.length} files, EACH WITH ITS OWN ANCHOR HASH — all ${pl.muc.length} are re-checked when you approve. If any file changes underneath, the WHOLE batch is refused and nothing is written.`,
      `${pl.muc.length} 个文件，每个文件各自的锚定哈希——审批时全部重新校验。任一文件被改动则拒绝整批，磁盘不变。`,
    ),
  );

  const changes: AuditChangeField[] = [];
  for (const m of pl.muc) {
    const nhan = `#${m.stt} ${m.pq.relPath}`;
    warnings.push(
      w(
        ctx.lang,
        `${nhan} — ${m.pq.daCo ? "GHI ĐÈ (tệp sạch)" : "TẠO MỚI"}; băm ${m.pq.bamTruoc.slice(0, 12)}… → ${m.pq.bamSau.slice(0, 12)}….`,
        `${nhan} — ${m.pq.daCo ? "OVERWRITE (clean file)" : "CREATE"}; sha256 ${m.pq.bamTruoc.slice(0, 12)}… → ${m.pq.bamSau.slice(0, 12)}….`,
        `${nhan} — ${m.pq.daCo ? "覆盖（文件干净）" : "新建"}；sha256 ${m.pq.bamTruoc.slice(0, 12)}… → ${m.pq.bamSau.slice(0, 12)}….`,
      ),
    );
    changes.push(
      { field: `files[${m.stt}].path`, oldValue: m.pq.daCo ? m.pq.relPath : null, newValue: m.pq.relPath, displayName: w(ctx.lang, "Tệp", "File", "文件") },
      { field: `files[${m.stt}].sha256Before`, oldValue: null, newValue: m.pq.bamTruoc, displayName: w(ctx.lang, "Băm TRƯỚC", "sha256 before", "前哈希") },
      { field: `files[${m.stt}].sha256After`, oldValue: null, newValue: m.pq.bamSau, displayName: w(ctx.lang, "Băm SAU", "sha256 after", "后哈希") },
      // ⚠ Trích ĐÃ CHE bí mật — bề mặt này đi vào Agent/UI + sổ audit (cùng luật `apply_diff`).
      { field: `files[${m.stt}].content`, oldValue: m.pq.daCo ? trich(m.pq.hienTai) : null, newValue: trich(m.modified), displayName: w(ctx.lang, "Nội dung", "Content", "内容") },
    );
  }

  return { entityType: "repo_file_batch", entityName: ten, changes, warnings, humanSummary: tomTat(p, ctx.lang) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TOOL
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface TepDaGhi {
  path: string;
  bytes: number;
  created: boolean;
  sha256Before: string;
  sha256After: string;
}
interface DuLieuLo {
  ok: boolean;
  /** Số tệp trong lô đề xuất. */
  soTep: number;
  /** Tệp ĐÃ trên đĩa sau lượt này. Rỗng ⇒ đĩa không đổi một byte. */
  daGhi: TepDaGhi[];
  /** Tệp CHƯA ghi, kèm lý do — luôn có mặt khi `ok:false`, kể cả ở lượt áp một phần. */
  chuaGhi: Array<{ path: string; ma: string }>;
}

const RONG: DuLieuLo = { ok: false, soTep: 0, daGhi: [], chuaGhi: [] };

export const applyDiffBatchTool: Tool<ThamSoLo, DuLieuLo> = {
  name: "apply_diff_batch",
  description:
    "Áp thay đổi vào NHIỀU tệp mã nguồn trong repo nền tảng trong MỘT lượt duyệt. Tham số: `files` — " +
    "mảng `{path, original, modified}` (tối đa " +
    String(TRAN_TEP_MOI_LO) +
    " mục). WRITE-ACTION (HITL): chỉ ĐỀ XUẤT, người dùng phải XÁC NHẬN mới ghi; quyền ai_repo_read/canEdit. " +
    "MỖI TỆP giữ băm neo RIÊNG (so `original` với byte trên đĩa) và cả N băm được kiểm LẠI lúc xác nhận — " +
    "KHÔNG có 'một băm cho cả lô'. Mọi hàng rào của apply_diff (tệp bẩn · hộp cát · đuôi trắng · TOCTOU) " +
    "chạy cho TỪNG tệp. Một tệp hỏng ⇒ TỪ CHỐI CẢ LÔ, 0 byte được ghi. Tạo tệp mới được (`original` RỖNG).",
  parameters: thamSo,
  /**
   * ⚠ Write tool KHÔNG được `findToolByTriggers` chọn (`chonDuocTheoTrigger` loại `kind:"write"`);
   * trigger chỉ đi vào bản kê tool đưa cho bộ định tuyến LLM. Cố ý HẸP: chỉ những cụm nói rõ
   * "nhiều tệp", để không giẫm chân `apply_diff` một tệp.
   */
  triggers: [
    "sửa nhiều tệp", "sửa nhiều file", "áp thay đổi nhiều tệp", "đổi tên khắp repo",
    "apply diff to multiple files", "edit multiple files", "batch patch files",
    "批量修改文件", "修改多个文件",
  ],
  kind: "write",
  requiredPermission: QUYEN,
  summarize: tomTat,
  preview: xemTruoc,
  /**
   * ★ HARD GATE: `args` tới đây từ HÀNG `ai_pending_actions` (`confirmAction`), KHÔNG phải từ
   * preview ⇒ **toàn bộ pha PHÁN QUYẾT chạy LẠI** cho từng tệp (git-status + băm + hộp cát). Chỉ
   * khi CẢ N còn xanh mới có một byte rời cửa `ghiTheoPhanQuyet`.
   */
  execute: async (p, ctx) => {
    const title = w(ctx.lang, "Áp thay đổi vào nhiều tệp repo", "Apply changes to multiple repo files", "对仓库多个文件应用更改");
    const soTep = Array.isArray(p?.files) ? p.files.length : 0;
    /**
     * ⚠⚠ `note` phải là **HẰNG CHỮ VIẾT THẲNG**, không phải `note: ma`.
     * `toolNoteCensus.test.ts` §1/§2 quét MÃ NGUỒN theo dòng (`note:` + hằng in hoa cùng dòng).
     * Viết `note: ma` thì §1 **mù** (không thấy mã nào mới) và §2 **ĐỎ** (bảng kê giữ ba mã không
     * ai sinh ra) — đúng cái bẫy mà `repoReadTools.ts` đã ghi lại. Nên đây là một `switch` dài
     * dòng có chủ ý: nó bắt người thêm mã mới phải nhìn thấy bảng kê một lần.
     */
    const napLoi = (ma: MaBatKy, chiTiet: string, data: DuLieuLo = { ...RONG, soTep }) => {
      const cau = cauTuChoiLo(ma, chiTiet, ctx.lang);
      switch (ma) {
        case "BATCH_REJECTED":
          return { type: KIEU, title, data, note: "BATCH_REJECTED", textSummary: cau };
        case "BATCH_PARTIAL":
          return { type: KIEU, title, data, note: "BATCH_PARTIAL", textSummary: cau };
        case "BATCH_DUPLICATE_PATH":
          return { type: KIEU, title, data, note: "BATCH_DUPLICATE_PATH", textSummary: cau };
        case "MISSING_REQUIRED_ARG":
          return { type: KIEU, title, data, note: "MISSING_REQUIRED_ARG", textSummary: cau };
        case "BUDGET_EXCEEDED":
          return { type: KIEU, title, data, note: "BUDGET_EXCEEDED", textSummary: cau };
        default:
          // Mọi mã còn lại của `apply_diff` không tới được đây: `phanQuyetLo` gói chúng vào
          // `BATCH_REJECTED` (kèm nguyên văn từng mã trong `chiTiet`). Nhánh này là fail-closed.
          return { type: KIEU, title, data, note: "BATCH_REJECTED", textSummary: cau };
      }
    };

    const goc = ctx.projectRoot ?? gocHopCat();
    const pl = await phanQuyetLo(p, goc, ctx.lang);
    if (!pl.ok) {
      return napLoi(pl.ma, pl.chiTiet, {
        ...RONG,
        soTep,
        chuaGhi: (Array.isArray(p?.files) ? p.files : []).map((f) => ({ path: String(f?.path ?? ""), ma: pl.ma })),
      });
    }

    // ── NGÂN SÁCH: hỏi cho CẢ LÔ trước khi ghi tệp đầu tiên. Đây là chỗ khác `apply_diff`: một lô
    //    hết ngân sách giữa chừng sẽ đẻ ra trạng thái nửa vời **do chính ta gây ra**, mà cái đó
    //    tránh được bằng một phép cộng. Nên lô là NGUYÊN TỬ về mặt ngân sách.
    const khoa = khoaNganSachApDung(ctx);
    const ns = nganSachConLai(khoa);
    const tongByte = pl.muc.reduce((s, m) => s + Buffer.byteLength(m.modified, "utf8"), 0);
    if (ns.conLai <= 0 || tongByte > ns.conLai) {
      return napLoi("BUDGET_EXCEEDED", `${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}, lô cần ${tongByte} byte, còn ${ns.conLai}`, {
        ...RONG,
        soTep,
        chuaGhi: pl.muc.map((m) => ({ path: m.pq.relPath, ma: "BUDGET_EXCEEDED" })),
      });
    }

    // ── PHA 2: GHI. Từ đây chỉ hệ tệp mới hỏng được, và nếu hỏng thì trạng thái là NỬA VỜI.
    const daGhi: TepDaGhi[] = [];
    for (let i = 0; i < pl.muc.length; i++) {
      const m = pl.muc[i]!;
      const res = ghiTheoPhanQuyet(m.pq, m.modified);
      if (!res.ok) {
        const chuaGhi = pl.muc.slice(i).map((x) => ({ path: x.pq.relPath, ma: res.kind }));
        const chiTiet =
          `ĐÃ GHI (${daGhi.length}): ${daGhi.map((d) => d.path).join(", ") || "—"}\n` +
          `CHƯA GHI (${chuaGhi.length}): ${chuaGhi.map((d) => d.path).join(", ")}\n` +
          `Dừng ở "${m.pq.relPath}": ${res.kind}${"message" in res ? ` — ${res.message}` : ""}`;
        return napLoi("BATCH_PARTIAL", chiTiet, { ok: false, soTep, daGhi, chuaGhi });
      }
      tieuNganSach(khoa, res.bytes);
      daGhi.push({
        path: m.pq.relPath,
        bytes: res.bytes,
        created: !m.pq.daCo,
        sha256Before: m.pq.bamTruoc,
        sha256After: m.pq.bamSau,
      });
    }

    const dong = daGhi.map(
      (d) => `• ${d.path} — ${d.created ? "TẠO" : "ghi đè"}, ${d.bytes} byte, băm ${d.sha256Before.slice(0, 12)}… → ${d.sha256After.slice(0, 12)}…`,
    );
    return {
      type: KIEU,
      title: w(ctx.lang, `Đã áp thay đổi vào ${daGhi.length} tệp`, `Applied changes to ${daGhi.length} files`, `已对 ${daGhi.length} 个文件应用更改`),
      data: { ok: true, soTep, daGhi, chuaGhi: [] } satisfies DuLieuLo,
      textSummary: w(
        ctx.lang,
        `Đã áp ${daGhi.length}/${soTep} tệp trong một lượt duyệt:\n${dong.join("\n")}`,
        `Applied ${daGhi.length}/${soTep} files in one approval:\n${dong.join("\n")}`,
        `在一次审批中应用了 ${daGhi.length}/${soTep} 个文件：\n${dong.join("\n")}`,
      ),
    };
  },
};

registerTool(applyDiffBatchTool);
