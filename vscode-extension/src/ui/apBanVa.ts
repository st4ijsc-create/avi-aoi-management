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
 * 6b. **ĐO LẠI đĩa + tài liệu NGAY SÁT trước lượt ghi** (cửa sổ TOCTOU do chính bước 6 mở ra —
 *     xem docblock riêng ở thân hàm). Lệch ⇒ DỪNG và CHỐT sổ `thanhCong:false`.
 * 7. **Áp chỉnh sửa + `save()`** — điểm ghi duy nhất (`thayToanBoNoiDung`).
 * 8. **Đọc lại đĩa, băm lại, SO với băm bản MỚI, rồi mới khai.** Khớp ⇒ `chotApDungOClient(
 *    {thanhCong:true, sha256SauThat})`. Đĩa mang đúng BẢN GỐC hoặc KHÔNG đọc lại được ⇒ **CHƯA RÕ**:
 *    KHÔNG chốt sổ (chi tiết ở docblock bước 8 — chỗ nói dối thứ HAI, vá 2026-08-30 · F1).
 * 9. Bước 7 hỏng ⇒ **ĐỌC ĐĨA**, **HOÀN NGUYÊN** nếu bộ đệm có thể đã đổi, rồi mới chốt sổ theo
 *    đúng thứ ĐO ĐƯỢC (chi tiết ở docblock bước 9 — đây là chỗ đã từng nói dối, xem ngay dưới).
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
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BA LỜI KHAI HỢP LỆ CỦA HÀM NÀY — VÀ MỘT CÂU **KHÔNG BAO GIỜ** ĐƯỢC NÓI NẾU CHƯA ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hàm này chỉ được kết thúc bằng đúng một trong ba câu, và mỗi câu phải dựa trên một PHÉP ĐO:
 *   (1) **ĐÃ GHI** — đọc lại đĩa, băm khớp bản mới ⇒ `ok:true`, sổ chốt `thanhCong:true`.
 *   (2) **KHÔNG GHI GÌ** — hoặc chưa từng gọi tới điểm ghi, hoặc VSCode nói thẳng "tôi không áp",
 *       hoặc đã HOÀN NGUYÊN và ĐO LẠI thấy đĩa bằng đúng bản gốc ⇒ `ok:false`, sổ chốt
 *       `thanhCong:false`.
 *   (3) **CHƯA RÕ** — ghi hỏng mà hoàn nguyên cũng hỏng ⇒ nội dung của AI CÓ THỂ còn nằm trong bộ
 *       đệm editor ở dạng chưa lưu. Khi ấy **KHÔNG chốt sổ**: để hàng đứng ở `dang_ap_client`,
 *       đúng nghĩa "một lượt ghi đã bắt đầu, kết cục chưa rõ".
 * Câu bị CẤM: chốt `thanhCong:false` (⇒ `ap_client_that_bai`, đọc là *"đã thử và không byte nào
 * rơi"*) trong khi chưa đo được điều đó. `ap_client_that_bai` là lời khai theo hướng **che giấu**
 * một lượt ghi — với `files.autoSave` bật hoặc chỉ một cú Ctrl+S sau đó, byte của AI vẫn xuống đĩa
 * trong khi sổ đã đóng lại là "không có gì xảy ra". Đây là lỗ đã có thật, vá 2026-08-29.
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
  /**
   * `true` ⇔ byte ĐÃ vào đĩa — và điều đó được ĐO (đọc lại đĩa, băm khớp), không suy từ giá trị
   * trả về của lời gọi ghi.
   *
   * ⚠ `false` KHÔNG tự động có nghĩa "không có gì xảy ra". Nó có nghĩa **"đĩa không mang nội dung
   *   mới"**. Ca (3) ở docblock đầu tệp — ghi hỏng và hoàn nguyên cũng hỏng — cũng trả `false`,
   *   nhưng khi ấy bộ đệm editor CÓ THỂ đang giữ nội dung của AI ở dạng chưa lưu. Sự thật đầy đủ
   *   luôn nằm ở `thongDiep`; đừng dịch `ok:false` thành một câu ngắn hơn nó.
   */
  ok: boolean;
  thongDiep: string;
}

/** Đọc BYTE THẬT từ đĩa (không qua bộ đệm editor) và trả về dạng chuỗi utf8. */
async function docDia(uri: vscode.Uri): Promise<string> {
  return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
}

