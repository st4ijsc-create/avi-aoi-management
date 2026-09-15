# Cảnh Twin nhiều nhà máy — thiết kế (Task 17, Giai đoạn 6)

> **Trạng thái: CHỜ CHỦ DỰ ÁN CHỐT PHƯƠNG ÁN.** Tài liệu này KHÔNG sửa một byte mã sản phẩm.
> Mọi con số trong đây là **phép đo chạy được**, không phải ước lượng; script đo nằm ở
> `.qa-tapdoan/t17-*.mts|mjs`, số thô ở `.qa-tapdoan/tho/T17/*.json`.
> Đo ngày **2026-09-15**, HEAD `a147fc35`, nhánh `feat/ai-local-L7-hang-rao`,
> **không có cổng ứng dụng nào chạy** (đo thẳng ở tầng hàm/DB, đúng yêu cầu của chủ dự án).

---

## 0. Câu hỏi phải trả lời

QA lần 11 xếp vai **giám đốc = CHƯA DÙNG ĐƯỢC**. Lý do không phải màn xấu hay số sai: người được gán
cấp tập đoàn (3 nhà máy) mở phạm vi `?pv=tapdoan` thì **màn hạ cấp xuống một nhà máy** và nói thẳng
ra điều đó bằng banner. Sản phẩm **không nói dối**, nhưng vai giám đốc không có màn của mình.

Chủ dự án chốt hướng: *thiết kế để mở rộng thêm*. Tài liệu này trả lời: **gộp ở đâu, hàng rào giữ thế
nào, toạ độ dời ra sao, trần bao nhiêu, ngân sách vẽ có đủ không, và nghiệm thu bằng phép đo nào.**

---

## 1. BƯỚC 1 — Hiện trạng hợp đồng (đo được, kèm số dòng)

### 1.1 `server/routers/twinCanhRouter.ts:1005-1062` — thủ tục `canhThietKe`

```
1005  canhThietKe: protectedProcedure
1006    .use(quyenDocHinhHoc())
1007    .input(
1008      z.object({
1009        factoryId: z.number().int().positive(),                        ← ĐÚNG MỘT MÃ
1010        tangIds: z.array(z.number().int().positive()).max(50).optional(),  ← TRẦN 50 TẦNG
1011      }),
1012    )
1013    .query(async ({ input, ctx }) => {
1014      const scope = phamViCua(ctx);
1015      const [cay, kichThuoc] = await Promise.all([
1016        traCayPhanCapNhaMay(input.factoryId, scope),                   ← cây của MỘT nhà máy
1017        traKichThuocTheoLoai(),
1018      ]);
1019      const datCho = input.tangIds?.length ? await traDatChoTheoTang(input.tangIds, scope) : [];
1031      const vung   = input.tangIds?.length ? await traVungAnToan(input.tangIds, scope) : [];
1055      const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
1056      const nhan = await resolveTenantFactoryScope({ userId: ctx.user?.id, userRole: ctx.user?.role });
1061      return { ...cay, datCho, kichThuoc, vung, ...nhan.labels };
1062    }),
```

Thủ tục này **không trả toà nhà**. Toà nhà đến từ `danhSachToaNha` (`:331-337`, cũng nhận đúng một
`factoryId` ở `:333`) và `chiTietToaNha` (`:339`). Một cảnh nhiều nhà máy cần cả hai nguồn.

### 1.2 `server/db/twinCanh.ts:962-1003` — `traCayPhanCapNhaMay(factoryId, scope)`

```
962  export async function traCayPhanCapNhaMay(factoryId: number, scope?: PhamViNguoiXem) {
965    if (!(await trongPhamVi("factory", factoryId, scope)))
966      return { xuong: [], chuyen: [], tram: [], may: [] };      ← ngoài phạm vi ⇒ CÂY RỖNG, không lỗi
969    const xuong  = … where(eq(workshops.factoryId, factoryId));  ← `eq`, không `inArray`
976    const chuyen = … where(inArray(productionLines.workshopId, xuongIds));
983    const tram   = … where(inArray(stations.lineId, chuyenIds));
990    const may    = … where(inArray(machines.stationId, tramIds));
1003 }
```

★ Ba tầng dưới **đã** là `inArray`. Chỉ tầng đầu (`:972`) là `eq`. Nới thành danh sách là đổi **một
dòng** ở tầng dữ liệu — phần khó nằm ở cổng, không ở SQL.

★★ `machines` **không có cột `factoryId`** (docblock `:957-960`). Cây trả về **không mang nhãn nhà
máy trên từng máy**: muốn biết máy thuộc nhà máy nào phải đi ngược `may → tram → chuyen → xuong →
factoryId`. Lưới ở Task 18 bước 1 của kế hoạch viết `kq.cay.may.every(m => m.factoryId === idA)` —
**trường ấy hôm nay không tồn tại**; hoặc thủ tục phải thêm nó, hoặc lưới phải đi qua `xuong`.

### 1.3 `server/db/twinCanh.ts:917-952` — `traDatChoTheoTang(tangIds, scope)`

```
917  export async function traDatChoTheoTang(tangIds, scope?) {
922    const hopLe: number[] = [];
923    for (const tangId of new Set(tangIds)) {                ← VÒNG LẶP TỪNG TẦNG
924      const factoryId = await nhaMayCuaTang(d, tangId);     ← 2 câu SQL (twin_tang, rồi twin_toa_nha)
925      if (factoryId === null) continue;
926      if (await trongPhamVi("factory", factoryId, scope)) hopLe.push(tangId);   ← +2 câu SQL nữa
927    }
928    if (hopLe.length === 0) return [];
930    const hang = await d.select().from(twinDatCho).where(inArray(twinDatCho.tangId, hopLe));
952  }
```

Đây là **hình dạng đúng về mặt an toàn** (§4 giữ nguyên nó) nhưng là **N+1 bốn lần** về chi phí:

* `nhaMayCuaTang` (`:673-684`) = 1 câu `twin_tang` + `nhaMayCuaToaNha` (`:335-345`) 1 câu `twin_toa_nha`.
* `trongPhamVi` (`server/db/hierarchy.ts:269-272`) → `idsTrongPhamVi` (`:216-259`) →
  `resolveTenantFactoryScope` (`server/db/reportAggregators.ts:328-374`) + 1 câu `SELECT f.id FROM factories`.
  **Không có bộ nhớ đệm nào ở giữa** — phạm vi được phân giải lại **từ đầu cho từng tầng**.

Công thức đo được (khớp tuyệt đối, xem §2.2): `admin = 2N+1` câu · `có phạm vi = 4N+1` câu.

`traVungAnToan` (`:1779-1809`) đi qua `locTangTrongPhamVi` (`:1821-1836`) — cùng lớp lỗi, công thức
`admin = N+2` · `có phạm vi = 3N+2`, **kể cả khi kết quả là 0 hàng**.

### 1.4 `client/src/components/twin3d/van-hanh/boChonNap.ts` — hai trục, và chỗ hạ cấp

Module tự khai ở `:26-38` rằng có **HAI TRỤC**, và đây là điều phải hiểu trước khi thiết kế:

