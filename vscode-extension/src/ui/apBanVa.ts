/**
 * ★★★ ĐIỂM GHI ĐĨA **DUY NHẤT** CỦA EXTENSION (spec §4.1 · §6.3 · §6.4 · §6.5).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY LÀ TỆP RỦI RO NHẤT CỦA CẢ DỰ ÁN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ở chế độ SERVER, MÁY CHỦ giữ tệp nên máy chủ cưỡng chế được: hộp cát, whitelist, RBAC. Ở chế độ
 * LOCAL, mã nằm trên máy lập trình viên — **máy chủ không với tới** ⇒ **không cưỡng chế được nữa**.
 * Spec §4.1 nói thẳng điều đó và bù bằng ba thứ ĐO ĐƯỢC, cả ba ráp lại **ở đây**:
 *   (1) đúng **MỘT** điểm ghi, có census canh (`loi/census.unit.test.ts` đếm hai API áp-chỉnh-sửa
 *       của VSCode dùng ở bước 7 và đòi ĐÚNG 1 lần, không phải "≤1");
 *   (2) **vị từ chặn cục bộ** (`loi/chanGhi.ts` + `loi/duongThat.ts`);
 *   (3) **kiểm toán ghi-TRƯỚC chốt-SAU** (`mang/duyetGhi.ts` → hai thủ tục tRPC của Task 5).
 *
 * ⚠ VÌ SAO BÌNH LUẬN Ở ĐÂY KHÔNG GỌI TÊN HAI API ẤY: census là phép soi VĂN BẢN, nó không phân biệt
 *   mã với bình luận. Mỗi lần nhắc tên trong ghi chú là một lần "+1" cho phép đếm lẽ ra chỉ được
 *   bằng 1 — nên tên chỉ xuất hiện ở đúng dòng mã thật, ngay dưới bước 7.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * THỨ TỰ BẤT BIẾN — MỖI BƯỚC CÓ MỘT LÝ DO, ĐỔI THỨ TỰ LÀ MỞ LẠI ĐÚNG MỘT LỖ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 1. **Giải đường THẬT** (`giaiDuongThat`, R-C5) — trước MỌI phép so ranh giới. `duocPhepGhi` so
 *    bằng `path.relative`, tức thao tác CHUỖI: một symlink/junction trong workspace trỏ ra ngoài
 *    lọt qua nguyên vẹn nếu không giải trước. Giải CẢ đường đích LẪN các thư mục workspace — giải
 *    một phía thôi thì phép so vẫn lệch.
 * 2. **`duocPhepGhi`** — sai ⇒ DỪNG, báo `lyDo`, KHÔNG làm gì thêm (không đọc, không ghi sổ).
 * 3. **Đọc tệp từ ĐĨA** bằng `vscode.workspace.fs.readFile` — **byte thật**, KHÔNG lấy từ
 *    `TextDocument.getText()`: bộ đệm editor có thể đã chuẩn hoá EOL/BOM, nên băm sẽ so hai thứ
 *    khác nhau và vị từ chống xung đột mất tác dụng ĐÚNG LÚC CẦN nhất.
 * 4. **So băm** với băm gốc của đề xuất (`khopBanGoc`). Lệch ⇒ DỪNG: tệp đã đổi kể từ lúc đề xuất,
 *    ghi đè là xoá thay đổi của người dùng. ⚠ Cộng thêm phép kiểm **bộ đệm BẨN** (`doc.isDirty`):
 *    băm nói về ĐĨA, nhưng bước 7 áp chỉnh sửa rồi `save()` cái đang ở BỘ ĐỆM — đĩa sạch mà bộ đệm có sửa
 *    chưa lưu thì một lượt ghi ở đây sẽ nuốt mất phần chưa lưu ấy, và băm đĩa KHÔNG hề thấy.
 * 5. **`ghepBanVa`** — `{ok:false}` ⇒ DỪNG, báo `lyDo` (không tự cắt, không tự đoán).
 * 6. **`batDauApDungOClient` — GHI KIỂM TOÁN TRƯỚC KHI BYTE RƠI.** Lỗi ⇒ DỪNG, KHÔNG ghi.
 * 7. **Áp chỉnh sửa + `save()`** — điểm ghi duy nhất.
 * 8. **Đọc lại đĩa, băm lại, `chotApDungOClient({thanhCong:true, sha256SauThat})`.**
 * 9. Bước 7 ném ⇒ `chotApDungOClient({thanhCong:false, loi})` rồi báo lỗi cho người dùng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO KIỂM TOÁN ĐI **TRƯỚC** (đây là câu quan trọng nhất của tệp này)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai thứ tự khả dĩ, và chúng KHÔNG đối xứng:
 *   · Ghi trước – ghi sổ sau ⇒ sập giữa chừng để lại **byte đã đổi trên đĩa mà KHÔNG có vết nào**.
 *     Sổ kiểm toán khi ấy nói "không có gì xảy ra" — một lời khai SAI, và sai theo hướng che giấu.
 *   · Ghi sổ trước – ghi byte sau ⇒ sập giữa chừng để lại một hàng đứng ở `dang_ap_client`, tức
 *     **"tôi biết một lượt ghi được BẮT ĐẦU, tôi KHÔNG biết nó có xong hay không"**. Đó là câu
 *     TRUNG THỰC — nó không nói dối theo hướng nào, và người đọc sổ biết chính xác mình đang thiếu
 *     thông tin gì. Máy chủ cố ý KHÔNG có tiến trình nào tự dọn hàng đó
 *     (`aiCopilotActions.ts` §Đợt C · Task 5), vì tự đặt `da_ap_client` là nói dối lạc quan và tự
 *     đặt `ap_client_that_bai` là nói dối bi quan.
 * Vì thế: kiểm toán lỗi ⇒ **thà không ghi còn hơn ghi mà không có vết**.
 *
 * ⚠ NGOÀI PHẠM VI (nói thẳng, không giả vờ): **KHÔNG tạo tệp mới**. Đợt này chỉ sửa tệp ĐÃ CÓ.
 *   Tạo tệp cần một lối ghi THỨ HAI (`.createFile()` của cùng đối tượng chỉnh-sửa) và một nhánh
 *   băm-gốc-rỗng riêng — hai thứ đều nới rộng đúng bề mặt mà tệp này sinh ra để thu hẹp. Đề xuất
 *   trỏ vào tệp chưa tồn tại bị từ chối RÀNH MẠCH ở bước 3, không im lặng.
 */
