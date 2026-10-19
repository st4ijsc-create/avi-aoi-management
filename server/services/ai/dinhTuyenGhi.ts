/**
 * ★★★ ĐỊNH TUYẾN CỬA GHI của chế độ lập trình — *"câu này rẽ sang cửa SỬA / TỰ TRỊ, hay xuống vòng
 * tool + SINH MÃ?"* — gom về MỘT module thuần để `streamCodingAnswer` và lưới đo CÙNG một sự thật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TÁCH RA (2026-10-18)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bộ đo ngẫu nhiên (`scripts/ai-eval/ngau-nhien/`, đường (a) pipeline) cho thấy đường chat lập trình
 * thua model thô 7 bài/54 vì ĐỊNH TUYẾN: 17/54 ĐẶC TẢ sinh mã bị cửa SỬA 1 TỆP / SỬA NHIỀU TỆP / TỰ
 * TRỊ nuốt trước nhánh sinh mã (xem khối ★★★ "ĐẶC TẢ vs CÂU LỆNH" ở `intentClassifier.ts`). Bản chẩn
 * đoán ngoại tuyến phải CHÉP TAY `laYDinhSuaTep` (nó nằm trong một module kéo theo cả DB) — đúng lớp
 * lỗi "hai bản sao một vị từ". Nay vị từ ghi + chuỗi cửa sống ở đây, không I/O ngoài một phép `stat`
 * trong hộp cát (`tepTonTaiTrongGoc`), và `aiLocalKnowledgeCoding.ts` xuất lại hai vị từ cũ.
 *
 * NGUYÊN TẮC: **chỉ rẽ sang cửa SỬA/TỰ TRỊ khi CHẮC CHẮN; nghi ngờ ⇒ sinh mã.**
 *   • "lenh_dau"        — dòng lệnh ĐẦU có động từ ghi (không phủ định) + một đường dẫn tệp ⇒ chắc chắn,
 *                          rẽ như cũ (kể cả tệp chưa có: người dùng gọi đích danh ⇒ "Không có tệp" + gợi ý
 *                          TẠO là câu trả lời đúng — `aiCodingTaoTep.stream.test.ts` §6/§8 ghim).
 *   • "can_tep_ton_tai" — câu NGẮN, động từ ghi nằm ngoài dòng đầu ⇒ chỉ rẽ khi MỌI tệp được nhắc CÓ THẬT
 *                          trong dự án đang chọn (hoặc người dùng xin TẠO).
 *   • "khong"           — không có động từ ghi, hoặc là ĐẶC TẢ mà dòng đầu không phải lệnh ghi ⇒ không rẽ.
 */
import {
  classifyCodingToolIntent,
  dongLenhDau,
  laDacTaDai,
  laYDinhTaoDuAn,
  laYDinhTuTri,
  boDongTuGhiPhuDinh,
  trichDuongSuaTatDinh,
  trichMoiDuongDanRepo,
} from "../aiLocalTools/intentClassifier";
import type { ToolDecision } from "../aiLocalTools/intentClassifier";
import { phanQuyetDuongDan } from "../aiLocalTools/repoSandbox";
import { confineTargetUnder } from "../aiLocalTools/readToolsProgramming";

/** Bỏ dấu tiếng Việt (kể cả `đ`) — bản cục bộ, thuần, để phân biệt ĐỌC với SỬA. */
function boDauVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * ★★★ *"Câu này là ĐỌC tệp hay SỬA tệp?"*
 *
 * ⚠ CỐ Ý HẸP (ưu tiên độ CHÍNH XÁC hơn độ phủ). Một lượt nhận nhầm ĐỌC thành SỬA đốt ~30 s của model
 * 30B rồi đẻ ra một thẻ duyệt mà người dùng không hề xin. Vì thế:
 *   • KHÔNG nhận `thay` (đụng `thấy` → `thay`), KHÔNG nhận `doi` trần (đụng `đợi`/`đối`);
 *   • động từ ĐỌC (`doc`/`xem`/`mo`/`read`/`show`) KHÔNG nằm ở đây, nên
 *     *"đọc server/routers.ts và cho biết export gì"* vẫn đi đúng đường ĐỌC tất định của trục 1.
 * Điều kiện này chỉ được HỎI khi bộ chọn tất định đã cho ra `read_file` (tức câu CÓ đường dẫn tệp).
 * ⚠ Vị từ TỪ KHOÁ trên chuỗi được đưa vào — KHÔNG biết đặc tả/phủ định. Cửa định tuyến dùng
 *   `phanLoaiYDinhGhi` (bọc hàm này), không gọi thẳng.
 */
