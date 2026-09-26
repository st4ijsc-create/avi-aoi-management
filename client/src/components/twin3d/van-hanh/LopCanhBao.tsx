/**
 * LopCanhBao.tsx — badge cảnh báo trên cảnh 3D, theo **BA LUẬT CỨNG của §10.3**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT 1 — VẼ Ở KHÔNG GIAN MÀN HÌNH, KHÔNG Ở KHÔNG GIAN THẾ GIỚI
 * ════════════════════════════════════════════════════════════════════════════
 * Badge KHÔNG phải sprite trong thế giới. Nếu là sprite, phối cảnh sẽ thu nhỏ
 * một badge P1 ở cuối xưởng thành vài pixel không đọc nổi — và alarm càng xa thì
 * càng khó thấy, tức là ĐÚNG NGƯỢC với thứ ta cần. Nên: chiếu điểm neo ra pixel
 * (`Vector3.project`) rồi vẽ DOM **cỡ cố định**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LUẬT 2 — MÃ HOÁ DƯ THỪA: HÌNH DẠNG + MÀU + CHỮ
 * ════════════════════════════════════════════════════════════════════════════
 * Màu đơn thuần KHÔNG BAO GIỜ là dấu hiệu duy nhất (khoảng 8 % nam giới mù màu
 * đỏ-lục; và màn hình panel-PC trong xưởng thường bị ám vàng). Mỗi badge mang cả
 * ba: một KÝ TỰ hình dạng (▲ / ◆ / ●), một MÀU token, và CHỮ mức độ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT 3 — GÓC CAMERA KHÔNG BAO GIỜ ĐƯỢC CHE MỘT ALARM ĐANG HOẠT ĐỘNG
 * ════════════════════════════════════════════════════════════════════════════
 * Đây là luật khó nhất và là lý do §10.3 tồn tại. Một alarm nằm sau lưng camera,
 * hoặc lệch ra ngoài mép canvas, sẽ **BIẾN MẤT** nếu ta chỉ chiếu rồi vẽ — người
 * vận hành xoay camera đi một chút là mất luôn cảnh báo P1, mà không có gì báo
 * rằng nó vừa mất. Đó chính là chế độ hỏng mà quy tắc "No 3D" của ASM sinh ra để
 * phòng, và là cái giá ta phải trả để được giữ 3D.
 *
 * ⇒ Alarm ngoài khung được **KẸP VỀ RÌA** màn hình và vẽ kèm **mũi tên chỉ
 *   hướng** tới vị trí thật. Không alarm nào rời khỏi màn hình bao giờ.
 *
 * ★ RB-7 — component này không cấp phát geometry/material nào (toàn DOM), nên
 *   không có gì phải `dispose()`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT 4 (PH-55) — CHIẾU MỖI KHUNG, NHƯNG **RENDER** THÌ KHÔNG
 * ════════════════════════════════════════════════════════════════════════════
 * Bản trước đưa toạ độ vào khoá so sánh của state:
 *
 *     `${an}|${ve.map(v => `${v.id}:${Math.round(v.x)}:${Math.round(v.y)}:…`)}`
 *
 * `Math.round(x)` của một badge đổi khi camera xê dịch chưa tới 1/400 bề ngang khung
 * nhìn ⇒ **mỗi khung kéo xoay là một `setState`**, tức một lượt reconcile + commit cho
 * CẢ danh sách badge — và vì `<Html>` của drei nuôi cây DOM con bằng một root react-dom
 * RIÊNG, mỗi lượt ấy còn kéo theo một `root.render()` đầy đủ nữa. Đây đúng là sai lầm số
 * một trong *performance pitfalls* của react-three-fiber: *"never bind a component to
 * state that changes per frame"*.
 *
 * ⇒ TÁCH LÀM HAI:
 *   · **TẬP badge** (id · mức · nhãn · đã-ack · số bị ẩn) — đổi khi DỮ LIỆU đổi ⇒ React
 *     state, vì nó quyết định *có bao nhiêu node, mỗi node mang chữ/màu gì*.
 *   · **VỊ TRÍ + CỜ VẼ** (x, y, ngoài-khung, dời-chỗ, góc mũi tên) — đổi MỖI KHUNG ⇒ ghi
 *     thẳng vào node DOM qua `ref` ({@link datViTriBadge}), KHÔNG qua state.
 *
 * ⚠ Phần TÍNH (chiếu, `locBadge`, `layVungCam`, `ghiHopDaVe`, `ghiSoAn`, `__demBadge`) vẫn
 *   chạy **nguyên vẹn mỗi khung**. Bản vá chỉ bỏ REACT ra khỏi đường đi của toạ độ, không
 *   bỏ phép đo nào: sổ `hopDaVe` mà `LopNhan` đọc ở CÙNG khung vẫn phải mới từng khung
 *   (G136 — "badge VẼ == badge VÀO SỔ"), kể cả những khung không có lượt commit nào.
 *   Ghim bằng `lopCanhBaoKhongVeLaiMoiKhung.dom.test.tsx` (đầu độc sổ giữa chừng, bắt một
 *   khung không-setState dựng lại).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

import { useOptionalTheme } from "../../factory-scene/useOptionalTheme";
import { giaiMauCanh } from "../mauTrangThai";
import { mauChuTrenNen } from "./mauChuTrenNen";
import { mauCss } from "./mauThree";
import { TAM_CANVAS, layVungCam } from "../loi/LopNhan";
import { LOP_BADGE, ghiHopDaVe, ghiSoAn, xoaHopDaVe, xoaSoAn } from "../loi/hopDaVe";
import {
  demCapChongLapBadge,
  locBadge,
  type BadgeUngVien,
} from "./locBadge";

/** Mức độ cảnh báo — khớp `andon_events.state`. */
export type MucCanhBao = "call" | "yellow" | "red";

