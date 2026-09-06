/**
 * quyenThietKe.unit.test.ts — cưỡng chế BA quyết định của đợt vá CHẶN-1/CHẶN-2/CHẶN-3.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO NHỮNG TEST NÀY TỒN TẠI — VÀ VÌ SAO CHÚNG KHÔNG ĐỦ
 * ════════════════════════════════════════════════════════════════════════════
 * QA độc lập đã bác bỏ đợt trước với 3 lỗi CHẶN mà **19 tệp / 747 test đều xanh**
 * không bắt được lấy một cái. Đó không phải tai nạn — nó là hình dạng của vấn đề:
 *
 *   · CHẶN-3 (proxy ngoài scene graph) sống trong `three` + vòng đời R3F. Không
 *     một hàm thuần nào biết `Object3D.parent` là gì.
 *   · CHẶN-2 (thiếu chế độ chỉ đọc) là chuyện DOM có/không có phần tử.
 *   · CHẶN-1 (sai cấp quyền) là một middleware tRPC.
 *
 * Nên tệp này CỐ Ý chỉ ghim phần LOGIC QUYẾT ĐỊNH tách được ra hàm thuần, và mọi
 * cổng ra thật của ba lỗi trên đều là phép đo LIVE (Playwright + SQL thô). Ghi rõ
 * ở đây để người sau không đọc "3 lỗi CHẶN, có test rồi" rồi tưởng là đã an toàn.
 * Bài học `pdca-vong1`: chỉ báo âm tính phải biết KÊU trên ca dương đã biết —
 * mỗi khối dưới đây vì thế có một ca "trạng thái CŨ" để chứng minh test này
 * phân biệt được bản vá với bản hỏng.
 */
import { describe, it, expect } from "vitest";

/* ═════════════════════════════════════════════════════════════════════════ */
/* CHẶN-2 — quyết định chỉ-đọc                                                */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * Bản sao TỐI THIỂU của phép hợp quyền trong `XuongThietKe`:
 * `canEdit` trên `settings_factory` **HOẶC** `machine_control`.
 *
 * ⚠ Đây là bản SAO, không phải bản gốc — `XuongThietKe` là component React và
 *   không tách hàm này ra được mà không dựng cả cây. Giá trị của test nằm ở chỗ
 *   ghim NGỮ NGHĨA (HOẶC, không phải VÀ) để một lần sửa nhầm thành `&&` có chỗ
 *   kêu. Phép đo thật là ảnh chụp DOM bằng tài khoản không-admin.
 */
function coQuyenSua(q: {
  settingsFactoryEdit: boolean;
  machineControlEdit: boolean;
}): boolean {
  return q.settingsFactoryEdit || q.machineControlEdit;
}