export function laYDinhSuaTep(question: string): boolean {
  const q = boDauVi(question);
  const vi = /(^|[^a-z])(sua|va loi|khac phuc|chinh lai|chinh sua|them|bo sung|cai dat|viet lai|cap nhat|doi ten|xoa bo|nem loi|toi uu)([^a-z]|$)/;
  const en = /(^|[^a-z])(fix|edit|modify|change|update|refactor|implement|rewrite|patch|remove|throw)([^a-z]|$)/;
  const zh = /(修改|修复|修正|实现|重构|更新|添加|删除|优化)/;
  return vi.test(q) || en.test(q) || zh.test(question);
}

/**
 * ★★★ doc 79 (2026-08-20) — *"Câu này là TẠO tệp MỚI?"*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO — VÀ NÓ **KHÔNG** NẰM Ở TOOL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apply_diff` đã hỗ trợ TẠO từ ngày đầu: `{path, original:"", modified}` là một hợp đồng hợp lệ,
 * có băm neo (`writeHandlers/applyDiff.ts` — nhánh `daCo === false`, và câu *"tệp chưa tồn tại nên
 * original phải RỖNG cho một lượt TẠO"*). Cái chặn là **ĐỊNH TUYẾN**: câu *"tạo file mới
 * src/utils/date.ts"* cho `classifyCodingToolIntent` ⇒ `read_file` (có đường dẫn), rồi
 * `laYDinhSuaTep` trả `false` (danh sách động từ của nó KHÔNG có `tao`) ⇒ đi thẳng xuống đường đọc
 * ⇒ tệp chưa tồn tại ⇒ người dùng nhận *"Không có tệp … trong hộp cát"*. Tool đúng, đường sai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÀ ĐÂY LÀ ĐIỂM MẤU CHỐT: **HÀM NÀY KHÔNG QUYẾT ĐỊNH TẠO HAY SỬA — CÁI ĐĨA QUYẾT ĐỊNH.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"thêm hàm formatNgay vào src/utils/date.ts"* khớp CẢ `laYDinhSuaTep` (`them`) lẫn hàm này
 * (`them … file`? không — xem dưới). Mọi phép tách bằng ĐỘNG TỪ đều có vùng chồng lấn, và đoán sai
 * ở đây có một chiều RẤT đắt: coi một lượt SỬA thành TẠO nghĩa là gửi `original:""` cho một tệp
 * đang có nội dung — tức **đề xuất xoá sạch tệp rồi ghi đè**.
 *
 * ⇒ Nên hàm này chỉ dùng cho MỘT câu hỏi hẹp: *"tệp KHÔNG tồn tại — đó là lỗi, hay là ý người
 *   dùng?"*. Sự tồn tại do `read_file` trả lời (`NOT_FOUND`), và tệp **đã tồn tại** thì đường đi là
 *   SỬA bất kể hàm này nói gì (xem `streamCodingEdit`). Chiều hỏng còn lại — người xin TẠO mà tệp
 *   đã có — bị chặn tường minh, KHÔNG âm thầm chuyển thành ghi đè; và `apply_diff` còn chặn độc lập
 *   một lần nữa bằng `BASE_MISMATCH` (băm("") ≠ băm(nội dung thật)).
 *
 * ⚠ CỐ Ý HẸP: `tao` trần đụng `tao nhã`, `tao lao`… nên vi đòi **động từ + danh từ tệp** hoặc dạng
 *   `tao moi`. `viet` trần đụng `viet lai` (đã thuộc `laYDinhSuaTep`) nên cũng đòi danh từ tệp.
 */