| trục | kiểu | trả lời câu hỏi | quyết định cái gì |
|---|---|---|---|
| **PHẠM VI** — `PhamVi` (`duongDanTwin.ts:37-45`) | `{cap: "tapDoan"\|"nhaMay"\|"tang"\|"line"\|"may", id}` | *"đang NHÌN cấp nào"* | camera, độ mờ (`phamViCanh.ts:53-82`), breadcrumb |
| **NẠP** — `LuaChonNap` (`boChonNap.ts:57-61`) | `{nhaMayId, toaNhaId, tangId}` — **ba ô, mỗi ô MỘT số** | *"đang HỎI dữ liệu của cái nào"* | `tangIds` gửi lên `canhThietKe` |

Trộn hai trục là sai (`pv=line:1` vẫn phải nạp cả tầng). Nhưng **tách hai trục không đủ để gộp**:
`LuaChonNap.nhaMayId` là **một ô số**, nên **trục NẠP hôm nay không diễn đạt nổi "ba nhà máy"** —
kể cả nếu server sẵn sàng. Đây là điểm chặn phía client, độc lập với hợp đồng server.

Hạ cấp nằm ở `:236-245`:

```
236  export function phamViThuc(yeuCau: PhamVi, soNhaMayCoThat: number, soNhaMayDaNap: number): PhamViThuc {
241    if (yeuCau.cap === "tapDoan" && soNhaMayCoThat > soNhaMayDaNap)
242      return { pv: { cap: "nhaMay", id: null }, daHaCap: true, capYeuCau: "tapDoan" };
244    return { pv: yeuCau, daHaCap: false, capYeuCau: yeuCau.cap };
245  }
```

Docblock `:199-218` ghi rõ đây là **lựa chọn (b) có chủ ý**: "nói đúng phạm vi nó đang hiện", vì (a)
"hiện đủ" đòi đổi hợp đồng server. Banner hiện ở `TwinVanHanh.tsx:2352-2362`, khoá i18n
`twin3d.vanHanh.haCapPhamVi` (vi/en/zh), nguyên văn tiếng Việt:

> "Đang hiện dữ liệu của MỘT nhà máy ({{soNhaMay}} nhà máy trong hệ). **Phạm vi Tập đoàn chưa nạp
> được nhiều nhà máy cùng lúc** — dùng ô Nhà máy để chuyển."

### 1.5 SÁU chỗ đang chặn việc gộp (không phải một)

| # | chỗ chặn | vị trí | bản chất |
|---|---|---|---|
| **C1** | đầu vào thủ tục nhận **một** mã | `twinCanhRouter.ts:1009` | hợp đồng vận chuyển |
| **C2** | cây nhận **một** mã, `eq` không `inArray` | `twinCanh.ts:962`, `:972` | tầng dữ liệu (1 dòng) |
| **C3** | **trần 50 tầng** trong khi 3 nhà máy = **84 tầng** | `twinCanhRouter.ts:1010` + `TwinVanHanh.tsx:650` (`.slice(0,50)`) | **cắt IM LẶNG** — `slice` không kêu |
| **C4** | trục NẠP có **một ô** `nhaMayId` | `boChonNap.ts:57-61` | mô hình client |
| **C5** | cảnh **không cộng toạ độ toà nhà** | `hopNhatCanh.ts:191` (`mmSangScene` chỉ lấy `d.viTri*Mm`) | hình học — xem §5 |
| **C6** | cảnh chỉ vẽ **một tầng** | `TwinVanHanh.tsx:1009` (`if (d.tangId !== tangId) continue`) | hình học |

**C3 là chỗ nguy hiểm nhất về sự trung thực**: `.slice(0, 50)` cắt 34 tầng của cảnh ba nhà máy mà
không một dòng nào kêu lên — đúng lớp lỗi mà chính module `boChonNap` (`:82-90`) cấm.

---

## 2. BƯỚC 2 — CHI PHÍ THẬT (đo trước, kết luận sau)

**Cách đo.** Gọi **thẳng hàm sản phẩm** (`traCayPhanCapNhaMay`, `traDatChoTheoTang`, `traVungAnToan`,
`traKichThuocTheoLoai`) qua `tsx`, trên DB dev `aoi@127.0.0.1:5434/aoi_management`, dữ liệu QATD đang
có. **Số câu SQL đếm bằng bộ đếm CỦA SẢN PHẨM** (`server/queryMonitor.getQueryStats().totalQueries`,
gắn vào `client.unsafe` — đúng đường drizzle gửi câu đi), không phải suy từ mã. Thời gian là
**trung vị của 5–7 lần**, sau một lượt làm nóng. **CHỈ SELECT.**

Ba vai đo, vì chi phí phụ thuộc vai:

| vai | tài khoản | gán | `resolveTenantFactoryScope` trả |
|---|---|---|---|
| admin | (scope vắng) | — | `factoryIds: null` ⇒ **không thêm mệnh đề nào, 0 câu SQL** |
| giám đốc | `qatd_giamdoc` id 26916 | `user_corporate_assignments` = `QATD` | `[41,42,43]` |
| quản lý | `qatd_quanly` id 26917 | `user_factory_assignments` = `QATD-A` | `[41]` |

Dữ liệu: QATD-A id 41 (371 máy · 4 toà · 28 tầng · 782 đặt chỗ) · QATD-B id 42 (409 · 4 · 28 · 861) ·
QATD-C id 43 (328 · 4 · 28 · 695). Tổng **1.108 máy · 12 toà · 84 tầng · 2.338 đặt chỗ**.

### 2.1 Bảng chính — THÂN `canhThietKe` đầy đủ (`.qa-tapdoan/tho/T17/than-gop.json`)

| đường | vai | **câu SQL** | **ms (trung vị, min–max)** | KB thô / **gzip** | máy / đặt chỗ trả về |
|---|---|---:|---:|---:|---|
| SẢN PHẨM · **1** nhà máy (28 tầng) | admin | **93** | **110,5** (100–130) | 303,7 / **18,8** | 371 / 782 |
| SẢN PHẨM · **1** nhà máy | giám đốc | **207** | **211,4** (206–242) | 303,7 / **18,8** | 371 / 782 |
| SẢN PHẨM · **1** nhà máy | quản lý | **207** | **267,5** (238–637) | 303,7 / **18,8** | 371 / 782 |
| SẢN PHẨM · **3** nhà máy (84 tầng) | admin | **269** | **299,5** (287–324) | 904 / **53,5** | 1.108 / 2.338 |
| SẢN PHẨM · **3** nhà máy | giám đốc | **611** | **666,6** (586–716) | 904 / **53,5** | 1.108 / 2.338 |
| SẢN PHẨM · **3** nhà máy | quản lý | **603** | **650,2** (583–678) | 303,8 / **18,8** | **371 / 782** |
| **[ABLATION] CỔNG GỘP** · 3 nhà máy | admin | **9** | **15,8** (14–23) | 1369 / 59,1 | 1.108 / 2.338 |
| **[ABLATION] CỔNG GỘP** · 3 nhà máy | giám đốc | **10** | **25,2** (16–35) | 1369 / 59,1 | 1.108 / 2.338 |
| **[ABLATION] CỔNG GỘP** · 3 nhà máy | quản lý | **10** | **8,9** (8,7–9,7) | 459 / 21,0 | **371 / 782** |

> "CỔNG GỘP" = **cùng dữ liệu, cùng hàng rào, khác cách đặt cổng**: phân giải phạm vi **một lần**,
> lọc mã nhà máy trong bộ nhớ, lọc tầng bằng **một câu JOIN `twin_tang → twin_toa_nha → factoryId`**.
> KB thô lớn hơn vì ablation `SELECT *` chưa cắt cột như sản phẩm — so sánh có nghĩa là **gzip** và
> **số câu/ms**.

