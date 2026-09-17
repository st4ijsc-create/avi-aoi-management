/**
 * CanhNhaMay.tsx — cảnh nhà máy dựng trên KIT `twin3d/loi/`, thay thế
 * `factory-scene/FactoryScene3D.tsx` cho màn `/factory-command`.
 *
 * ★★★ ĐÂY LÀ CỔNG RA CỦA ĐỢT 1. Nó nhận **đúng** `FactorySceneProps` mà
 * `FactoryScene2D`/`FactoryScene3D` nhận, và phải cho ra màn hình **hoạt động y
 * hệt**. Nếu kit sai thì màn đang chạy đổi hành vi — đó là phép đo thật, khác hẳn
 * một màn demo mới tự chấm điểm cho chính nó.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠ VÌ SAO MÀU VẪN ĐI QUA `overlayColorHex` CHỨ KHÔNG QUA `mauTrangThai.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * `mauTrangThai.ts` (Đợt 0) là nguồn sự thật màu cho các trạng thái
 * `operationStatusEnum` (running/stopped/error/…) theo ISA-101. Màn
 * `/factory-command` chạy trên MỘT TẬP TRẠNG THÁI KHÁC — `running | idle | down |
 * offline | maintenance` từ hợp đồng `factoryCommand.overview` — và có **bốn lớp
 * phủ** (status / oee / ng / energy) mà `mauTrangThai.ts` không mô hình hoá.
 * `idle`, `down`, `offline` KHÔNG có ô nào trong `BANG_MAU`, nên nối thẳng vào đó
 * sẽ đẩy cả ba xuống `khong_ro` (xám gạch chéo) — tức là **đổi hành vi màn hình**,
 * đúng thứ cổng ra Đợt 1 cấm.
 *
 * Nên Đợt 1 giữ nguyên `overlayColorHex` cho màn này. Hợp nhất hai hệ trạng thái
 * là việc của màn `/twin` mới (Đợt 5), nơi dữ liệu đến từ `trangThaiHangLoat` với
 * đúng enum của DB. Ghi lại ở đây để đợt sau không tưởng là bỏ sót.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Grid } from "@react-three/drei";
import { useBuocLuoi } from "./useBuocLuoi";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  type FactorySceneProps,
  type PlacedMachine,
  overlayColorHex,
  resolveLayout,
  scenePalette,
} from "../../factory-scene/sceneTypes";
import { useOptionalTheme } from "../../factory-scene/useOptionalTheme";
import { hinhKhoiCho } from "../hinhKhoiMay";
import { KhungCanh } from "./KhungCanh";
import { LoBatchMay, type MayTrongLo } from "./LoBatchMay";
import { LopNhan, type NhanTheGioi } from "./LopNhan";
import { noiInvalidate } from "./dieuKhienQuay";
import { taoVienHopBao, giaiPhongVien } from "./vienNoiBat";
import { TheoDoiMatDoKhungHinh, docBacDaLuu } from "./matDoKhungHinh";
import { apClick, apHover, TRANG_THAI_CHON_RONG, type TrangThaiChon } from "./chonVatThe";
import { laCheDoDo } from "./cheDoDo";

/* ═════════════════════════════════════════════════════════════════════════ */
/* PH-42 — CỬA SỔ ĐO "BA BỀ MẶT CHỌN"                                        */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ PH-42 — `window.__demChonChiHuy` — BA BỀ MẶT CHỌN CỦA MỘT CẢNH, ĐỌC CÙNG LÚC.
 *
 * Vì sao phải có: tiêu chí nghiệm thu của PH-42 là *"nhấn sáng, viền chọn và nhãn
 * cùng nói MỘT điều"*, mà trước cửa sổ này **không phép đo nào nói được câu đó**:
 *   · nhấn sáng — màu một instance trong `BatchedMesh`; `preserveDrawingBuffer` tắt
 *     nên `toDataURL()` trả 0 điểm khác nền (cùng lý do đã ghi ở `__demVien`).
 *   · viền chọn — `LineSegments` trong buffer WebGL, không có mặt trong DOM.
 *   · nhãn      — CÓ trong DOM, nên suốt các đợt trước người đo chỉ thấy **một**
 *     trong ba bề mặt và kết luận "màn hình nhất quán" từ đúng bề mặt duy nhất
 *     mình nhìn được.
 *
 * Bốn số trả về là **CHÍNH các biểu thức mà JSX dùng**, không phải bản chép lại:
 * `mayDangChon` và `idChoNhan` được tính MỘT lần rồi dùng cho cả cửa sổ đo lẫn
 * `<VienChon>`/`<LopNhan>`. Một bản sao ở đây sẽ đo được "cái tôi định vẽ" thay vì
 * "cái tôi đang vẽ" — đúng lớp lỗi `wip={[]}` mà `vienSucKhoeDoDuoc.dom.test.tsx` canh.
 *
 * Chỉ gắn khi `laCheDoDo()` (build DEV hoặc URL `?do=1`), dọn khi rời màn — cùng
 * khuôn `__demTuongTac`/`__demVien`; sản phẩm không đổi một byte khi cờ tắt.
 */