export function laYDinhTaoTep(question: string): boolean {
  const q = boDauVi(question);
  const vi =
    /(^|[^a-z])(tao|khoi tao|sinh|them|bo sung|viet|lam)\s+(mot\s+|1\s+)?(file|tep|tap tin)([^a-z]|$)/.test(q) ||
    /(^|[^a-z])(tao|khoi tao|sinh)\s+(moi|ra)([^a-z]|$)/.test(q) ||
    /(^|[^a-z])(file|tep|tap tin)\s+moi([^a-z]|$)/.test(q);
  const en =
    /(^|[^a-z])(create|add|make|generate|scaffold|write)\s+(a\s+|an\s+|the\s+)?(new\s+)?(file|module|component)([^a-z]|$)/i.test(q) ||
    /(^|[^a-z])new\s+file([^a-z]|$)/i.test(q);
  const zh = /(创建|新建|新增|生成)\s*(一个)?\s*(文件|文件夹|模块|组件)/.test(question) || /新文件/.test(question);
  return vi || en || zh;
}

/** Động từ ghi (SỬA hoặc TẠO) trên một chuỗi, SAU KHI gỡ các động từ bị phủ định. */
function coDongTuGhi(s: string): boolean {
  const sach = boDongTuGhiPhuDinh(boDauVi(s));
  return laYDinhSuaTep(sach) || laYDinhTaoTep(sach);
}

/**
 * ★★★ *"Dòng lệnh ĐẦU có phải một mệnh lệnh GHI nhắm một tệp cụ thể không?"* — động từ ghi KHÔNG bị
 * phủ định (*"Không được sửa src/a.ts"* ⇒ false) + ít nhất một đường dẫn tệp repo trên CÙNG dòng.
 */
export function coLenhGhiODau(question: string): boolean {
  const dau = dongLenhDau(question);
  if (dau === "") return false;
  return coDongTuGhi(dau) && trichMoiDuongDanRepo(dau).length >= 1;
}

export type LoaiYDinhGhi = "khong" | "lenh_dau" | "can_tep_ton_tai";

/** Phân loại ý định GHI của một câu — xem docblock đầu module cho ba mức. Thuần. */
export function phanLoaiYDinhGhi(question: string): LoaiYDinhGhi {
  const q = String(question ?? "");
  if (!coDongTuGhi(q)) return "khong";
  if (coLenhGhiODau(q)) return "lenh_dau";
  if (laDacTaDai(q)) return "khong";
  return "can_tep_ton_tai";
}

export type CuaGhi = "SUA_TAT_DINH" | "TAO_KHUNG" | "TU_TRI" | "SUA_NHIEU_TEP" | "SUA_1_TEP" | "KHONG";

export interface DinhTuyenCuaGhi {
  /** Cửa ĐẦU TIÊN sẽ được thử (theo đúng thứ tự trong `streamCodingAnswer`); "KHONG" ⇒ vòng tool + sinh mã. */
  cua: CuaGhi;
  /** Cửa "sửa <đường>:" tất định — `trichDuongSuaTatDinh`. */
  suaTatDinh: string | null;
  taoKhung: boolean;
  tuTri: boolean;
  /** Cửa SỬA/TẠO tệp (một hoặc nhiều) — `null` ⇒ không rẽ. */
  ghiTep: null | {
    duong: string;
    nhieuDuong: string[];
    /** `true` ⇒ chỉ rẽ khi MỌI tệp trong `nhieuDuong` (hoặc `duong`) CÓ THẬT trong dự án (`tepTonTaiTrongGoc`). */
    canTonTai: boolean;
  };
  /** Ý định TẠO tệp (`laYDinhTaoTep`) — chuyển nguyên cho `streamCodingEdit`/`streamCodingSuaNhieuTep`. */
  yDinhTao: boolean;
  /** Quyết định của bộ chọn tất định trên CẢ câu — `streamCodingAnswer` dùng tiếp sau vòng tool. */
  quyetDinh: ToolDecision;
}