**Đối chứng đúng-sai của ablation** (không có đối chứng thì con số nhanh chỉ là con số nhanh):
với vai `quanly` xin cả ba mã, đường CỔNG GỘP trả **371 máy / 782 đặt chỗ — bằng ĐÚNG đường sản
phẩm**, và chuỗi `"QATD-B"`/`"QATD-C"` **không xuất hiện trong phản hồi** (`ablation_ro_ten_B_hay_C:
false`). Đo riêng ở tầng `traDatChoTheoTang`: 782 hàng / 8 tầng khác nhau ở cả hai đường, **khớp**.

### 2.2 Bảng thành phần — chi phí nằm ở đâu (`.qa-tapdoan/tho/T17/dem-cau.json`)

| phép đọc | admin | giám đốc | quản lý (chỉ A) |
|---|---|---|---|
| `resolveTenantFactoryScope` (riêng) | **0 câu** / 0 ms | 1 câu / 2,3 ms | — |
| `traCayPhanCapNhaMay` **1** nhà máy | 4 / 12,5 ms | 6 / 13,0 ms | 8 / 9,7 ms |
| cây **3** nhà máy — **tuần tự** | 12 / 30,1 ms | 18 / 50,3 ms | 10 / 13,4 ms |
| cây **3** nhà máy — **song song** (`Promise.all`) | 12 / **22,9 ms** | 18 / **17,1 ms** | 10 / **10,4 ms** |
| `traDatChoTheoTang` **28** tầng | 57 / 81 ms | 113 / 132 ms | 113 / 115 ms |
| `traDatChoTheoTang` **50** tầng (trần hiện tại) | 101 / 123 ms | 201 / 256 ms | 201 / 246 ms |
| `traDatChoTheoTang` **84** tầng | **169 / 214 ms** | **337 / 367 ms** | **337 / 341 ms** |
| `traVungAnToan` **84** tầng (**trả 0 hàng**) | 86 / 113 ms | **254 / 261 ms** | 254 / 252 ms |
| [AB] `datCho` 84 tầng · **cổng gộp** | 2 / 17 ms | **3 / 8,2 ms** | **3 / 4,9 ms** |
| [AB] cây 3 nhà máy · **một bộ 4 câu** | 4 / 6,5 ms | **5 / 7,5 ms** | **5 / 5,2 ms** |

Công thức khớp tuyệt đối với mã ở §1.3 — đây là bằng chứng phép đo đo đúng thứ nó nói:

* `traDatChoTheoTang(N)`: admin `2N+1` (28→57 ✓, 50→101 ✓, 84→169 ✓) · có phạm vi `4N+1` (28→113 ✓, 50→201 ✓, 84→337 ✓)
* `traVungAnToan(N)`: admin `N+2` (84→86 ✓) · có phạm vi `3N+2` (84→254 ✓)

### 2.3 Bốn kết luận mà phép đo BẮT BUỘC, không phải gợi ý

**K1 — Cây phân cấp KHÔNG phải nút thắt.** Ba nhà máy song song tốn **17,1 ms / 18 câu** (giám đốc).
Gộp hay không gộp, cây không quyết định gì. Ai định dựa vào cây để chọn phương án là chọn sai trục.

**K2 — Nút thắt là CỔNG PHẠM VI ĐƯỢC PHÂN GIẢI LẠI TỪNG TẦNG.** Với giám đốc, thân đầy đủ 3 nhà máy
tốn **611 câu / 667 ms**, trong đó **591 câu (96,7 %)** đến từ hai vòng lặp `traDatChoTheoTang` (337)
và `traVungAnToan` (254). Đặt lại cổng cho **cùng một hàng rào** đưa xuống **10 câu / 25 ms**:
**61× ít câu, 27× nhanh hơn**, kết quả **giống hệt** (§2.1 đối chứng).

**K3 — HÔM NAY, TỪ CHỐI ĐẮT NGANG CHẤP NHẬN.** Vai `quanly` chỉ được xem QATD-A, xin ba nhà máy:
**603 câu / 650 ms** để rồi trả về đúng 371 máy — **gần bằng chi phí của giám đốc nhận đủ 1.108 máy**.
Hệ trả tiền cho việc *đọc rồi vứt* 56 tầng. Đây là điều khiến "cứ để client gọi song song ba lượt" trở
thành lựa chọn đắt: **mỗi lượt gọi tự trả lại toàn bộ tiền cổng của nó**, kể cả lượt sẽ bị từ chối.

**K4 — KÍCH THƯỚC PHẢN HỒI KHÔNG PHẢI VẤN ĐỀ.** Trên dây, phản hồi đi **gzip**:

| | thô | **gzip** |
|---|---:|---:|
| 1 nhà máy (371 máy, 782 đặt chỗ, 4 toà) | 312,4 KB | **20,1 KB** |
| 3 nhà máy (1.108 máy, 2.338 đặt chỗ, 12 toà) | 924,6 KB | **55,4 KB** |

**55 KB gzip** cho cả tập đoàn. Lý lẽ "một lượt gọi ba nhà máy thì phản hồi quá to" **bị phép đo bác
bỏ**. (Nguồn: `.qa-tapdoan/tho/T17/payload.json`.)

---

## 3. BƯỚC 3 — PHƯƠNG ÁN

### 3.1 PA-1 — "Ba lượt gọi song song, ghép ở trình duyệt" (không đổi hợp đồng server)

Giữ `canhThietKe` y nguyên. Client gọi `useQueries` ba lượt `{factoryId: 41|42|43, tangIds: …}`, rồi
ghép `may`/`datCho`/`toaNha` ở `hopNhatCanh`.

| | |
|---|---|
| **Sửa** | chỉ client: `boChonNap.ts` (C4), `TwinVanHanh.tsx`, `hopNhatCanh.ts` (C5/C6). **0 dòng server.** |
| **Chi phí đo được** | 3 × 207 câu = **621 câu**, tường ~**270–300 ms** nếu ba lượt thật sự song song (mỗi lượt 211 ms, ba kết nối trong pool 25). |
| **Số lượt HTTP** | 3 (và ×2 nếu tính `danhSachToaNha`) ⇒ **6 lượt**. |
| **Trần 50 tầng (C3)** | **vẫn vỡ**: mỗi lượt chỉ được 50 tầng, một nhà máy có 28 nên vừa — nhưng nếu một nhà máy có > 50 tầng thì `.slice(0,50)` lại cắt im lặng. Không xử lý được ở client. |
| **Hàng rào** | **không đổi một byte** — mỗi lượt vẫn đi qua `trongPhamVi` cũ. Mã ngoài phạm vi trả cây rỗng, **im lặng**, đúng thứ §4 đòi. Đây là điểm mạnh thật của PA-1. |
| **Ba thời điểm chụp** | ba lượt gọi = **ba `dataUpdatedAt` khác nhau**. Docblock `canhThietKe:1000-1004` tồn tại chính vì lớp lỗi này ("cây trái vẽ 41 máy trong khi cảnh 3D vẽ 40… và nó không kêu"). PA-1 **tái lập** lớp lỗi ấy ở quy mô ba nhà máy. |
| **Tải/lỗi từng phần** | phải thiết kế: 2/3 xong, 1/3 lỗi ⇒ vẽ 2 khối và **nói ra**, hay không vẽ gì? Thêm một trạng thái mới cho UI. |