export interface CanhBaoTheGioi {
  /** `andon_events.id`. */
  id: number;
  machineId: number | null;
  /** Điểm neo trong thế giới (đỉnh máy + khoảng hở). */
  viTri: { x: number; y: number; z: number };
  muc: MucCanhBao;
  /** Nhãn ngắn ĐÃ qua `t()` — component này không gọi `t()` (RB-8.3). */
  nhan: string;
  /** Đã xác nhận chưa — alarm đã ack vẫn hiện nhưng nhạt hơn. */
  daAck: boolean;
}

export interface LopCanhBaoProps {
  canhBao: readonly CanhBaoTheGioi[];
  /** Trần badge đồng thời. Nhiều hơn thì gộp thành một chip "+N". */
  tran?: number;
}

/** Trần badge — thấp hơn trần nhãn (30) vì badge to hơn và quan trọng hơn. */
export const TRAN_BADGE = 12;

/**
 * Mã hoá DƯ THỪA (luật 2): mỗi mức có hình dạng + token màu + trọng số riêng.
 *
 * ⚠ Ba token này nằm trong bảng ≤ 7 mã của §10.2 (`--destructive`, `--warning`,
 *   `--info`) — KHÔNG thêm mã thứ tám ở đây.
 */
const KIEU_MUC: Readonly<
  Record<MucCanhBao, { hinh: string; token: string; tokenChu: string; uuTien: number }>
> = {
  // Đỏ = critical. Tam giác — hình dạng "nguy hiểm" quy ước quốc tế.
  red: { hinh: "▲", token: "--destructive", tokenChu: "--destructive-foreground", uuTien: 3 },
  // Vàng = warning. Thoi.
  yellow: { hinh: "◆", token: "--warning", tokenChu: "--warning-foreground", uuTien: 2 },
  // Xanh dương = information / gọi hỗ trợ. Tròn.
  call: { hinh: "●", token: "--info", tokenChu: "--info-foreground", uuTien: 1 },
};

interface BadgeDaChieu {
  id: number;
  x: number;
  y: number;
  muc: MucCanhBao;
  nhan: string;
  daAck: boolean;
  /** true ⇒ alarm nằm ngoài khung, badge đã bị kẹp về rìa (luật 3). */
  ngoaiKhung: boolean;
  /** Góc mũi tên chỉ về vị trí thật, radian. Có nghĩa khi `ngoaiKhung` hoặc `doiCho`. */
  gocMuiTen: number;
  /**
   * ★ Đợt 47 (N1) — badge đã DỜI khỏi neo (tránh lớp phủ DOM / badge khác); vẽ mũi tên về
   * neo thật như badge ngoài khung — cùng một ngôn ngữ: "alarm ở đằng kia".
   */
  doiCho?: boolean;
}

/**
 * ★★★ PH-55 — thứ ĐƯỢC PHÉP nằm trong React state: DANH TÍNH + NỘI DUNG của tập badge.
 *
 * Không có `x`/`y`/`ngoaiKhung`/`gocMuiTen` ở đây, và đó là toàn bộ bản vá. Mọi trường
 * dưới đây chỉ đổi khi DỮ LIỆU cảnh báo đổi (thêm/bớt alarm, ack, đổi mức, đổi nhãn) —
 * không trường nào đổi vì người dùng xoay camera.
 */
interface BadgeTrongTap {
  id: number;
  muc: MucCanhBao;
  nhan: string;
  daAck: boolean;
}

/** Thứ đổi MỖI KHUNG ⇒ đi thẳng vào node DOM qua `ref`, không qua state. */
interface ViTriBadge {
  x: number;
  y: number;
  ngoaiKhung: boolean;
  doiCho: boolean;
  gocMuiTen: number;
}

/**
 * ★★★ PH-55 — ghi vị trí + cờ vẽ của MỘT badge THẲNG vào node DOM (không `setState`).
 *
 * · Dùng `transform` chứ không `left/top`: hai kênh cho cùng một kết quả hình học
 *   (`getBoundingClientRect` — thứ e2e và `coBadgeRef` đọc — tính cả transform), nhưng
 *   `left/top` bắt trình duyệt tính lại BỐ CỤC của cả lớp phủ mỗi khung, còn `transform`
 *   chỉ hợp thành. Bỏ React ra khỏi đường đi mà vẫn viết `left/top` là mới đi được nửa
 *   đường. `translate(-50%, -50%)` giữ nguyên nghĩa "(x, y) là TÂM hộp" mà `hopBadge`
 *   của `locBadge.ts` phụ thuộc — hai phép tịnh tiến giao hoán nên thứ tự không đổi gì.
 * · `data-ngoai-khung` / `data-doi-cho` ghi qua `dataset` (đúng tên thuộc tính cũ, e2e
 *   `qa-t1-badge-chonglap.spec.ts` đọc chúng), vì hai cờ ấy cũng đổi theo từng khung.
 */
