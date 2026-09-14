/**
 * xuatUsd.unit.test.ts — lưới cho §11 #1 (nút xuất USD/USDA).
 *
 * ★★★ HAI MẪU DƯỚI ĐÂY LÀ NGUYÊN VĂN ĐẦU RA THẬT của `buildFactoryUsda`, chép
 *     từ lần chạy 2026-09-07 trên DB dev (`npx tsx` gọi thẳng hàm server):
 *
 *       factory 1 → 40.025 byte · 142 prim   (cắt gọn phần thân, GIỮ hình dạng)
 *       factory 2 →    115 byte ·   0 prim   (NGUYÊN VĂN, không cắt gì)
 *
 *     Mẫu factory 2 quan trọng hơn mẫu factory 1: nó là ca "thành công mà rỗng"
 *     mà G28 cấm, và nó KHÔNG ném lỗi, KHÔNG trả chuỗi rỗng. Nếu lưới này chỉ
 *     có mẫu factory 1 thì `thamDinhUsda` viết thành `() => ({lyDo: null})` vẫn
 *     XANH — tức là cổng xanh trên `f(x)=x` (G5/G32).
 */
import { describe, it, expect } from "vitest";

import {
  demByteUtf8,
  demPrim,
  tenTepUsd,
  thamDinhUsda,
  xuatUsd,
  type KetQuaUsdExport,
} from "./xuatUsd";
import type { DocTaiXuong } from "../thiet-ke/xuatAnh";

/* ── Mẫu THẬT: factory 2, NGUYÊN VĂN 115 byte, 0 prim ────────────────────── */
const USDA_TRONG = `#usda 1.0
(
    doc = "ST4I twin USD export — empty stage (no factory)"
    metersPerUnit = 1
    upAxis = "Z"
)
`;

/* ── Mẫu THẬT: factory 1, giữ nguyên hình dạng (header + prim lồng nhau) ─── */
const USDA_THAT = `#usda 1.0
(
    defaultPrim = "factory_1"
    doc = "ST4I twin USD export — Nhà máy ảo (SIM) (ts 1788780806805)"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "factory_1" (
    kind = "assembly"
)
{
    custom string st4i:factoryCode = "SIM-FAC"
    def Scope "Looks"
    {
        def Material "Mat_stopped"
        {
            def Shader "PreviewSurface"
            {
                uniform token info:id = "UsdPreviewSurface"
            }
        }
    }
    def Scope "Lines"
    {
        def Xform "line_1"
        {
            def Xform "station_1"
            {
                def Xform "may_11"
                {
                    def Cube "geo"
                    {
                    }
                }
            }
        }
    }
}
`;

/** `document` giả — ghi lại đúng những gì nút bấm làm với DOM. */
function docGia(hong = false) {
  const daBam: Array<{ href: string; download: string }> = [];
  let daGan = 0;
  let daGo = 0;
  const doc: DocTaiXuong = {
    createElement: () => {
      if (hong) throw new Error("createElement hỏng");
      const a = { href: "", download: "", style: {} as Record<string, string>, click: () => {}, remove: () => { daGo += 1; } };
      a.click = () => daBam.push({ href: a.href, download: a.download });
      return a;
    },
    body: { appendChild: () => { daGan += 1; }, removeChild: () => { daGo += 1; } },
  };
  return { doc, daBam, soGan: () => daGan, soGo: () => daGo };
}

describe("demPrim — đếm prim `def`", () => {
  it("stage THẬT: đếm đúng số prim def lồng nhau", () => {
    // 8 dòng `def ` trong mẫu: Xform factory, Scope Looks, Material, Shader,
    // Scope Lines, Xform line, Xform station, Xform may, Cube geo = 9.
    expect(demPrim(USDA_THAT)).toBe(9);
  });

  it("★ stage RỖNG THẬT (factory 2, nguyên văn): đúng 0 prim", () => {
    expect(demPrim(USDA_TRONG)).toBe(0);
  });

  it("★ KHÔNG đếm chữ `def` nằm giữa dòng — neo đầu dòng là bắt buộc", () => {
    // Nếu bỏ neo `^`, chuỗi "undefined" trong doc sẽ khớp và stage rỗng này
    // tự khai là có prim.
    const bay = `#usda 1.0\n(\n    doc = "value is undefined, redefined"\n)\n`;
    expect(demPrim(bay)).toBe(0);
  });

  it("★ đếm được prim thụt lề (cờ `m`, không chỉ đầu chuỗi)", () => {
    const s = `#usda 1.0\ndef A "x"\n    def B "y"\n\tdef C "z"\n`;
    expect(demPrim(s)).toBe(3);
  });

  it("chuỗi rỗng / không phải chuỗi ⇒ 0", () => {
    expect(demPrim("")).toBe(0);
    expect(demPrim(null as unknown as string)).toBe(0);
  });
});

