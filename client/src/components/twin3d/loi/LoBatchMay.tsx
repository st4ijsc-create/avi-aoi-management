/**
 * LoBatchMay.tsx — vẽ TOÀN BỘ máy bằng MỘT `THREE.BatchedMesh` = 1 draw call.
 *
 * Vì sao `BatchedMesh` chứ không `InstancedMesh` (§4 kỹ thuật 2): `InstancedMesh`
 * dùng ĐÚNG MỘT geometry cho mọi instance, nên 7 khối máy khác nhau cần 7
 * InstancedMesh = 7 draw call, và nếu chia nhỏ theo LOD thì thành 21.
 * `BatchedMesh` render nhiều object **cùng material nhưng KHÁC hình học** trong
 * một draw call, `perObjectFrustumCulled` mặc định `true`, và **giữ ID từng
 * object** nên click vào máy vẫn hoạt động. Đã kiểm chứng có sẵn trong three
 * r182 tại `node_modules/three/src/objects/BatchedMesh.js`.
 *
 * ★ Bẫy đã kiểm chứng trong mã nguồn three: raycast của `BatchedMesh` gán
 * `intersect.batchId`, **KHÔNG** gán `instanceId` (r182 dòng 1415). R3F trải
 * nguyên `...hit` vào event nên `batchId` có mặt, nhưng KHÔNG có trong kiểu
 * `ThreeEvent`. Đọc nhầm `e.instanceId` cho ra `undefined` với MỌI cú click —
 * và vì không ai ném lỗi, biểu hiện duy nhất là "click vào máy không có gì xảy ra".
 *
 * Bất biến §6.2: **hình học tĩnh tách hẳn khỏi trạng thái động.** Cập nhật
 * realtime CHỈ được chạm `setColorAt`/`setVisibleAt`; không bao giờ dựng lại
 * BatchedMesh vì một cập nhật trạng thái.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 47 (N2) — HANDLER Ở `<group>` BỌC NGOÀI, KHÔNG Ở `<primitive>`
 * ════════════════════════════════════════════════════════════════════════════
 * Đọc từ bundle R3F 9.5.0 (`dist/events-5a94e5eb.esm.js`, `swapInstances`
 * :15200-15260 và `applyProps` :446-453): khi `<primitive object>` ĐỔI object
 * (lô mới vì `may` đổi — ít nhất một lần ở mọi màn: lô RỖNG lúc chưa có dữ
 * liệu → lô có máy), R3F
 *   (1) `remove` object cũ khỏi scene và `delete object.__r3f` — nhưng KHÔNG gọi
 *       `removeInteractivity` ⇒ object cũ NẰM LẠI trong `internal.interaction`
 *       với `__r3f` rỗng (mọi raycast trúng nó đều bị bỏ vì `eventCount` = 0);
 *   (2) TÁI DÙNG instance descriptor (đã có `eventCount = 3`) cho object mới rồi
 *       `applyProps` ⇒ `prevHandlers === instance.eventCount` ⇒ object mới KHÔNG
 *       BAO GIỜ được đẩy vào `interaction`.
 * Đo được ở HEAD trước vá (`.qa-dot47/probe/bam47-HEAD.json`, đọc store R3F
 * thật): `interaction = [1 lô, handlers = [], 0 instance, không trong scene]`;
 * lô 43 máy đang vẽ KHÔNG có trong danh sách ⇒ bấm/rê máy trên `/twin` và
 * `/twin/line/2` chết im lặng suốt 46 đợt. `/factory-command` sống chỉ vì lô
 * đầu tiên của nó đã đủ máy (không swap) — cùng kit, khác vận may.
 *
 * ⇒ Handler đặt trên MỘT `<group>` KHÔNG BAO GIỜ ĐỔI; `<primitive>` bên trong
 *   đổi object thoải mái. R3F raycast `intersectObject(group, true)` xuống
 *   BatchedMesh con và nổi bọt sự kiện lên group (`intersect` :590-600) —
 *   `batchId` giữ nguyên trên event. Lưới `loBatchMay.dom.test.tsx` dựng
 *   reconciler R3F THẬT trong jsdom (gl giả, không WebGL) để ghim đúng cơ chế
 *   này: đổi lô ⇒ handler vẫn tới, và đối chứng "handler trên primitive" chết.
 *
 * ★ BẤM ≠ KÉO: `onClick` chỉ chọn khi `laBam({ lechPx: e.delta, ms })` — xem
 *   `phanBietBamKeo.ts`. Trước đó, xoay camera rồi nhả chuột trên máy = chọn máy.
 */