/**
 * ★★★ ĐIỂM GHI — hàm DUY NHẤT trong toàn extension chạm vào nội dung một tệp workspace.
 *
 * ⚠⚠ VÌ SAO NÓ LÀ MỘT HÀM RIÊNG (chứ không viết thẳng hai lần): đường ghi có HAI lượt gọi hợp lệ
 *    — lượt ÁP bản vá (bước 7) và lượt HOÀN NGUYÊN khi lượt kia hỏng nửa chừng (bước 9). Viết lặp
 *    là tạo **điểm ghi THỨ HAI**: census đếm số lần xuất hiện và đòi ĐÚNG MỘT, nên bản sao thứ hai
 *    vừa làm lưới đỏ vừa — nguy hiểm hơn — đẻ ra một lối chạm đĩa mà người sau phải rà riêng.
 *    Gói vào đây thì mọi byte của extension, theo cả hai chiều, đi qua đúng một cửa.
 *
 * Đi qua API chỉnh-sửa của VSCode (KHÔNG qua `fs`): người dùng **Ctrl+Z hoàn tác được**, editor
 * thấy thay đổi ngay. Thay TOÀN BỘ nội dung — `validateRange` kẹp phạm vi về đúng biên tài liệu
 * (tệp không có newline cuối vẫn đúng).
 *
 * Trả `false` ⇔ VSCode nói THẲNG rằng nó KHÔNG áp (khi ấy bộ đệm chắc chắn chưa đổi). Ném ⇒ trạng
 * thái bộ đệm KHÔNG XÁC ĐỊNH, nơi gọi phải xử lý như vậy.
 */