describe("thamDinhUsda — cổng G28", () => {
  it("stage THẬT ⇒ cho qua, kèm số prim và số byte đo tại chỗ", () => {
    const td = thamDinhUsda({ usda: USDA_THAT, byteLength: 999 });
    expect(td.lyDo).toBeNull();
    expect(td.soPrim).toBe(9);
    // Số byte là của CHUỖI THẬT, không phải `byteLength` server khai (999).
    expect(td.soByte).toBe(demByteUtf8(USDA_THAT));
    expect(td.soByte).not.toBe(999);
  });

  it("★★★ stage RỖNG THẬT ⇒ CHẶN với lý do `canh-trong` (đây là ca G28)", () => {
    const td = thamDinhUsda({ usda: USDA_TRONG, byteLength: 115 });
    expect(td.lyDo).toBe("canh-trong");
    expect(td.soPrim).toBe(0);
    // ★ Nó CÓ nội dung — 115 byte. Mọi phép kiểm `length > 0` sẽ cho nó qua.
    expect(td.soByte).toBe(115);
    expect(td.soByte).toBeGreaterThan(0);
  });

  it("chuỗi rỗng ⇒ `rong`", () => {
    expect(thamDinhUsda({ usda: "", byteLength: 0 }).lyDo).toBe("rong");
    expect(thamDinhUsda({ usda: "   \n ", byteLength: 5 }).lyDo).toBe("rong");
    expect(thamDinhUsda(null).lyDo).toBe("rong");
    expect(thamDinhUsda(undefined).lyDo).toBe("rong");
  });

  it("thiếu header `#usda` ⇒ `khong-phai-usda` (hợp đồng server đã đổi?)", () => {
    const td = thamDinhUsda({ usda: `<html>lỗi 500</html>\ndef X "y"\n`, byteLength: 30 });
    expect(td.lyDo).toBe("khong-phai-usda");
  });
});

describe("tenTepUsd", () => {
  it("đuôi .usda + mốc giờ ĐỊA PHƯƠNG + slug bỏ dấu", () => {
    const khi = new Date(2026, 8, 7, 14, 30, 5); // 2026-09-07 14:30:05 địa phương
    expect(tenTepUsd("Nhà máy ảo (SIM)", khi)).toBe("twin-nha-may-ao-sim-20260907-143005.usda");
  });

  it("nhãn rỗng ⇒ vẫn có tên hợp lệ, không có dấu `--`", () => {
    const khi = new Date(2026, 0, 2, 3, 4, 5);
    expect(tenTepUsd("", khi)).toBe("twin-20260102-030405.usda");
  });
});

describe("xuatUsd — đường bấm nút, CẢ HAI chiều", () => {
  const khi = new Date(2026, 8, 7, 14, 30, 5);

  it("★ ca DƯƠNG: stage thật ⇒ tải xuống THẬT SỰ xảy ra, nội dung đi kèm", () => {
    const g = docGia();
    const kq = xuatUsd({ usda: USDA_THAT, byteLength: 1 }, g.doc, "Nhà máy ảo (SIM)", khi);
    expect(kq.xong).toBe(true);
    expect(kq.lyDo).toBeNull();
    expect(kq.soPrim).toBe(9);
    // ĐO BẰNG SỐ LẦN BẤM THẬT, không bằng cờ trả về (G16/G46).
    expect(g.daBam).toHaveLength(1);
    expect(g.daBam[0].download).toBe("twin-nha-may-ao-sim-20260907-143005.usda");
    // ★ NỘI DUNG THẬT nằm trong href — giải mã lại phải ra ĐÚNG chuỗi gốc.
    const daGiaiMa = decodeURIComponent(g.daBam[0].href.replace(/^data:text\/plain;charset=utf-8,/, ""));
    expect(daGiaiMa).toBe(USDA_THAT);
    expect(demPrim(daGiaiMa)).toBe(9);
    // `<a>` phải được gắn vào document TRƯỚC khi click (bẫy Firefox).
    expect(g.soGan()).toBe(1);
  });

  it("★★★ ca ÂM: stage rỗng ⇒ KHÔNG tải gì cả (0 lần bấm)", () => {
    const g = docGia();
    const kq = xuatUsd({ usda: USDA_TRONG, byteLength: 115 }, g.doc, "Nhà máy 2", khi);
    expect(kq.xong).toBe(false);
    expect(kq.lyDo).toBe("canh-trong");
    // ★ Đây là khẳng định đắt nhất của cả tệp: KHÔNG CÓ tệp nào rời trình duyệt.
    expect(g.daBam).toHaveLength(0);
    expect(g.soGan()).toBe(0);
  });

  it("ca ÂM: document hỏng ⇒ `tai-loi`, không ném", () => {
    const g = docGia(true);
    const kq = xuatUsd({ usda: USDA_THAT, byteLength: 1 }, g.doc, "x", khi);
    expect(kq.xong).toBe(false);
    expect(kq.lyDo).toBe("tai-loi");
    // ★ Thẩm định vẫn chạy TRƯỚC khi tải — số prim có thật dù tải hỏng.
    expect(kq.soPrim).toBe(9);
  });

  it("ca ÂM: không có document ⇒ `tai-loi`", () => {
    expect(xuatUsd({ usda: USDA_THAT, byteLength: 1 }, null, "x", khi).lyDo).toBe("tai-loi");
  });

  it("★ tên nhà máy có dấu KHÔNG làm hỏng data URL (bẫy btoa)", () => {
    const g = docGia();
    const usda = `#usda 1.0\ndef Xform "x"\n{\n    custom string st4i:name = "Nhà máy Đông Anh — 日本"\n}\n`;
    const kq = xuatUsd({ usda, byteLength: 1 }, g.doc, "Đông Anh", khi);
    expect(kq.xong).toBe(true);
    const daGiaiMa = decodeURIComponent(g.daBam[0].href.replace(/^data:text\/plain;charset=utf-8,/, ""));
    expect(daGiaiMa).toBe(usda);
  });
});

describe("demByteUtf8", () => {
  it("khớp với số byte UTF-8 thật (ký tự nhiều byte)", () => {
    expect(demByteUtf8("abc")).toBe(3);
    expect(demByteUtf8("à")).toBe(2);
    expect(demByteUtf8("日")).toBe(3);
    expect(demByteUtf8("😀")).toBe(4);
    // Mẫu factory 2 thật: 115 byte.
    expect(demByteUtf8(USDA_TRONG)).toBe(115);
  });
});