import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { hinhHocKhoi, type KhoiKey, type KichThuocMm } from "../hinhKhoiMay";
import { hinhHocDonViTuMoTa, maTranDatMay, demDinhVaChiSo } from "./hinhHocTuMoTa";
import { dungBangTra, mucNhanSang, type BangTraLo, type TrangThaiChon } from "./chonVatThe";
import { laBam } from "./phanBietBamKeo";
import { laCheDoDo } from "./cheDoDo";
import type { CuaSoDoTwin3d } from "./KhungCanh";

/** Một máy sẵn sàng để vẽ. Toạ độ đã ở hệ SCENE (mét) — quy đổi ở `heToaDo.ts`. */
export interface MayTrongLo {
  /** id máy trong DB — cái mà DOM biết. KHÔNG phải chỉ số instance. */
  machineId: number;
  khoi: KhoiKey;
  kichThuocMm: KichThuocMm;
  /** Vị trí ĐÁY máy trên sàn, mét. */
  viTri: { x: number; y: number; z: number };
  /** Góc xoay quanh trục đứng, radian. */
  gocXoayRad: number;
  /** Màu đã phân giải sang chuỗi CSS dùng được (`giaiMauCanh()` của mauTrangThai). */
  mau: string;
  /** Độ mờ 0–1 từ `mauTrangThai.ts` — hiện tại dùng để làm nhạt màu, xem docblock. */
  doMo?: number;
  /** false = ẩn (ngoài phạm vi đang chọn). Mặc định hiện. */
  hien?: boolean;
}

export interface LoBatchMayProps {
  may: MayTrongLo[];
  chon: TrangThaiChon;
  onChon: (machineId: number | null) => void;
  onHover: (machineId: number | null) => void;
  /** Bậc `chi_hop` của matDoKhungHinh → vẽ hộp bao trần thay vì khối chi tiết. */
  chiHopBao?: boolean;
  /** Nhận tham chiếu bảng tra để lớp nhãn / e2e dùng chung. */
  onBangTra?: (bang: BangTraLo) => void;
}

const TRANG = new THREE.Color("#ffffff");

/** Tên lô — `window.__demTuongTac`/e2e tìm BatchedMesh theo tên này. */
export const TEN_LO_MAY = "twin3d-lo-may";
/** Tên nhóm bọc mang handler (Đợt 47) — object DUY NHẤT của lớp này nằm trong `internal.interaction`. */
export const TEN_NHOM_SU_KIEN_LO_MAY = "twin3d-lo-may-su-kien";

/**
 * Ngân sách cấp phát. `BatchedMesh` cấp buffer CỐ ĐỊNH lúc dựng và ném khi tràn,
 * nên ta cộng thật số đỉnh/chỉ số của 7 geometry rồi mới dựng — không đoán.
 * Đệm 20 % cho phép đổi LOD tại chỗ mà không phải cấp phát lại.
 */
const DEM_DU_PHONG = 1.2;

