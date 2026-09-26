/**
 * useBuocLuoi.ts — CẦU NỐI R3F CHO `buocLuoi.ts` (PH-54).
 *
 * Tách khỏi `buocLuoi.ts` có chủ đích: tệp kia là số học THUẦN (không import
 * React, không import three) nên lưới đơn vị chấm được mọi nấc thang mà không
 * phải dựng canvas. Tệp này chỉ làm ba việc: đọc camera mỗi khung, gọi
 * `buocKeTiep`, và **chỉ `setState` khi bước THẬT SỰ đổi**.
 *
 * ★ Vì sao `setState` chứ không mutate thẳng uniform: bước chỉ đổi vài lần trên
 *   cả một cú cuộn từ trần zoom vào sát sàn, nên giá một lần render lại là không
 *   đáng kể — trong khi mutate uniform chỉ chạy được cho drei `<Grid>` (bước là
 *   UNIFORM) chứ không cho `gridHelper` (bước là HÌNH HỌC, phải dựng lại). Một
 *   đường cho cả ba màn, không hai cài đặt lệch nhau ở lần sửa đầu tiên (G12).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ `lamTron` — VÌ SAO NÓ PHẢI LÀM TRÒN **LÊN**, KHÔNG PHẢI LÀM TRÒN GẦN NHẤT
 * ════════════════════════════════════════════════════════════════════════════
 * `gridHelper(canh, soO)` chia sàn thành `soO` ô ĐỀU ⇒ bước THẬT = `canh / soO`,
 * một số bị lượng tử hoá, không phải nấc thang tôi xin. Nếu lượng tử hoá ấy đi
 * XUỐNG (bước thật < nấc thang) thì ô tụt xuống dưới 8 px và bất biến vỡ — đúng
 * ở những ca sát ngưỡng (đo được: `fc-motnhamay` trần zoom 8,59 px, Studio trần
 * zoom 8,30 px — chỉ cần 4 % hụt là thành KHÔNG ĐẠT).
 * Nên mỗi màn truyền vào một `lamTron` mà kết quả LUÔN ≥ tham số (dùng `floor`
 * cho SỐ Ô ⇒ bước thật ≥ bước xin). Chiều làm tròn ở đây là một phần của bất biến.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import { buocKeTiep, khoangCachToiDiemNgam, pxTrenMet, O_TOI_THIEU_PX } from "./buocLuoi";

/** Cửa sổ chẩn đoán — cùng khuôn `__thongKeVe` / `__demSaBan`, để e2e ĐO được bất biến "ô ≥ 8 px". */
export interface CuaSoLuoi {
  __luoiSan?: {
    /** Bước lưới THẬT SỰ đang vẽ (m) — đã qua `lamTron`. */
    buocM: number;
    /** Bước lưới gốc của cảnh (m) — bản vá KHÔNG BAO GIỜ xuống dưới số này. */
    buocGocM: number;
    /** Bước đường `section` nếu màn có hai mức (drei `<Grid>`), else null. */
    buocSectionM: number | null;
    /** Ô lưới quy ra pixel tại điểm ngắm — CON SỐ TIÊU CHÍ NGHIỆM THU. */
    oPx: number;
    /** Khoảng cách camera → điểm ngắm trên sàn (m). */
    dNgam: number;
    /** Số lần bước đã đổi kể từ khi dựng cảnh — để đo "có nhảy giật khi cuộn không". */
    soLanDoi: number;
  };
}

export interface TuyChonLuoi {
  /** Lượng tử hoá bước cho hình học của màn. PHẢI trả ≥ tham số. */
  lamTron?: (buoc: number) => number;
  /** Tỉ lệ section/cell nếu màn có hai mức (drei `<Grid>` = 5). */
  heSoSection?: number | null;
}

/**
 * Trả bước lưới (m) nên dùng cho khung hình này.
 * @param buocGoc bước lưới gốc của cảnh — SÀN, bản vá chỉ làm thưa hơn nó.
 */
export function useBuocLuoi(buocGoc: number, { lamTron, heSoSection = null }: TuyChonLuoi = {}): number {
  const [buocThang, setBuocThang] = useState(buocGoc);
  const giu = useRef(buocGoc);
  const dem = useRef(0);
  const huong = useRef(new Vector3());
  useThree((s) => s.size); // đăng ký render lại khi khung đổi cỡ
  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    cam.getWorldDirection(huong.current);
    const d = khoangCachToiDiemNgam(cam.position, huong.current);
    const caoPx = state.size.height;
    const b = buocKeTiep(giu.current, { d, caoPx, fovDoc: cam.fov, buocGoc });
    if (b !== giu.current) {
      giu.current = b;
      dem.current += 1;
      setBuocThang(b);
    }
    if (typeof window !== "undefined") {
      const thuc = lamTron ? lamTron(giu.current) : giu.current;
      (window as unknown as CuaSoLuoi).__luoiSan = {
        buocM: Math.round(thuc * 1000) / 1000,
        buocGocM: buocGoc,
        buocSectionM: heSoSection == null ? null : Math.round(thuc * heSoSection * 1000) / 1000,
        oPx: Math.round(thuc * pxTrenMet(caoPx, d, cam.fov) * 100) / 100,
        dNgam: Math.round(d * 1000) / 1000,
        soLanDoi: dem.current,
      };
    }
  }, -1);
  return useMemo(() => (lamTron ? lamTron(buocThang) : buocThang), [buocThang, lamTron]);
}

export { O_TOI_THIEU_PX };
