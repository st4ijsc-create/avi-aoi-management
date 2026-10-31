/**
 * Đợt 12 · H1.1 — THƯỚC NGOẠI TUYẾN đo chi phí của NÉN NGỮ CẢNH (không GPU, tất định). Mô phỏng mất cache tiền tố của llama.cpp:
 * ở mỗi lượt gọi model, so yêu cầu với yêu cầu TRƯỚC — tin đầu tiên khác nhau (`viTriSuaSom`) là chỗ cache tiền tố bắt đầu mất; token
 * "phải xử lý lại" ≈ ước lượng token từ tin đó tới cuối yêu cầu (lượt đầu: toàn bộ). Chuỗi chỉ-nối-thêm ⇒ chỉ xử lý lại phần mới.
 *
 * Kịch bản: lượt dài (`SO_BUOC` lượt model), mỗi lượt model nghĩ ~`TOKEN_NGHI` token (giữ trong lịch sử như host thật khi `giuNghiTrongLichSu`)
 * và gọi read_file; kết quả tool ~`KY_TU_KET_QUA` ký tự; ngân sách ngữ cảnh `NGAN_SACH`. Số đo ghi ra console (bảng) và GHIM ở
 * `DUONG_NEN` — H1.1 (nén xuống mốc thấp) đổi mã nén thì CẬP NHẬT ghim cùng commit, kèm số trước/sau.
 */
import { describe, expect, it } from "vitest";
import { chayVongAgent } from "./vongAgent";
import { congCuTheoCheDo } from "./congCu";
import { uocLuongTinNhan } from "./nguCanh";
import type { BoThucThi, GoiModel, ManhModel, SuKienAgent, TinNhan } from "./kieu";

const SO_BUOC = 80;
const TOKEN_NGHI = 1500;
const KY_TU_KET_QUA = 7000;
const NGAN_SACH = 65_536;
/** Bộ đếm token THẬT của model so với ước lượng 2,8 ký tự/token của lõi (tiếng Việt/mã/JSON thường dày hơn) + system/schema công cụ ước lượng bỏ sót. */
const HE_SO_THAT = 1.4;
const TOKEN_CONG_CU_THAT = 3500;

export interface SoDoNen {
  soBuoc: number;
  soLanNen: number;
  /** tổng token ước lượng của MỌI yêu cầu (nếu không có cache nào) */
  tongTokenYeuCau: number;
  /** tổng token phải xử lý lại nếu cache tiền tố chạy lý tưởng (từ tin sớm nhất bị sửa tới cuối) */
  tongTokenXuLyLai: number;
  /** số bước mà tin bị sửa sớm nhất nằm TRƯỚC tin cuối của yêu cầu trước (= cache tiền tố bị cắt cụt) */
  soBuocMatCache: number;
  /** số bước mà `vao` THẬT vượt ngân sách ngữ cảnh (= llama.cpp sẽ cắt/lỗi tràn) */
  soBuocTran: number;
  /** vị trí tin sớm nhất bị sửa ở từng bước (null: chỉ nối thêm) */
  viTriSuaSom: Array<number | null>;
}

export async function doNen(tuyChon: { mucDichNen?: number; demNguCanhSoThat?: boolean } = {}): Promise<SoDoNen> {
  const { mucDichNen, demNguCanhSoThat } = tuyChon;
  const vaoThat: number[] = [];
  const yeuCau: TinNhan[][] = [];
  const suKien: SuKienAgent[] = [];
  let i = 0;
  const goiModel: GoiModel = (v) => {
    yeuCau.push(structuredClone(v.tinNhan));
    const k = i++;
    vaoThat[k] = Math.round(uocLuongTinNhan(v.tinNhan) * HE_SO_THAT) + TOKEN_CONG_CU_THAT;
    const cuoi = k >= SO_BUOC - 1;
    return (async function* (): AsyncGenerator<ManhModel> {
      yield { loai: "nghi", noiDung: `k${k} ` + "n".repeat(Math.round(TOKEN_NGHI * 2.8)) };
      yield {
        loai: "xong",
        toolCalls: cuoi ? [] : [{ id: `c${k}`, type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: `src/f${k}.ts` }) } }],
        usage: { vao: vaoThat[k]!, ra: Math.round(TOKEN_NGHI * HE_SO_THAT) },
      } as ManhModel;
    })();
  };
  const bo: BoThucThi = {
    congCu: (c) => congCuTheoCheDo(c),
    chay: async () => ({ ok: true, choModel: "x".repeat(KY_TU_KET_QUA) }),
  };
  await chayVongAgent({
    cauHoi: "đọc nhiều tệp",
    cheDo: "hoi",
    runId: "thuoc",
    nguCanhDuAn: "",
    goiModel,
    boThucThi: bo,
    phat: (e) => suKien.push(e),
    signal: new AbortController().signal,
    gioiHan: { nganSachNguCanhToken: NGAN_SACH, soLuotToiDa: SO_BUOC + 5, tokenRaToiDa: 10_000_000 },
    giuNghiTrongLichSu: true,
    ...(mucDichNen !== undefined ? { mucDichNen } : {}),
    ...(demNguCanhSoThat ? { demNguCanhSoThat } : {}),
  });

  const viTri: Array<number | null> = [];
  let tongYeuCau = 0;
  let tongLai = 0;
  let matCache = 0;
  yeuCau.forEach((cur, k) => {
    const tokenCur = uocLuongTinNhan(cur);
    tongYeuCau += tokenCur;
    if (k === 0) {
      viTri.push(0);
      tongLai += tokenCur;
      return;
    }
    const truoc = yeuCau[k - 1]!;
    let d = 0;
    while (d < truoc.length && d < cur.length && JSON.stringify(truoc[d]) === JSON.stringify(cur[d])) d++;
    if (d >= truoc.length) {
      viTri.push(null);
      tongLai += uocLuongTinNhan(cur.slice(d));
    } else {
      viTri.push(d);
      matCache++;
      tongLai += uocLuongTinNhan(cur.slice(d));
    }
  });
  const soLanNen = suKien.filter((e) => e.loai === "buoc-do" && e.nen !== null).length;
  return { soBuoc: yeuCau.length, soLanNen, tongTokenYeuCau: tongYeuCau, tongTokenXuLyLai: tongLai, soBuocMatCache: matCache, soBuocTran: vaoThat.filter((v) => v > NGAN_SACH).length, viTriSuaSom: viTri };
}