### 3.2 PA-2 — "Đầu vào nhận danh sách mã, cổng gộp một lần" (đổi hợp đồng server)

`canhThietKe` nhận thêm `factoryIds?: number[]`, **giữ nguyên `factoryId`** cũ. Cổng phạm vi được
phân giải **một lần**; tầng được lọc bằng **một câu JOIN**.

| | |
|---|---|
| **Sửa** | `twinCanhRouter.ts` (đầu vào + thân), `twinCanh.ts` (cây nhận danh sách; **cổng gộp** cho `traDatChoTheoTang`/`traVungAnToan`), + phần client như PA-1. |
| **Chi phí đo được** | **10 câu / 25 ms** (giám đốc, 3 nhà máy, 84 tầng) — **[ABLATION] đã chạy thật**, kết quả khớp đường sản phẩm. |
| **Số lượt HTTP** | **1** (+1 cho toà nhà, hoặc gộp luôn toà nhà vào thân ⇒ vẫn 1). |
| **Trần 50 tầng (C3)** | **sửa được ở đúng chỗ**: nới trần theo §6 và **từ chối rõ ràng** khi vượt, thay vì `slice` im lặng. |
| **Hàng rào** | **đây là phần nguy hiểm** — cổng bị viết lại. Xem §4: bất biến + lưới trước, mã sau. |
| **Một thời điểm chụp** | một lượt gọi ⇒ cây, đặt chỗ, vùng, toà nhà **cùng một ảnh chụp**. Giữ đúng lý do `canhThietKe` ra đời. |
| **Lợi ngoài phạm vi task** | K3 biến mất cho **mọi** người gọi hiện có: 1 nhà máy · giám đốc đi từ **207 câu / 211 ms** xuống ~**9 câu / ~15 ms**. Màn Thiết kế và màn Vận hành **một nhà máy** cũng nhanh lên, không chỉ màn tập đoàn. |

### 3.3 PA-3 (biến thể của PA-2) — chỉ vá cổng, chưa nới danh sách

Tách PA-2 làm hai lượt giao: **(a)** thay vòng lặp từng-tầng bằng cổng gộp, giữ nguyên đầu vào một
mã; **(b)** sau đó mới nới `factoryIds`. Bước (a) là **thuần hiệu năng, 0 thay đổi hợp đồng, 0 thay
đổi hành vi** (đối chứng §2.1 đã chứng minh cùng kết quả), và nó gỡ K3 ngay.

> Ghi cho người thực thi: (a) **không phải** là thứ có thể làm "tiện tay". Nó viết lại cổng phạm vi —
> phải có đủ lưới của §4 trước khi chạm, y như PA-2.

### 3.4 Đánh đổi cạnh nhau

| trục | PA-1 (client ghép) | PA-2 (server nhận danh sách) |
|---|---|---|
| số lượt gọi | **6** | **1–2** |
| câu SQL (giám đốc, 3 nhà máy) | ~621 | **10** |
| thời gian tường | ~270–300 ms | **~25 ms** |
| gzip trên dây | 3 × 20,1 = 60,3 KB | **55,4 KB** |
| rủi ro hàng rào | **thấp nhất** (không chạm cổng) | **cao nhất** (viết lại cổng) — §4 |
| ba-ảnh-chụp-lệch-nhau | **có**, phải tự chống | không |
| sửa được C3 (cắt im lặng) | **không** | có |
| K3 ("từ chối đắt ngang chấp nhận") | **còn nguyên** | mất |
| khối lượng mã | ít hơn ở server, nhiều hơn ở client (điều phối 3 truy vấn) | nhiều hơn ở server, client như nhau |

---

## 4. HÀNG RÀO PHẠM VI KHI CÓ NHIỀU MÃ — phần nguy hiểm nhất

### 4.1 Ba bất biến, viết thành câu kiểm được

> **BB-1 (LỌC TỪNG MÃ).** Với đầu vào `factoryIds = [a, b, c]`, tập được phục vụ là
> `factoryIds ∩ phamVi(người gọi)` — **giao từng phần tử**. Không có đường nào để một mã hợp lệ kéo
> các mã còn lại qua cổng. Cưỡng chế bằng **`Array.filter` trên tập id đã phân giải**, không bằng
> `if (có ít nhất một mã hợp lệ)`.
>
> **BB-2 (IM LẶNG BỎ, KHÔNG NÉM LỖI).** Mã ngoài phạm vi bị **loại khỏi danh sách**, thủ tục trả
> `200` với phần dữ liệu còn lại. Không `FORBIDDEN`, không thông điệp nêu đích danh mã bị loại, không
> đếm "đã bỏ N mã" trong phản hồi. Lý do là G82, đã ghi ở `twinCanh.ts:1031-1039`: một lỗi riêng cho
> "anh không được xem nhà máy 42" **vẫn xác nhận rằng nhà máy 42 có thật**. Đây cũng đúng hành vi hiện
> hành (`traCayPhanCapNhaMay:965-967` trả cây rỗng).
>
> **BB-3 (MỌI MÃ NGOÀI PHẠM VI ⇒ RỖNG, KHÔNG RÒ TÊN).** `factoryIds` toàn mã ngoài phạm vi ⇒
> `{xuong: [], chuyen: [], tram: [], may: [], datCho: [], vung: [], toaNha: []}` và **chuỗi phản hồi
> không chứa mã/tên của bất kỳ nhà máy nào bị loại**.

★ **Bất biến phụ, dễ bị bỏ quên nhất:** mọi lối vào phải chiếu qua **một** bộ phân giải
(`resolveTenantFactoryScope`). Tối ưu ở PA-2 rất dễ đẻ ra **bộ luật thứ hai** — một phép lọc `IN
(...)` viết tay trong SQL "cho nhanh". Bài học `mqttOeeRouters.getScopeLabels` (ghi ở
`twinCanhRouter.ts:1046-1048`): hai bộ suy độc lập canh hai nửa một câu là lớp lỗi đã cắn dự án này.

★ **Và tầng tầng phải tự đứng vững.** Kể cả khi `factoryIds` đã lọc sạch, `tangIds` **vẫn do client
tự khai**. Cổng gộp phải lọc tầng bằng `JOIN twin_toa_nha ... WHERE b."factoryId" IN (tập đã lọc)` —
tức tầng được kiểm **qua nhà máy thật của nó**, không qua `factoryIds` mà client gửi kèm. Bỏ vế này
là mở lại đúng lỗ `pham-vi-tenant-dot-lon` (lọc theo cột client tự khai = không có hàng rào).

### 4.2 Lưới chứng minh — và cách làm nó không tự thoả

Bốn ca trong kế hoạch Task 18 là **cần nhưng chưa đủ**. Bộ đề nghị:

