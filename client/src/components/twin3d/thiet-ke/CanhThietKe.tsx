/**
 * CanhThietKe.tsx — cảnh 3D của màn Thiết kế: canvas + lô máy + gizmo + ghost.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — CHỈ MỘT `<Canvas>` SỐNG
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này là nơi DUY NHẤT của màn Thiết kế dựng `<KhungCanh>` (và `KhungCanh` là
 * cửa duy nhất vào WebGL của kit). `DungNhaXuong`/`NhapBanVe` của Đợt 3 xem
 * trước bằng SVG chính vì bất biến này. `window.__soCanvas` phải luôn = 1 và
 * `KhungCanh` tự `console.error` khi > 1.
 *
 * ★ RB-3 — `taoDieuKhienQuay` nhận `invalidate` là tham số BẮT BUỘC nên quên nối
 *   là lỗi biên dịch, không phải màn hình đơ lúc chạy.
 * ★ RB-5 — không `<Environment>`, không CDN. Đèn do `KhungCanh` lo.
 * ★ RB-7 — geometry/material của lớp ghost `dispose()` trong cleanup.
 *
 * ★★★ VẬT THỂ MANG GIZMO LÀ MỘT `Object3D` PROXY, KHÔNG PHẢI MÁY TRONG BATCH.
 *   `LoBatchMay` vẽ mọi máy bằng MỘT `BatchedMesh` (1 draw call) — từng máy
 *   KHÔNG có `Object3D` riêng để `TransformControls.attach()` bám vào. Nên ta
 *   dựng một object rỗng, đặt nó đúng vị trí máy đang chọn, cho gizmo bám vào
 *   đó, rồi đọc kết quả ra. Đây KHÔNG phải giải pháp tạm: nó giữ nguyên ngân
 *   sách draw call của §4, và là cách duy nhất để có cả hai thứ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CHẶN-3 — PROXY PHẢI NẰM TRONG SCENE GRAPH, KHÔNG CHỈ TỒN TẠI
 * ════════════════════════════════════════════════════════════════════════════
 * Bản đầu dựng proxy bằng `new THREE.Object3D()` rồi `setProxy(o)` và DỪNG Ở
 * ĐÓ — object không bao giờ được `add` vào scene. Gizmo VẪN HIỆN (helper của nó
 * là một object khác, đã `scene.add` đúng theo RB-1), nên ảnh chụp trông ĐẠT.
 * Nhưng kéo thì KHÔNG lưu được, và chuỗi nhân quả nằm trong three r182 —
 * kiểm chứng trên `node_modules` của CHÍNH repo này, không trích tài liệu:
 *
 *   `TransformControls.js:1066`  `if (controls.object.parent === null)`
 *        → nhánh `console.error('… must be a part of the scene graph.')`
 *        → và `_parentScale` **KHÔNG được gán** (nó chỉ gán ở nhánh `else`).
 *   `TransformControls.js:344`   `this._parentScale = new Vector3()`  ⇒ (0,0,0)
 *   `TransformControls.js:501/505`  `.divide( this._parentScale )`    ⇒ CHIA 0
 *
 * Hệ quả đo được: `object.position` thành `NaN`, `onXong` trả NaN, `gomThayDoi`
 * so sánh NaN !== NaN theo kiểu không dùng được, nút Lưu ở nguyên `disabled`, và
 * DB không đổi một byte. Console nổ 90+ lần mỗi phiên vì `updateMatrixWorld`
 * chạy mỗi khung.
 *
 * ⚠ ĐÂY LÀ LỚP LỖI "MỘT ĐƯỜNG SỐNG CHE MỘT ĐƯỜNG CHẾT": gõ số vào Inspector vẫn
 *   bật được nút Lưu (đường đó không đi qua three), nên nghiệm thu bằng Inspector
 *   chứng minh SỐ 0 về gizmo. Phải đo CẢ HAI đường vào.
 *
 * ★ Vá bằng `<primitive object={proxy} />` — R3F tự `add` lúc mount và tự
 *   `remove` lúc unmount, nên không có đường nào rò một `Object3D` mồ côi vào
 *   scene (RB-7). `scene.add` thủ công cũng đúng nhưng phải tự nhớ `remove`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useOptionalTheme } from "@/components/factory-scene/useOptionalTheme";

import { KhungCanh, LoBatchMay, taoDieuKhienQuay, type MayTrongLo } from "../loi";
import { mmSangMet } from "../heToaDo";
import { TRANG_THAI_CHON_RONG, type TrangThaiChon } from "../loi/chonVatThe";
import { GizmoBienDoi } from "./GizmoBienDoi";
import type { CheDoGizmo, TrucKhoa } from "./gizmoNoiLogic";
import type { HopMa } from "./xemTruocSinh";
import { CauNoiCanh, type RefCanh } from "./CauNoiCanh";
import { LopVung } from "./LopVung";
import type { VungVe } from "./vungAnToan";

export interface CanhThietKeProps {
  may: MayTrongLo[];
  /** machineId đang chọn (một) — gizmo bám vào máy này. */
  mayDangChon: number | null;
  mayDaKhoa: boolean;
  cheDo: CheDoGizmo;
  snapBat: boolean;
  buocLuoiMm: number;
  buocGocDo: number;
  trucKhoa: TrucKhoa;
  /** Lớp xem trước Sinh tự động; rỗng = không xem trước. */
  ma: readonly HopMa[];
  /** Kích thước sàn (mét) để đặt lưới và camera. */
  sanRongM: number;
  sanSauM: number;
  hienLuoi: boolean;
  /** Vùng an toàn đã dựng sẵn (§11.1 #5). Rỗng = không có vùng nào. */
  vung?: readonly VungVe[];
  /** Ẩn nhãn vùng. */
  tatNhanVung?: boolean;
  onChonVung?: (khoa: string | null) => void;
  /**
   * ★ CẦU NỐI ra lớp phủ DOM (thanh công cụ #58/#57, mini-map #56).
   *   Xem `CauNoiCanh.tsx`: dùng ref thay context để KHÔNG phải sửa `loi/KhungCanh`.
   */
  refCanh?: RefCanh;
  onChonMay: (machineId: number | null) => void;
  /** Kéo gizmo xong: vị trí SCENE (mét) + góc ĐỘ. Người gọi quy sang mm. */
  onBienDoiXong: (kq: {
    viTri: { x: number; y: number; z: number };
    gocYDo: number;
  }) => void;
  chuMatContext: string;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* OrbitControls — RB-3                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