export function LoBatchMay({
  may,
  chon,
  onChon,
  onHover,
  chiHopBao = false,
  onBangTra,
}: LoBatchMayProps) {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const meshRef = useRef<THREE.BatchedMesh | null>(null);

  // ── Bảng tra instanceId ↔ machineId. Dựng từ CÙNG mảng, CÙNG useMemo với lô. ──
  const bangTra = useMemo(() => dungBangTra(may.map((m) => m.machineId)), [may]);

  /**
   * ════════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 49 (mục B) — KHOÁ HÌNH HỌC: dựng lại lô khi HÌNH/VỊ TRÍ đổi, KHÔNG khi MÀU đổi
   * ════════════════════════════════════════════════════════════════════════════
   * `loMoi` phụ thuộc `[may]` — mà `may` là mảng MỚI mỗi khi trạng thái máy về (`mau`, `doMo`,
   * `hien` đổi theo realtime). Bất biến §6.2 ghi rõ *"cập nhật realtime CHỈ được chạm
   * `setColorAt`/`setVisibleAt`; không bao giờ dựng lại BatchedMesh vì một cập nhật trạng thái"*
   * — nhưng deps `[may]` cưỡng chế ĐÚNG điều ngược lại: một gói ws đổi màu một máy ⇒ cấp phát
   * lại buffer 43 máy, `addGeometry` lại 7 hình, `dispose` lô cũ. Docblock nói một đằng, deps
   * làm một nẻo suốt 48 đợt.
   *
   * Khoá này là mô tả của thứ `loMoi` THẬT SỰ đọc: khối + kích thước + vị trí + góc xoay + cờ
   * `chiHopBao`. Đổi màu/độ mờ/ẩn-hiện ⇒ khoá KHÔNG đổi ⇒ giữ nguyên lô, chỉ `setColorAt`.
   * Đổi tập máy hoặc bố cục ⇒ khoá đổi ⇒ dựng lại, đúng như trước.
   *
   * ⚠ KHÔNG khoá bằng `JSON.stringify(may)`: `mau` nằm trong đó. Liệt kê trường là cách duy
   *   nhất nói được "cái gì làm hình đổi" — và nếu mai thêm trường hình học mà quên thêm vào
   *   đây thì lô không dựng lại; lưới `loBatchMay.hinhHoc.unit.test.ts` ghim cả hai chiều.
   */
  const khoaHinhHocLo = useMemo(
    () =>
      `${chiHopBao ? "hop" : "chitiet"}|` +
      may
        .map(
          (m) =>
            `${m.machineId}:${m.khoi}:${Math.round(m.kichThuocMm.rongMm)}x${Math.round(m.kichThuocMm.caoMm)}x${Math.round(m.kichThuocMm.sauMm)}` +
            `@${m.viTri.x.toFixed(3)},${m.viTri.y.toFixed(3)},${m.viTri.z.toFixed(3)}~${m.gocXoayRad.toFixed(4)}`,
        )
        .join("|"),
    [may, chiHopBao],
  );
  /**
   * Bản chụp `may` tại lần dựng lô gần nhất. `loMoi` đọc mảng này, KHÔNG đọc `may` trực tiếp —
   * nếu đọc `may` thì eslint đúng khi đòi `may` vào deps và ta quay lại chỗ cũ. Ghi TRONG
   * `useMemo` của khoá (chạy trước `loMoi` trong cùng render) nên `loMoi` luôn thấy bản khớp khoá.
   */
  const mayHinhHocRef = useRef<MayTrongLo[]>(may);
  const khoaDaDungRef = useRef<string | null>(null);
  if (khoaDaDungRef.current !== khoaHinhHocLo) {
    khoaDaDungRef.current = khoaHinhHocLo;
    mayHinhHocRef.current = may;
  }

  useEffect(() => {
    onBangTra?.(bangTra);
  }, [bangTra, onBangTra]);

  /**
   * ── HÌNH HỌC TĨNH ──
   * Phụ thuộc: danh sách khối + kích thước (hình dạng), KHÔNG phụ thuộc màu.
   * Đây chính là chỗ cưỡng chế bất biến §6.2: đổi trạng thái không đụng useMemo này.
   */
  const loMoi = useMemo(() => {
    // ★ Đợt 49 (B) — đọc BẢN CHỤP khớp `khoaHinhHocLo`, không đọc `may` (xem docblock khoá).
    const may = mayHinhHocRef.current;
    // Khoá geometry = khối + kích thước làm tròn mm. Hai máy AOI cùng số đo dùng
    // CHUNG một geometryId; khác số đo thì tách — đúng ý "AOI 1400 và AOI 2200
    // nhìn khác nhau ngay" của hinhKhoiMay.ts.
    const khoaHinh = (m: MayTrongLo) =>
      chiHopBao
        ? "hop"
        : `${m.khoi}|${Math.round(m.kichThuocMm.rongMm)}x${Math.round(m.kichThuocMm.caoMm)}x${Math.round(m.kichThuocMm.sauMm)}`;

    const hinhTheoKhoa = new Map<string, THREE.BufferGeometry>();
    for (const m of may) {
      const k = khoaHinh(m);
      if (hinhTheoKhoa.has(k)) continue;
      hinhTheoKhoa.set(
        k,
        chiHopBao
          ? (() => {
              const g = new THREE.BoxGeometry(1, 1, 1);
              const n = g.getAttribute("position").count;
              g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
              return g;
            })()
          : hinhHocDonViTuMoTa(hinhKhoiKhongLoi(m)),
      );
    }

    let tongDinh = 0;
    let tongChiSo = 0;
    for (const g of hinhTheoKhoa.values()) {
      const d = demDinhVaChiSo(g);
      tongDinh += d.dinh;
      tongChiSo += d.chiSo;
    }

    const soMay = Math.max(1, may.length);
    const mesh = new THREE.BatchedMesh(
      Math.ceil(soMay * DEM_DU_PHONG),
      Math.ceil(Math.max(1, tongDinh) * DEM_DU_PHONG),
      Math.ceil(Math.max(1, tongChiSo) * DEM_DU_PHONG),
      new THREE.MeshStandardMaterial({
        // Màu trắng + vertexColors: màu thật đến từ `setColorAt` per-instance,
        // nhân với hệ số sáng vai trò hộp nằm trong vertex color của geometry.
        color: "#ffffff",
        vertexColors: true,
        metalness: 0.12,
        roughness: 0.68,
      }),
    );
    mesh.name = TEN_LO_MAY;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = false; // vật liệu đục — không cần sắp theo chiều sâu

    const geoIdTheoKhoa = new Map<string, number>();
    for (const [k, g] of hinhTheoKhoa) {
      geoIdTheoKhoa.set(k, mesh.addGeometry(g));
      // BatchedMesh đã SAO CHÉP dữ liệu vào buffer chung; bản gốc không còn cần.
      g.dispose();
    }

    const mt = new THREE.Matrix4();
    const tam = new THREE.Object3D();
    for (const m of may) {
      const geoId = geoIdTheoKhoa.get(khoaHinh(m));
      if (geoId === undefined) continue;
      const id = mesh.addInstance(geoId);
      const met = {
        rong: m.kichThuocMm.rongMm / 1000,
        cao: m.kichThuocMm.caoMm / 1000,
        sau: m.kichThuocMm.sauMm / 1000,
      };
      mesh.setMatrixAt(id, maTranDatMay(mt, m.viTri, met, m.gocXoayRad, tam));
    }
    mesh.computeBoundingSphere();
    return mesh;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ★ Đợt 49 (B): `may` CỐ Ý không ở deps;
    // `khoaHinhHocLo` là mô tả đầy đủ phần `may` mà khối này đọc (hình/kích thước/vị trí/góc).
  }, [khoaHinhHocLo, chiHopBao]);

  // Gắn ref + RB-7: giải phóng lô CŨ khi useMemo sinh lô mới hoặc khi unmount.
  useEffect(() => {
    meshRef.current = loMoi;
    /**
     * ★ Đợt 49 (mục B) — ĐẾM SỐ LẦN DỰNG LÔ. Không có con số này thì "đã tách hình khỏi màu"
     * là một lời khai: bất biến §6.2 đã viết trong docblock từ Đợt 5 mà deps vẫn dựng lại mỗi
     * gói ws, và 2.424 lưới không ai kêu. Đếm ở SẢN PHẨM (không gác `laCheDoDo`) vì nó là một
     * phép cộng số nguyên mỗi lần dựng — rẻ hơn chính việc dựng nhiều bậc.
     */
    if (typeof window !== "undefined") {
      const w = window as Window & CuaSoDoTwin3d;
      const cua = w.__demTuongTac ?? (w.__demTuongTac = {});
      cua.soLanDungLo = (cua.soLanDungLo ?? 0) + 1;
    }
    invalidate();
    return () => {
      // `BatchedMesh.dispose()` trả buffer chung; material và geometry gộp phải
      // dispose tay — three không đi tìm chúng hộ ta (RB-7).
      loMoi.dispose();
      loMoi.geometry.dispose();
      const mat = loMoi.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    };
  }, [loMoi, invalidate]);

  /**
   * ── TRẠNG THÁI ĐỘNG ──
   * Chỉ `setColorAt` + `setVisibleAt`. KHÔNG dựng lại geometry (§6.2).
   */
  useLayoutEffect(() => {
    const mesh = loMoi;
    const c = new THREE.Color();
    may.forEach((m, i) => {
      c.set(m.mau || "#808080");
      // `doMo` của mauTrangThai.ts nghĩa là "vật thể mờ đi". Vật liệu đục dùng
      // chung cho cả lô nên KHÔNG bật `transparent` được (một cờ, cả lô mờ theo).
      // Ta chuyển độ mờ thành pha về màu nền xưởng — đọc y hệt trên nền tối/sáng,
      // và giữ nguyên 1 draw call. Đây là đánh đổi có ý thức, không phải bỏ sót.
      if (m.doMo !== undefined && m.doMo < 1) c.multiplyScalar(0.35 + 0.65 * m.doMo);
      const nhan = mucNhanSang(m.machineId, chon);
      if (nhan > 0) c.lerp(TRANG, nhan);
      mesh.setColorAt(i, c);
      mesh.setVisibleAt(i, m.hien !== false);
    });
    invalidate();
  }, [loMoi, may, chon, invalidate]);

  /**
   * ★ Đợt 47 (A.2) — cửa sổ đo `__demTuongTac.tamMay/dsMay`: tâm KHỐI máy (bbox hình
   *   học × ma trận instance) chiếu ra px canvas. e2e bấm vào đúng điểm này — không
   *   bấm nhãn (nhãn neo trên nóc + 0,45 m, có thể trượt khỏi hình học). Chỉ gắn ở chế
   *   độ đo; tính lúc GỌI theo camera hiện tại.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !laCheDoDo()) return;
    const w = window as Window & CuaSoDoTwin3d;
    const cua = w.__demTuongTac ?? (w.__demTuongTac = {});
    const hop = new THREE.Box3();
    const mt = new THREE.Matrix4();
    const tam = new THREE.Vector3();
    // ★ Đợt 49 (A) — `hitTai` của `KhungCanh` không biết bảng tra; nó hỏi qua hàm này.
    cua.mayTuBatch = (batchId: number) => bangTra.mayTheoInstance[batchId] ?? null;
    const chieu = (machineId: number) => {
      const i = bangTra.instanceTheoMay.get(machineId);
      if (i === undefined) return null;
      if (!loMoi.getBoundingBoxAt(loMoi.getGeometryIdAt(i), hop)) return null;
      hop.getCenter(tam);
      loMoi.getMatrixAt(i, mt);
      tam.applyMatrix4(mt).applyMatrix4(loMoi.matrixWorld).project(camera);
      const x = ((tam.x + 1) / 2) * size.width;
      const y = ((1 - tam.y) / 2) * size.height;
      const trongKhung = tam.z < 1 && x >= 0 && y >= 0 && x <= size.width && y <= size.height;
      return { x, y, ndcX: tam.x, ndcY: tam.y, trongKhung };
    };
    /**
     * ★★★ Đợt 49 (A) — `biChe`: TÂM khối chiếu ra px là điểm e2e bấm; nhưng tâm có thể bị máy
     * khác (hoặc chính lớp nhãn) chiếm. Raycast từ camera qua đúng NDC ấy: giao ĐẦU TIÊN không
     * phải máy này ⇒ trả id máy đang che. Đợt 48 chọn điểm bấm rồi mới phát hiện sai máy TỪ URL —
     * tức phép đo biết sau khi đã bấm; đây là biết TRƯỚC, nên e2e chọn được điểm hợp lệ.
     */
    cua.tamMay = (machineId) => {
      const c = chieu(machineId);
      if (!c) return null;
      const h = cua.hitTai?.(c.ndcX, c.ndcY) ?? null;
      const idTrung = h?.machineId ?? null;
      return { ...c, biChe: idTrung === null || idTrung === machineId ? null : idTrung };
    };
    cua.dsMay = () =>
      may.flatMap((m) => {
        const c = chieu(m.machineId);
        return c ? [{ machineId: m.machineId, x: c.x, y: c.y, trongKhung: c.trongKhung }] : [];
      });
    return () => {
      delete cua.tamMay;
      delete cua.dsMay;
      delete cua.mayTuBatch;
    };
  }, [loMoi, bangTra, may, camera, size]);

  const doiHover = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = docBatchId(e);
    onHover(id === null ? null : (bangTra.mayTheoInstance[id] ?? null));
  };

  /** Mốc pointerdown gần nhất — cùng với `e.delta` của R3F cho phép phân biệt bấm/kéo. */
  const tPointerDown = useRef(0);
  const khiPointerDown = () => {
    tPointerDown.current = typeof performance !== "undefined" ? performance.now() : Date.now();
  };
  const khiClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // ★ Đợt 47 — KÉO xoay camera rồi nhả trên máy KHÔNG phải bấm. `e.delta` = px từ pointerdown (R3F đo).
    const bayGio = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!laBam({ lechPx: e.delta, ms: bayGio - tPointerDown.current })) return;
    const id = docBatchId(e);
    onChon(id === null ? null : (bangTra.mayTheoInstance[id] ?? null));
  };
  const khiPointerOut = () => onHover(null);

  return (
    /*
     * ★★★ Đợt 47 — handler ở NHÓM BỌC ổn định (xem docblock đầu tệp). Đặt lại
     *   `onClick`… lên `<primitive>` là quay về lỗi câm: lô đổi ⇒ handler mất.
     */
    <group
      name={TEN_NHOM_SU_KIEN_LO_MAY}
      onClick={khiClick}
      onPointerDown={khiPointerDown}
      onPointerMove={doiHover}
      onPointerOut={khiPointerOut}
    >
      <primitive object={loMoi} />
    </group>
  );
}

/**
 * Đọc `batchId` khỏi event của R3F.
 *
 * ★ `batchId` KHÔNG có trong kiểu `ThreeEvent` (R3F chỉ khai `instanceId` cho
 * InstancedMesh), nhưng R3F trải `...hit` nguyên vẹn vào event object nên trường
 * này CÓ MẶT lúc chạy — đã đọc `events-5a94e5eb.esm.js` để xác nhận. Ép kiểu ở
 * đúng một chỗ, có chú thích, thay vì rắc `any` khắp nơi.
 */
function docBatchId(e: { batchId?: number; instanceId?: number | null }): number | null {
  if (typeof e.batchId === "number") return e.batchId;
  // Dự phòng: nếu three đổi tên trường ở bản sau, instanceId là ứng viên kế tiếp.
  if (typeof e.instanceId === "number") return e.instanceId;
  return null;
}

/** Mô tả khối, không bao giờ ném — kích thước rác đã được `hinhHocKhoi` kẹp. */
function hinhKhoiKhongLoi(m: MayTrongLo) {
  return hinhHocKhoi(m.khoi, m.kichThuocMm);
}

export default LoBatchMay;