| # | ca | khẳng định |
|---|---|---|
| L1 | `quanly` (chỉ A) xin `[41,42]` | trả > 0 máy, và **mọi** máy truy ngược ra `factoryId === 41` |
| L2 | `quanly` xin `[42,43]` (toàn ngoài) | `may.length === 0` **và** `JSON.stringify(kq)` không chứa `"QATD-B"`/`"QATD-C"` (BB-3) |
| L3 | **đối chứng dương** — `admin` xin `[41,42,43]` | tập `factoryId` truy ngược có **đúng 3** phần tử |
| L4 | vượt trần | `BAD_REQUEST`, **và `kq` không phải một tập bị cắt** (§6) |
| **L5** | `quanly` xin `[41,42]` kèm `tangIds` **của cả A lẫn B** | `datCho` chỉ mang tầng của A — **cổng tầng đứng độc lập với cổng nhà máy** |
| **L6** | `giamdoc` (3 nhà máy) xin **đúng một** mã `[42]` | trả đúng B — **thu hẹp tự nguyện phải được tôn trọng**, không "anh có quyền cả ba nên trả cả ba" |
| **L7** | `qatd_khonggan` (0 gán) xin `[41,42,43]` | rỗng. `factoryIds: []` phải ra `1 = 0` **tường minh**, không phải "không lọc" |
| **L8** | trùng lặp/rác: `[41, 41, -1, 999999]` | trả đúng A một lần; id lạ **im lặng biến mất**, không lỗi, không hàng thừa |

> ★★★ **Ablation là bắt buộc, và phải ablate ĐÚNG CHỖ.** Gỡ **một** dòng `filter` của BB-1 (đừng gỡ
> cả cổng) rồi chạy lại: **L1, L2, L5, L7 phải ĐỎ**; L3, L6 **phải vẫn xanh**. Nếu ablation làm đỏ
> tất cả thì lưới đang đo "có cổng hay không", chứ không đo "cổng lọc TỪNG mã hay không" — và đó là
> phép đo quá dễ, đúng thứ đã cứu kết luận ở L-7 (`ai-local-L7-hang-rao-dieu-khien`).
>
> ⚠ **Lưới L1/L3 không viết được bằng `m.factoryId`** — `machines` không có cột ấy (§1.2). Hoặc thủ
> tục thêm nhãn nhà máy cho từng máy (và khi đó nhãn ấy **phải suy ở server từ `xuong`**, không nhận
> từ client), hoặc lưới đi ngược `may → tram → chuyen → xuong.factoryId` trên chính phản hồi.

---

## 5. TOẠ ĐỘ — mỗi nhà máy một hệ, gốc ở 0

### 5.1 Đo được gì

| tầng toạ độ | cột | đo trên QATD |
|---|---|---|
| **trong tầng** | `twin_dat_cho.viTriXMm/viTriYMm` | A `0…55.000` · B `0…58.850` · C `0…57.370` — **cả ba đều bắt đầu từ 0** |
| **độ cao** | `twin_dat_cho.viTriZMm` | **đã tuyệt đối trong toà**: bằng `twin_tang.caoDoMm` (tầng 1 = 0, tầng 2 = 6.000) ⇒ **chồng tầng đã đúng, không phải làm gì** |
| **vị trí toà** | `twin_toa_nha.viTriXMm/YMm/ZMm` (`drizzle/schema/twin3d.ts:51-53`), kèm `rongMm/sauMm/caoMm` (`:54-56`) | **có thật và đã điền** — xem dưới |
| **vị trí nhà máy** | `factories.mapPositionX/mapPositionY` | **CÓ cột, NULL ở 5/5 hàng** (SIM-FAC, T12-SHOT-FA, QATD-A/B/C) ⇒ **không có dữ liệu địa lý nào để dùng hôm nay** |

`twin_toa_nha.viTriXMm` của QATD:

| nhà máy | X các toà (mm) | Y các toà (mm) |
|---|---|---|
| QATD-A (41) | 0 · 130.000 | 0 · 100.000 |
| QATD-B (42) | **1.000.000** · 1.130.000 | 0 · 100.000 |
| QATD-C (43) | **2.000.000** · 2.130.000 | 0 · 100.000 |

Bước cụm **1.000.000 mm = 1 km** do `.qa-tapdoan/sinh-tap-doan.mjs:166` (`ci * HH.buocCumMm`,
`HH.buocCumMm = 1_000_000`). **Đây là quyết định của BỘ SINH DỮ LIỆU ĐO, không phải luật của hệ.**
Bằng chứng: SIM-FAC (nhà máy 1) có **một toà ở (0,0)** — nếu hai nhà máy kiểu SIM-FAC cùng vào một
cảnh, chúng **chồng khít lên nhau**.

### 5.2 Điều quan trọng nhất ở §5: **cảnh hôm nay chưa cộng toạ độ toà nhà**

`hopNhatCanh.dungMayVe:191` dựng vị trí máy bằng **đúng** `mmSangScene({xMm: d.viTriXMm, yMm:
d.viTriYMm, zMm: d.viTriZMm})` — ba giá trị của **hàng đặt chỗ**, **không có số hạng nào của toà nhà**.
Và toàn `client/src/components/twin3d/van-hanh/` **không đọc `twin_toa_nha.viTriXMm`** một lần nào
(chỗ duy nhất đọc là `thiet-ke/DungNhaXuong.tsx:184`).

⇒ **Hệ quả đã có sẵn, chưa lộ ra:** *hai toà của **cùng một nhà máy** cũng sẽ chồng lên nhau nếu vẽ
cùng lúc.* Lý do chưa ai thấy: `TwinVanHanh.tsx:1009` lọc `d.tangId !== tangId` nên cảnh **chỉ vẽ một
tầng của một toà**. Phép dời chỗ **không phải chi phí riêng của việc gộp nhà máy** — nó là nợ hình
học đã đến hạn.

### 5.3 Ba cách dời chỗ

| cách | phép tính | đánh giá |
|---|---|---|
| **D-1 — dùng chính `twin_toa_nha`** | `worldX = toa.viTriXMm + datCho.viTriXMm` (tương tự Y) | **Một số hạng, một chỗ sửa.** Dữ liệu đã có cột, có giá trị, có `nguon` để khai "sinh/tay". Với QATD, các cụm đã cách nhau 1 km ⇒ **ra kết quả đúng ngay, không cần lưới nhà máy nào**. Rủi ro: hai nhà máy đều để toà ở (0,0) thì vẫn chồng — **hệ không có gì cấm điều đó**. |
| **D-2 — lưới nhà máy cố định do client sinh** | `worldX = i * BUOC_NHA_MAY + toa.viTriXMm + datCho.viTriXMm` | Bảo đảm không chồng **bất kể dữ liệu**. Nhưng với QATD nó **cộng thêm lên offset đã có** ⇒ ba khối cách nhau `BUOC + 1 km`. Và `i` là **chỉ số trong danh sách** ⇒ thứ tự đổi thì cảnh nhảy chỗ; phải khoá theo `factoryId` tăng dần, không theo thứ tự mảng. §11e.6 đã ghi §10C.6 có lỗi đúng loại này ("bước lưới 400 m làm 4 khối 3 km lồng vào nhau"). |
| **D-3 — theo vị trí địa lý thật** | từ `factories.mapPositionX/Y` | **Không làm được hôm nay: 5/5 hàng NULL.** Muốn dùng phải (a) có đường nhập toạ độ nhà máy trên UI, (b) quyết định đơn vị (`mapPosition*` không khai đơn vị ở schema), (c) xử lý tỉ lệ — hai nhà máy cách nhau 40 km thật thì một cảnh 3D theo tỉ lệ 1:1 là **99,99 % khoảng trống**. |

