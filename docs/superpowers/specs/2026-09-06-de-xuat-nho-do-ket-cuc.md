# `de_xuat_nho` — do KET CUC sau ban va H5 (2026-09-06)

No mo tu Dot H, ghi trong bo nho du an la **0/5**. Nay do lai bang model THAT.

## Buoc 0 (MSA) — kiem he do truoc khi tin con so
- Bundle `vscode-extension/dist/extension.js` (09-06 11:12) **moi hon moi tep nguon** — khong lech.
- `de_xuat_nho` **co mat trong bundle da build** (grep = 1), khong phai chi co trong ma nguon.
- `llama-server` song tren 8091, model `Qwen3-30B-A3B-Instruct-2507`. VRAM 24.196/32.607 MiB.

## Phep do lan 1 — SAI, va day la phat hien quan trong nhat

Lan dau toi do bang prompt "sach" (chi day tool + nhac lai). Ket qua **5/5**.
Ablation (go ban va H5): **van 5/5** ⇒ ban va **khong** giai thich duoc con so.

Ket luan dung khi do: **phep do qua de**, khong tai hien duoc dieu kien sinh ra 0/5.
Neu dung o day va bao "5/5, no da dong", do se la mot lo khai dep dua tren mot phep
do khong co suc phan biet. **Ablation that bai chinh la thu cuu no.**

## Phep do lan 2 — co ap luc that (luat may chu + RAG lac de)

Dot H do duoc 0/5 kem **RAG-hijack**: luat "NGUYEN TAC TRA LOI" cua may chu
(`aiLocalKnowledgeService.ts:1686,1820`) ep model chi tra loi theo ngu canh KB, va
ngu canh do khong he nhac toi `de_xuat_nho`. Do lai voi dung ap luc do:

| Cau hinh | Phat khoi dung | Cau mau tu choi |
|---|---|---|
| **CO ban va H5** | **5/5** | 0/5 |
| **GO ban va H5** (ablation) | **3/5** | 0/5 |

Ban va H5 co cong **do duoc**: 3/5 -> 5/5. Ablation lan nay **co tac dung**.

## ★★★ Lo con lai — bat duoc tu ca HONG, khong tu con so

Ca 5 khi go va: model phat **dung JSON `de_xuat_nho` nhung THIEU hang rao**
```` ```avi-tool ```` boc ngoai.

`khoiAviTool.ts:37` dung regex `^([ \t]*)```avi-tool\r?\n...` voi co `gm` — **doi hang
rao dung dau dong**. JSON tran **bi bo qua hoan toan**: khong loi, khong canh bao.
Nguoi dung chi thay "AI khong lam gi", va **khong gi ghi nhan** rang model DA co y
goi tool.

Day la lop loi da can du an nay nhieu lan: **khai mot ket cuc ma khong doc ket cuc**
— nhung o day nan nhan la chinh trinh phan tich, no im lang nuot mot y dinh dung.

**Chua vá.** De xuat: dem so lan bat duoc JSON-tran-co-truong-`tool` de **DO tan suat
that** truoc, roi moi quyet dinh co nen chap nhan JSON tran hay khong. Chap nhan JSON
tran lam noi long hop dong doc — phai co so lieu truoc khi doi.

## Con mo
- Chi 5 cau, mot nhiet do (0.3), mot lan chay. Chua do phuong sai.
- Chua do `mcp_goi` (cung duoc va o H5, cung tung 0/5) — can may chu MCP that.

---

## Phu luc — DEM TAN SUAT lo "JSON tran khong rao" (2026-09-07)

O bao cao tren toi de xuat **dem tan suat that truoc khi noi long hop dong doc**.
Da dem. 10 cau moi, nhiet do **0.7** (cao hon lan do goc 0.3 => nhieu bien thien
hon, kho hon cho model):

| Ket cuc | So lan |
|---|---|
| Phat khoi **CO hang rao** (parser bat duoc) | **10/10** |
| **JSON tran** khong rao (parser bo qua) | **0/10** |
| Khong goi tool | 0/10 |

Do bang **dung regex cua parser that** (`khoiAviTool.ts:37`), khong bang mot
khuon tu che.

### QUYET DINH: **KHONG VA**

Ca JSON-tran quan sat duoc truoc do xay ra o dieu kien **DA GO ban va H5**. Tuc
no la trieu chung cua viec **thao hang rao**, khong phai mot lo doc lap cua
parser. Khi ban va co mat — tuc trang thai that dang chay — tan suat do duoc la
**0**.

Noi long hop dong doc (chap nhan JSON tran) se:
- lam yeu giao thuc cho mot van de co tan suat do duoc = 0;
- mo cua cho van ban tinh co chua `{"tool": ...}` bi hieu nham la mot lenh goi
  tool — **doi mot lo khong xay ra lay mot lop tan cong moi**.

Ghi lai de nguoi sau khong phai do lai. Neu ai do go/sua `nhacLaiCuoiCauHoi`,
**phai do lai muc nay** — lo se quay ve.

## Con mo (cap nhat)
- `mcp_goi` — cung lop, cung tung 0/5, chua do vi can may chu MCP that.
- Chua do phuong sai nhieu lan chay.