function DieuKhien({
  banKinh,
  controlsRef,
}: {
  banKinh: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    // ★ RB-3: `invalidate` là tham số required của `taoDieuKhienQuay`.
    const { controls, huy } = taoDieuKhienQuay(camera, gl.domElement, invalidate, {
      khoangCachToiThieu: 2,
      khoangCachToiDa: Math.max(80, banKinh * 6),
    });
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
      huy();
    };
  }, [camera, gl, invalidate, banKinh, controlsRef]);

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Sàn + lưới                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★ THƯỜNG-3 — sàn và lưới cũng phải đổi theo theme, không chỉ nền.
 *   Đổi mỗi màu nền mà giữ sàn `#e2e8f0` sáng thì ở theme tối cả mặt sàn thành
 *   một tấm trắng chiếm gần hết khung — chói hơn cả lỗi ban đầu. Ba màu này đi
 *   cùng nhau hoặc không đi.
 */
function San({
  rongM,
  sauM,
  hienLuoi,
  toi,
}: {
  rongM: number;
  sauM: number;
  hienLuoi: boolean;
  toi: boolean;
}) {
  const canh = Math.max(rongM, sauM, 10);
  const mauSan = toi ? "#1e293b" : "#e2e8f0";
  const mauLuoiChinh = toi ? "#475569" : "#94a3b8";
  const mauLuoiPhu = toi ? "#334155" : "#cbd5e1";
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[rongM / 2, -0.01, sauM / 2]}>
        <planeGeometry args={[rongM, sauM]} />
        <meshStandardMaterial color={mauSan} />
      </mesh>
      {hienLuoi ? (
        <gridHelper
          args={[canh, Math.max(4, Math.round(canh)), mauLuoiChinh, mauLuoiPhu]}
          position={[rongM / 2, 0, sauM / 2]}
        />
      ) : null}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Lớp GHOST xem trước Sinh tự động                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ghost vẽ bằng MỘT `InstancedMesh` — mọi hộp ma dùng chung một `BoxGeometry`
 * đơn vị và co giãn bằng ma trận. Vẽ 41 mesh rời sẽ tốn 41 draw call và đẩy
 * ngân sách §4 (≤ 150) đi một phần ba chỉ để xem trước.
 */