export interface CuaSoDoChonChiHuy extends Window {
  __demChonChiHuy?: () => {
    /** `selectedId` — thứ TRANG đang giữ (Sheet chi tiết, vòng `ring-primary` ở rail phải). */
    trang: number | null;
    /** `chon.dangChon` — thứ CẢNH tô nhấn sáng (`LoBatchMay`). */
    nhanSang: number | null;
    /** Máy mà `<VienChon>` đang vẽ khung trắng quanh. */
    vien: number | null;
    /** Giá trị `dangChon` mà `<LopNhan>` nhận — quyết định nhãn nào viền primary. */
    nhan: number | null;
  };
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* OrbitControls thuần + RB-3 (nối `invalidate`)                             */
/* ═════════════════════════════════════════════════════════════════════════ */

function DieuKhien({
  banKinh,
  controlsRef,
  onDoiKhoangCach,
}: {
  banKinh: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  onDoiKhoangCach: (d: number) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.maxPolarAngle = Math.PI / 2.15;
    c.minDistance = 4;
    c.maxDistance = banKinh * 5;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.update();

    // ★★★ RB-3 — thiếu dòng này thì màn hình ĐỨNG HÌNH khi xoay camera.
    const goInvalidate = noiInvalidate(c, invalidate);

    // Báo khoảng cách để tầng trên quyết định hiện nhãn (LOD nhãn của màn cũ).
    let mocCuoi = 0;
    const khiDoi = () => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - mocCuoi < 120) return; // throttle y hệt màn cũ
      mocCuoi = now;
      onDoiKhoangCach(c.object.position.distanceTo(c.target));
    };
    c.addEventListener("change", khiDoi);

    controlsRef.current = c;
    invalidate();
    return () => {
      c.removeEventListener("change", khiDoi);
      goInvalidate();
      c.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, invalidate, banKinh, controlsRef, onDoiKhoangCach]);

  // Quán tính (`enableDamping`) đòi `update()` mỗi khung KHI CÒN TRÔI. Với
  // `frameloop="demand"`, khung chỉ chạy khi có invalidate — và chính `change`
  // của controls phát ra invalidate, nên vòng lặp tự tắt khi camera dừng hẳn.
  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Camera bay tới máy được focus (giữ nguyên hành vi màn cũ)                 */
/* ═════════════════════════════════════════════════════════════════════════ */

