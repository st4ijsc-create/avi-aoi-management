/**
 * ★★ Đợt 7.3 — TẦNG 4 của bộ định tuyến vai trò: PHÂN LOẠI NGỮ NGHĨA (kiểu semantic-router). Spec §3.4.
 *
 * Khi không có vai trò tường minh, không có gán phạm vi, không có tín hiệu tất định (tầng 1–3), câu hỏi được nhúng
 * bằng model embedding ĐANG THƯỜNG TRÚ (Qwen3-Embedding) và so cosine với các câu MẪU của từng vai trò. Điểm cao nhất
 * phải ≥ `nguong` VÀ hơn vai trò về nhì ≥ `cachBiet` — không thì trả `null` (bề mặt dùng vai trò mặc định của nó).
 * KHÔNG dùng LLM để chọn LLM.
 *
 * Câu mẫu: `ai_roles.examples` (CSDL) nếu có, không thì `VI_DU_MAC_DINH` dưới đây. Bộ câu ĐO
 * (`scripts/ai-eval/dinh-tuyen-vai-tro/cau-hoi.jsonl`) KHÔNG được trùng câu mẫu (lưới kiểm).
 */
/** Vai trò tầng 4 được phép chọn (vai trò chỉ chọn tường minh — classify, embed, rerank, vision, fim — không có ở đây). */
export const VAI_TRO_TANG_4 = ["code.plc", "code.software", "summarize", "extract", "chat.ops", "chat"] as const;

