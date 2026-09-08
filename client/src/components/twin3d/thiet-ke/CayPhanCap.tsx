/**
 * CayPhanCap.tsx — cây phân cấp bên trái của màn Thiết kế (§7.1, §11 #8-#11/#15).
 *
 * ★ Toàn bộ LOGIC nằm ở `trangThaiThietKe.ts` (dựng cây, lọc, đường tới node) và
 *   `cayPhanCapLogic.ts` (roll-up đếm, cắt nhãn highlight, lọc theo cảnh báo,
 *   cây phẳng, bàn phím WAI-ARIA, roving tabindex). Tệp này CHỈ vẽ và NỐI — nếu
 *   có gì đáng đo lọt vào đây thì nó không đo được nữa (`.tsx` không nằm trong
 *   `include` node của vitest).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SPEC SAI — MỤC #8-#11/#15 GHI ĐÍCH LÀ MÀN VẬN HÀNH
 * ════════════════════════════════════════════════════════════════════════════
 * §11.2 xếp năm mục này dưới `CommandCenter.tsx` và spec §11 nói đích là màn
 * Vận hành. Đo được (và §11c.3 của chính spec đã tự đính chính): tệp này có
 * **chỗ gọi DUY NHẤT là `XuongThietKe.tsx:725`** — màn **Thiết kế** `/twin-studio`.
 * `/twin` (Vận hành) KHÔNG có cây phân cấp nào. Làm theo spec §11 sẽ là dựng một
 * cây thứ hai ở màn không có chỗ cho nó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ #11 — LỖI ĐANG CÓ ĐƯỢC VÁ Ở ĐÂY, VÀ VÌ SAO NÓ TỆ HƠN KHÔNG CÓ GÌ
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được trước đợt này (2026-09-07): tệp khai `role="tree"` (dòng 180 bản cũ)
 * và `role="treeitem"` (dòng 70) — nhưng **0 `onKeyDown`, 0 `tabIndex`** trong
 * TOÀN BỘ `twin3d/**` (chỗ duy nhất có `onKeyDown` là `BangThuocTinh.tsx:108`,
 * không liên quan). Hàng là `<div onClick>` thuần.
 *
 * ⇒ Nó **tự giới thiệu với trình đọc màn hình rằng nó là một cây thao tác được**,
 *   rồi không thao tác được. Người dùng bàn phím nhận lời hứa "đây là tree, dùng
 *   mũi tên đi", làm đúng thế, và không gì xảy ra. Đó là lý do trạng thái cũ
 *   **tệ hơn** là không khai ARIA: không khai thì trình đọc màn hình mô tả nó
 *   như một danh sách div và người dùng biết ngay là phải dùng chuột.
 *
 * Bản này nối đủ: Enter/Space/←/→/↑/↓/Home/End + roving tabindex, tất cả đi qua
 * `phimCay` (hàm thuần, 51 test) — component chỉ dịch sự kiện DOM thành lời gọi
 * và áp kết quả. Việc NỐI ấy được đo riêng bằng `CayPhanCap.dom.test.tsx` (render
 * component THẬT trên jsdom, bấm phím thật) — G16: "hàm không ai gọi = chưa xong".
 *
 * ★★★ §7.1 — "KHU CHỜ XẾP CHỖ" là nhánh riêng, mờ + viền NÉT ĐỨT.
 *   Spec nói thẳng lý do: *"nếu ẩn chúng đi, người dùng không bao giờ biết mình
 *   thiếu N máy"*. Nên nhánh này hiện cả khi RỖNG (với câu "0 máy chờ").
 *
 * ★ §7.3 — ĐỒNG BỘ HAI CHIỀU BẮT BUỘC: `chon` vào từ ngoài (click trong 3D) và
 *   `onChon` đi ra (click trong cây). Component KHÔNG giữ state chọn của riêng
 *   nó; giữ một bản sao là cách chắc chắn để hai bên lệch nhau.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  duongToiNode,
  locCay,
  type CayThietKe,
  type KhoaNode,
  type NodeCay,
  type TapChon,
} from "./trangThaiThietKe";
import {
  catNhanTheoTim,
  duyetPhang,
  khoaCanMo,
  khoaNhanTab,
  locTheoCanhBao,
  phimCay,
  ropCanhBao,
  type DemCanhBao,
  type HangPhang,
} from "./cayPhanCapLogic";

export interface CayPhanCapProps {
  cay: CayThietKe;
  chon: TapChon;
  onChon: (khoa: KhoaNode | null, giuShift: boolean) => void;
  /** Số máy chờ xếp chỗ — truyền riêng để hiện được cả khi nhánh bị lọc trống. */
  soChoXepCho: number;
  /**
   * #8 — số cảnh báo gắn TRỰC TIẾP theo khoá node. Roll-up lên cha xảy ra trong
   * component (`ropCanhBao`), người gọi không phải tự cộng.
   *
   * ★ Không truyền ⇒ cây chạy y như trước (0 cảnh báo, chip lọc ẩn). Đây là hợp
   *   đồng cộng-thêm: `XuongThietKe.tsx` chưa tải alarm vẫn dùng được cây.
   */
  soCanhBaoTrucTiep?: ReadonlyMap<KhoaNode, number>;
  /**
   * #15 — báo ra ngoài nhánh nào đang được chọn, để dải cảnh báo lọc theo cây
   * con. `null` = không chọn gì.
   */
  onDoiPhamVi?: (khoa: KhoaNode | null) => void;
  /**
   * ★★★ ĐỢT 22 Z4 (G-7) — SỐ MÁY gắn TRỰC TIẾP theo khoá node. Roll-up lên cha
   * đi qua **cùng** `ropCanhBao` (nó là phép cộng thuần trên cây, không biết nó
   * đang cộng cái gì) — G12: một phép cộng, không phải hai bản cài đặt.
   *
   * ★★★ ĐẠI LƯỢNG NÀY **KHÁC** `soCanhBaoTrucTiep`, và hai badge phải phân biệt
   *   được bằng mắt. Gộp chúng thành một con số là đúng lớp lỗi §13d Z3 vừa bắt
   *   ("huy hiệu khai SAI ĐẠI LƯỢNG"): một line 6 máy / 2 cảnh báo mà hiện "8"
   *   thì không ai đọc ngược ra được nó gồm những gì.
   *
   * ★ Không truyền ⇒ cây chạy **y như trước** (0 badge máy). Hợp đồng cộng-thêm:
   *   `XuongThietKe.tsx` không truyền, và ảnh màn Thiết kế không đổi một pixel.
   */
  soMayTrucTiep?: ReadonlyMap<KhoaNode, number>;
}