function BayToi({
  byId,
  focusId,
  controlsRef,
}: {
  byId: Map<number, PlacedMachine>;
  focusId: number | null;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const dangBay = useRef(false);
  const dich = useRef(new THREE.Vector3());
  const dichMuc = useRef(new THREE.Vector3());

  useEffect(() => {
    if (focusId == null) return;
    const p = byId.get(focusId);
    if (!p) return;
    dichMuc.current.set(p.x, p.y + p.h * 0.5, p.z);
    const d = Math.max(5, (p.w + p.h + p.d) * 1.6);
    dich.current.set(p.x + d, p.y + p.h + d * 0.7, p.z + d);
    dangBay.current = true;
    invalidate();
  }, [focusId, byId, invalidate]);

  useFrame(({ camera }) => {
    if (!dangBay.current) return;
    const c = controlsRef.current;
    camera.position.lerp(dich.current, 0.12);
    if (c) {
      c.target.lerp(dichMuc.current, 0.12);
      c.update();
    }
    if (camera.position.distanceTo(dich.current) < 0.12) {
      dangBay.current = false;
      camera.position.copy(dich.current);
      if (c) {
        c.target.copy(dichMuc.current);
        c.update();
      }
    } else {
      invalidate();
    }
  });

  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Viền nổi bật máy đang chọn — EdgesGeometry, KHÔNG post-processing (§4.5)  */
/* ═════════════════════════════════════════════════════════════════════════ */

function VienChon({ may }: { may: PlacedMachine | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const [vien, setVien] = useState<THREE.LineSegments | null>(null);

  useEffect(() => {
    if (!may) {
      setVien(null);
      return;
    }
    const v = taoVienHopBao(
      { rong: may.w * 1.06, cao: may.h * 1.06, sau: may.d * 1.06 },
      { mau: "#ffffff", veDe: false },
    );
    v.position.set(may.x, may.y + may.h / 2, may.z);
    v.rotation.set(0, may.node.rotation || 0, 0);
    setVien(v);
    invalidate();
    // ★ RB-7 — EdgesGeometry cấp phát buffer GPU MỚI mỗi lần đổi máy đang chọn,
    // tức là hàng trăm lần mỗi ca. Không dispose là rò rỉ tích luỹ theo giờ.
    return () => giaiPhongVien(v);
  }, [may, invalidate]);

  return vien ? <primitive object={vien} /> : null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Theo dõi fps → tự hạ chất lượng                                           */
/* ═════════════════════════════════════════════════════════════════════════ */

function TheoDoiFps({ onDoiBac }: { onDoiBac: (chiHopBao: boolean, coNhan: boolean) => void }) {
  const doRef = useRef<TheoDoiMatDoKhungHinh | null>(null);
  if (doRef.current === null) {
    doRef.current = new TheoDoiMatDoKhungHinh({ bacBanDau: docBacDaLuu() ?? "day_du" });
  }
  useFrame(() => {
    const kq = doRef.current!.ghiKhungHinh(
      typeof performance !== "undefined" ? performance.now() : Date.now(),
    );
    if (kq.daDoi) {
      const d = doRef.current!.dacTinh;
      onDoiBac(d.chiHopBao, d.nhan);
    }
  });
  return null;
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Nội dung cảnh                                                             */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PH-52 — SÀN THÔI GHI ĐỘ SÂU, VÌ Ở ĐÂY `polygonOffset` **KHÔNG ĐỦ**
 * ════════════════════════════════════════════════════════════════════════════
 * Tấm sàn ở `y = -0.02`, drei `<Grid>` ở `y = 0` — cách nhau **2 cm**. Giống lớp
 * lỗi PH-51 ở `CanhVanHanh`, nhưng **cách vá phải khác**, và đây là lý lẽ đo được
 * chứ không phải khẩu vị:
 *
 * `<Grid infiniteGrid>` của drei nhân toạ độ đỉnh với `1 + fadeDistance`
 * (`Grid.js`: `if (infiniteGrid) localPosition *= 1.0 + fadeDistance`). Với
 * `args = banKinh*4` và `fadeDistance = banKinh*5`, ở cỡ tập đoàn QATD
 * (`banKinh` = 410 m) tấm lưới rộng **1.640 × 2.051 ≈ 3,36 TRIỆU mét** trong khi
 * `far` chỉ 8.200 m. Một tứ giác như thế vắt qua cả mặt phẳng `near` lẫn `far`;
 * độ sâu nội suy của nó sai **hàng mét**, không phải sai một nấc z. Hệ quả:
 * `polygonOffset` — thứ đếm theo **một** bước z — không mua nổi gì.
 *
 * ★ ĐO trên cổng 3077, bundle dựng từ chính cây này, thước "lưới vẽ ĐỦ"
 *   (% pixel vùng sàn thuần khác với oracle; oracle = lưới tắt depth-test):
 *
 *   | ứng viên                                   | tập đoàn xiên | một nhà máy xiên |
 *   |--------------------------------------------|---------------|------------------|
 *   | (chưa vá)                                  | **96,34 %**   | **56,32 %**      |
 *   | sàn `polygonOffset` 1/1 (cách của PH-51)   | 96,34 %       | 56,32 %          |
 *   | lưới `polygonOffset` −1/−1                 | 96,34 %       | 56,32 %          |
 *   | lưới `polygonOffset` −8/−8                 | 96,34 %       | 31,69 %          |
 *   | thu nhỏ tấm lưới (bỏ `infiniteGrid`)       |  0,49 %       |  0,00 %  ⚠       |
 *   | **sàn `depthWrite: false`  ← CHỌN**        |  **0,00 %**   |  **0,00 %**      |
 *
 *   ⚠ Thu nhỏ tấm lưới chữa khung XIÊN nhưng **làm hỏng khung mặc định** ở cỡ
 *     một nhà máy (0 % → 43,60 %/52,76 %): hết sai-vì-tấm-khổng-lồ thì lộ ra
 *     z-fighting cổ điển 2 cm vs Δz 7,5 cm. Tức nó đổi một khuyết tật lấy một
 *     khuyết tật khác. `depthWrite: false` **bỏ hẳn cuộc tranh chấp**, nên không
 *     phụ thuộc vào việc bước z có đủ mịn hay không ở bất kỳ nấc zoom nào.
 *
 * ★★★ VÌ SAO TẮT `depthWrite` CỦA SÀN LÀ AN TOÀN Ở ĐÂY (chứ không phải mọi nơi)
 *   Tấm sàn là **mặt dưới cùng** của cảnh: mọi máy đứng ở `y ≥ 0`, và
 *   `OrbitControls` không cho camera xuống dưới mặt sàn. Không có vật nào nằm
 *   SAU sàn để sàn phải che. Bỏ ghi độ sâu vì thế không mở ra vật nào bị lộ —
 *   đo toàn khung hình: khung mặc định (tập đoàn và một nhà máy) đổi **0,00 %**;
 *   khung zoom-sâu vào giữa lô máy đổi 4,72 % và soi ảnh thì **toàn bộ** phần đổi
 *   nằm trên mặt sàn HỞ, **0 pixel** trên khối máy (ảnh `_hz-fc-tatca-b-zoom.png`).
 *   Đây chính là hazard đã LOẠI ứng viên (C) của PH-51 (lưới `depthTest:false`
 *   vẽ đè khối máy) — ở đây nó không xảy ra vì thứ bị tắt là **sàn**, không phải
 *   lưới: lưới vẫn so độ sâu, nên máy vẫn che được lưới.
 *
 * ⚠ Khe hở 2 cm GIỮ NGUYÊN — hàng rào thứ hai, không phải bản thay thế.
 *
 * Lưới: `zFightingSanNhaMay.unit.test.ts`.
 */
/** Bước lưới gốc của màn (m) — SÀN của PH-54, bản vá chỉ làm THƯA hơn số này. */
const CELL_SIZE_GOC = 2;
/** Tỉ lệ `sectionSize / cellSize` — GIỮ NGUYÊN tỉ lệ 10/2 của bản đang chạy. */
const HE_SO_SECTION = 5;

const SAN_GHI_DO_SAU = false;

/**
 * ★ EXPORT cho LƯỚI: `chonNhatQuanChiHuy.dom.test.tsx` phải dựng **đúng cây này**
 *   dưới một gốc R3F có `gl` giả (jsdom không có WebGL, nên `<KhungCanh>` — tức
 *   `<Canvas>` thật — không dựng được). Dựng lại một bản chép trong lưới sẽ đo bản
 *   chép, không đo sản phẩm; đó là lý do export thay vì nhân bản.
 */
export function NoiDungCanh({
  machines,
  selectedId,
  onSelect,
  overlay,
  focusId,
  theme,
  nhanTrangThai,
}: Omit<Required<Omit<FactorySceneProps, "className">>, "onSelect"> & {
  /** ★ PH-42 — RỘNG HƠN `FactorySceneProps.onSelect`; lý do ở {@link CanhNhaMayProps}. */
  onSelect: (id: number | null) => void;
  nhanTrangThai: (m: PlacedMachine) => string;
}) {
  const palette = scenePalette(theme);
  const invalidate = useThree((s) => s.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const [chon, setChon] = useState<TrangThaiChon>(TRANG_THAI_CHON_RONG);
  const [zoomGan, setZoomGan] = useState(false);
  const [chiHopBao, setChiHopBao] = useState(false);
  const [coNhan, setCoNhan] = useState(true);

  const layout = useMemo(() => resolveLayout(machines), [machines]);

  // Đồng bộ DOM → 3D: `selectedId` do trang sở hữu; trạng thái chọn nội bộ chỉ
  // theo đuôi. Đây là chiều thứ hai của "đồng bộ hai chiều" (chonVatThe.ts).
  useEffect(() => {
    setChon((tt) => (tt.dangChon === selectedId ? tt : { ...tt, dangChon: selectedId }));
  }, [selectedId]);

  useEffect(() => {
    invalidate();
  }, [theme, overlay, selectedId, chiHopBao, coNhan, invalidate]);

  /**
   * ── HÌNH HỌC TĨNH ── phụ thuộc bố cục, KHÔNG phụ thuộc màu (§6.2).
   * `hinhKhoiCho()` của Đợt 2 ánh xạ mọi `machineType` sang một trong 7 khối và
   * không bao giờ trả `undefined`.
   */
  const hinhHocMay = useMemo(
    () =>
      layout.placed.map((p) => ({
        machineId: p.node.id,
        khoi: hinhKhoiCho(p.node.machineType),
        // `resolveLayout` đã trả kích thước MÉT; `hinhHocKhoi` nhận mm.
        kichThuocMm: { rongMm: p.w * 1000, caoMm: p.h * 1000, sauMm: p.d * 1000 },
        viTri: { x: p.x, y: p.y, z: p.z },
        gocXoayRad: p.node.rotation || 0,
      })),
    [layout],
  );

  /** ── TRẠNG THÁI ĐỘNG ── chỉ màu, ghép lên hình học tĩnh ở trên. */
  const may = useMemo<MayTrongLo[]>(
    () =>
      hinhHocMay.map((h, i) => ({
        ...h,
        mau: overlayColorHex(layout.placed[i].node, overlay),
      })),
    [hinhHocMay, layout, overlay],
  );

  const byId = layout.byId;

  /**
   * ── BA BỀ MẶT CHỌN, MỖI BỀ MẶT MỘT BIỂU THỨC CÓ TÊN ──
   * Đặt tên để `<VienChon>`, `<LopNhan>` và `window.__demChonChiHuy` dùng CHUNG một
   * giá trị. Trước đây hai chỗ vẽ đọc thẳng `selectedId` ở hai nơi khác nhau nên
   * không ai đối chiếu được chúng với `chon.dangChon` (nhấn sáng) — xem PH-42.
   */
  const mayDangChon = selectedId != null ? (byId.get(selectedId) ?? null) : null;
  const idVien = mayDangChon?.node.id ?? null;
  const idChoNhan = selectedId;

  useEffect(() => {
    if (typeof window === "undefined" || !laCheDoDo()) return;
    const w = window as CuaSoDoChonChiHuy;
    w.__demChonChiHuy = () => ({
      trang: selectedId,
      nhanSang: chon.dangChon,
      vien: idVien,
      nhan: idChoNhan,
    });
    return () => {
      delete w.__demChonChiHuy;
    };
  }, [selectedId, chon.dangChon, idVien, idChoNhan]);

  /**
   * Tập nhãn: giữ NGUYÊN luật của màn cũ (chọn ∪ hover ∪ andon ∪ pdm, hoặc TẤT CẢ
   * khi zoom gần) rồi để `locNhan.ts` cắt xuống 30.
   *
   * ★ ĐỐI CHỨNG với màn cũ, khai theo cái ĐO ĐƯỢC chứ không theo ý định:
   * `client/src/components/factory-scene/FactoryScene3D.tsx:257` (engine cũ) chỉ
   * `.slice(0, 60)` — KHÔNG khử chồng
   * lấp gì cả. Kit này khử chồng lấp bằng bbox thật (`locNhan.ts`), nên nhãn
   * không đè lên nhau nữa: đó là điểm HƠN, đo được bằng `__demNhan.capConChong`.
   * Đổi lại kit này chỉ vẽ tối đa 30 nhãn thay vì 60 — với người dùng cần đọc
   * nhiều mã máy cùng lúc thì đó là điểm KÉM hơn. Hai chiều, không phải "tốt hơn"
   * một chiều.
   *
   * ⚠ Bản khai TRƯỚC ở đây viết "đây là điểm kit mới TỐT HƠN, không phải khác đi"
   * trong khi khử chồng lấp lúc đó dùng mô hình ĐƯỜNG TRÒN bán kính 42px và QA đo
   * được 5 cặp nhãn vẫn chồng nhau thật (chồng ngang tới 66px). Lời khai đó sai
   * tại thời điểm viết; nay mô hình đã sửa thành bbox nên nó ĐÚNG với phần khử
   * chồng lấp — nhưng vẫn phải nói kèm cái đánh đổi 60→30.
   */
  const nhan = useMemo<NhanTheGioi[]>(() => {
    const canHien = (p: PlacedMachine) =>
      zoomGan ||
      p.node.id === selectedId ||
      p.node.id === chon.dangHover ||
      p.node.andonActive ||
      p.node.pdmRiskHigh;

    return layout.placed.filter(canHien).map((p) => ({
      khoa: `may:${p.node.id}`,
      machineId: p.node.id,
      viTri: { x: p.x, y: p.y + p.h + 0.45, z: p.z },
      ma: p.node.code,
      phu: nhanTrangThai(p),
      batThuong: p.node.andonActive || p.node.status === "down",
    }));
  }, [layout, zoomGan, selectedId, chon.dangHover, nhanTrangThai]);

  /**
   * Con trỏ pointer khi rê lên máy — hành vi màn cũ.
   *
   * ★★★ ĐỢT 50 MỤC D — CHỖ LỆCH VỚI `CanhVanHanh.tsx:544` ĐƯỢC GHI RA, KHÔNG ĐƯỢC VÁ.
   * ══════════════════════════════════════════════════════════════════════════
   * Ở ĐÂY  : không rê ⇒ `cursor = "grab"` (và KHÔNG có hàm dọn khi unmount).
   * Bên kia : không rê ⇒ `cursor = ""` (trả về mặc định), có `return () => …` dọn.
   *
   * VÌ SAO KHÔNG ĐỔI (đo lại 2026-09-12, không chép lời khai Đợt 49 — G83):
   *   `grep -rn "CanhNhaMay" client/src` ⇒ NGƯỜI GỌI DUY NHẤT là
   *   `client/src/pages/FactoryCommandView.tsx:518` (`/factory-command`) — một
   *   trong 5 MÀN CŨ mà mọi đợt Twin đều bị cấm sửa hành vi. Đổi `"grab"` → `""`
   *   ở đây là đổi cảm giác kéo-xoay của màn ấy, và KHÔNG CÓ PHÉP ĐO NÀO nói
   *   bên nào đúng: e2e `T1b`/`K7e` chỉ canh "rời máy ⇒ KHÔNG `pointer`", mà
   *   `"grab"` cũng không phải `pointer` ⇒ lưới XANH cho CẢ HAI giá trị (lưới
   *   KHÔNG canh được hướng này — đó là lý do chỗ lệch sống sót 50 đợt).
   *
   * ⇒ Điều kiện để hợp nhất: có phép đo nói `/factory-command` muốn con trỏ nào,
   *   HOẶC màn ấy được đưa vào phạm vi sửa. Chưa có ⇒ ghi lệch, giữ nguyên.
   */
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.cursor = chon.dangHover != null ? "pointer" : "grab";
  }, [chon.dangHover, gl]);

  const banKinh = layout.radius;

  /**
   * ★★★ PH-54 — `cellSize` THÔI LÀ HẰNG 2 MÉT.
   *
   * Đây là màn TỆ NHẤT trong năm màn, và tệ vì một lý do khác hai màn `/twin`:
   * ở kia số ô ít nhất còn đi theo cỡ sàn, còn ở đây `cellSize` là HẰNG 2 m bất
   * kể cảnh rộng bao nhiêu hay camera đứng đâu. Đo sống trên `ca088198`:
   * tập đoàn **1,07 px** một ô (đường `section` 10 m cũng chỉ 5,33 px), một nhà
   * máy 2,94 px, và ở trần zoom xa còn tụt xuống **0,62 px**.
   *
   * ⚠ ĐỔI Ở ĐÂY LÀ MIỄN PHÍ VỀ HÌNH HỌC, và đó là lý do chọn đúng hai prop này:
   *   drei `<Grid>` là MỘT `planeGeometry` (2 tam giác) với lưới vẽ trong
   *   fragment shader — `cellSize`/`sectionSize` là UNIFORM. Đổi chúng không
   *   thêm một đỉnh, một tam giác hay một lệnh vẽ nào. `args`, `infiniteGrid`
   *   và `fadeDistance` — tức HÌNH HỌC của tấm lưới — GIỮ NGUYÊN không chạm,
   *   vì chính hình học ấy là thứ PH-53 đã buộc vào `near` (ở `near` = 0,1 lưới
   *   tập-đoàn-xiên BIẾN MẤT; `near` đang giao là 0,41 do `catCanh.ts` tính).
   *   Bản vá này không được phép mở lại cánh cửa đó.
   */
  const buocLuoi = useBuocLuoi(CELL_SIZE_GOC, { heSoSection: HE_SO_SECTION });

  /**
   * ★★★ `useCallback` BẮT BUỘC, không phải làm đẹp.
   *
   * `DieuKhien` liệt kê `onDoiKhoangCach` trong deps của `useEffect` dựng
   * `OrbitControls`. Truyền arrow function inline thì MỌI re-render của
   * `NoiDungCanh` (đổi lớp phủ, hover một máy, dữ liệu trạng thái về) sinh một
   * hàm mới ⇒ deps đổi ⇒ effect chạy lại ⇒ `controls.dispose()` rồi `new
   * OrbitControls(...)`.
   *
   * Đo được ở lần đổi lớp phủ: listener `pointerdown`/`wheel`/`contextmenu` mỗi
   * loại +1 gắn, +2 gỡ. Số GỠ ≥ số GẮN nên KHÔNG rò listener, và vị trí camera
   * giữ nguyên — nên đây không phải lỗi chặn. Hậu quả thật là **mất quán tính
   * damping đang trôi** (camera đang trượt mượt thì khựng lại giữa chừng khi
   * người dùng bấm nút lớp phủ) cộng cấp phát thừa mỗi lần.
   *
   * `banKinh` KHÔNG nằm trong deps của callback này dù thân hàm dùng nó: nó là
   * `layout.radius`, đổi khi bố cục đổi — và khi bố cục đổi thì dựng lại controls
   * là ĐÚNG (`maxDistance` phụ thuộc `banKinh`). `DieuKhien` đã có `banKinh`
   * trong deps riêng nên hành vi đó được giữ; thêm vào đây chỉ nhân đôi lý do.
   */
  const doiKhoangCach = useCallback(
    (d: number) => {
      const gan = d < Math.max(10, banKinh * 0.8);
      setZoomGan((truoc) => (truoc === gan ? truoc : gan));
    },
    [banKinh],
  );

  /**
   * Cùng lý do: `TheoDoiFps` cũng nhận hàm này qua deps của effect. Hai `set*`
   * đều là setter của `useState` — React đảm bảo chúng ỔN ĐỊNH giữa các render,
   * nên deps rỗng là đúng chứ không phải bỏ sót.
   */
  const doiBac = useCallback((hop: boolean, nhanBat: boolean) => {
    setChiHopBao(hop);
    setCoNhan(nhanBat);
  }, []);

  /**
   * ★★★ PH-42 — MỘT CÚ BẤM, **MỘT** QUYẾT ĐỊNH, BÁO CHO CẢ CẢNH LẪN TRANG.
   *
   * Cách nối CŨ tách quyết định làm hai nửa và hai nửa ấy không đồng ý với nhau:
   *
   *     setChon((tt) => apClick(tt, id));   // cảnh: có thể về `null`
   *     if (id != null) onSelect(id);        // trang: KHÔNG BAO GIỜ nhận `null`
   *
   * `apClick` trả `dangChon: null` ở HAI nhánh — bấm nền (`chonVatThe.ts:77`) và bấm
   * LẠI đúng máy đang chọn (`:78`). Nhánh đầu bị chặn bởi `id != null`; nhánh sau còn
   * tệ hơn vì `onSelect(id)` gửi lên trang **chính id vừa bị bỏ chọn**. Hậu quả: nhấn
   * sáng tắt trong khi `selectedId` giữ nguyên, mà `<VienChon>` + `<LopNhan>` + ngăn
   * chi tiết của trang đều đọc `selectedId` ⇒ bốn bề mặt nói một đằng, lô máy nói một
   * nẻo (đo được: `{trang:202, nhanSang:null, vien:202, nhan:202}`).
   *
   * Nay `apClick` được gọi ĐÚNG MỘT LẦN và kết quả của nó đi cả hai đường. Luật
   * chọn/bỏ chọn vẫn nằm nguyên trong `chonVatThe.ts` — ở đây không có bản sao nào
   * của luật ấy để trôi khỏi nhau.
   *
   * ⚠ Đọc `chon` của vòng render hiện tại (không dùng dạng cập nhật hàm) là CỐ Ý:
   *   giá trị báo lên trang phải là CHÍNH giá trị đặt vào state, mà một updater chạy
   *   trễ thì không trả được gì ra ngoài. An toàn vì `onHover` đi từ sự kiện `pointer
   *   move` — một sự kiện rời, React đã flush xong trước khi cú `click` chạy — nên
   *   `chon` trong closure luôn là bản mới nhất; ca N3 canh đúng chỗ này (chọn máy
   *   khác sau khi đã hover/chọn máy cũ).
   */
  const khiChonTrenCanh = useCallback(
    (id: number | null) => {
      const sau = apClick(chon, id);
      setChon(sau);
      onSelect(sau.dangChon);
    },
    [chon, onSelect],
  );

  return (
    <>
      <fog attach="fog" args={[palette.fog, banKinh * 2.4, banKinh * 6]} />

      {/* Sàn + lưới — giữ nguyên diện mạo màn cũ. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[banKinh * 8, banKinh * 8]} />
        <meshStandardMaterial
          color={palette.floor}
          roughness={1}
          metalness={0}
          depthWrite={SAN_GHI_DO_SAU}
        />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[banKinh * 4, banKinh * 4]}
        cellSize={buocLuoi}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={buocLuoi * HE_SO_SECTION}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={banKinh * 5}
        fadeStrength={1.2}
        infiniteGrid
      />

      {/* ★ TOÀN BỘ máy trong MỘT BatchedMesh = 1 draw call. */}
      <LoBatchMay
        may={may}
        chon={chon}
        chiHopBao={chiHopBao}
        onChon={khiChonTrenCanh}
        onHover={(id) => setChon((tt) => apHover(tt, id))}
      />

      <VienChon may={mayDangChon} />
      <LopNhan nhan={nhan} dangChon={idChoNhan} dangHover={chon.dangHover} tat={!coNhan} />

      <DieuKhien banKinh={banKinh} controlsRef={controlsRef} onDoiKhoangCach={doiKhoangCach} />
      <BayToi byId={byId} focusId={focusId} controlsRef={controlsRef} />
      <TheoDoiFps onDoiBac={doiBac} />
    </>
  );
}

/* ═════════════════════════════════════════════════════════════════════════ */
/* Component xuất khẩu — CÙNG chữ ký `FactorySceneProps`                     */
/* ═════════════════════════════════════════════════════════════════════════ */

export interface CanhNhaMayProps extends Omit<FactorySceneProps, "onSelect"> {
  /**
   * ★★★ PH-42 — RỘNG HƠN `FactorySceneProps.onSelect` MỘT CÁCH CÓ CHỦ Ý: `null` nghĩa là
   * **không còn máy nào được chọn**.
   *
   * Hợp đồng chung `(id: number) => void` không có từ nào để nói "bỏ chọn", trong khi
   * `apClick` của kit BỎ CHỌN ở hai nhánh (bấm nền, bấm lại máy đang chọn). Thiếu từ ấy,
   * cảnh buộc phải nuốt quyết định của chính mình và màn hình tự mâu thuẫn — xem
   * docblock `khiChonTrenCanh`.
   *
   * ⚠ Chỉ nới ở ĐÂY, không nới `sceneTypes.FactorySceneProps`: `FactoryScene2D` dùng
   *   chung hợp đồng ấy và không nằm trong phạm vi đợt này. Một hàm `(id: number | null)
   *   => void` vẫn gán được vào chỗ đòi `(id: number) => void`, nên trang dùng CÙNG một
   *   `selectMachine` cho cả 2D lẫn 3D — không sinh hai đường xử lý.
   */
  onSelect: (id: number | null) => void;
  /** Nhãn trạng thái đã qua `t()` — trang truyền vào để chuỗi không bị cứng ở đây. */
  nhanTrangThai?: (status: string) => string;
  /** Chữ khi mất WebGL context, đã qua `t()` (`twin3d.loi.matContext`). */
  chuMatContext?: string;
}

export function CanhNhaMay(props: CanhNhaMayProps) {
  const themeCtx = useOptionalTheme();
  const theme = props.theme ?? themeCtx;
  const palette = scenePalette(theme);

  const banKinh = useMemo(() => resolveLayout(props.machines).radius, [props.machines]);
  const camStart = banKinh * 1.8;

  const nhanTrangThai = props.nhanTrangThai;
  const nhanCho = useMemo(
    () => (p: PlacedMachine) => (nhanTrangThai ? nhanTrangThai(p.node.status) : p.node.status),
    [nhanTrangThai],
  );

  return (
    <KhungCanh
      className={props.className}
      viTriCamera={[camStart, camStart * 0.8, camStart]}
      mauNen={palette.background}
      far={Math.max(2000, banKinh * 20)}
      cuongDoBanCau={theme === "dark" ? 0.9 : 1.1}
      cuongDoHuong={theme === "dark" ? 1.0 : 1.3}
      viTriDenHuong={[banKinh, banKinh * 1.4, banKinh * 0.6]}
      chuMatContext={props.chuMatContext}
      data-testid="khoi-canh-3d"
    >
      <NoiDungCanh
        machines={props.machines}
        selectedId={props.selectedId}
        onSelect={props.onSelect}
        overlay={props.overlay}
        focusId={props.focusId}
        theme={theme}
        nhanTrangThai={nhanCho}
      />
    </KhungCanh>
  );
}

export default CanhNhaMay;