export const VI_DU_MAC_DINH: Record<(typeof VAI_TRO_TANG_4)[number], readonly string[]> = {
  "code.plc": [
    "Viết FB điều khiển quạt làm mát theo nhiệt độ có trễ bằng ST",
    "Code PLC điều khiển xi lanh khí nén hai vị trí có cảm biến",
    "Sửa logic máy trạng thái trong chương trình PLC bị kẹt bước",
    "Viết khối chức năng đo thời gian chu kỳ máy bằng TON",
    "Write PLC code for a tank filling sequence with level switches",
    "Viết chương trình CODESYS đếm giờ chạy động cơ",
    "Viết function block Structured Text điều khiển băng tải có dừng khẩn",
    "Lập trình PLC: khởi động sao tam giác bằng ST",
    "Sửa lỗi đoạn ladder / ST bộ đếm CTU không reset",
    "Viết chương trình IEC 61131-3 cho máy trộn theo mẻ",
    "TON trong CODESYS không lên Q, kiểm tra giúp đoạn ST này",
    "Viết logic khoá liên động hai van bằng Structured Text",
    "Write an IEC 61131-3 function block for pump alternation",
    "Chuyển đoạn ladder này sang Structured Text cho Siemens SCL",
  ],
  "code.software": [
    "Viết hàm JavaScript gọi REST API và xử lý lỗi",
    "Viết service Python đọc dữ liệu từ PostgreSQL",
    "Sửa lỗi build trong dự án .NET",
    "Viết script Node.js chuyển CSV sang JSON",
    "Write a SQL view aggregating defects by day",
    "Viết giao diện HTML CSS cho trang dashboard",
    "Viết hàm TypeScript đọc file CSV và trả về mảng object",
    "Sửa lỗi null reference trong service C# này",
    "Viết API Express thêm endpoint lấy danh sách lỗi AOI",
    "Viết unit test pytest cho hàm tính trung bình",
    "Tối ưu câu truy vấn SQL join hai bảng production và defects",
    "Component React hiển thị bảng có phân trang",
    "Write a Python script that parses JSON logs",
    "Refactor đoạn code Node.js này cho dễ đọc",
  ],
  summarize: [
    "Tóm tắt nhật ký vận hành ca đêm thành vài dòng",
    "Viết đoạn tóm tắt kết quả đánh giá 5S tháng này",
    "Tổng hợp ngắn gọn báo cáo sự cố gửi ban giám đốc",
    "Tóm tắt những thay đổi chính trong quy trình mới",
    "Give me a short summary of this technical document",
    "Tóm tắt ý kiến trong cuộc khảo sát khách hàng",
    "Tóm tắt báo cáo ca sản xuất hôm qua",
    "Tóm tắt nội dung tài liệu hướng dẫn bảo trì này trong 5 ý",
    "Viết báo cáo tuần về tỉ lệ lỗi AOI từ số liệu sau",
    "Rút gọn biên bản họp này thành các việc cần làm",
    "Summarize this incident report",
    "Tổng hợp các điểm chính của email khách hàng phàn nàn",
  ],
  extract: [
    "Trích danh sách mã lỗi xuất hiện trong báo cáo dưới dạng bảng",
    "Lấy ngày giờ và giá trị đo từ đoạn dữ liệu cảm biến sau",
    "Từ văn bản này lấy tên người, chức vụ, số điện thoại",
    "Lấy các trường mã đơn, khách hàng, số lượng ra JSON",
    "Pull the serial numbers and test results out of this text",
    "Trích thông số kỹ thuật từ mô tả sản phẩm",
    "Trích xuất số lô, mã sản phẩm và ngày sản xuất từ đoạn văn sau ra JSON",
    "Lấy danh sách mã lỗi và vị trí linh kiện từ log máy AOI",
    "Đọc phiếu bảo trì này và điền các trường: thiết bị, người làm, thời gian",
    "Extract all part numbers and quantities from this purchase order",
    "Tách thông tin nhà cung cấp, đơn giá, số lượng từ hoá đơn",
  ],
  "chat.ops": [
    "Line 3 hôm nay đã chạy được bao nhiêu giờ?",
    "Hiện có bao nhiêu cảnh báo đang hoạt động?",
    "Máy in kem hàn đang ở trạng thái nào?",
    "Ca sáng nay đã kiểm bao nhiêu bo mạch?",
    "Phiếu bảo trì máy reflow đã đóng chưa?",
    "Tồn kho cuộn linh kiện R0603 còn bao nhiêu?",
    "Máy AOI line 2 đang báo lỗi gì?",
    "OEE ca này của dây chuyền SMT là bao nhiêu?",
    "Ai đang trực ca đêm hôm nay?",
    "Còn bao nhiêu sản phẩm lỗi chờ xử lý?",
    "Máy nào đang dừng ngoài kế hoạch?",
    "Tỉ lệ lỗi hàn của line 3 hôm nay thế nào?",
  ],
  chat: [
    "Giải thích sự khác nhau giữa bảo trì phòng ngừa và khắc phục",
    "Tại sao cần hiệu chuẩn thiết bị đo định kỳ?",
    "Nguyên lý hoạt động của biến tần là gì?",
    "Explain what MTBF and MTTR mean",
    "Nên dùng PLC hay vi điều khiển cho máy nhỏ?",
    "Các nguyên nhân phổ biến gây lỗi hở mạch khi hàn",
    "Giải thích nguyên lý hoạt động của máy kiểm tra quang học AOI",
    "Sự khác nhau giữa PID và điều khiển on/off là gì?",
    "Cho tôi lời khuyên về cách giảm lỗi thiếu thiếc khi hàn reflow",
    "What is the difference between Modbus RTU and Modbus TCP?",
    "Chuẩn ISA-18.2 về quản lý cảnh báo nói gì?",
    "Nên chọn cảm biến tiệm cận điện cảm hay điện dung cho kim loại?",
  ],
};

/**
 * Tiền tố chỉ dẫn khi nhúng. RỖNG có chủ ý: so trên bộ DEV 60 câu (2026-10-20, `so-bien-the-dev.mts`) — tiền tố
 * "Instruct:…Query:" dùng chung kéo mọi cosine lên 0,7–0,9 (nhiễu lấn nội dung): tâm cụm có tiền tố 55/60, KHÔNG
 * tiền tố 56/60, tiền tố chỉ ở câu hỏi 42/60.
 */
