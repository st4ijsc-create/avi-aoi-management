/**
 * khuChoVaNhanLine.ts — §11 **#53** (máy chưa đặt = bán trong suốt) và **#54**
 * (nhãn tên chuyền tại centroid), di trú sang `/twin`.
 *
 * ★ Module THUẦN (RB-8.1) — không react, không three, không `Date.now()` ẩn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ #53 — VÌ SAO "BÁN TRONG SUỐT" Ở ĐÂY LÀ **PHA VỀ NỀN**, KHÔNG PHẢI ALPHA
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được: `LoBatchMay` vẽ bằng MỘT `BatchedMesh` với vật liệu **ĐỤC**, và
 * `TwinVanHanh.tsx:489` ghi rõ vì sao — *"bật `transparent` cho cả lô sẽ phá thứ
 * tự vẽ"*. Kênh `doMo` của lô KHÔNG phải alpha: `LoBatchMay.tsx:196` nhân màu
 * với `0.35 + 0.65*doMo`, tức nó LÀM TỐI. Một máy "chưa đặt" mà bị làm tối sẽ
 * trông y hệt một máy **đang lỗi** — đúng thứ ISA-101 cấm (màu chỉ dành cho bất
 * thường), và nó nói sai về thế giới.
 *
 * ⇒ "Bán trong suốt" thực hiện bằng **pha màu về màu NỀN** (`phaVeNen`, cùng
 *   kênh mà vật thể ngoài phạm vi đã dùng), cho ra "nhạt đi" đúng nghĩa mà
 *   không cần vật liệu trong suốt và không đụng thứ tự vẽ.
 *
 * ⚠⚠ **VÀ ĐÂY LÀ NỬA QUAN TRỌNG HƠN.** Trước bản này, máy chưa đặt chỗ **không
 * được vẽ chút nào**: vòng dựng `mayVe` có `if (!d || !d.hienThi) continue`, tức
 * máy không có `twin_dat_cho` bị BỎ QUA. Nên #53 không phải "đổi độ mờ của một
 * thứ đang vẽ" mà là **cho nó một chỗ đứng trước đã** — một khu chờ (staging)
 * ngoài rìa mặt bằng. Không có toạ độ thì không có gì để làm mờ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CẢNH BÁO ĐO ĐƯỢC (G5) — TẬP NÀY ĐANG **RỖNG** TRÊN DB DEV
 * ════════════════════════════════════════════════════════════════════════════
 * `SELECT COUNT(*) FILTER (WHERE isActive) , COUNT(DISTINCT thucTheId)` cho
 * **42 máy sống / 42 có đặt chỗ** ⇒ **0 máy chưa xếp chỗ**, và banner đối soát
 * của `/twin` hiện đúng "0 máy chưa xếp chỗ". Nghĩa là một phép nghiệm thu
 * "mở `/twin` xem có khu chờ không" trên DB này **không chứng minh gì** — nó
 * trông y hệt nhau dù mã đúng hay hỏng hoàn toàn.
 * ⇒ Test của module này dựng ca dương BẰNG TAY, và nghiệm thu thị giác phải
 *   tiêm một máy chưa đặt chỗ rồi mới đo (xem báo cáo đóng nợ).
 */
import type { DiemScene } from "../heToaDo";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #53 — KHU CHỜ XẾP CHỖ                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Cấu hình khu chờ. Mọi số đo ở hệ SCENE (mét). */
export interface CauHinhKhuCho {
  /** Mép X của mặt bằng — khu chờ đặt bên trái mép này. */
  mepX: number;
  /** Mép Z bắt đầu xếp. */
  mepZ: number;
  /** Khoảng cách giữa hai máy trong khu chờ. */
  buoc?: number;
  /** Số máy mỗi cột trước khi sang cột mới. */
  moiCot?: number;
}

/** Một máy trong khu chờ, đã có chỗ đứng. */
export interface MayKhuCho {
  machineId: number;
  viTri: DiemScene;
}

/** Mặc định: đủ thưa để không chồng nhau ở kích thước máy điển hình (~1 m). */
export const BUOC_MAC_DINH = 2.5;
export const MOI_COT_MAC_DINH = 10;

/**
 * ★★★ Xếp máy CHƯA CÓ ĐẶT CHỖ vào khu chờ, ngoài rìa mặt bằng.
 *
 * ★ **TẤT ĐỊNH** — sắp theo `machineId` tăng dần trước khi rải. Nếu để nguyên
 *   thứ tự DB trả thì cùng một tập máy sẽ nhảy chỗ giữa hai lần tải trang, và
 *   một vật thể tự di chuyển khi không ai chạm vào là thứ phá niềm tin vào cả
 *   màn hình. Cùng luật tất định mà `sinhBoCuc` (T1-T9) đã ghim.
 *
 * ★ Xếp theo CỘT rồi mới sang cột mới: khu chờ dài vô hạn theo Z sẽ chạy khỏi
 *   khung nhìn, còn cuộn theo hai chiều thì giữ được cụm gọn cạnh mặt bằng.
 *
 * ⚠ `viTri.y = 0` — máy khu chờ đứng trên SÀN, không lơ lửng. Một vật thể bay
 *   giữa không trung đọc như một lỗi render, không như một thông điệp.
 */