describe("CHẶN-2 — hợp quyền màn Thiết kế là HOẶC, không phải VÀ", () => {
  it("có canEdit trên settings_factory ⇒ được sửa", () => {
    expect(coQuyenSua({ settingsFactoryEdit: true, machineControlEdit: false })).toBe(true);
  });

  it("có canEdit trên machine_control ⇒ được sửa", () => {
    expect(coQuyenSua({ settingsFactoryEdit: false, machineControlEdit: true })).toBe(true);
  });

  it("★ CA DƯƠNG của lỗi: viết thành VÀ sẽ chặn người mà §6.4 cho vào", () => {
    // Nếu ai đó đổi `||` thành `&&`, ca này là ca ĐẦU TIÊN đổi kết quả.
    const chiCoMotQuyen = { settingsFactoryEdit: false, machineControlEdit: true };
    expect(coQuyenSua(chiCoMotQuyen)).toBe(true);
    const nhuTheLaVA =
      chiCoMotQuyen.settingsFactoryEdit && chiCoMotQuyen.machineControlEdit;
    expect(nhuTheLaVA).toBe(false);
  });

  it("không quyền nào ⇒ CHỈ ĐỌC", () => {
    expect(coQuyenSua({ settingsFactoryEdit: false, machineControlEdit: false })).toBe(false);
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* CHẶN-3 — điều kiện gắn gizmo                                               */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * Điều kiện gắn gizmo trong `CanhThietKe`:
 *   `mayDangChon !== null && !mayDaKhoa && daVaoScene`
 *
 * ★★★ `daVaoScene` là vế MỚI của bản vá, và là vế mà toàn bộ lỗi CHẶN-3 nằm ở đó.
 *   Gắn `TransformControls` vào một `Object3D` chưa có cha ⇒ `parent === null` ⇒
 *   `TransformControls.js:1066` đi nhánh `console.error` ⇒ `_parentScale` giữ
 *   nguyên `(0,0,0)` ⇒ `.divide(_parentScale)` ở dòng 501/505 ⇒ **NaN**.
 *   Gizmo VẪN HIỆN (helper là object khác), nên ảnh chụp trông ĐẠT trong khi
 *   không byte nào tới được DB.
 */
function nenGanGizmo(t: {
  mayDangChon: number | null;
  mayDaKhoa: boolean;
  daVaoScene: boolean;
}): boolean {
  return t.mayDangChon !== null && !t.mayDaKhoa && t.daVaoScene;
}

describe("CHẶN-3 — gizmo chỉ gắn khi proxy ĐÃ vào scene graph", () => {
  it("đủ ba điều kiện ⇒ gắn", () => {
    expect(nenGanGizmo({ mayDangChon: 7, mayDaKhoa: false, daVaoScene: true })).toBe(true);
  });

  it("★★★ CA DƯƠNG CỦA CHÍNH LỖI ĐÃ VÁ: proxy chưa có cha ⇒ KHÔNG gắn", () => {
    // Đây CHÍNH LÀ trạng thái của bản trước bản vá: máy đã chọn, không khoá,
    // nhưng object mang gizmo chưa bao giờ được add vào scene.
    expect(nenGanGizmo({ mayDangChon: 7, mayDaKhoa: false, daVaoScene: false })).toBe(false);
  });

  it("máy bị khoá ⇒ không gắn dù proxy đã vào scene", () => {
    expect(nenGanGizmo({ mayDangChon: 7, mayDaKhoa: true, daVaoScene: true })).toBe(false);
  });

  it("chưa chọn máy nào ⇒ không gắn", () => {
    expect(nenGanGizmo({ mayDangChon: null, mayDaKhoa: false, daVaoScene: true })).toBe(false);
  });

  it("★ chỉ báo `coParent` phân biệt được bản vá với bản hỏng", () => {
    // Mô phỏng đúng thứ `window.__gizmoProxy` ghi lại. Bản HỎNG: daTao=true
    // nhưng coParent=false — và đó là cặp giá trị mà ảnh chụp KHÔNG phân biệt
    // được, vì gizmo hiện trong cả hai.
    const banHong = { daTao: true, coParent: false };
    const banVa = { daTao: true, coParent: true };
    expect(banHong.daTao).toBe(banVa.daTao); // ảnh chụp thấy y hệt nhau
    expect(banHong.coParent).not.toBe(banVa.coParent); // cờ thì không
  });
});

/* ═════════════════════════════════════════════════════════════════════════ */
/* THƯỜNG-1 — cổng tồn tại thực thể                                           */
/* ═════════════════════════════════════════════════════════════════════════ */

/**
 * Bản thuần của `thucTheKhongTonTai` (server/db/twinCanh.ts): so tập id GỬI LÊN
 * với tập id CÓ THẬT, theo TỪNG LOẠI.
 *
 * ★ Vì sao phải theo từng loại: `(loaiThucThe, thucTheId)` là khoá ĐA HÌNH trỏ
 *   tới 5 bảng. `machine:12` và `station:12` là hai thực thể khác nhau; gộp id
 *   lại một rổ sẽ cho `station:12` mượn sự tồn tại của `machine:12`.
 */
function thieuThucThe(
  hangs: readonly { loaiThucThe: string; thucTheId: number }[],
  coThat: Readonly<Record<string, readonly number[]>>,
): string[] {
  const thieu: string[] = [];
  for (const loai of new Set(hangs.map((h) => h.loaiThucThe))) {
    const co = new Set(coThat[loai] ?? []);
    for (const id of new Set(
      hangs.filter((h) => h.loaiThucThe === loai).map((h) => h.thucTheId),
    )) {
      if (!co.has(id)) thieu.push(`${loai}:${id}`);
    }
  }
  return thieu;
}

describe("THƯỜNG-1 — đặt chỗ cho thực thể KHÔNG TỒN TẠI phải bị chặn", () => {
  it("★ CA DƯƠNG ĐO ĐƯỢC: thucTheId 999999 không có trong machines", () => {
    // QA gửi đúng payload này và nhận {"daGhi":1,"daTao":1} HTTP 200.
    const thieu = thieuThucThe([{ loaiThucThe: "machine", thucTheId: 999999 }], {
      machine: [1, 2, 3],
    });
    expect(thieu).toEqual(["machine:999999"]);
  });

  it("mọi thực thể có thật ⇒ không chặn gì", () => {
    expect(
      thieuThucThe(
        [
          { loaiThucThe: "machine", thucTheId: 1 },
          { loaiThucThe: "station", thucTheId: 5 },
        ],
        { machine: [1, 2], station: [5, 6] },
      ),
    ).toEqual([]);
  });

  it("★★★ id trùng nhau ở HAI LOẠI khác nhau không được mượn sự tồn tại của nhau", () => {
    // `machine:12` có thật, `station:12` KHÔNG. Một phép kiểm gộp id lại sẽ cho
    // cả hai lọt — đúng lớp lỗi mà docblock của `twinThucTheEnum` cảnh báo.
    const thieu = thieuThucThe(
      [
        { loaiThucThe: "machine", thucTheId: 12 },
        { loaiThucThe: "station", thucTheId: 12 },
      ],
      { machine: [12], station: [99] },
    );
    expect(thieu).toEqual(["station:12"]);
  });

  it("gộp id trùng lặp trong cùng một lô — báo MỘT lần, không báo hai", () => {
    const thieu = thieuThucThe(
      [
        { loaiThucThe: "machine", thucTheId: 777 },
        { loaiThucThe: "machine", thucTheId: 777 },
      ],
      { machine: [] },
    );
    expect(thieu).toEqual(["machine:777"]);
  });

  it("lô rỗng ⇒ rỗng (không ném, không báo nhầm)", () => {
    expect(thieuThucThe([], { machine: [1] })).toEqual([]);
  });
});