export const TIEN_TO_NHUNG = "";

/** Tâm cụm (trung bình) các vector câu mẫu của một vai trò — DEV: tâm cụm 56/60 > câu mẫu gần nhất 49/60. */
export function tamCum(ds: readonly (readonly number[])[]): number[] {
  if (!ds.length) return [];
  return ds[0].map((_, k) => ds.reduce((t, v) => t + v[k], 0) / ds.length);
}

export interface KetQuaPhanLoai {
  vaiTro: string | null;
  diem: number;
  vaiTroNhi: string | null;
  diemNhi: number;
  lyDo: string;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let t = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    t += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? t / Math.sqrt(na * nb) : 0;
}

/** THUẦN: vai trò có câu mẫu GẦN NHẤT (max cosine theo vai trò), qua ngưỡng + cách biệt. */
export function chonVaiTroTheoNhung(
  vec: readonly number[],
  mau: ReadonlyMap<string, readonly (readonly number[])[]>,
  nguong: number,
  cachBiet: number,
  boQua?: (vaiTro: string) => boolean,
): KetQuaPhanLoai {
  const diem: [string, number][] = [];
  for (const [vt, ds] of mau) {
    if (boQua?.(vt)) continue;
    let max = -1;
    for (const v of ds) max = Math.max(max, cosine(vec, v));
    if (ds.length) diem.push([vt, max]);
  }
  diem.sort((x, y) => y[1] - x[1]);
  const [nhat, nhi] = [diem[0], diem[1]];
  if (!nhat) return { vaiTro: null, diem: 0, vaiTroNhi: null, diemNhi: 0, lyDo: "không có câu mẫu" };
  const kq = { diem: nhat[1], vaiTroNhi: nhi?.[0] ?? null, diemNhi: nhi?.[1] ?? 0 };
  if (nhat[1] < nguong) return { vaiTro: null, ...kq, lyDo: `điểm ${nhat[1].toFixed(3)} < ngưỡng ${nguong}` };
  if (nhi && nhat[1] - nhi[1] < cachBiet) {
    return { vaiTro: null, ...kq, lyDo: `${nhat[0]} ${nhat[1].toFixed(3)} sát ${nhi[0]} ${nhi[1].toFixed(3)}` };
  }
  return { vaiTro: nhat[0], ...kq, lyDo: `gần câu mẫu ${nhat[0]} (${nhat[1].toFixed(3)})` };
}

/**
 * ★ Đợt 9 (a) — tầng 4 CÓ CỔNG: nhúng chọn `code.*` mà câu KHÔNG có ý định viết/sửa mã và không có mã dán vào
 * (`coYDinhHoacMa`) ⇒ chọn lại trong các vai trò KHÔNG phải code. "Hố hút" code.plc: câu dài dán log máy / câu vận hành
 * không dấu có cosine ~0,5 với tâm cụm code.plc (bộ mù 3: 9/13 lỗi).
 */
export function chonVaiTroTang4CoCong(
  vec: readonly number[],
  mau: ReadonlyMap<string, readonly (readonly number[])[]>,
  nguong: number,
  cachBiet: number,
  cauHoi: string,
  coYDinhHoacMa: (cauHoi: string) => boolean,
): KetQuaPhanLoai {
  const kq = chonVaiTroTheoNhung(vec, mau, nguong, cachBiet);
  if (!kq.vaiTro?.startsWith("code.") || coYDinhHoacMa(cauHoi)) return kq;
  const lai = chonVaiTroTheoNhung(vec, mau, nguong, cachBiet, (vt) => vt.startsWith("code."));
  return { ...lai, lyDo: `${lai.lyDo} (cổng ý định mã: bỏ ${kq.vaiTro} ${kq.diem.toFixed(3)} — câu không có ý định viết mã)` };
}