export function xepKhuCho(
  machineIdChuaDat: readonly number[],
  cauHinh: CauHinhKhuCho,
): MayKhuCho[] {
  const buoc = cauHinh.buoc ?? BUOC_MAC_DINH;
  const moiCot = cauHinh.moiCot ?? MOI_COT_MAC_DINH;
  const sapXep = [...machineIdChuaDat].sort((a, b) => a - b);
  return sapXep.map((machineId, i) => {
    const cot = Math.floor(i / moiCot);
    const hang = i % moiCot;
    return {
      machineId,
      viTri: {
        // Cột chạy RA XA mặt bằng (giảm dần X) — không đè lên nhà xưởng.
        x: cauHinh.mepX - buoc * (cot + 1),
        y: 0,
        z: cauHinh.mepZ + buoc * hang,
      },
    };
  });
}

/**
 * ★★★ Tỉ lệ pha về nền cho máy khu chờ — "bán trong suốt" của #53.
 *
 * 0 = giữ nguyên màu · 1 = tan hẳn vào nền. `0.55` giữ đủ hình để thấy có vật
 * thể ở đó, nhưng nhạt rõ rệt so với máy đã đặt (`0` hoặc `0.12` khi ngoài phạm
 * vi) nên không ai nhầm hai nhóm.
 *
 * ⚠ HẰNG SỐ CÓ TÊN, không phải số rời rạc trong JSX: nó phải bằng nhau ở cảnh
 *   3D và ở bản đồ 2D, và hai chỗ chép tay một con số là hai chỗ trôi khỏi nhau.
 */
export const PHA_KHU_CHO = 0.55;

/* ═══════════════════════════════════════════════════════════════════════════ */
/* #54 — NHÃN TÊN CHUYỀN TẠI CENTROID                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Nhãn một Line, đã có điểm neo ở hệ scene. */
export interface NhanLine {
  lineId: number;
  ma: string;
  ten: string;
  viTri: DiemScene;
  /** Số trạm+máy đã góp vào centroid — 0 nghĩa là KHÔNG suy được. */
  soVatThe: number;
}

/** Đầu vào tối thiểu để suy centroid của một Line. */
export interface LineDeDatNhan {
  lineId: number;
  ma: string;
  ten: string;
  /** Tâm của các vật thể thuộc line (trạm và/hoặc máy), hệ scene. */
  tamVatThe: readonly DiemScene[];
}

/**
 * ★★★ CENTROID = TRUNG BÌNH TÂM CÁC VẬT THỂ, không phải tâm BBOX.
 *
 * ⚠ Hai thứ đó khác nhau và sự khác ấy quan trọng: một Line có 11 trạm chụm một
 *   đầu và 1 trạm lẻ ở đầu kia sẽ có tâm bbox nằm giữa khoảng trống — nhãn rơi
 *   vào chỗ KHÔNG CÓ GÌ, và người đọc phải đoán nó thuộc cụm nào. Trung bình
 *   tâm kéo nhãn về nơi thật sự có thiết bị.
 *
 * ★ `y` lấy MAX + khoảng hở thay vì trung bình: nhãn phải nổi TRÊN đỉnh cụm,
 *   không chìm vào giữa các khối. Trung bình `y` sẽ đặt chữ bên trong máy.
 *
 * ⚠ Line KHÔNG có vật thể nào ⇒ **BỎ QUA** (không sinh nhãn ở gốc toạ độ). Một
 *   nhãn "Line 3" nằm ở (0,0,0) nói rằng có một chuyền ở đó, và điều đó SAI —
 *   đúng lớp lỗi NT-3 "không có dữ liệu ≠ bình thường". Không suy được thì
 *   không vẽ, và số Line bị bỏ được trả ra để UI nói thành lời nếu cần.
 */
export const HO_NHAN_LINE = 1.5;

export function nhanLineTaiCentroid(
  lines: readonly LineDeDatNhan[],
  hoM: number = HO_NHAN_LINE,
): NhanLine[] {
  const ra: NhanLine[] = [];
  for (const l of lines) {
    const ds = l.tamVatThe.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
    );
    if (ds.length === 0) continue;
    let sx = 0;
    let sz = 0;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of ds) {
      sx += p.x;
      sz += p.z;
      if (p.y > maxY) maxY = p.y;
    }
    ra.push({
      lineId: l.lineId,
      ma: l.ma,
      ten: l.ten,
      viTri: { x: sx / ds.length, y: maxY + hoM, z: sz / ds.length },
      soVatThe: ds.length,
    });
  }
  // TẤT ĐỊNH theo `lineId` — cùng lý lẽ với `xepKhuCho`.
  ra.sort((a, b) => a.lineId - b.lineId);
  return ra;
}