import * as vscode from "vscode";
import type { DeXuatCucBo } from "../loi/deXuatCucBo";
import { bamNoiDung, khopBanGoc } from "../loi/bamTep";
import { duocPhepGhi } from "../loi/chanGhi";
import { giaiDuongThat } from "../loi/duongThat";
import { ghepBanVa } from "../loi/ghepBanVa";
import { tomTatDiff } from "../loi/tomTatDiff";
import { goiBatDauApClient, goiChotApClient } from "../mang/duyetGhi";

export interface DauVaoApBanVa {
  /** Đề xuất đã đọc từ văn bản model (`loi/deXuatCucBo.ts`). */
  deXuat: DeXuatCucBo;
  /** Đường TUYỆT ĐỐI đã ghép từ gốc workspace + `deXuat.path` (chưa giải symlink — bước 1 lo). */
  duongTuyetDoi: string;
  /** Đường TƯƠNG ĐỐI để khai lên sổ kiểm toán — máy chủ KHÔNG nhận đường tuyệt đối máy dev. */
  duongTuongDoi: string;
  /** Băm nội dung ĐĨA tại thời điểm dựng đề xuất — chính là bản người dùng đã nhìn thấy trong diff. */
  bamGoc: string;
  /** Các thư mục workspace đang mở (`fsPath`), CHƯA giải symlink — bước 1 lo. */
  thuMucWorkspace: string[];
  nhanWorkspace: string;
  serverUrl: string;
  cookie: string;
}

export interface KetQuaApBanVa {
  /** `true` ⇔ byte ĐÃ vào đĩa (theo quan sát của chính extension: áp chỉnh sửa + `save` đều báo xong). */
  ok: boolean;
  thongDiep: string;
}

/** Đọc BYTE THẬT từ đĩa (không qua bộ đệm editor) và trả về dạng chuỗi utf8. */
async function docDia(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
}