describe("thước đo nén ngữ cảnh (đường nền)", () => {
  it("tất định: hai lần chạy cho đúng cùng số đo", async () => {
    const a = await doNen();
    const b = await doNen();
    expect(b).toEqual(a);
  });

  it("★ ĐƯỜNG NỀN (mã hiện tại): số đo ghim — H1.1 đổi thì cập nhật cùng commit kèm số trước/sau", async () => {
    const r = await doNen();
    console.log(
      `THUOC-NEN soBuoc=${r.soBuoc} soLanNen=${r.soLanNen} tongTokenYeuCau=${r.tongTokenYeuCau} tongTokenXuLyLai=${r.tongTokenXuLyLai} ` +
        `soBuocMatCache=${r.soBuocMatCache} (${Math.round((100 * r.tongTokenXuLyLai) / r.tongTokenYeuCau)}% phải xử lý lại)`,
    );
    expect(r.soBuoc).toBe(SO_BUOC);
    // ĐƯỜNG NỀN đo 2026-10-31 (64k, 80 bước): nén ở 68/80 bước, 86 % token phải xử lý lại.
    expect(r).toMatchObject({ soLanNen: 68, tongTokenYeuCau: 3317565, tongTokenXuLyLai: 2836663, soBuocMatCache: 68 });
  });
});

describe("H1.1 nén xuống mốc thấp (mucDichNen)", () => {
  it("★ mốc 0,5: ít lần nén hơn nhiều và ít token phải xử lý lại hơn đường nền", async () => {
    const nen = await doNen();
    const thap = await doNen({ mucDichNen: 0.5 });
    console.log(
      `THUOC-NEN-MOC0.5 soLanNen=${thap.soLanNen} tongTokenXuLyLai=${thap.tongTokenXuLyLai} soBuocMatCache=${thap.soBuocMatCache} (${Math.round((100 * thap.tongTokenXuLyLai) / thap.tongTokenYeuCau)}% phải xử lý lại; nền ${Math.round((100 * nen.tongTokenXuLyLai) / nen.tongTokenYeuCau)}%)`,
    );
    // mốc 0,5 đo 2026-10-31: nén 17/80 bước (nền 68), 26 % token phải xử lý lại (nền 86 %).
    expect(thap).toMatchObject({ soLanNen: 17, tongTokenXuLyLai: 745597, soBuocMatCache: 17 });
    expect(thap.tongTokenXuLyLai).toBeLessThan(nen.tongTokenXuLyLai * 0.3);
  });
});

describe("H1.2 đếm ngữ cảnh bằng số thật (demNguCanhSoThat)", () => {
  it("★ đo: đường nền vs số thật vs số thật + mốc 0,5", async () => {
    const nen = await doNen();
    const that = await doNen({ demNguCanhSoThat: true });
    const thatThap = await doNen({ demNguCanhSoThat: true, mucDichNen: 0.5 });
    const dong = (ten: string, r: SoDoNen) =>
      `${ten}: soLanNen=${r.soLanNen} soBuocTran=${r.soBuocTran} xuLyLai=${Math.round((100 * r.tongTokenXuLyLai) / r.tongTokenYeuCau)}%`;
    console.log(`THUOC-SO-THAT ${dong("nen", nen)} | ${dong("soThat", that)} | ${dong("soThat+0.5", thatThap)}`);
    // đo 2026-10-31 với HE_SO_THAT=1.4 (GIẢ ĐỊNH tổng hợp — hệ số thật đo từ buoc-do.tokenUoc/vaoThat ở cửa sổ GPU): nền tràn 51/80 bước vì
    // ước lượng thuần bỏ sót system+schema và đếm thiếu; neo số thật ⇒ 0 bước tràn.
    expect(nen).toMatchObject({ soLanNen: 68, soBuocTran: 51 });
    expect(that).toMatchObject({ soLanNen: 72, soBuocTran: 0 });
    expect(thatThap).toMatchObject({ soLanNen: 18, soBuocTran: 0 });
  });
});