function LopMa({ ma }: { ma: readonly HopMa[] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({
      color: "#0ea5e9",
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(() => {
    return () => {
      hinh.dispose();
      chatLieu.dispose();
    };
  }, [hinh, chatLieu]);

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mauDoi = new THREE.Color("#f59e0b");
    const mauYen = new THREE.Color("#0ea5e9");
    ma.forEach((h, i) => {
      mt.compose(
        new THREE.Vector3(
          mmSangMet(h.viTriXMm),
          mmSangMet(h.viTriZMm) + mmSangMet(h.caoMm) / 2,
          mmSangMet(h.viTriYMm),
        ),
        new THREE.Quaternion(),
        new THREE.Vector3(mmSangMet(h.rongMm), mmSangMet(h.caoMm), mmSangMet(h.sauMm)),
      );
      inst.setMatrixAt(i, mt);
      // Máy SẼ DỜI tô cam, máy đứng yên tô xanh — xem trước phải trả lời được
      // câu hỏi duy nhất người dùng có (§ xemTruocSinh.dungLopMa).
      inst.setColorAt(i, h.seDoi ? mauDoi : mauYen);
    });
    inst.count = ma.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [ma, invalidate]);

  if (ma.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[hinh, chatLieu, Math.max(1, ma.length)]}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Proxy mang gizmo                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function NoiDung(props: CanhThietKeProps & { toi: boolean }) {
  const {
    toi,
    may,
    mayDangChon,
    mayDaKhoa,
    cheDo,
    snapBat,
    buocLuoiMm,
    buocGocDo,
    trucKhoa,
    ma,
    sanRongM,
    sanSauM,
    hienLuoi,
    vung,
    tatNhanVung,
    onChonVung,
    refCanh,
    onChonMay,
    onBienDoiXong,
  } = props;

  const camera = useThree((st) => st.camera);
  const orbitRef = useRef<OrbitControls | null>(null);
  const [proxy, setProxy] = useState<THREE.Object3D | null>(null);
  const proxyRef = useRef<THREE.Object3D | null>(null);

  const chon: TrangThaiChon = useMemo(
    () => ({ ...TRANG_THAI_CHON_RONG, dangChon: mayDangChon }),
    [mayDangChon],
  );

  // Dựng proxy MỘT LẦN. Nó là `Object3D` rỗng (0 tam giác, 0 draw call) — chỉ
  // tồn tại để `TransformControls.attach()` có chỗ bám.
  //
  // ★★★ CHẶN-3 — object này PHẢI vào scene graph, xem docblock đầu tệp. Việc
  //   `add` do `<primitive object={proxy} />` ở dưới lo; ở đây chỉ TẠO.
  useEffect(() => {
    const o = new THREE.Object3D();
    o.name = "twin-gizmo-proxy";
    proxyRef.current = o;
    setProxy(o);
    return () => {
      proxyRef.current = null;
      setProxy(null);
    };
  }, []);

  /**
   * ★★★ CHỈ BÁO NGHIỆM THU CHẶN-3 — proxy ĐÃ CÓ PARENT hay chưa.
   *
   * `<primitive>` add object trong lượt commit của React, tức SAU khi render trả
   * về. Nếu `GizmoBienDoi` gọi `attach(proxy)` ngay trong cùng lượt đó thì
   * `TransformControls` bám vào một object `parent === null` — đúng trạng thái
   * hỏng mà bản vá này dẹp. Đọc `parent` sau khi mount và chỉ gắn gizmo khi nó
   * khác `null` là cưỡng chế thứ tự bằng DỮ LIỆU chứ không bằng lời hứa.
   *
   * ⚠ Cố ý KHÔNG assert `parent === scene`: R3F có thể chèn qua một `<group>` phụ
   *   nếu cây đổi. Điều `TransformControls` cần là CÓ parent — đúng thứ nó kiểm
   *   ở dòng 1066 — nên chỉ báo phải đo đúng điều đó, không chặt hơn.
   */
  const [daVaoScene, setDaVaoScene] = useState(false);
  useEffect(() => {
    if (!proxy) {
      setDaVaoScene(false);
      return;
    }
    // ⚠ KHÔNG giả định thứ tự effect. R3F gắn object vào cha trong pha COMMIT
    // của reconciler, nhưng effect của component con chạy TRƯỚC effect của cha,
    // nên `proxy.parent` có thể còn `null` ngay tại lượt này. Thay vì tin vào
    // một thứ tự không đo được, ta ĐỌC LẠI cho tới khi thấy parent — rẻ (vài
    // khung, chỉ lúc mount) và đúng dù nội bộ R3F đổi.
    if (proxy.parent !== null) {
      setDaVaoScene(true);
      return;
    }
    let huy = false;
    let raf = 0;
    const doLai = () => {
      if (huy) return;
      if (proxy.parent !== null) {
        setDaVaoScene(true);
        return;
      }
      raf = requestAnimationFrame(doLai);
    };
    raf = requestAnimationFrame(doLai);
    return () => {
      huy = true;
      cancelAnimationFrame(raf);
    };
  }, [proxy]);

  // Cửa sổ đo cho e2e — ảnh chụp KHÔNG phân biệt được proxy có parent hay không
  // (gizmo hiện trong CẢ HAI trường hợp; đó là lý do lỗi này lọt qua nghiệm thu
  // thị giác lần trước). Cờ này ghi lại đúng biến quyết định.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as Window & {
      __gizmoProxy?: {
        daTao: boolean;
        coParent: boolean;
        ten: string;
        /**
         * ★ Tham chiếu THẬT tới object + camera, để e2e chiếu toạ độ thế giới
         *   ra màn hình và biết phải KÉO VÀO ĐÂU.
         *
         * ⚠ Không có nó thì test buộc phải đoán tâm canvas — mà tâm canvas KHÔNG
         *   phải chỗ gizmo đứng, nên cú kéo trượt ra ngoài trục và phép đo trả
         *   "không đổi" vì lý do SAI. `__r3f` nội bộ của R3F không đọc được trên
         *   bản `npm run build` (minify), nên phải tự phơi ra.
         */
        vatThe: THREE.Object3D | null;
        camera: THREE.Camera | null;
      };
    };
    w.__gizmoProxy = {
      daTao: proxy !== null,
      coParent: proxy?.parent != null,
      ten: proxy?.name ?? "",
      vatThe: proxy,
      camera,
    };
  }, [proxy, daVaoScene, camera]);

  // Đồng bộ proxy tới vị trí máy đang chọn.
  const mayChon = useMemo(
    () => may.find((m) => m.machineId === mayDangChon) ?? null,
    [may, mayDangChon],
  );
  useEffect(() => {
    const o = proxyRef.current;
    if (!o || !mayChon) return;
    o.position.set(
      mayChon.viTri.x,
      mayChon.viTri.y + mmSangMet(mayChon.kichThuocMm.caoMm) / 2,
      mayChon.viTri.z,
    );
    o.rotation.set(0, mayChon.gocXoayRad, 0);
    o.updateMatrixWorld();
  }, [mayChon]);

  const banKinh = Math.max(sanRongM, sanSauM) / 2;

  return (
    <>
      <DieuKhien banKinh={banKinh} controlsRef={orbitRef} />
      {/* ★ Cầu nối ra lớp phủ DOM — 0 draw call, xem `CauNoiCanh.tsx`. Đặt SAU
          `DieuKhien` để `orbitRef` đã được gán trước khi ai đó đọc. */}
      {refCanh ? <CauNoiCanh refCanh={refCanh} controls={orbitRef} /> : null}
      <San rongM={sanRongM} sauM={sanSauM} hienLuoi={hienLuoi} toi={toi} />
      {/* ★ #5 — vùng an toàn translucent + nhãn. Vẽ SAU sàn, TRƯỚC máy: vùng
          nằm trên sàn và máy đứng trong vùng. */}
      <LopVung vung={vung ?? []} tatNhan={tatNhanVung} onChon={onChonVung} />
      <LoBatchMay
        may={may}
        chon={chon}
        onChon={onChonMay}
        onHover={() => {
          /* hover không đổi state ở màn Thiết kế — tránh render lại 41 máy mỗi lần rê chuột */
        }}
      />
      <LopMa ma={ma} />
      {/*
        ★★★ CHẶN-3 — PROXY VÀO SCENE GRAPH.

        Không có dòng này thì `proxy.parent === null`, `TransformControls` rơi vào
        nhánh `console.error` ở `TransformControls.js:1066`, `_parentScale` giữ
        nguyên (0,0,0) và phép `.divide(_parentScale)` ở dòng 501/505 cho NaN —
        gizmo hiện, kéo được, mà KHÔNG một thay đổi nào tới được DB.

        `<primitive>` cặp đôi add/remove theo vòng đời React nên không rò object
        mồ côi (RB-7). Proxy rỗng: 0 tam giác, 0 draw call, ngân sách §4 không đổi.
      */}
      {proxy ? <primitive object={proxy} /> : null}
      {/* ★★★ Gizmo — RB-1/RB-2 ở trong `GizmoBienDoi`.
          ★ `daVaoScene` chặn `attach()` chạy TRƯỚC khi `<primitive>` kịp add:
            attach vào một object chưa có parent tái tạo đúng lỗi NaN ở trên. */}
      <GizmoBienDoi
        vatThe={mayDangChon !== null && !mayDaKhoa && daVaoScene ? proxy : null}
        cheDo={cheDo}
        snapBat={snapBat}
        buocLuoiMm={buocLuoiMm}
        buocGocDo={buocGocDo}
        trucKhoa={trucKhoa}
        orbitRef={orbitRef}
        onXong={(kq) => {
          if (!mayChon) return;
          // Trả về TÂM đáy máy: proxy đứng ở giữa chiều cao, mô hình dữ liệu ghi
          // vị trí đáy. Quên phép trừ này làm máy nhích lên nửa chiều cao MỖI
          // LẦN kéo — trôi tích luỹ, và không lỗi nào nổ.
          onBienDoiXong({
            viTri: {
              x: kq.viTri.x,
              y: kq.viTri.y - mmSangMet(mayChon.kichThuocMm.caoMm) / 2,
              z: kq.viTri.z,
            },
            gocYDo: kq.gocYDo,
          });
        }}
      />
    </>
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THƯỜNG-3 — NỀN CẢNH THEO THEME (§15 #17)
 * ════════════════════════════════════════════════════════════════════════════
 * `KhungCanh` mặc định `mauNen = "#eef2f6"` và dùng giá trị đó ở CẢ HAI chỗ:
 * `style.background` của div bọc VÀ `<color attach="background">` trong scene.
 * `CanhThietKe` trước đây không truyền gì, nên ở theme tối canvas vẫn trắng
 * sáng — một ô chói giữa màn đen.
 *
 * ★ Sửa TỐI THIỂU theo yêu cầu: `loi/` đã qua QA và ổn định nên KHÔNG đụng vào
 *   (prop `mauNen` vốn ĐÃ tồn tại ở đó, chỉ chưa ai truyền). Toàn bộ thay đổi
 *   nằm ở phía gọi.
 *
 * ★ Dùng `useOptionalTheme` (đã có sẵn, `factory-scene/`) chứ không `useTheme`
 *   của ThemeContext: hook này đọc class trên `<html>` và KHÔNG ném lỗi khi
 *   thiếu Provider, nên ảnh chụp/test dựng component trần vẫn chạy được.
 *
 * ⚠ Màu tối KHÔNG phải đen tuyền. `#0f172a` (slate-900) là nền mà phần còn lại
 *   của UI tối đang dùng; đen tuyền làm mất hẳn cảm giác chiều sâu vì sàn và
 *   lưới đều tối, và người dùng không phân biệt được "cảnh tối" với "canvas
 *   chết".
 */
const MAU_NEN_SANG = "#eef2f6";
const MAU_NEN_TOI = "#0f172a";

export function CanhThietKe(props: CanhThietKeProps) {
  const { sanRongM, sanSauM, chuMatContext } = props;
  const theme = useOptionalTheme();
  const mauNen = theme === "dark" ? MAU_NEN_TOI : MAU_NEN_SANG;
  // Camera nhìn bao trọn mặt sàn ngay lần mở đầu — người dùng không phải zoom
  // ra để tìm nhà xưởng của mình.
  const viTriCamera = useMemo<[number, number, number]>(() => {
    const r = Math.max(sanRongM, sanSauM, 10);
    return [sanRongM / 2 + r * 0.55, r * 0.62, sanSauM / 2 + r * 0.85];
  }, [sanRongM, sanSauM]);

  return (
    <KhungCanh
      viTriCamera={viTriCamera}
      far={Math.max(2000, Math.max(sanRongM, sanSauM) * 8)}
      mauNen={mauNen}
      chuMatContext={chuMatContext}
      data-testid="khoi-canh-3d"
    >
      <NoiDung {...props} toi={theme === "dark"} />
    </KhungCanh>
  );
}

export default CanhThietKe;