/**
 * ★★★ Chuỗi cửa ghi của `streamCodingAnswer`, tính MỘT lần, thuần (không I/O). Mỗi trường là điều kiện
 * của MỘT cửa; người gọi thử theo đúng thứ tự `suaTatDinh → taoKhung → tuTri → ghiTep` và mỗi cửa có thể
 * nhường (fail-through) — nên trả ĐỦ các trường, không chỉ `cua`.
 */
export function dinhTuyenCuaGhi(question: string): DinhTuyenCuaGhi {
  const q = String(question ?? "");
  const suaTatDinh = trichDuongSuaTatDinh(q);
  const taoKhung = laYDinhTaoDuAn(q);
  const tuTri = laYDinhTuTri(q);
  const yDinhTao = laYDinhTaoTep(q);
  const quyetDinh = classifyCodingToolIntent(q);

  let ghiTep: DinhTuyenCuaGhi["ghiTep"] = null;
  const loai = phanLoaiYDinhGhi(q);
  if (loai !== "khong") {
    /**
     * ⚠ ĐẶC TẢ có lệnh ở dòng đầu ⇒ đích ghi lấy từ CHÍNH dòng ấy: các tệp được nhắc trong thân (tệp test,
     *   tệp cấu hình "không được sửa") KHÔNG được kéo vào một lô ghi người dùng không gọi tên.
     */
    const dacTa = laDacTaDai(q);
    const nguon = dacTa ? dongLenhDau(q) : q;
    const qd = dacTa ? classifyCodingToolIntent(nguon) : quyetDinh;
    if (qd.tool === "read_file" && typeof qd.args.path === "string") {
      const nhieuDuong = trichMoiDuongDanRepo(nguon);
      ghiTep = {
        duong: qd.args.path,
        nhieuDuong,
        canTonTai: loai === "can_tep_ton_tai" && !yDinhTao,
      };
    }
  }

  const cua: CuaGhi =
    suaTatDinh !== null
      ? "SUA_TAT_DINH"
      : taoKhung
        ? "TAO_KHUNG"
        : tuTri
          ? "TU_TRI"
          : ghiTep
            ? ghiTep.nhieuDuong.length >= 2
              ? "SUA_NHIEU_TEP"
              : "SUA_1_TEP"
            : "KHONG";
  return { cua, suaTatDinh, taoKhung, tuTri, ghiTep, yDinhTao, quyetDinh };
}

/**
 * ★★★ *"Tệp `duong` có THẬT trong dự án gốc `goc` không?"* — CHỈ dùng để định tuyến (`canTonTai`).
 *
 * ⚠ Thứ tự bắt buộc của hộp cát: **chính sách TRƯỚC, đĩa SAU** (`phanQuyetDuongDan` — `..`, tuyệt đối,
 *   `.env`, `node_modules`… bị loại TRƯỚC mọi `stat`, nên câu trả lời không rò "tệp cấm có tồn tại
 *   không"). Rồi `confineTargetUnder` — realpath trong gốc (symlink/junction thoát gốc ⇒ từ chối),
 *   thư mục ⇒ không phải tệp, `nlink > 1` ⇒ từ chối. KHÔNG đọc byte nào, KHÔNG trừ ngân sách đọc.
 * ⚠ KHÔNG phải cửa đọc thứ hai: nội dung vẫn chỉ được đọc bởi `read_file` trong `streamCodingEdit`
 *   (cửa ấy tự phán quyết lại tồn tại/TOCTOU trên fd). Đây chỉ là sàng định tuyến; sai ⇒ rơi xuống
 *   vòng tool + sinh mã, không ghi gì.
 */
export function tepTonTaiTrongGoc(goc: string, duong: string): boolean {
  if (phanQuyetDuongDan(duong) !== null) return false;
  const c = confineTargetUnder(goc, duong);
  return c.ok && c.target.exists;
}