function datViTriBadge(el: HTMLElement, muiTen: HTMLElement | null | undefined, v: ViTriBadge): void {
  el.style.transform = `translate(-50%, -50%) translate(${v.x}px, ${v.y}px)`;
  el.dataset.ngoaiKhung = v.ngoaiKhung ? "1" : "0";
  el.dataset.doiCho = v.doiCho ? "1" : "0";
  if (!muiTen) return;
  // Luật 3 — mũi tên chỉ về vị trí THẬT của alarm ngoài khung (Đợt 47: cả badge bị dời chỗ).
  muiTen.style.display = v.ngoaiKhung || v.doiCho ? "inline-block" : "none";
  muiTen.style.transform = `rotate(${v.gocMuiTen}rad)`;
}

/** Lề tối thiểu khi kẹp badge vào rìa, px. */
const LE_RIA_PX = 28;

/** z-index lớp badge drei — TRÊN nhãn (20) và ngang dải hợp nhất (30). ★ Đợt 47 — hằng module (G114: prop mới mỗi render = đổi props mọi commit). */
const Z_INDEX_BADGE: [number, number] = [30, 10];
/** Lớp badge là chỉ báo, không nhận chuột — kéo xoay camera xuyên qua. */
const KIEU_LOP_BADGE = { pointerEvents: "none", userSelect: "none" } as const;
/**
 * Kiểu KHỞI ĐIỂM của mũi tên — hằng module, và CỐ Ý là "ẩn".
 *
 * Nút mũi tên nay LUÔN được dựng (xem chỗ dùng): sự tồn tại của nó từng phụ thuộc cờ
 * `ngoaiKhung`/`doiCho`, mà hai cờ ấy đổi theo từng khung kéo camera ⇒ mỗi lần badge chạm
 * rìa là một lượt commit. `datViTriBadge` bật/tắt nó bằng `display` ngay trong chính
 * commit gắn node (ref chạy trước khi trình duyệt vẽ), nên không có khung nào thấy mũi
 * tên sai. `display: "none"` (chứ không `visibility`) ⇒ nút ẩn KHÔNG chiếm chỗ, bề rộng
 * badge đo vào `coBadgeRef` vẫn đúng bằng bề rộng lúc chưa có mũi tên — y như bản
 * dựng-có-điều-kiện trước đây, nên `locBadge` không đổi hành vi khử chồng.
 */
const KIEU_MUI_TEN = { display: "none", transform: "rotate(0rad)" } as const;