**Đề nghị (chờ chốt): D-1 làm nền, cộng một luật CHỐNG CHỒNG đo được, không phải một lưới mặc định.**
Cụ thể: tính bao hình (AABB) của từng nhà máy từ `toa.viTriX/Y ± rongMm/sauMm`; nếu hai bao hình giao
nhau thì **mới** rải theo lưới; và **nói ra trên giao diện** rằng vị trí đang là tạm sinh, y như badge
`nguon='sinh'` mà `twin_toa_nha` đã có sẵn (`drizzle/schema/twin3d.ts:38-40`). Im lặng dời một nhà máy
đang có toạ độ thật là nói dối; im lặng để chúng chồng nhau cũng là nói dối.

> **Chưa quyết được ở đây:** D-3 có phải đích đến không. Nếu chủ dự án muốn cảnh tập đoàn **giống bản
> đồ**, D-1 là ngõ cụt và phải mở `mapPositionX/Y` trước. Xem §11.

---

## 6. TRẦN AN TOÀN

### 6.1 Trần nào đang có, và vỡ ở đâu

* `tangIds ... .max(50)` — `twinCanhRouter.ts:1010`. Vượt ⇒ Zod **từ chối rõ ràng**. Đúng.
* `TwinVanHanh.tsx:650` — `dsTang.map(s => s.id).slice(0, 50)`. **Cắt IM LẶNG trước khi Zod kịp nói.**
* 3 nhà máy = **84 tầng** > 50 ⇒ với PA-2, `slice` sẽ vứt **34 tầng** và màn hiện một tập đoàn thiếu
  một phần ba, **không lỗi, không banner**. Đây là C3.

### 6.2 Đề nghị

| trần | giá trị đề nghị | căn cứ đo được |
|---|---|---|
| `factoryIds` | **≤ 8** | 3 nhà máy = 10 câu / 25 ms / 55 KB gzip (PA-2). Ngoại suy tuyến tính theo số máy: 8 nhà máy ≈ 3.000 máy ≈ 150 KB gzip — vẫn dưới mức đáng lo, và **số câu SQL không tăng theo số nhà máy** ở đường cổng gộp. 8 là trần *của cái đã đo nhân hơn hai lần*, không phải con số đẹp. |
| `tangIds` | **≤ 300** | 84 tầng thật; 300 cho biên độ. Ở cổng gộp, 84 tầng tốn **3 câu**, nên trần này **không mua thêm rủi ro SQL** — nó chặn kích thước đầu vào, không chặn chi phí. |
| tổng máy trả về | **không đặt trần cứng** | Trần theo số máy sẽ cắt giữa một nhà máy ⇒ vẽ nửa nhà máy mà không ai biết. Đúng hơn là chặn ở **số nhà máy** (đơn vị mà người dùng hiểu). |

### 6.3 Hành vi khi vượt trần — **từ chối rõ ràng, TUYỆT ĐỐI KHÔNG cắt im lặng**