/** Câu mẫu theo vai trò: CSDL (`ai_roles.examples`) thắng, không có thì mặc định. */
export function cauMauTheoVaiTro(layViDu?: (vt: string) => readonly string[] | undefined): Map<string, readonly string[]> {
  const ra = new Map<string, readonly string[]>();
  for (const vt of VAI_TRO_TANG_4) {
    const tuCsdl = layViDu?.(vt);
    ra.set(vt, tuCsdl && tuCsdl.length ? tuCsdl : VI_DU_MAC_DINH[vt]);
  }
  return ra;
}

type HamNhung = (texts: string[]) => Promise<number[][]>;

let boNhoMau: { khoa: string; mau: Map<string, number[][]> } | null = null;

/**
 * KHÔNG THUẦN: nhúng câu hỏi (+ câu mẫu, nhớ đệm theo nội dung) rồi chọn. Lỗi nhúng ⇒ `null` (tầng 5 — mặc định),
 * không bao giờ ném lên đường sinh chữ.
 */
export async function phanLoaiNguNghia(
  cauHoi: string,
  y: { cauMau: Map<string, readonly string[]>; nhung: HamNhung; nguong?: number; cachBiet?: number; coYDinhHoacMa?: (cauHoi: string) => boolean },
): Promise<KetQuaPhanLoai> {
  // Chốt TRƯỚC lượt đo cuối (chọn trên DEV): ngưỡng 0,3 chỉ chặn câu lạc đề hẳn, không cách biệt.
  const nguong = y.nguong ?? 0.3;
  const cachBiet = y.cachBiet ?? 0;
  try {
    const khoa = JSON.stringify([...y.cauMau]);
    if (!boNhoMau || boNhoMau.khoa !== khoa) {
      const mau = new Map<string, number[][]>();
      for (const [vt, ds] of y.cauMau) mau.set(vt, [tamCum(await y.nhung(ds.map((c) => TIEN_TO_NHUNG + c)))]);
      boNhoMau = { khoa, mau };
    }
    const [vec] = await y.nhung([TIEN_TO_NHUNG + cauHoi.slice(0, 2000)]);
    if (y.coYDinhHoacMa) return chonVaiTroTang4CoCong(vec, boNhoMau.mau, nguong, cachBiet, cauHoi, y.coYDinhHoacMa);
    return chonVaiTroTheoNhung(vec, boNhoMau.mau, nguong, cachBiet);
  } catch (e) {
    return { vaiTro: null, diem: 0, vaiTroNhi: null, diemNhi: 0, lyDo: `nhúng hỏng: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/**
 * Lối vào cho bề mặt: chọn vai trò TỰ ĐỘNG từ câu hỏi — tầng 3 (tín hiệu chữ, tất định) rồi tầng 4 (nhúng bằng model
 * embedding thường trú của engine). `null` ⇒ bề mặt dùng vai trò mặc định của nó. Không bao giờ ném.
 */
export async function chonVaiTroTuDong(cauHoi: string): Promise<{ vaiTro: string | null; tang: 3 | 4 | 5; lyDo: string }> {
  const { vaiTroTuCauHoiTuDong, coYDinhHoacMa } = await import("../../../../shared/aiRoles");
  const t3 = vaiTroTuCauHoiTuDong(cauHoi);
  if (t3) return { vaiTro: t3.vaiTro, tang: 3, lyDo: t3.bangChung };
  const kq = await phanLoaiNguNghia(cauHoi, {
    cauMau: cauMauTheoVaiTro(),
    coYDinhHoacMa,
    nhung: async (ts) => {
      const { generateEmbeddings } = await import("../../aiGgufEngine");
      return (await generateEmbeddings(ts)).embeddings;
    },
  });
  return kq.vaiTro ? { vaiTro: kq.vaiTro, tang: 4, lyDo: kq.lyDo } : { vaiTro: null, tang: 5, lyDo: kq.lyDo };
}