export async function apBanVa(dv: DauVaoApBanVa): Promise<KetQuaApBanVa> {
  // ── BƯỚC 1: giải đường THẬT (R-C5) ─────────────────────────────────────────────────────────
  const that = giaiDuongThat(dv.duongTuyetDoi);
  if (!that.ok) return { ok: false, thongDiep: `KHÔNG GHI — ${that.lyDo}` };

  const wsThat: string[] = [];
  for (const ws of dv.thuMucWorkspace) {
    const r = giaiDuongThat(ws);
    // Một thư mục workspace không giải nổi thì KHÔNG so được ranh giới THẬT với nó. Dừng cả lượt
    // (fail-closed) thay vì lặng lẽ bỏ nó ra khỏi danh sách: bỏ ra làm danh sách so ngắn đi mà
    // người dùng không hề biết, và một thông báo "nằm ngoài mọi workspace" khi ấy là lời khai sai
    // về NGUYÊN NHÂN.
    if (!r.ok) {
      return {
        ok: false,
        thongDiep: `KHÔNG GHI — không giải được đường thật của thư mục workspace "${ws}" (${r.lyDo}); từ chối vì không so được ranh giới thật.`,
      };
    }
    wsThat.push(r.duong);
  }

  // ── BƯỚC 2: vị từ chặn cục bộ ──────────────────────────────────────────────────────────────
  const phep = duocPhepGhi(that.duong, wsThat);
  if (!phep.ok) return { ok: false, thongDiep: `KHÔNG GHI — ${phep.lyDo}` };

  const uri = vscode.Uri.file(that.duong);

  // ── BƯỚC 3: đọc tệp từ ĐĨA (byte thật) ─────────────────────────────────────────────────────
  let noiDungDia: string;
  try {
    noiDungDia = await docDia(uri);
  } catch (e) {
    return {
      ok: false,
      thongDiep: `KHÔNG GHI — không đọc được tệp từ đĩa: "${dv.duongTuongDoi}" (${(e as Error).message}). Đợt này chỉ sửa tệp ĐÃ CÓ, không tạo tệp mới.`,
    };
  }

  // ── BƯỚC 4: chống xung đột — băm ĐĨA phải khớp băm gốc của đề xuất ──────────────────────────
  const bamDia = bamNoiDung(noiDungDia);
  if (!khopBanGoc(bamDia, dv.bamGoc)) {
    return {
      ok: false,
      thongDiep:
        `KHÔNG GHI — tệp đã đổi kể từ lúc đề xuất: "${dv.duongTuongDoi}". ` +
        `Băm đĩa ${bamDia.slice(0, 12)}… ≠ băm gốc ${dv.bamGoc.slice(0, 12)}…. ` +
        `Hãy hỏi lại để AI đọc bản mới nhất — ghi đè ở đây sẽ xoá mất thay đổi vừa rồi.`,
    };
  }

  // Bộ đệm editor BẨN: xem docblock bước 4. Mở tài liệu ở đây (chỉ ĐỌC) để vừa kiểm `isDirty` vừa
  // có sẵn phạm vi thay thế cho bước 7.
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (e) {
    return { ok: false, thongDiep: `KHÔNG GHI — không mở được tài liệu "${dv.duongTuongDoi}" (${(e as Error).message}).` };
  }
  if (doc.isDirty) {
    return {
      ok: false,
      thongDiep:
        `KHÔNG GHI — "${dv.duongTuongDoi}" đang có thay đổi CHƯA LƯU trong editor. ` +
        `Băm chỉ nói về ĐĨA, nên nó không thấy phần chưa lưu; ghi lúc này sẽ nuốt mất phần đó. ` +
        `Hãy lưu (hoặc hoàn tác) rồi bấm lại.`,
    };
  }

  // ── BƯỚC 5: ghép bản vá (thuần, chưa chạm đĩa) ─────────────────────────────────────────────
  const ghep = ghepBanVa(noiDungDia, dv.deXuat);
  if (!ghep.ok) return { ok: false, thongDiep: `KHÔNG GHI — ${ghep.lyDo}` };
  const moi = ghep.moi;
  if (moi === noiDungDia) {
    // Không có gì để ghi. Vẫn phải nói ra: một lượt "thành công" mà đĩa không đổi là lời khai gây
    // hiểu nhầm, và ghi một hàng kiểm toán cho một lượt không thay đổi gì chỉ làm loãng sổ.
    return { ok: false, thongDiep: `KHÔNG GHI — bản vá cho "${dv.duongTuongDoi}" không thay đổi nội dung nào.` };
  }
  const bamSauDuKien = bamNoiDung(moi);
  const { them, bot } = tomTatDiff(noiDungDia, moi);

  // ── BƯỚC 6: KIỂM TOÁN **TRƯỚC** KHI BYTE RƠI ───────────────────────────────────────────────
  let batDau: { actionId: string; token: string };
  try {
    batDau = await goiBatDauApClient(dv.serverUrl, dv.cookie, {
      path: dv.duongTuongDoi,
      // ⚠ Router chặn `nhanWorkspace` ở 200 ký tự (`aiCopilotRouter.ts`). Nhãn này là MÔ TẢ, không
      // dùng để cưỡng chế điều gì, nên cắt bớt là vô hại — trong khi để nó vượt trần sẽ khiến zod
      // từ chối cả lượt và người dùng nhận một lỗi "không mở được sổ kiểm toán" chẳng nói lên gì.
      nhanWorkspace: dv.nhanWorkspace.length > 200 ? `…${dv.nhanWorkspace.slice(-199)}` : dv.nhanWorkspace,
      sha256Truoc: bamDia,
      sha256Sau: bamSauDuKien,
      tomTat: `+${them} / −${bot}`,
      soDongThem: them,
      soDongBot: bot,
    });
  } catch (e) {
    return {
      ok: false,
      thongDiep:
        `KHÔNG GHI — không mở được sổ kiểm toán trên máy chủ (${(e as Error).message}). ` +
        `Thà không ghi còn hơn ghi mà không có vết.`,
    };
  }
  if (!batDau.actionId || !batDau.token) {
    return {
      ok: false,
      thongDiep: "KHÔNG GHI — máy chủ không cấp actionId/token cho lượt kiểm toán; không có vết thì không ghi.",
    };
  }

  // ── BƯỚC 7: GHI — ĐIỂM DUY NHẤT trong extension chạm đĩa workspace ─────────────────────────
  // Đi qua API chỉnh-sửa của VSCode (KHÔNG qua `fs`): người dùng **Ctrl+Z hoàn tác được**, editor
  // thấy thay đổi ngay, và mọi lượt ghi đi qua đúng một API mà census đếm được. Thay TOÀN BỘ nội
  // dung — `validateRange` kẹp phạm vi về đúng biên tài liệu (tệp không newline cuối vẫn đúng).
  try {
    const bienTap = new vscode.WorkspaceEdit();
    bienTap.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), moi);
    const daAp = await vscode.workspace.applyEdit(bienTap);
    if (!daAp) throw new Error("VSCode từ chối áp chỉnh sửa (tệp bị khoá hoặc đã đổi giữa chừng)");
    const daLuu = await doc.save();
    if (!daLuu) throw new Error("VSCode không lưu được tệp sau khi áp chỉnh sửa");
  } catch (e) {
    // ── BƯỚC 9: ghi hỏng ⇒ chốt THẤT BẠI ────────────────────────────────────────────────────
    const loi = (e as Error).message;
    let ghiChu = "";
    try {
      await goiChotApClient(dv.serverUrl, dv.cookie, {
        actionId: batDau.actionId,
        token: batDau.token,
        thanhCong: false,
        loi,
      });
    } catch (e2) {
      // Không chốt được: hàng đứng ở `dang_ap_client` — "chưa rõ" TRUNG THỰC. Nói ra, đừng nuốt.
      ghiChu = ` (và KHÔNG chốt được sổ kiểm toán: ${(e2 as Error).message} — lượt này đứng ở trạng thái "đang áp", tức máy chủ ghi nhận là CHƯA RÕ)`;
    }
    return { ok: false, thongDiep: `GHI THẤT BẠI — "${dv.duongTuongDoi}": ${loi}.${ghiChu}` };
  }

  // ── BƯỚC 8: đọc lại ĐĨA, băm lại, chốt sổ ──────────────────────────────────────────────────
  // Băm khai lên sổ là băm ĐO ĐƯỢC SAU KHI GHI, không phải băm DỰ KIẾN ở bước 6. Hai con số có thể
  // lệch thật (formatOnSave, chuẩn hoá EOL của editor…) — khai cái đo được rồi nói rõ chỗ lệch còn
  // hơn khai cái mình mong đợi.
  let bamSauThat: string | undefined;
  let canhBaoDocLai = "";
  try {
    bamSauThat = bamNoiDung(await docDia(uri));
  } catch (e) {
    canhBaoDocLai = ` ⚠ Không đọc lại được tệp để băm xác nhận (${(e as Error).message}) — sổ kiểm toán không có băm sau.`;
  }

  let ketSo = "";
  try {
    const chot = await goiChotApClient(dv.serverUrl, dv.cookie, {
      actionId: batDau.actionId,
      token: batDau.token,
      thanhCong: true,
      sha256SauThat: bamSauThat,
    });
    if (!chot.ok) ketSo = ` ⚠ Máy chủ từ chối chốt sổ kiểm toán: ${chot.message ?? "không rõ lý do"}.`;
  } catch (e) {
    ketSo =
      ` ⚠ Byte ĐÃ vào đĩa nhưng KHÔNG chốt được sổ kiểm toán (${(e as Error).message}) — ` +
      `lượt này đứng ở trạng thái "đang áp" trên máy chủ, tức được ghi nhận là CHƯA RÕ.`;
  }

  const lechBam =
    bamSauThat && bamSauThat !== bamSauDuKien
      ? ` ⚠ Nội dung trên đĩa sau khi lưu KHÁC bản đã xem trước (băm ${bamSauThat.slice(0, 12)}… ≠ ${bamSauDuKien.slice(0, 12)}…) — nhiều khả năng do editor định dạng/chuẩn hoá lúc lưu. Hãy xem lại tệp.`
      : "";

  return {
    ok: true,
    thongDiep: `Đã ghi vào workspace: "${dv.duongTuongDoi}" (+${them} / −${bot}). Ctrl+Z hoàn tác được.${lechBam}${canhBaoDocLai}${ketSo}`,
  };
}