export function LopCanhBao({ canhBao, tran = TRAN_BADGE }: LopCanhBaoProps) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  /**
   * ★★★ PH-55b — HỒI QUY DO CHÍNH PH-55 MỞ RA, VÁ BẰNG HOOK ĐÃ CÓ (G12).
   *
   * `mauCss` và `mauChuTrenNen` đọc biến CSS của `<html>` NGAY TRONG THÂN RENDER
   * (`giaiMauCanh` → `getComputedStyle(document.documentElement)`), nên màu badge đúng
   * hay sai phụ thuộc vào việc component có render lại sau khi theme đổi hay không.
   * Trước PH-55 nó render mỗi khung nên tự lành sau ~16 ms; sau PH-55 nó chỉ render khi
   * TẬP badge đổi — mà `ThemeContext.tsx:38` đổi theme bằng `root.classList.add("dark")`,
   * một thao tác không chạm `canhBao` và không xin khung (`frameloop="demand"`). Badge sẽ
   * đứng lại ở màu theme cũ vô thời hạn: đúng chỗ ba vòng đo WCAG của Đợt 57 vừa dọn.
   *
   * ★ DÙNG LẠI `useOptionalTheme` — KHÔNG viết bản thứ hai: nó đã theo dõi đúng
   *   `documentElement` với `attributeFilter: ["class"]` + `matchMedia` cho theme hệ điều
   *   hành, và an toàn khi thiếu Provider (không cần bắc cầu context vào trong `<Canvas>` —
   *   ràng buộc mà lớp này không thể phá). `setState` của nó là thứ kéo một lượt render.
   * ★ CỐ Ý KHÔNG đưa theme vào `chuKy` và KHÔNG memo hoá bảng màu: `chuKy` chỉ được so ở
   *   TRONG một khung, mà đổi theme không sinh khung nào; còn memo theo `[theme]` sẽ ghim
   *   vĩnh viễn màu DỰ PHÒNG nếu lượt render đầu chạy trước khi stylesheet kịp có biến —
   *   đọc lại mỗi lượt render là hành vi cũ, và nay số lượt render đã ít.
   * ★ Giá trị được KHAI ra DOM (`data-theme` dưới kia) nên sự phụ thuộc này đọc được, đo
   *   được và không thể bị xoá âm thầm.
   */
  const theme = useOptionalTheme();
  const [hienThi, setHienThi] = useState<BadgeTrongTap[]>([]);

  // ★ Đợt 47 (N5) — rời cảnh thì rút hộp khỏi sổ chung, nhãn không phải né bóng ma.
  useEffect(
    () => () => {
      xoaHopDaVe(gl.domElement, LOP_BADGE);
      xoaSoAn(gl.domElement, LOP_BADGE);
    },
    [gl],
  );
  const [soAn, setSoAn] = useState(0);
  const tamRef = useRef(new THREE.Vector3());
  const chuKyRef = useRef("");
  /**
   * Kích thước THẬT của từng badge (đo bằng `getBoundingClientRect` sau khi div
   * đã render), nhớ theo `id`. Cùng lý do như `coNhanRef` của `LopNhan`: bề rộng
   * badge phụ thuộc nhãn đã qua `t()` và font đang tải, nên ƯỚC LƯỢNG theo ký tự
   * là cách sinh con số CÓ VẺ đúng mà không ai đo. Khung đầu của một badge mới
   * dùng trị suy đoán của `locBadge`; từ khung sau đã có số đo thật.
   */
  const coBadgeRef = useRef(new Map<number, { rongPx: number; caoPx: number }>());
  /**
   * ★★★ PH-55 — BA SỔ TAY ngoài React, cập nhật mỗi khung:
   *   · `viTriRef`  — vị trí + cờ vẽ đã tính của khung HIỆN TẠI, theo `id`. Node mới gắn
   *     vào DOM đọc ngay sổ này trong `ref` nên nó không bao giờ nhấp nháy ở gốc (0,0).
   *   · `nodeRef` / `muiTenRef` — node DOM đang sống của từng badge, để vòng lặp khung
   *     ghi thẳng vào. Xoá trong chính `ref` khi React tháo node (đối số `null`).
   */
  const viTriRef = useRef(new Map<number, ViTriBadge>());
  const nodeRef = useRef(new Map<number, HTMLDivElement>());
  const muiTenRef = useRef(new Map<number, HTMLSpanElement>());

  const tinhLai = useCallback(() => {
    if (canhBao.length === 0) {
      ghiHopDaVe(gl.domElement, LOP_BADGE, []);
      viTriRef.current.clear();
      /*
       * ★★★ PH-55 — PHẢI XOÁ CHỮ KÝ Ở ĐÂY, nếu không lớp này CHẾT HẲN sau lần đầu hết
       * cảnh báo. Trước bản vá chữ ký chứa toạ độ nên hai lần "cùng một tập badge" gần như
       * không bao giờ trùng chuỗi, và lỗi ngủ yên. Nay chữ ký CỐ Ý không có toạ độ ⇒ một
       * alarm đóng rồi mở lại sinh ĐÚNG chuỗi cũ; giữ nguyên `chuKyRef` thì so sánh bên
       * dưới khớp và `setHienThi` không bao giờ được gọi lại — badge biến mất vĩnh viễn
       * trong khi mọi phép đo (`__demBadge.ve`, sổ `hopDaVe`) vẫn khai là có vẽ.
       */
      chuKyRef.current = "";
      if (hienThi.length !== 0) {
        setHienThi([]);
        setSoAn(0);
      }
      return;
    }

    const ra: BadgeDaChieu[] = [];
    const tamMh = { x: size.width / 2, y: size.height / 2 };

    for (const cb of canhBao) {
      const p = tamRef.current.set(cb.viTri.x, cb.viTri.y, cb.viTri.z);
      const v = p.clone().project(camera);

      // ★ LUẬT 3 — `v.z > 1` nghĩa là SAU LƯNG camera. Không được bỏ qua: đó
      //   chính là ca "xoay camera đi một chút là mất cảnh báo P1".
      const sauLung = v.z > 1 || !Number.isFinite(v.x) || !Number.isFinite(v.y);
      // Sau lưng camera thì toạ độ chiếu bị LẬT dấu — phải đảo lại trước khi kẹp,
      // nếu không mũi tên sẽ chỉ đúng ngược hướng.
      const nx = sauLung ? -v.x : v.x;
      const ny = sauLung ? -v.y : v.y;

      let x = ((nx + 1) / 2) * size.width;
      let y = ((1 - ny) / 2) * size.height;

      const ngoai =
        sauLung || x < LE_RIA_PX || x > size.width - LE_RIA_PX || y < LE_RIA_PX || y > size.height - LE_RIA_PX;

      let goc = 0;
      if (ngoai) {
        // Kẹp về rìa dọc theo tia từ tâm màn hình tới vị trí chiếu.
        const dx = x - tamMh.x;
        const dy = y - tamMh.y;
        goc = Math.atan2(dy, dx);
        const nuaRong = size.width / 2 - LE_RIA_PX;
        const nuaCao = size.height / 2 - LE_RIA_PX;
        // Tỉ lệ để tia chạm cạnh gần nhất của hình chữ nhật (không phải hình tròn
        // — kẹp theo tròn để lại bốn góc màn hình trống trong khi badge chen chúc
        // ở giữa các cạnh).
        const t = Math.min(
          nuaRong / Math.max(1e-6, Math.abs(dx)),
          nuaCao / Math.max(1e-6, Math.abs(dy)),
        );
        x = tamMh.x + dx * t;
        y = tamMh.y + dy * t;
      }

      ra.push({
        id: cb.id,
        x,
        y,
        muc: cb.muc,
        nhan: cb.nhan,
        daAck: cb.daAck,
        ngoaiKhung: ngoai,
        gocMuiTen: goc,
      });
    }

    /**
     * ★★★ T-1 — KHỬ CHỒNG LẤN, KHÔNG CHỈ SẮP + CẮT.
     *
     * Trước bản vá đây là `ra.sort(...).slice(0, tran)` trần: một phép chọn theo
     * ƯU TIÊN, KHÔNG phải phép khử chồng lấn theo KHÔNG GIAN. Hậu quả đo được:
     * 52 cặp badge chồng nhau trên 12 badge (4 alarm cùng máy `SIM-L1-AOI` đè
     * hoàn toàn lên nhau, không đọc nổi) trong khi `data-so-an` khai `0`.
     *
     * `locBadge` (thuần, có test) làm cả ba việc theo đúng thứ tự: sắp ưu tiên →
     * khử chồng lấn bbox (chỉ badge TRONG khung; badge ngoài khung được MIỄN vì
     * §10.3 luật 3 cấm để một alarm biến mất) → cắt trần. Thứ tự ưu tiên (mức độ,
     * rồi chưa-ack trước) là CHÍNH SÁCH của lớp này, nên ta tính `diemUuTien` ở
     * đây rồi truyền vào — `locBadge` không cần biết về `MucCanhBao`.
     */
    const ungVien: BadgeUngVien[] = ra.map((b) => {
      const co = coBadgeRef.current.get(b.id);
      // Chưa-ack (daAck=false) phải xếp TRƯỚC đã-ack ⇒ +1000 khi chưa ack, để nó
      // trội hơn mọi chênh lệch mức độ (uuTien ∈ {1,2,3}). Giống nhánh `daAck`
      // trong sort cũ (đã-ack đẩy xuống cuối).
      // ★ Đợt 47 (N1) — ĐỎ = SỰ CỐ, ưu tiên TUYỆT ĐỐI: +10.000 ⇒ mọi badge đỏ (kể cả đã ack)
      //   đứng trước mọi badge vàng/xanh; trong đỏ, chưa-ack vẫn trước. §10.3 luật 3 viết cho nó.
      const doTuyetDoi = b.muc === "red";
      const diemUuTien = KIEU_MUC[b.muc].uuTien + (b.daAck ? 0 : 1000) + (doTuyetDoi ? 10_000 : 0);
      return {
        id: b.id,
        x: b.x,
        y: b.y,
        diemUuTien,
        ngoaiKhung: b.ngoaiKhung,
        uuTienTuyetDoi: doTuyetDoi,
        // Số đo THẬT khi đã có; thiếu thì `locBadge` dùng trị suy đoán của nó.
        rongPx: co?.rongPx,
        caoPx: co?.caoPx,
      };
    });

    // ★ Đợt 47 (N1) — vùng cấm = bbox THẬT của lớp phủ DOM (`[data-che-nhan]`, CÙNG nguồn với `LopNhan`
    //   từ Đợt 35 — lớp badge là lớp duy nhất chưa đọc nó; QA Đợt 46: badge đỏ SPI bị thẻ "Chỉ số" che
    //   toàn bộ). Badge bị che/chồng thì DỜI, không giấu; badge đỏ không bao giờ giấu khi còn chỗ.
    const vungCam = layVungCam(gl.domElement);
    const kq = locBadge(ungVien, {
      tran,
      khungCanvas: { rong: size.width, cao: size.height },
      vungCam,
      doiCho: true,
    });
    /*
     * ★ Đợt 47 (N5) — ghi hộp đã vẽ vào sổ chung: `LopNhan` (chạy SAU trong cùng khung) nhường chỗ này.
     * ★★★ Đợt 53 (QA lần 8, SAI #1) — ghi `hopManHinh`, KHÔNG phải `hop`. `hop` là `null` cho badge bị
     *   KẸP RÌA (miễn khử chồng badge×badge theo §10.3 luật 3) và bản cũ `filter(h !== null)` đã ném
     *   đúng những badge ấy ra khỏi sổ — trong khi chúng vẫn vẽ, vẫn z 30, vẫn đè nhãn. Đo được trên
     *   `/twin/may/18`: `__demBadge.ve = 1` mà `__demNhan.soHopBadge = 0` ⇒ nhãn tên máy bị đè 17–35 %.
     *   `hopManHinh` LUÔN có ⇒ không còn `filter` nào có thể làm rỗng sổ một cách câm lặng.
     */
    ghiHopDaVe(
      gl.domElement,
      LOP_BADGE,
      kq.ve.map((u) => u.hopManHinh),
    );

    // Dựng lại danh sách BadgeDaChieu theo thứ tự `locBadge` đã chọn; badge bị DỜI mang toạ độ mới
    // + mũi tên về neo thật.
    const theoId = new Map(ra.map((b) => [b.id, b]));
    const ve: BadgeDaChieu[] = kq.ve.map((u) => {
      const b = theoId.get(u.id)!;
      if (!u.doiCho) return b;
      return { ...b, x: u.x, y: u.y, doiCho: true, gocMuiTen: Math.atan2(u.yGoc - u.y, u.xGoc - u.x) };
    });
    // ★★★ G7 — `data-so-an` phải là con số người đọc TƯỞNG nó là: số alarm đang
    //   bị GIẤU khỏi màn (vì chồng lấn HOẶC vì chạm trần). Đó là `kq.soAn`, đại
    //   lượng ĐẦU VÀO-bị-loại. NHƯNG chỉ số này KHÔNG đủ để nghiệm thu (nó do
    //   chính thuật toán tính ra); phép nghiệm thu dùng `capConChong` bên dưới —
    //   số cặp CÒN chồng ở ĐẦU RA, đo bằng hàm độc lập `demCapChongLapBadge`.
    const an = kq.soAn;
    /*
     * ★★★ ĐỢT 49 (mục D) — GHI SỐ CẢNH BÁO BỊ GIẤU VÀO SỔ CHUNG.
     * `/twin`@1280 đo được `soAn 2 · biChe 2` mà màn không nói gì: `data-so-an` chỉ DOM đọc
     * được, còn chip đáy canvas (`LopNhan`) đếm TÊN MÁY ẩn chứ không đếm cảnh báo. Ghi ở đây,
     * `LopNhan` đọc ở CÙNG khung (nó chạy sau trong cây — hợp đồng thứ tự của `hopDaVe`) và vẽ
     * chung một cụm chip; hai cụm chip riêng là hai cụm chồng nhau.
     * ⚠ Ghi CẢ khi 0: "chưa ai ghi" và "ghi 0" phải cùng nghĩa, nếu không chip sẽ in số cũ khi
     *   cảnh báo cuối cùng hiện ra được.
     */
    ghiSoAn(gl.domElement, LOP_BADGE, an);

    // Cửa sổ đo cho e2e (luật G11). Ghi CẢ khi 0 badge — "không đo được" phải
    // khác "đo được 0". `capConChong` là đại lượng ĐỘC LẬP với `locBadge`: nó
    // quét mọi cặp trong tập ĐƯỢC VẼ bằng bbox (dùng số đo thật khi có), nên nó
    // có thể BÁC BỎ `locBadge`. Phải luôn = 0; e2e đối chiếu với getBoundingClientRect.
    if (typeof window !== "undefined") {
      (window as WindowCoDoBadge).__demBadge = {
        ve: ve.length,
        tong: ra.length,
        soAn: an,
        soBiChongLap: kq.soBiChongLap,
        soVuotTran: kq.soVuotTran,
        biChe: kq.soBiChe,
        doiCho: kq.soDoiCho,
        soVungCam: vungCam.length,
        tran,
        capConChong: demCapChongLapBadge(
          ve.map((b) => ({
            x: b.x,
            y: b.y,
            ngoaiKhung: b.ngoaiKhung,
            ...(coBadgeRef.current.get(b.id) ?? {}),
          })),
        ),
      };
    }

    /*
     * ★★★ PH-55 (LUẬT 4) — VỊ TRÍ ĐI THẲNG VÀO DOM, KHÔNG QUA REACT.
     *
     * Đây là chỗ bản vá thật sự nằm. Vòng lặp này chạy MỖI KHUNG như trước, nhưng nó
     * viết vào `element.style` / `element.dataset` thay vì gọi `setState`. Badge chưa có
     * node (khung đầu của một badge mới) chỉ được ghi vào `viTriRef`; `ref` của nó đọc
     * lại sổ ấy ngay khi React gắn node, trong cùng commit, trước khi trình duyệt vẽ.
     */
    const viTri = viTriRef.current;
    viTri.clear();
    for (const b of ve) {
      const v: ViTriBadge = {
        x: b.x,
        y: b.y,
        ngoaiKhung: b.ngoaiKhung,
        doiCho: b.doiCho === true,
        gocMuiTen: b.gocMuiTen,
      };
      viTri.set(b.id, v);
      const el = nodeRef.current.get(b.id);
      if (el) datViTriBadge(el, muiTenRef.current.get(b.id), v);
    }

    /*
     * ★★★ CHỮ KÝ CỦA **TẬP**, KHÔNG PHẢI CỦA KHUNG NHÌN — không một toạ độ nào ở đây.
     *
     * Vào chữ ký đúng những thứ quyết định *có bao nhiêu node và mỗi node mang gì*:
     * số bị ẩn (`data-so-an`), thứ tự + `id` (thêm/bớt badge), `muc` (hình dạng + màu),
     * `daAck` (viền nét đứt), `nhan` (chữ). Thiếu ba trường sau thì một alarm được ack
     * hoặc đổi mức sẽ KHÔNG bao giờ cập nhật trên màn khi camera đứng yên — bản cũ chỉ
     * thoát nạn ấy nhờ chính cái tật render mỗi khung mà bản vá này gỡ bỏ.
     */
    const chuKy = `${an}|${ve.map((v) => `${v.id}:${v.muc}:${v.daAck ? 1 : 0}:${v.nhan}`).join("|")}`;
    if (chuKy === chuKyRef.current) return;
    chuKyRef.current = chuKy;
    setHienThi(ve.map((b) => ({ id: b.id, muc: b.muc, nhan: b.nhan, daAck: b.daAck })));
    setSoAn(an);
  }, [canhBao, camera, gl, size.width, size.height, tran, hienThi.length]);

  // Chiếu lại mỗi khung ĐƯỢC VẼ. Với `frameloop="demand"` đây không phải 60 fps.
  useFrame(tinhLai);

  if (hienThi.length === 0) return null;

  return (
    /*
     * ★★★ Đợt 47 (N1 gốc rễ) — LỚP `fullscreen` NEO VÀO TÂM CANVAS, như `LopNhan` từ Đợt 31.
     * drei `Html fullscreen` đặt lớp QUANH `calculatePosition(el, camera, size)` — mặc định là hình
     * chiếu của chính `<Html>` = gốc (0,0,0) của cảnh, đổi theo camera. Đo được (`.qa-dot47/
     * run-probe-lop47.log`): lớp badge lệch canvas (−57,−96) ở `/twin` 1600 và (−443,−142) ở
     * Line 1600 ⇒ mọi badge vẽ lệch khỏi máy của nó, và "badge bị thẻ Chỉ số che" (QA Đợt 46
     * N1) là HỆ QUẢ của lệch lớp, không phải của thuật toán. `LopNhan` đã vá Đợt 31; lớp này bị
     * bỏ quên (G110).
     */
    <Html fullscreen calculatePosition={TAM_CANVAS} zIndexRange={Z_INDEX_BADGE} style={KIEU_LOP_BADGE}>
      <div
        data-testid="lop-canh-bao"
        data-so-badge={hienThi.length}
        data-so-an={soAn}
        /* ★★★ PH-55b — theme mà lớp này ĐANG vẽ theo. Không phải trang trí: nó là cửa sổ đo
           duy nhất cho biết màu badge đã theo kịp `<html class="dark">` chưa, và nó khiến sự
           phụ thuộc vào `useOptionalTheme` không thể bị xoá mà mọi lưới vẫn xanh. */
        data-theme={theme}
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        {hienThi.map((b) => {
          const kieu = KIEU_MUC[b.muc];
          /* ★ Đợt 57 (mục 11) — nền badge qua `mauCss` (canvas 2D quy `oklch()` ra sRGB thật):
               để chọn màu chữ ta cần BYTE, mà `giaiMauCanh` trả nguyên văn `oklch(...)` (G29). */
          const mau = mauCss(kieu.token, "#ef4444");
          /*
           * ★★★ ĐỢT 57 (mục thiết kế 11) — MÀU CHỮ **TÍNH TỪ ĐỘ CHÓI CỦA NỀN**, ba lần đo mới ra.
           *
           * Bản gốc ghim `color: "#fff"` cho cả ba mức + `opacity: 0.6` cho badge đã ack. Đo pixel
           * thật (WCAG 2.1, nền sau khi vẽ) qua ba vòng:
           *   ① gốc (mờ 0,6 + trắng)             ⇒ **1,68–2,83**  — 106 chuỗi dưới ngưỡng
           *   ② bỏ `opacity`, giữ trắng           ⇒ **1,96–2,60**  — độ mờ KHÔNG phải nguyên nhân duy nhất
           *   ③ dùng `--<mức>-foreground`         ⇒ warning/info ĐẠT, **destructive vẫn 3,11–3,29**
           * Lý do ③ hụt: `--destructive-foreground` là màu SÁNG (oklch 0.98) — đúng cho nút
           * `bg-destructive` cỡ chữ thường, SAI cho chữ 11 px trên nền đỏ đặc. Chữ SẪM trên chính
           * nền đỏ ấy đo được **≈ 5,0**.
           * ⇒ Không ghim mức nào cả: `mauChuTrenNen` CHỌN giữa `--foreground` và `--background`
           *   bằng đúng công thức WCAG. Chỉ dùng token có sẵn (§10.2 trần 7 mã nguyên vẹn), và tự
           *   lật đúng khi đổi theme sáng/tối — thứ mà mọi bảng ghim tay đều hỏng.
           */
          const mauChu = mauChuTrenNen(mau, giaiMauCanh(kieu.tokenChu) ?? "#fff");
          return (
            <div
              key={b.id}
              data-testid={`badge-canh-bao-${b.id}`}
              data-muc={b.muc}
              /* ★ Đợt 57 (mục 11) — trạng thái ack nay đọc được từ DOM (viền thay cho `opacity`). */
              data-da-ack={b.daAck ? "1" : "0"}
              /* ★★★ PH-55 — `data-ngoai-khung` / `data-doi-cho` KHÔNG còn ở đây: hai cờ ấy đổi
                 theo từng khung kéo camera nên chúng do `datViTriBadge` ghi qua ref (tên và
                 ngữ nghĩa thuộc tính giữ nguyên — e2e `qa-t1-badge-chonglap.spec.ts` đọc chúng).
                 Để chúng lại trong JSX là để nguyên cái tật này ở một cửa sau.
                 ★ Đo kích thước THẬT ngay khi div gắn vào DOM và nhớ theo `id`.
                 Khung sau, `locBadge` khử chồng lấn bằng bbox thật thay vì trị
                 suy đoán. Ghi vào ref (không setState) nên KHÔNG gây re-render. */
              ref={(el) => {
                if (!el) {
                  nodeRef.current.delete(b.id);
                  return;
                }
                nodeRef.current.set(b.id, el);
                /* Đặt badge vào ĐÚNG chỗ của khung hiện tại NGAY trong commit này — `ref` chạy
                   trước khi trình duyệt vẽ, nên node mới không bao giờ loé lên ở gốc lớp phủ.
                   Phải đứng TRƯỚC phép đo bên dưới: mũi tên vừa được bật/tắt ở đây quyết định
                   bề rộng mà `getBoundingClientRect` sắp đọc. */
                const v = viTriRef.current.get(b.id);
                if (v) datViTriBadge(el, muiTenRef.current.get(b.id), v);
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  const cu = coBadgeRef.current.get(b.id);
                  coBadgeRef.current.set(b.id, { rongPx: r.width, caoPx: r.height });
                  // ★ Đợt 47 — số đo THẬT khác trị đã dùng (khung đầu ước lượng; badge DỜI thêm mũi tên "➤" nên
                  //   rộng ra) ⇒ xin MỘT khung để hộp trong sổ `hopDaVe` và khử chồng dùng số thật. Hội tụ sau một
                  //   khung; `frameloop="demand"` không tự xin.
                  if (!cu || Math.abs(cu.rongPx - r.width) > 0.5 || Math.abs(cu.caoPx - r.height) > 0.5) invalidate();
                }
              }}
              style={{
                position: "absolute",
                /* ★★★ PH-55 — gốc CỐ ĐỊNH (0, 0); toạ độ thật đi qua `transform` do
                   `datViTriBadge` ghi mỗi khung. Hai số này là hằng nên React không bao giờ
                   phải viết lại chúng, và `transform` tĩnh dưới đây chỉ là giá trị khởi điểm
                   (neo TÂM) cho khoảnh khắc trước khi `ref` chạy. */
                left: 0,
                top: 0,
                transform: "translate(-50%, -50%)",
                display: "flex",
                alignItems: "center",
                gap: 4,
                // Cỡ CỐ ĐỊNH — luật 1. Không `distanceFactor`, không scale theo z.
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                padding: "3px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                color: mauChu,
                background: mau,
                /*
                 * ★★★ ĐỢT 57 (mục thiết kế 11) — "ĐÃ XÁC NHẬN" = **VIỀN**, KHÔNG PHẢI MỜ ĐI.
                 * Bản cũ: `opacity: b.daAck ? 0.6 : 1`. `opacity` composite CẢ khối (nền + chữ) xuống
                 * nền phía sau, nên nó KHÔNG "lùi badge lại" mà **kéo tương phản chữ/nền xuống cùng
                 * lúc**. Đo pixel THẬT trên cảnh 3D (`.qa-dot57/01-do-truoc.txt`, WCAG 2.1 trên nền
                 * sau khi vẽ): chữ 11 px trắng trong badge đã ack đạt tỉ số **1,68–2,83** — dưới cả
                 * ngưỡng 3,0 của chữ lớn, chứ chưa nói 4,5 của chữ thường. 106 chuỗi dính lỗi này.
                 * ★ Thay bằng `outline` nét ĐỨT: nó là kênh HÌNH DẠNG (§10.3 luật 2 — mã hoá dư thừa),
                 *   giữ nguyên độ tương phản của chữ, và `outline` KHÔNG chiếm chỗ trong hộp nên
                 *   `coBadgeRef`/`locBadge` đo ra đúng kích thước cũ — khử chồng lấn không đổi hành vi.
                 * ★ `opacity` giữ 1 ở CẢ HAI nhánh: khác biệt ack/chưa-ack nay đọc được bằng viền,
                 *   và một cảnh báo chưa được giải quyết không có lý do gì mờ hơn cảnh báo khác.
                 */
                opacity: 1,
                /* ★ Viền ack lấy CÙNG màu chữ của mức ⇒ luôn tương phản với nền badge của mức ấy
                     (trắng trên đỏ, sẫm trên vàng/xanh) — không còn trắng-trên-vàng. */
                outline: b.daAck ? `2px dashed ${mauChu}` : "none",
                outlineOffset: "-3px",
                boxShadow: "0 1px 3px rgba(0,0,0,.4)",
              }}
            >
              {/* Luật 2 — hình dạng, rồi chữ. Màu là chiều thứ ba, không phải duy nhất. */}
              <span aria-hidden="true">{kieu.hinh}</span>
              <span>{b.nhan}</span>
              {/* Luật 3 — mũi tên chỉ về vị trí THẬT của alarm ngoài khung (Đợt 47: cả badge bị dời
                  chỗ). ★★★ PH-55: LUÔN dựng, `display`+góc do `datViTriBadge` ghi qua ref (xem
                  `KIEU_MUI_TEN`) — dựng-có-điều-kiện buộc mỗi lần badge chạm rìa thành một commit. */}
              <span
                aria-hidden="true"
                data-testid={`mui-ten-${b.id}`}
                ref={(el) => {
                  if (el) muiTenRef.current.set(b.id, el);
                  else muiTenRef.current.delete(b.id);
                }}
                style={KIEU_MUI_TEN}
              >
                ➤
              </span>
            </div>
          );
        })}
      </div>
    </Html>
  );
}