async function thayToanBoNoiDung(
  uri: vscode.Uri,
  doc: vscode.TextDocument,
  noiDung: string,
): Promise<boolean> {
  const bienTap = new vscode.WorkspaceEdit();
  bienTap.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), noiDung);
  return await vscode.workspace.applyEdit(bienTap);
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
  // Vân tay của TÀI LIỆU tại thời điểm này, để bước 6b so lại được sau lượt đi-về mạng của bước 6.
  // `version` của VSCode tăng ở MỌI lượt sửa bộ đệm, kể cả lượt sửa rồi hoàn tác — nên nó nhạy hơn
  // cả `isDirty` (sửa rồi Ctrl+Z về nguyên trạng làm `isDirty` trở lại `false` nhưng `version` thì
  // KHÔNG lùi). Ở một cửa ghi đè, nhạy quá là hướng đúng để sai.
  const phienBanLucDoc = doc.version;

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

  // ── BƯỚC 6b: ĐO LẠI NGAY SÁT TRƯỚC LƯỢT GHI ────────────────────────────────────────────────
  /**
   * ⚠⚠⚠ VÌ SAO PHÉP KIỂM NÀY PHẢI ĐỨNG **SAU** LỜI GỌI KIỂM TOÁN, KHÔNG PHẢI CHỈ TRƯỚC NÓ.
   *
   * Bước 4 băm đĩa. Bước 6 gọi **MẠNG**. Giữa hai mốc ấy là cửa sổ RỘNG NHẤT của cả hàm — một lượt
   * đi-về HTTP tới máy chủ, tính bằng chục đến hàng trăm mili-giây, thừa cho một lượt `git
   * checkout`, một `formatOnSave`, một tiến trình build đang ghi, hay chính người dùng gõ phím.
   * Bất cứ thứ gì rơi vào cửa sổ ấy đều bị lượt ghi ở bước 7 **xoá sạch không dấu vết**, và
   * `sha256Truoc` vừa khai lên sổ ở bước 6 trở thành một con số KHÔNG còn đúng với đĩa.
   *
   * Không chữa được bằng cách dời phép kiểm lên trước bước 6: thứ tự "ghi sổ TRƯỚC — ghi byte SAU"
   * là bất biến của tệp này (xem docblock đầu tệp) và không được đảo, nên bước 6 sẽ LUÔN nằm giữa
   * phép đo và lượt ghi. Vì thế phép kiểm được **THÊM** ở đây, sát ngay trước lượt ghi, chứ không
   * phải chuyển chỗ — cửa sổ còn lại thu về vài chục micro-giây thay vì một vòng mạng.
   *
   * Sổ đã mở rồi mà ta dừng ⇒ **phải chốt** `thanhCong:false`: chưa gọi tới điểm ghi lần nào nên
   * "không byte nào rơi" ở đây là điều ĐO ĐƯỢC (chính phép đo vừa rồi), không phải suy đoán.
   */
  let lyDoDungTruocKhiGhi: string | undefined;
  try {
    const bamNgayTruoc = bamNoiDung(await docDia(uri));
    if (!khopBanGoc(bamNgayTruoc, bamDia)) {
      lyDoDungTruocKhiGhi =
        `tệp trên đĩa đã đổi TRONG LÚC mở sổ kiểm toán (băm ${bamNgayTruoc.slice(0, 12)}… ≠ ${bamDia.slice(0, 12)}…)`;
    }
  } catch (e) {
    lyDoDungTruocKhiGhi = `không đọc lại được tệp ngay trước lượt ghi (${(e as Error).message})`;
  }
  if (!lyDoDungTruocKhiGhi && doc.version !== phienBanLucDoc) {
    lyDoDungTruocKhiGhi = `bộ đệm editor đã đổi trong lúc mở sổ kiểm toán (phiên bản tài liệu ${phienBanLucDoc} → ${doc.version})`;
  }
  if (!lyDoDungTruocKhiGhi && doc.isDirty) {
    lyDoDungTruocKhiGhi = "bộ đệm editor trở nên BẨN (có thay đổi chưa lưu) trong lúc mở sổ kiểm toán";
  }
  if (lyDoDungTruocKhiGhi) {
    let ghiChuChot = "";
    try {
      // ⚠ F6 (2026-08-30) — ĐỌC `chot.ok`. Máy chủ TỪ CHỐI qua HTTP 200 (token lệch, chủ sở hữu
      // lệch, hàng không ở `dang_ap_client`) và `goiChotApClient` KHÔNG ném cho các ca đó. Bỏ qua
      // trường này là để hàng đứng ở `dang_ap_client` VĨNH VIỄN trong khi người dùng không được
      // nói gì — đúng lớp lỗi "khai kết cục mà không đọc kết cục", chỉ đổi chỗ.
      const chot = await goiChotApClient(dv.serverUrl, dv.cookie, {
        actionId: batDau.actionId,
        token: batDau.token,
        thanhCong: false,
        loi: `DỪNG TRƯỚC KHI GHI: ${lyDoDungTruocKhiGhi}`,
      });
      if (!chot.ok) {
        ghiChuChot = ` (và máy chủ TỪ CHỐI chốt sổ kiểm toán: ${chot.message ?? "không rõ lý do"} — lượt này đứng ở trạng thái "đang áp", tức máy chủ ghi nhận là CHƯA RÕ)`;
      }
    } catch (e2) {
      ghiChuChot = ` (và KHÔNG chốt được sổ kiểm toán: ${(e2 as Error).message} — lượt này đứng ở trạng thái "đang áp", tức máy chủ ghi nhận là CHƯA RÕ)`;
    }
    return {
      ok: false,
      thongDiep:
        `KHÔNG GHI — "${dv.duongTuongDoi}": ${lyDoDungTruocKhiGhi}. ` +
        `Chưa gọi tới điểm ghi lần nào nên KHÔNG byte nào của lượt này rơi xuống đĩa. ` +
        `Hãy hỏi lại để AI đọc bản mới nhất.${ghiChuChot}`,
    };
  }

  // ── BƯỚC 7: GHI — ĐIỂM DUY NHẤT trong extension chạm đĩa workspace ─────────────────────────
  /** Đã GỌI tới điểm ghi ⇒ từ đây trở đi bộ đệm CÓ THỂ đang mang nội dung của AI. */
  let daGoiDiemGhi = false;
  /** VSCode nói THẲNG "tôi không áp" ⇒ bộ đệm chắc chắn CHƯA đổi (khác hẳn ca "ném"). */
  let biTuChoiAp = false;
  try {
    daGoiDiemGhi = true;
    const daAp = await thayToanBoNoiDung(uri, doc, moi);
    if (!daAp) {
      biTuChoiAp = true;
      throw new Error("VSCode từ chối áp chỉnh sửa (tệp bị khoá hoặc đã đổi giữa chừng)");
    }
    const daLuu = await doc.save();
    if (!daLuu) throw new Error("VSCode không lưu được tệp sau khi áp chỉnh sửa");
  } catch (e) {
    // ── BƯỚC 9: GHI HỎNG — ĐỌC KẾT CỤC RỒI MỚI KHAI KẾT CỤC ─────────────────────────────────
    /**
     * ⚠⚠⚠ ĐÂY LÀ CHỖ ĐÃ NÓI DỐI, VÁ 2026-08-29 (C-1). Bản cũ chốt thẳng `thanhCong:false` và báo
     * "GHI THẤT BẠI" cho MỌI lỗi của khối trên. Nhưng khối trên có HAI mốc rất khác nhau:
     *   · áp chỉnh sửa ⇒ đổi **BỘ ĐỆM** (chưa chạm đĩa);
     *   · `save()`     ⇒ đẩy bộ đệm xuống **ĐĨA**.
     * Mốc đầu XONG mà mốc sau HỎNG ⇒ nội dung của AI đang nằm trong bộ đệm editor ở dạng **CHƯA
     * LƯU**. Với `files.autoSave` (mặc định của rất nhiều người) hoặc chỉ một cú Ctrl+S sau đó,
     * đúng những byte ấy rơi xuống đĩa — trong khi sổ kiểm toán đã đóng ở `ap_client_that_bai` và
     * người dùng vừa đọc câu "GHI THẤT BẠI". Một lời khai SAI **theo hướng che giấu một lượt ghi**.
     *
     * Nên ở đây, đúng ba việc, đúng thứ tự:
     *   (a) **ĐỌC ĐĨA** — `save()` báo hỏng KHÔNG có nghĩa byte không rơi; đọc rồi mới nói.
     *   (b) **HOÀN NGUYÊN** qua ĐÚNG điểm ghi ở trên (`thayToanBoNoiDung`, không mở lối thứ hai),
     *       rồi **ĐO LẠI** để xác nhận đĩa đã bằng bản gốc và bộ đệm đã sạch.
     *   (c) chỉ khai "không byte nào rơi" khi (a)/(b) chứng minh được; nếu không, để sổ ở
     *       `dang_ap_client` (CHƯA RÕ) và nói thẳng bộ đệm có thể còn nội dung chưa lưu.
     */
    const loi = (e as Error).message;

    // (a) Đĩa nói gì? — không suy từ giá trị trả về của lời gọi vừa hỏng.
    let bamSauHong: string | undefined;
    try {
      bamSauHong = bamNoiDung(await docDia(uri));
    } catch {
      bamSauHong = undefined;
    }

    if (bamSauHong !== undefined && khopBanGoc(bamSauHong, bamSauDuKien)) {
      // Byte ĐÃ vào đĩa dù lời gọi báo hỏng. Ở đây khai "thất bại" mới là nói dối — theo đúng
      // hướng che giấu. Khai THÀNH CÔNG kèm nguyên văn lỗi để người dùng biết đường đi bất thường.
      let ketSoNgoaiY = "";
      try {
        const chot = await goiChotApClient(dv.serverUrl, dv.cookie, {
          actionId: batDau.actionId,
          token: batDau.token,
          thanhCong: true,
          sha256SauThat: bamSauHong,
        });
        if (!chot.ok) ketSoNgoaiY = ` ⚠ Máy chủ từ chối chốt sổ kiểm toán: ${chot.message ?? "không rõ lý do"}.`;
      } catch (e2) {
        ketSoNgoaiY = ` ⚠ KHÔNG chốt được sổ kiểm toán (${(e2 as Error).message}) — lượt này đứng ở "đang áp", tức CHƯA RÕ trên máy chủ.`;
      }
      return {
        ok: true,
        thongDiep:
          `ĐÃ GHI vào workspace: "${dv.duongTuongDoi}" (+${them} / −${bot}) — MẶC DÙ VSCode báo lỗi ("${loi}"). ` +
          `Đọc lại đĩa cho thấy nội dung MỚI đã nằm trên đĩa (băm khớp bản đã xem trước), nên khai "thất bại" ở đây sẽ là lời khai sai. ` +
          `Ctrl+Z hoàn tác được.${ketSoNgoaiY}`,
      };
    }

    // (b) HOÀN NGUYÊN nếu bộ đệm CÓ THỂ đã mang nội dung của AI.
    let daHoanTac = false;
    let loiHoanTac = "";
    if (daGoiDiemGhi && !biTuChoiAp) {
      try {
        if (!(await thayToanBoNoiDung(uri, doc, noiDungDia))) {
          throw new Error("VSCode từ chối áp bản hoàn nguyên");
        }
        // ⚠ Giá trị trả về của `save()` ở đây được BỎ QUA CÓ CHỦ Ý — cùng lý lẽ với nhánh (a) ngay
        // trên: lời gọi có thể báo hỏng mà byte vẫn đúng chỗ, và ngược lại. "Đã hoàn nguyên" là
        // một KẾT CỤC, nên nó phải được ĐỌC (băm đĩa + `isDirty`), không được suy từ một cờ.
        await doc.save();
        const bamKiem = bamNoiDung(await docDia(uri));
        if (!khopBanGoc(bamKiem, bamDia)) {
          throw new Error(`đĩa sau hoàn nguyên mang băm ${bamKiem.slice(0, 12)}… ≠ băm gốc ${bamDia.slice(0, 12)}…`);
        }
        if (doc.isDirty) throw new Error("bộ đệm vẫn còn thay đổi CHƯA LƯU sau khi hoàn nguyên");
        daHoanTac = true;
      } catch (e3) {
        loiHoanTac = (e3 as Error).message;
      }
    }

    // (c) Khai theo đúng thứ đo được.
    if (!biTuChoiAp && !daHoanTac) {
      // ⚠ KHÔNG CHỐT SỔ. `thanhCong:false` ⇒ `ap_client_that_bai`, đọc là "đã thử và KHÔNG byte nào
      // rơi" — một câu ta KHÔNG kiểm chứng được ở đây. Để hàng đứng ở `dang_ap_client` là câu trung
      // thực duy nhất còn lại: "một lượt ghi đã BẮT ĐẦU, kết cục CHƯA RÕ".
      return {
        ok: false,
        thongDiep:
          `⚠⚠ CHƯA RÕ — "${dv.duongTuongDoi}": lượt ghi hỏng (${loi})` +
          (loiHoanTac ? ` và HOÀN NGUYÊN CŨNG HỎNG (${loiHoanTac})` : "") +
          `. Nội dung do AI đề xuất CÓ THỂ đang nằm trong bộ đệm editor ở dạng CHƯA LƯU: nếu ` +
          `"files.autoSave" đang bật, hoặc bạn bấm Ctrl+S, nó SẼ rơi xuống đĩa. Hãy mở ` +
          `"${dv.duongTuongDoi}" rồi Ctrl+Z (hoặc đóng tệp mà KHÔNG lưu) trước khi làm gì tiếp. ` +
          `Sổ kiểm toán được ĐỂ NGUYÊN ở trạng thái "đang áp" (CHƯA RÕ) — chốt "thất bại" ở đây sẽ ` +
          `là lời khai sai theo hướng che giấu một lượt ghi.`,
      };
    }

    const xacNhanDia =
      bamSauHong === undefined
        ? " ⚠ (không đọc lại được đĩa để xác nhận)"
        : khopBanGoc(bamSauHong, bamDia)
          ? ""
          : ` ⚠ nhưng đĩa lại mang băm ${bamSauHong.slice(0, 12)}… khác cả bản gốc lẫn bản đề xuất — hãy kiểm tra tệp bằng tay.`;
    let ghiChu = "";
    try {
      // ⚠ F6 — cùng lý lẽ với lượt chốt ở bước 6b: `ok:false` qua HTTP 200 là một lượt chốt KHÔNG
      // xảy ra, và im lặng ở đây để lại một hàng `dang_ap_client` mà không ai biết.
      const chot = await goiChotApClient(dv.serverUrl, dv.cookie, {
        actionId: batDau.actionId,
        token: batDau.token,
        thanhCong: false,
        loi: daHoanTac ? `${loi} — đã hoàn nguyên về nội dung gốc và đo lại xác nhận` : loi,
      });
      if (!chot.ok) {
        ghiChu = ` (và máy chủ TỪ CHỐI chốt sổ kiểm toán: ${chot.message ?? "không rõ lý do"} — lượt này đứng ở trạng thái "đang áp", tức máy chủ ghi nhận là CHƯA RÕ)`;
      }
    } catch (e2) {
      // Không chốt được: hàng đứng ở `dang_ap_client` — "chưa rõ" TRUNG THỰC. Nói ra, đừng nuốt.
      ghiChu = ` (và KHÔNG chốt được sổ kiểm toán: ${(e2 as Error).message} — lượt này đứng ở trạng thái "đang áp", tức máy chủ ghi nhận là CHƯA RÕ)`;
    }
    return {
      ok: false,
      thongDiep: daHoanTac
        ? `KHÔNG GHI — "${dv.duongTuongDoi}": ${loi}. Nội dung của AI đã được HOÀN NGUYÊN qua đúng điểm ghi ấy; ` +
          `đọc lại đĩa cho băm ${bamDia.slice(0, 12)}… (đúng bản gốc) và bộ đệm editor đã sạch, nên KHÔNG byte nào ` +
          `của lượt này còn ở đâu cả.${ghiChu}`
        : `KHÔNG GHI — "${dv.duongTuongDoi}": ${loi}. VSCode từ chối áp chỉnh sửa nên bộ đệm KHÔNG đổi.${xacNhanDia}${ghiChu}`,
    };
  }

  // ── BƯỚC 8: ĐỌC LẠI ĐĨA, **SO BĂM**, RỒI MỚI KHAI KẾT CỤC ─────────────────────────────────
  /**
   * ⚠⚠⚠ F1 (2026-08-30) — ĐÂY LÀ CHỖ THỨ HAI ĐÃ NÓI DỐI, VÀ NÓ NẰM NGAY TRONG BẢN VÁ CỦA CHỖ THỨ
   * NHẤT. Bản trước: đọc lại đĩa → băm → **chốt `thanhCong:true` và trả `ok:true "Đã ghi"` bất kể
   * băm ấy là gì**, kể cả khi lượt đọc lại NÉM (`bamSauThat === undefined` ⇒ hàng `da_ap_client`
   * mang `sha256SauThat: undefined`). Luật của chính tệp này — *"ĐÃ GHI — đọc lại đĩa, băm KHỚP
   * BẢN MỚI"* — được cưỡng chế ở nhánh HỎNG (bước 9) và bị bỏ quên ở nhánh THÀNH CÔNG: **bản vá
   * khẳng định một luật mà nó chỉ cài đặt ở MỘT PHÍA.**
   *
   * Hai câu KHÔNG ĐÚNG lọt qua được bản cũ:
   *   (a) không đọc nổi kết cục, vẫn khai là đã áp — "đã ghi" khi ấy suy từ giá trị trả về của
   *       `save()`, đúng thứ mà cả tệp này cấm;
   *   (b) đĩa vẫn mang **BẢN GỐC** (có thứ trả tệp về ngay sau lượt lưu) ⇒ sổ ghi
   *       `sha256SauThat === sha256Truoc` dưới trạng thái `da_ap_client` — hai ô mâu thuẫn trong
   *       một hàng, đúng hình dạng lỗi mà Đợt B đã vá ở máy chủ — giao diện nói "Đã ghi", và cảnh
   *       báo lệch băm còn quy sai nguyên nhân cho bộ định dạng của editor.
   *
   * Nên ở đây: ĐỌC → SO → rẽ theo BA kết cục THẬT, mỗi kết cục một lời khai và một trạng thái sổ
   * ĐÚNG với nó. Băm khai lên sổ luôn là băm ĐO ĐƯỢC, không phải băm DỰ KIẾN ở bước 6.
   */
  let bamSauThat: string | undefined;
  let loiDocLai = "";
  try {
    bamSauThat = bamNoiDung(await docDia(uri));
  } catch (e) {
    loiDocLai = (e as Error).message;
  }

  // ── (8a) KHÔNG ĐỌC ĐƯỢC KẾT CỤC ⇒ **CHƯA RÕ**, KHÔNG CHỐT SỔ ───────────────────────────────
  if (bamSauThat === undefined) {
    // `thanhCong:true` ⇒ `da_ap_client` = "byte ĐÃ vào đĩa"; `thanhCong:false` ⇒ `ap_client_that_bai`
    // = "đã thử và KHÔNG byte nào rơi". Ở đây ta không đo được ĐIỀU NÀO trong hai điều đó, nên cả
    // hai đều là khai điều mình không biết. `dang_ap_client` là câu trung thực duy nhất còn lại.
    return {
      ok: false,
      thongDiep:
        `⚠⚠ CHƯA RÕ — "${dv.duongTuongDoi}": lượt ghi báo THÀNH CÔNG nhưng KHÔNG đọc lại được tệp để ` +
        `xác nhận (${loiDocLai}). "Đã ghi" là một KẾT CỤC và kết cục ấy vừa KHÔNG đo được, nên nó ` +
        `không được khai ở đây. Byte CÓ THỂ đã vào đĩa, cũng có thể chưa. Sổ kiểm toán được ĐỂ NGUYÊN ` +
        `ở trạng thái "đang áp" (CHƯA RÕ) — chốt "đã áp" lúc này là khai một điều chưa ai đọc. Hãy mở ` +
        `"${dv.duongTuongDoi}" và tự kiểm tra trước khi làm gì tiếp.`,
    };
  }

  // ── (8b) ĐĨA MANG ĐÚNG **BẢN GỐC** ⇒ LƯỢT GHI KHÔNG CÓ HIỆU LỰC ⇒ **CHƯA RÕ**, KHÔNG CHỐT ──
  if (!khopBanGoc(bamSauThat, bamSauDuKien) && khopBanGoc(bamSauThat, bamDia)) {
    // ⚠ VÌ SAO KHÔNG PHẢI `thanhCong:false`: `ap_client_that_bai` đọc là *"đã thử và KHÔNG byte nào
    // rơi"*. Ta CHỈ đo được trạng thái ĐĨA LÚC NÀY. Lượt lưu vừa báo thành công, nên hoàn toàn có
    // thể byte ĐÃ rơi rồi bị một thứ khác (git checkout, tiến trình build, extension khác) ghi đè
    // trở lại. Hai ca ấy không phân biệt được từ đây ⇒ khai "0 byte" là nói dối theo hướng CHE GIẤU
    // một lượt ghi, đúng câu bị CẤM ở docblock đầu tệp.
    return {
      ok: false,
      thongDiep:
        `⚠⚠ CHƯA RÕ — "${dv.duongTuongDoi}": lượt ghi báo THÀNH CÔNG, nhưng đọc lại đĩa cho ĐÚNG BĂM ` +
        `TRƯỚC KHI GHI (${bamSauThat.slice(0, 12)}… = ${bamDia.slice(0, 12)}…) ⇒ trên đĩa hiện là ` +
        `NỘI DUNG GỐC, tức lượt ghi này KHÔNG CÓ HIỆU LỰC: nội dung do AI đề xuất KHÔNG nằm trên đĩa. ` +
        `Có thứ gì đó đã trả tệp về bản cũ ngay sau lượt lưu (git checkout, một tiến trình build, một ` +
        `extension khác), hoặc lượt lưu chỉ BÁO là xong — từ đây không phân biệt được, nên KHÔNG khai ` +
        `"đã ghi" mà cũng KHÔNG khai "không byte nào rơi".` +
        (doc.isDirty
          ? ` ⚠ Bộ đệm editor ĐANG có thay đổi CHƯA LƯU: một cú Ctrl+S (hoặc "files.autoSave") sẽ đẩy ` +
            `nội dung của AI xuống đĩa. Hãy Ctrl+Z hoặc đóng tệp mà KHÔNG lưu nếu bạn không muốn điều đó.`
          : "") +
        ` Sổ kiểm toán được ĐỂ NGUYÊN ở trạng thái "đang áp" (CHƯA RÕ).`,
    };
  }

  // ── (8c) BĂM KHỚP BẢN MỚI **hoặc** ĐĨA MANG MỘT BẢN THỨ BA ⇒ BYTE ĐÃ ĐỔI TRÊN ĐĨA ─────────
  // Bản thứ ba (khác cả gốc lẫn bản xem trước) vẫn là "đã ghi": đĩa KHÔNG còn mang bản gốc. Ca
  // thường gặp là editor định dạng/chuẩn hoá lúc lưu. Khai băm ĐO ĐƯỢC và nói rõ chỗ lệch — nhưng
  // KHÔNG quy nguyên nhân thành một câu chắc chắn, vì nguyên nhân là thứ ta chưa đo.
  const lechBam = khopBanGoc(bamSauThat, bamSauDuKien)
    ? ""
    : ` ⚠ Nội dung trên đĩa sau khi lưu KHÁC bản đã xem trước (băm ${bamSauThat.slice(0, 12)}… ≠ ${bamSauDuKien.slice(0, 12)}…) và cũng khác bản gốc — thường là do editor định dạng/chuẩn hoá lúc lưu, nhưng đó là PHỎNG ĐOÁN chứ không phải phép đo. Hãy xem lại tệp.`;

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

  return {
    ok: true,
    thongDiep: `Đã ghi vào workspace: "${dv.duongTuongDoi}" (+${them} / −${bot}). Ctrl+Z hoàn tác được.${lechBam}${ketSo}`,
  };
}