const THUT_PX = 12;

/** #9 — vẽ nhãn với đoạn khớp bọc `<mark>`. Cắt chuỗi do `catNhanTheoTim` lo. */
function NhanCoTo({ nhan, tim }: { nhan: string; tim: string }) {
  const manh = catNhanTheoTim(nhan, tim);
  return (
    <>
      {manh.map((m, i) =>
        m.khop ? (
          // eslint-disable-next-line react/no-array-index-key
          <mark key={i} className="rounded-sm bg-warning/40 px-0 text-inherit">
            {m.chu}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <span key={i}>{m.chu}</span>
        ),
      )}
    </>
  );
}

function IconMo({ mo }: { mo: boolean }) {
  return mo ? (
    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
  ) : (
    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
  );
}

function Hang({
  hang,
  daChon,
  nhanTab,
  tim,
  soCanhBao,
  soMay,
  dat,
  onBamMo,
  onBamChon,
  onPhim,
}: {
  hang: HangPhang;
  daChon: boolean;
  /** #11 — roving tabindex: đúng MỘT hàng trong cả cây nhận `0`. */
  nhanTab: boolean;
  tim: string;
  soCanhBao: number;
  /** ★ Z4 — roll-up SỐ MÁY. `0` ⇒ không vẽ badge (xem docblock badge dưới). */
  soMay: number;
  /** Ghi phần tử DOM vào sổ để `focus()` được sau khi phím đổi node. */
  dat: (khoa: KhoaNode, el: HTMLDivElement | null) => void;
  onBamMo: (khoa: KhoaNode) => void;
  onBamChon: (khoa: KhoaNode, giuShift: boolean) => void;
  onPhim: (khoa: KhoaNode, phim: string, e: React.KeyboardEvent) => void;
}) {
  const { node, bac, mo, coCon } = hang;
  return (
    <div
      ref={(el) => dat(node.khoa, el)}
      role="treeitem"
      aria-selected={daChon}
      aria-expanded={coCon ? mo : undefined}
      // ★ `aria-level` bắt đầu từ 1 theo WAI-ARIA (bậc 0 của ta = level 1).
      aria-level={bac + 1}
      // ★★★ ROVING TABINDEX — xem `khoaNhanTab`. Cho mọi hàng `0` biến một cây 82
      //   máy thành 82 chặng Tab người dùng phải bấm qua.
      tabIndex={nhanTab ? 0 : -1}
      data-testid={`node-cay-${node.khoa}`}
      data-cho-xep-cho={node.choXepCho ? "1" : "0"}
      data-so-canh-bao={soCanhBao}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        daChon ? "bg-primary/15 text-foreground" : "hover:bg-muted/60",
        // ★ §7.1 — mờ + viền NÉT ĐỨT cho máy chưa xếp chỗ.
        node.choXepCho && "border border-dashed border-muted-foreground/50 opacity-60",
      )}
      style={{ paddingLeft: 6 + bac * THUT_PX }}
      onClick={(e) => onBamChon(node.khoa, e.shiftKey)}
      onKeyDown={(e) => onPhim(node.khoa, e.key, e)}
    >
      {coCon ? (
        <button
          type="button"
          // ★ Nút mũi tên KHÔNG nhận Tab: hàng `treeitem` đã là điểm dừng bàn
          //   phím, và một nút lồng trong nó sẽ nhân đôi số chặng Tab.
          tabIndex={-1}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onBamMo(node.khoa);
          }}
          aria-label={node.nhan}
        >
          <IconMo mo={mo} />
        </button>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className="truncate">
        <NhanCoTo nhan={node.nhan} tim={tim} />
      </span>
      {/*
        ★★★ HAI BADGE, HAI ĐẠI LƯỢNG — thứ tự và MÀU đều là quyết định, không
        phải trang trí:
          · SỐ MÁY   — xám trung tính. ISA-101 §10.1: màu chỉ dành cho BẤT
            THƯỜNG, và "line này có 6 máy" là chuyện hoàn toàn bình thường.
          · CẢNH BÁO — màu destructive, và đứng SAU (sát mép phải) để mắt liếc
            dọc mép phải bắt được ngay hàng nào đang đỏ.
        ⚠ Gộp hai số thành một là §13d Z3 lặp lại. Chúng KHÔNG cùng mẫu số.
      */}
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {/* ★ Z4 — badge SỐ MÁY. Chỉ hiện khi > 0 **và** node có con: một node
            `machine:` tự nó luôn có roll-up = 1, và in "1" lên từng máy là 82
            con số vô nghĩa che mất badge cảnh báo. */}
        {soMay > 0 && coCon ? (
          <span
            className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
            data-testid={`so-may-${node.khoa}`}
            title={`${soMay}`}
          >
            {soMay}
          </span>
        ) : null}
        {/* #8 — badge roll-up cảnh báo. Chỉ hiện khi > 0: một số 0 trên mọi hàng
            là nhiễu thị giác che mất hàng thật sự có cảnh báo. */}
        {soCanhBao > 0 ? (
          <span
            className="flex items-center gap-0.5 rounded bg-destructive/15 px-1 text-[10px] font-medium text-destructive"
            data-testid={`canh-bao-${node.khoa}`}
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            {soCanhBao}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function CayPhanCap({
  cay,
  chon,
  onChon,
  soChoXepCho,
  soCanhBaoTrucTiep,
  onDoiPhamVi,
  soMayTrucTiep,
}: CayPhanCapProps) {
  const { t } = useTranslation();
  const [timTho, setTimTho] = useState("");
  const [tim, setTim] = useState("");
  const [chiCanhBao, setChiCanhBao] = useState(false);
  const [mo, setMo] = useState<Set<KhoaNode>>(new Set());
  const [khoaFocus, setKhoaFocus] = useState<KhoaNode | null>(null);

  /**
   * #9 — DEBOUNCE 200 ms.
   *
   * ★ Vì sao debounce chứ không lọc thẳng mỗi phím: `locCay` + `locTheoCanhBao` +
   *   `duyetPhang` chạy lại toàn cây mỗi ký tự. Với 82 máy thì không đau, nhưng ô
   *   tìm kiếm là nơi người dùng gõ nhanh nhất trên cả màn, và 200 ms là ngưỡng
   *   quen thuộc (bản gốc `CommandCenter.tsx:963` cũng dùng đúng số này).
   *
   * ★ `timTho` (ô nhập) và `tim` (đã hoãn) là HAI state riêng — gộp làm một thì
   *   ô nhập bị trễ theo và người dùng thấy chữ mình gõ hiện ra muộn 200 ms.
   */
  useEffect(() => {
    const id = setTimeout(() => setTim(timTho.trim()), 200);
    return () => clearTimeout(id);
  }, [timTho]);

  // #8 — roll-up đếm. Bản đồ rỗng khi người gọi không cấp dữ liệu alarm.
  const demCanhBao: DemCanhBao = useMemo(
    () => ropCanhBao([...cay.goc, ...cay.khuCho], soCanhBaoTrucTiep ?? new Map()),
    [cay, soCanhBaoTrucTiep],
  );
  const coDuLieuCanhBao = (soCanhBaoTrucTiep?.size ?? 0) > 0;

  /**
   * ★ Z4 — roll-up SỐ MÁY, đi qua **cùng** `ropCanhBao`. Hàm ấy là phép cộng
   *   thuần trên cây và không biết nó đang cộng cảnh báo hay máy; viết một hàm
   *   `ropSoMay` thứ hai là chép nguyên đệ quy ấy sang chỗ thứ hai để rồi hai
   *   bản trôi khỏi nhau (G12).
   */
  const demSoMay: DemCanhBao = useMemo(
    () => ropCanhBao([...cay.goc, ...cay.khuCho], soMayTrucTiep ?? new Map()),
    [cay, soMayTrucTiep],
  );

  // Lọc: text (§7.1) rồi lọc-chỉ-cảnh-báo (#10). Thứ tự không đổi kết quả vì cả
  // hai đều là phép cắt, nhưng giữ text trước cho khớp bản gốc.
  const daLoc = useMemo(() => {
    const a = locCay(cay.goc, tim);
    return chiCanhBao ? locTheoCanhBao(a, demCanhBao) : a;
  }, [cay, tim, chiCanhBao, demCanhBao]);
  const khuChoLoc = useMemo(() => {
    const a = locCay(cay.khuCho, tim);
    return chiCanhBao ? locTheoCanhBao(a, demCanhBao) : a;
  }, [cay, tim, chiCanhBao, demCanhBao]);

  const dangLoc = tim !== "" || chiCanhBao;

  /**
   * ★ §7.3 — cây TỰ MỞ đúng nhánh khi vật thể được chọn từ 3D. Không có hiệu
   *   ứng này thì "đồng bộ hai chiều" chỉ đúng một nửa: chọn trong 3D làm cây
   *   đánh dấu một hàng đang bị gập lại, tức là người dùng không thấy gì.
   */
  useEffect(() => {
    if (chon.length === 0) return;
    const canMo = new Set(mo);
    let doi = false;
    for (const k of chon) {
      for (const to of duongToiNode(cay, k)) {
        if (!canMo.has(to)) {
          canMo.add(to);
          doi = true;
        }
      }
    }
    if (doi) setMo(canMo);
    // `mo` cố tình KHÔNG trong deps: thêm vào sẽ tạo vòng lặp set → render → set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chon, cay]);

  /**
   * #10 — AUTO-EXPAND khi bộ lọc bật: hợp nhất tập người dùng mở với mọi node có
   * con trong cây ĐÃ LỌC.
   *
   * ★★★ CỘNG THÊM, KHÔNG GHI ĐÈ. Ghi đè `mo` nghĩa là tắt bộ lọc xong cây bung/
   *   gập khác hẳn lúc trước khi lọc — người dùng mất chỗ đứng. Vì thế đây là một
   *   giá trị DẪN XUẤT mỗi lần render, không phải một `setMo()`.
   */
  const moHieuLuc = useMemo<ReadonlySet<KhoaNode>>(() => {
    if (!dangLoc) return mo;
    const them = khoaCanMo([...daLoc, ...khuChoLoc]);
    return new Set([...mo, ...them]);
  }, [dangLoc, mo, daLoc, khuChoLoc]);

  // #11 — cây phẳng: MỘT nguồn cho cả phép vẽ lẫn phép đi bàn phím. Hai danh
  // sách riêng sẽ trôi khỏi nhau (G12) và focus nhảy sang hàng không nhìn thấy.
  const hangChinh = useMemo(() => duyetPhang(daLoc, moHieuLuc), [daLoc, moHieuLuc]);
  const hangKhuCho = useMemo(() => duyetPhang(khuChoLoc, moHieuLuc), [khuChoLoc, moHieuLuc]);
  const moiHang = useMemo(() => [...hangChinh, ...hangKhuCho], [hangChinh, hangKhuCho]);

  const khoaTab = useMemo(() => khoaNhanTab(moiHang, khoaFocus, chon), [moiHang, khoaFocus, chon]);

  // Sổ tra DOM để `focus()` được node mà `phimCay` chỉ định.
  const soDom = useRef(new Map<KhoaNode, HTMLDivElement>());
  const dat = useCallback((khoa: KhoaNode, el: HTMLDivElement | null) => {
    if (el) soDom.current.set(khoa, el);
    else soDom.current.delete(khoa);
  }, []);

  const doiMo = useCallback((k: KhoaNode) => {
    setMo((cu) => {
      const s = new Set(cu);
      if (s.has(k)) s.delete(k);
      else s.add(k);
      return s;
    });
  }, []);

  /**
   * #11 — CẦU NỐI DUY NHẤT giữa DOM và `phimCay`.
   *
   * ★ `phimCay` trả `null` cho phím không thuộc về cây ⇒ **KHÔNG** `preventDefault`.
   *   Nuốt hết mọi phím sẽ nhốt người dùng bàn phím trong cây (Tab không ra được)
   *   — lỗi trợ năng nặng hơn hẳn lỗi đang vá.
   *
   * ★ Phím phát từ NÚT CON (mũi tên gập) bị bỏ qua: `e.target !== e.currentTarget`.
   *   Không lọc thì Enter trên nút gập vừa gập vừa chọn.
   */
  const onPhim = useCallback(
    (khoa: KhoaNode, phim: string, e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      const viec = phimCay(moiHang, khoa, phim);
      if (viec === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (viec.mo !== null) doiMo(viec.mo);
      if (viec.dong !== null) doiMo(viec.dong);
      if (viec.chon !== null) onChon(viec.chon, false);
      if (viec.focus !== null) {
        setKhoaFocus(viec.focus);
        // `focus()` NGAY, không đợi render: node đích đã có mặt trong DOM (nó
        // nằm trong danh sách phẳng hiện tại). Đợi effect sẽ nhấp nháy một khung.
        soDom.current.get(viec.focus)?.focus();
      }
    },
    [moiHang, doiMo, onChon],
  );

  // #15 — báo phạm vi ra ngoài mỗi khi node chủ đạo đổi.
  const khoaChuDao = chon.length === 0 ? null : chon[chon.length - 1];
  useEffect(() => {
    onDoiPhamVi?.(khoaChuDao);
  }, [khoaChuDao, onDoiPhamVi]);

  function ve(hang: readonly HangPhang[]): React.ReactNode[] {
    return hang.map((h) => (
      <Hang
        key={h.node.khoa}
        hang={h}
        daChon={chon.includes(h.node.khoa)}
        nhanTab={khoaTab === h.node.khoa}
        tim={tim}
        soCanhBao={demCanhBao.get(h.node.khoa) ?? 0}
        soMay={demSoMay.get(h.node.khoa) ?? 0}
        dat={dat}
        onBamMo={doiMo}
        onBamChon={(k, shift) => {
          setKhoaFocus(k);
          onChon(k, shift);
        }}
        onPhim={onPhim}
      />
    ));
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cay-phan-cap-twin">
      <div className="space-y-1.5 border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={timTho}
            onChange={(e) => setTimTho(e.target.value)}
            placeholder={t("twin3d.cay.loc")}
            className="h-8 pl-7 text-xs"
            data-testid="loc-cay"
          />
        </div>

        {/* #10 — chip "chỉ node có cảnh báo". CHỈ hiện khi thật sự có dữ liệu
            cảnh báo: một chip lọc luôn cho kết quả rỗng vì không ai cấp dữ liệu
            là một nút tự khai "nhà máy sạch" mà chưa đo gì (NT-3/G15). */}
        {coDuLieuCanhBao ? (
          <button
            type="button"
            aria-pressed={chiCanhBao}
            data-testid="chip-chi-canh-bao"
            onClick={() => setChiCanhBao((v) => !v)}
            className={cn(
              "flex w-full items-center justify-center gap-1 rounded border px-2 py-1 text-[11px]",
              chiCanhBao
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground hover:bg-muted/60",
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            {t("twin3d.cay.chiCanhBao")}
          </button>
        ) : null}
      </div>

      <div
        role="tree"
        aria-label={t("twin3d.cay.ariaCay")}
        className="min-h-0 flex-1 overflow-auto p-1"
        // Click nền cây = bỏ chọn (ngữ nghĩa chuẩn của mọi trình sửa).
        onClick={(e) => {
          if (e.target === e.currentTarget) onChon(null, false);
        }}
      >
        {daLoc.length === 0 && khuChoLoc.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">{t("twin3d.cay.khongKhop")}</p>
        ) : null}

        {ve(hangChinh)}

        {/* ★★★ §7.1 — KHU CHỜ XẾP CHỖ. Hiện CẢ KHI RỖNG (xem docblock đầu tệp). */}
        <div className="mt-3 border-t pt-2" data-testid="khu-cho-xep-cho">
          <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("twin3d.khuChoXepCho")} ({soChoXepCho})
          </p>
          {khuChoLoc.length === 0 ? (
            <p className="px-1.5 text-[11px] text-muted-foreground">
              {soChoXepCho === 0 ? "—" : t("twin3d.cay.khongKhop")}
            </p>
          ) : (
            ve(hangKhuCho)
          )}
          <p className="px-1.5 pt-1 text-[10px] leading-tight text-muted-foreground">
            {t("twin3d.khuChoXepChoMoTa")}
          </p>
        </div>
      </div>
    </div>
  );
}

export default CayPhanCap;