/**
 * Hình dạng cửa sổ đo `window.__demBadge` — e2e đọc đúng các khoá này.
 *
 * ⚠ `soAn`/`soBiChongLap`/`soVuotTran` là ĐẦU VÀO bị loại (do `locBadge` tính).
 *   `capConChong` là ĐẦU RA còn chồng (do `demCapChongLapBadge` đo độc lập) —
 *   phải luôn 0. Chính chỗ lẫn hai đại lượng này là gốc của `chongLap = 0` sai.
 */
export interface WindowCoDoBadge extends Window {
  __demBadge?: {
    ve: number;
    tong: number;
    /** Số badge BỊ GIẤU (chồng lấn HOẶC chạm trần) — đại lượng của `data-so-an`. */
    soAn: number;
    soBiChongLap: number;
    soVuotTran: number;
    /** ★ Đợt 47 (N1) — bị loại vì lớp phủ DOM che / thò mép mà không dời được (badge thường). Đỏ ⇒ luôn 0 khi còn chỗ. */
    biChe: number;
    /** ★ Đợt 47 (N1) — số badge đã DỜI khỏi neo (có mũi tên về neo thật). */
    doiCho: number;
    /** ★ Đợt 47 (N1) — số vùng cấm đọc được từ DOM ở khung này (cùng `layVungCam` với nhãn). */
    soVungCam: number;
    tran: number;
    /** Số CẶP badge CÒN chồng nhau trong tập ĐƯỢC VẼ — phải luôn 0. */
    capConChong: number;
  };
}

export default LopCanhBao;