1. Server: Zod `.max()` ⇒ `BAD_REQUEST`. Không `slice`, không `take(n)`.
2. **Client PHẢI BỎ `.slice(0, 50)` ở `TwinVanHanh.tsx:650`.** Thay bằng: nếu số tầng cần > trần thì
   **không gửi truy vấn**, hiện một dòng nêu con số thật ("cần 84 tầng, trần 300" / "chọn 9 nhà máy,
   trần 8"). Giữ `slice` cạnh một trần lớn hơn là giữ lại một khẩu súng đã lên đạn cho lần dữ liệu
   sau phình to.
3. Lưới L4 phải khẳng định **cả hai vế**: ném `BAD_REQUEST` **và** không có đường nào trả về một tập
   đã cắt. Một lưới chỉ kiểm `rejects` sẽ vẫn xanh nếu ai đó thêm `slice` ở client.

---

## 7. NGÂN SÁCH VẼ

**Ngưỡng (§4 spec gốc):** ≤ 150 lệnh vẽ · ≤ 500.000 tam giác · ≤ 30 nhãn · ≥ 30 khung/giây khi xoay.
**Nền đã đo:** 68 máy một tầng = 5 lệnh vẽ, 15.026 tam giác, 6 nhãn.

### 7.1 Đo và ước (`.qa-tapdoan/tho/T17/ngan-sach-ve.json`)

Tam giác máy tính bằng **chính hàm sản phẩm** `hinhHocKhoi()` (`hinhKhoiMay.ts:441-466`:
`soTamGiacUocTinh = số hộp con × 12`):

| | QATD-A | QATD-B | QATD-C | **tổng** |
|---|---:|---:|---:|---:|
| máy có đặt chỗ | 371 | 409 | 328 | **1.108** |
| tam giác máy | 22.260 | 24.540 | 19.680 | **66.480** |
| khối khác nhau | 7 | 7 | 7 | **7/7** |

* **Tầng đông nhất là `tangId 172` — đúng 68 máy**, tam giác máy **4.080**. Nền 15.026 là **cùng cấu
  hình ấy** ⇒ phần **không-phải-máy ≈ 10.946 tam giác** (sàn, tường, vùng, đồ đạc cố định).
* Tường: `twin_vat_the loai='tuong'` 112 hàng/nhà máy, **336 tổng** = 4 tường/tầng ⇒ `336 × 12 =
  **4.032** tam giác` cho **cả 84 tầng**.
* Cảnh hiện tại vẽ **một tầng** (`TwinVanHanh.tsx:1009`). Cảnh tập đoàn vẽ **84 tầng ⇒ 16× số máy**.

**Ước cảnh ba nhà máy:** `66.480 (máy) + 4.032 (tường 84 tầng) + ~10.900 (đồ đạc cố định) ≈ **81.400
tam giác** ≈ **16 % trần 500.000**.`

**Lệnh vẽ: không theo số máy.** `LoBatchMay.tsx:4-6` tự khai vì sao dùng `BatchedMesh` chứ không
`InstancedMesh`: "InstancedMesh = 7 draw call… BatchedMesh" gộp **mọi khối vào một lô**. Lô E đã đo
**549 máy một tầng = 3 lệnh vẽ, 57–59 FPS**. 1.108 máy là **2,0× lô E**, không phải 16× nền.

**Nhãn: đã có trần cứng 30** — `locNhan.ts:42` `TRAN_NHAN_DOM = 30`, cắt ở `:474`.

### 7.2 Phương án nào có nguy cơ vượt

| rủi ro | PA-1 | PA-2 | đánh giá |
|---|---|---|---|
| tam giác | ~81.400 | ~81.400 | **an toàn**, 16 % trần. Giống nhau: hai phương án vẽ cùng một cảnh. |
| lệnh vẽ | ~5 | ~5 | **an toàn** nếu **một `BatchedMesh` duy nhất**. |
| **⚠ lệnh vẽ nếu chia lô theo nhà máy** | 3 lô | 3 lô | vẫn thấp — **nhưng nếu ai đó chia lô theo TẦNG (84 lô) thì ~84 lệnh vẽ + sàn/tường**, sát trần 150. **Luật: tuyệt đối không chia lô theo tầng.** |
| **nhãn** | 30 | 30 | trần không vỡ, nhưng **luật CHỌN 30 nhãn trong 1.108 máy qua 3 nhà máy chưa tồn tại**. G134 (lưới chọn mẫu sạch) áp thẳng vào đây: 30 nhãn dồn hết vào nhà máy gần camera nhất là cảnh "đúng ngưỡng, sai thông tin". |
| **FPS khi xoay** | chưa đo | chưa đo | **1.108 máy chưa từng được vẽ.** 549 cho 57–59 FPS; ngoại suy nói là đủ, **ngoại suy không phải phép đo** — §9 đặt đây thành cổng ra. |
| **`far` của camera** | **có rủi ro** | **có rủi ro** | `CanhVanHanh.tsx:765` đặt `far = max(2000, banKinh*24)`, với `banKinh = max(sanRongM, sanSauM, 10)` (`:513`) — tức **kích thước SÀN truyền vào**, không phải độ trải của máy. Cảnh ba nhà máy cần sàn phủ ~**2.200 m** ⇒ `far` ~ **52.800 m** với `near` mặc định. **Tỉ lệ far/near lớn = z-fighting**: hai mặt phẳng gần nhau nhấp nháy. Không vi phạm ngưỡng nào của §4 và vì thế **không cổng nào bắt được** — chỉ mắt người thấy. |

---

## 8. BANNER KHAI HẠN CHẾ — phải gỡ **cùng lượt**

Banner ở `TwinVanHanh.tsx:2352-2362` (`testId="banner-ha-cap"`), khoá `twin3d.vanHanh.haCapPhamVi`,
nói: *"Phạm vi Tập đoàn **chưa nạp được nhiều nhà máy cùng lúc**"*. Khi gộp chạy được, câu ấy thành
**lời khai sai theo chiều ngược** — sản phẩm nói dối về chính năng lực mình vừa có.

Phải làm **trong cùng lượt giao**, không để lượt sau:

1. Gỡ nhánh hạ cấp `boChonNap.ts:241-243`; `phamViThuc` giữ `tapDoan` khi phạm vi người dùng ≥ 2 nhà máy.
2. Gỡ mục `banner-ha-cap` ở `TwinVanHanh.tsx:2352-2362`.
3. **Gỡ khoá i18n ở cả ba tệp** `vi.json:19930` · `en.json:19950` · `zh.json:19958` (`npm run
   i18n:check` là cổng — khoá mồ côi hoặc thiếu đều đỏ).
4. Cập nhật docblock `boChonNap.ts:199-218` — nó đang **giải thích vì sao chọn (b)**. Để nguyên thì
   tài liệu trong mã nói ngược với mã, và người đọc sau sẽ tin tài liệu.

★ **Nhưng `daHaCap` KHÔNG được xoá khỏi kiểu.** Vẫn còn một ca thật cần nó: người được gán **đúng
một** nhà máy mở `?pv=tapdoan`. Lúc ấy "Tập đoàn" vẫn là lời khai sai — chỉ khác là lý do đã đổi từ
*"hệ không nạp nổi"* sang *"anh chỉ được gán một"*. Cần **một câu khác**, không phải câu cũ:
`soNhaMayTrongPhamVi` thay cho `soNhaMayDaNap`. Xoá cả cơ chế là vá một lời nói dối bằng một lời nói
dối khác.

---

## 9. NGHIỆM THU — phép đo nào chứng minh cái gì

| # | khẳng định phải chứng minh | phép đo | ĐẠT khi |
|---|---|---|---|
| **N1** | cảnh có **đủ ba khối nhà máy** | Trên trình duyệt thật, vai `qatd_giamdoc`, `?pv=tapdoan`. Đọc `window.__demTuongTac.dsMay` (`LoBatchMay.tsx:311`), gom theo bao hình X: đếm **cụm** | **3 cụm**, tổng máy vẽ = **1.108** |
| **N2** | **chỉ được gán một nhà máy ⇒ vẫn chỉ thấy một** | Cùng URL, cùng bước đo, vai `qatd_quanly` (gán QATD-A) | **1 cụm**, **371 máy**, và bao hình nằm trọn trong X của QATD-A |
| **N2b** | **đối chứng chặn-đúng ở tầng mạng** | `qatd_quanly` gọi thẳng `canhThietKe {factoryIds:[41,42,43]}` | 200, **371 máy**, chuỗi phản hồi **không chứa** `QATD-B`/`QATD-C` (BB-3) |
| **N3** | ba khối **không chồng nhau** | Bao hình X/Y từng cụm | **0 cặp giao nhau** |
| **N4** | ngân sách vẽ | `window.__thongKeVe` (`KhungCanh.tsx:265`) khi **đang xoay** | lệnh vẽ ≤ 150 · tam giác ≤ 500.000 · nhãn ≤ 30 · **FPS ≥ 30** |
| **N5** | **không cắt im lặng** | Ép một tập đoàn 9 nhà máy (hoặc trần tạm 2) rồi xin 3 | **BAD_REQUEST hiện thành chữ trên màn**, không phải một cảnh thiếu khối |
| **N6** | banner cũ đã chết | Grep `banner-ha-cap` trên bản **ĐANG PHỤC VỤ** + đọc màn | 0 lần xuất hiện ở cả hai chỗ |
| **N7** | đường một-nhà-máy không vỡ | Suite twin3d + e2e bấm cảnh | không có ca nào đỏ thêm |

> ★★★ **N1 và N2 phải chạy trên CÙNG một bản dựng, trong CÙNG một lượt.** G142 (Đợt 55–56): bản đang
> phục vụ còn lỗ rò tenant suốt 16 đợt vì `dist/` không cùng lai lịch với mã. Ở đây nguy hiểm gấp
> đôi: N1 và N2 là **hai chiều của một câu**, đo trên hai bản dựng khác nhau thì cả hai đều vô nghĩa.
>
> ★★ **N2 là chiều dễ khai láo nhất.** "Một cụm" cũng là kết quả khi tính năng gộp **chưa bật**. Nên
> N2 chỉ tính là bằng chứng khi **N1 xanh trong cùng lượt** — không có N1 thì N2 chỉ chứng minh mã
> chưa chạy. (G139: một số 0 chỉ có nghĩa khi kèm ablation trên nền đã chứng minh.)

---

## 10. KHUYẾN NGHỊ

> **Tôi không chốt thay chủ dự án.** Dưới đây là khuyến nghị kèm lý do đo được.

### Khuyến nghị: **PA-2, giao làm hai lượt theo PA-3 (vá cổng trước, nới danh sách sau).**

**Lý do 1 — phép đo bác bỏ lý lẽ chính chống PA-2.** Lý lẽ "một lượt gọi ba nhà máy thì phản hồi quá
to" **sai**: 55,4 KB gzip (§2.3 K4). Lý lẽ "gộp thì chậm" cũng sai theo chiều bất ngờ: đường gộp có
cổng gộp **nhanh hơn 8× so với đường một-nhà-máy hiện tại** (25 ms so với 211 ms).

**Lý do 2 — PA-1 giữ nguyên K3, và K3 là lỗi thật.** Hôm nay `qatd_quanly` xin ba nhà máy tốn **603
câu / 650 ms** để trả về đúng một nhà máy. PA-1 để nguyên con số ấy; PA-2 đưa nó xuống **10 câu / 8,9
ms**. Một hàng rào mà **từ chối đắt ngang chấp nhận** là một hàng rào có thể bị dùng làm đòn bẩy tải.

**Lý do 3 — phần lợi lớn nhất rơi ngoài task này.** 96,7 % số câu của thân `canhThietKe` là cổng
phạm vi phân giải lại từng tầng. Vá nó làm **màn Thiết kế và màn Vận hành một-nhà-máy** nhanh lên
(207 → ~9 câu), cho **mọi** người dùng, kể cả người không bao giờ mở phạm vi tập đoàn.

**Lý do 4 — PA-2 là chỗ duy nhất sửa được C3.** `.slice(0, 50)` cắt im lặng 34/84 tầng. PA-1 không
với tới chỗ ấy.

**Nhưng phải nói thẳng cái giá:** PA-2 **viết lại cổng phạm vi**, tức chạm đúng thứ đã cắn dự án này
nhiều lần nhất (`pham-vi-tenant-dot-lon`, G113, G142). Vì thế **PA-3 chia hai lượt**:

* **Lượt A — cổng gộp, giữ nguyên đầu vào một mã.** 0 thay đổi hợp đồng, 0 thay đổi hành vi (đối
  chứng §2.1 đã chứng minh cùng kết quả). Lưới L5/L7/L8 + ablation viết **trước**. Rủi ro cô lập:
  nếu cổng gộp sai, nó sai ở một đường **đã có lưới cũ canh**, chưa có thêm bề mặt mới nào.
* **Lượt B — nới `factoryIds`.** Chỉ chạm hình dạng đầu vào, trên một cổng **đã chứng minh**. Lưới
  L1–L4, L6 + ablation. Rồi mới tới client (Task 19).

**Nếu chủ dự án ưu tiên rủi ro thấp nhất hơn tốc độ**, PA-1 là lựa chọn hợp lệ và **phải kèm ba điều
kiện**: (a) một cơ chế chống ba-ảnh-chụp-lệch-nhau, (b) một câu trả lời cho ca 2/3 lượt thành công,
(c) chấp nhận rằng C3 và K3 **còn nguyên** và phải vào sổ nợ có ngày hẹn.

---

## 11. ĐIỀU TÔI KHÔNG CHẮC

1. **FPS ở 1.108 máy — chưa ai đo.** Số gần nhất là lô E: 549 máy/1 tầng = 3 lệnh vẽ, 57–59 FPS.
   1.108 là 2,0× và ngoại suy nói vẫn ≥ 30 FPS, nhưng **`BatchedMesh` có sức chứa hình học đặt lúc
   dựng** (`LoBatchMay.tsx:141` `khoaHinhHocLo`) — tôi **không** đo cái giá của lần dựng lại lô khi số
   máy nhảy 16×, cũng không đo bộ nhớ GPU. Nếu N4 đỏ, đó là lý do quay lại thiết kế, **không phải lý
   do nới ngưỡng** (kế hoạch Task 19 bước 5 đã viết đúng như vậy).

2. **~10.946 tam giác "không phải máy" tôi KHÔNG tách được.** Tôi lấy nó bằng hiệu `15.026 − 4.080`
   trên đúng tầng 68 máy. Tôi **giả định** phần ấy phần lớn là đồ đạc cố định (một `<San>`, đèn, trục)
   và **không nhân theo số tầng** — vì `CanhVanHanh.tsx:573` chỉ dựng **một** `<San>`. Nếu thiết kế
   sau này vẽ **sàn cho từng tầng**, `84 × 10.946 ≈ 919.000` tam giác — **vượt trần 500.000 gần gấp
   đôi**. Con số đó đủ để đảo ngược kết luận §7, nên phải đo thật trước khi vẽ sàn nhiều tầng.

3. **D-3 (toạ độ địa lý) có phải đích đến không — tôi không biết.** `factories.mapPositionX/Y` tồn
   tại nhưng **NULL 5/5**, và schema **không khai đơn vị**. Nếu chủ dự án muốn cảnh tập đoàn phản ánh
   địa lý thật thì D-1 là ngõ cụt và phải mở đường nhập toạ độ nhà máy trước. Đây là câu hỏi sản
   phẩm, không phải câu hỏi kỹ thuật, nên tôi không tự trả lời.

4. **Luật chọn 30 nhãn qua ba nhà máy — tôi chưa thiết kế.** `TRAN_NHAN_DOM = 30` là trần, không phải
   chính sách. 30 nhãn dồn hết vào cụm gần camera là "đúng ngưỡng, sai thông tin" (đúng lớp G134).
   Tôi không biết luật đúng là "chia đều theo nhà máy", "theo mức báo động", hay "theo khoảng cách" —
   cần một quyết định, và cần một phép đo chọn-mẫu-sạch để chứng minh nó.

5. **Đo trên DB dev, một tiến trình, không có tải đồng thời.** Số ở §2 là **cận dưới**. Với 611 câu
   của đường hiện tại và pool 25 (`connection.ts:15`), **năm** người dùng mở phạm vi tập đoàn cùng
   lúc là 3.055 câu đang bay — tôi **không** đo ca ấy. Trực giác nói PA-2 (10 câu) làm ca ấy biến
   mất, nhưng trực giác không phải phép đo.

6. **Tôi chưa đo đường `danhSachToaNha`/`chiTietToaNha`** (`twinCanhRouter.ts:331`, `:339`) — chúng
   cũng nhận **một** `factoryId` và cũng cần nới nếu cảnh gộp phải biết vị trí 12 toà. Chi phí của
   chúng nhỏ (`traToaNhaTheoNhaMay` = 1 cổng + 1 câu) nhưng **số lượt gọi** thì không: PA-1 thành 6
   lượt HTTP chính vì chúng. Tôi ước `×2` chứ không đo.

7. **`machines` không có `factoryId` — tôi không biết cách nào là đúng** để gắn nhãn nhà máy lên
   từng máy trong phản hồi gộp. Thêm một cột suy ở server là thêm một nguồn sự thật thứ hai; bắt
   client tự truy ngược `may → tram → chuyen → xuong` là đẩy một phép suy về phía không có hàng rào.
   Cần quyết định ở Task 18, và lưới L1/L3 của kế hoạch **hiện đang giả định một trường không tồn tại**.

8. **Trần 8 nhà máy là ngoại suy, không phải đo.** Tôi đo 3. Tôi chưa dựng 8 nhà máy để xem điều gì
   vỡ trước — số máy, số tầng, hay `far` của camera. Con số 8 chọn theo "gấp hơn hai lần cái đã đo";
   nó có thể quá rộng hoặc quá chặt.

---

## Phụ lục — tái hiện phép đo

```bash
# Khảo sát dữ liệu QATD (chỉ SELECT)
node   .qa-tapdoan/t17-kham.mjs
node   .qa-tapdoan/t17-kham2.mjs
# Chi phí: gọi thẳng hàm sản phẩm, 3 vai, 1 vs 3 nhà máy
npx tsx .qa-tapdoan/t17-chi-phi.mts
# Đếm chính xác số câu SQL (bộ đếm của sản phẩm) + ablation cổng gộp
npx tsx .qa-tapdoan/t17-dem-cau.mts
# Thân canhThietKe đầy đủ: sản phẩm vs cổng gộp, kèm đối chứng đúng-sai
npx tsx .qa-tapdoan/t17-than-gop.mts
# Ngân sách vẽ: tam giác tính bằng chính hinhHocKhoi()
npx tsx .qa-tapdoan/t17-ngan-sach-ve.mts
# Kích thước phản hồi (thô + gzip) và phân bố Z theo tầng
node   .qa-tapdoan/t17-goi-payload.mjs
```

Số thô: `.qa-tapdoan/tho/T17/{chi-phi,dem-cau,than-gop,ngan-sach-ve,payload}.json`.
Mọi script **chỉ `SELECT`**; không script nào ghi DB, không script nào bật/tắt cổng ứng dụng.
