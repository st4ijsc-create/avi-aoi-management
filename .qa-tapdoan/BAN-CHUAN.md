# Bản chuẩn `/twin` một nhà máy — BA mã băm, và chúng KHÔNG mâu thuẫn

> Lập 2026-09-17. Lý do: bốn agent liên tiếp phải hỏi *"so với tệp nào?"* vì cùng một
> phép đo "đối chứng âm `/twin` một nhà máy giống BYTE" lại có **ba** md5 khác nhau
> trôi nổi trong sổ và trong brief. Chủ đợt cũng đã **dẫn nhầm** một mã băm
> (`637f81e1` được gán cho `t19-mot-nha-may-sau.json`, thật ra nó là của họ `b2-*`).
> Một bản chuẩn mơ hồ là một bản chuẩn yếu.

## ★ BẢN CHÍNH THỨC

```
.qa-tapdoan/b2-mot-nha-may-p50b-cuoi.json      md5 637f81e1f6135b4fec650aa501ecf1e1
```

Mọi phép đo *"`/twin` một nhà máy không đổi một ô nào"* **so với tệp này**, và **nói
rõ tên tệp** trong báo cáo — không chỉ đưa mã băm trần.

## Ba họ là một DÒNG DÕI, không phải ba lời khai chọi nhau

| họ | md5 | chế độ | mã định danh | trạng thái |
|---|---|---|---|---|
| `t19-mot-nha-may-*` | `48af3d35` | **chỉ 3D** | `toa 78 · tang 333` — **dữ liệu CŨ** | ⛔ **LỖI THỜI** |
| `t19-mot-nha-may-b2*` | `a0ae3cbe` | chỉ 3D | `toa 91 · tang 420` — dữ liệu mới | kế thừa, đã bị thay |
| **`b2-mot-nha-may-*`** | **`637f81e1`** | **3D + 2D** | `toa 91 · tang 420` | ★ **CHÍNH THỨC** |

Chênh lệch đã đối chiếu từng trường:

1. `t19-*` → `t19-b2*` khác **đúng hai trường**: `toa 78 → 91`, `tang 333 → 420`. Đó
   **không phải hồi quy** — đó là **mã định danh đổi** vì bộ dữ liệu QATD được sinh
   lại ngày 2026-09-16 (`--go` rồi `--ghi`). Mười trường còn lại giống hệt.
2. `t19-b2*` → `b2-*` là **bao hàm thật**: cùng nội dung 3D, **cộng thêm** nửa 2D
   (`viewBox`, `donViVe`, `soMay2D`, `soBieuTuong2D`, `soNutSvg`, `rongPxMin/Max`,
   `aria`, `trangThaiDau`). Từ khi ô 2D cũng vẽ sa bàn (`339ebed2`), đối chứng âm
   **bắt buộc** phải phủ cả hai chế độ ⇒ chỉ `b2-*` còn đủ sức.

⇒ Ba con số ấy là **ba lát cắt thời gian**, không phải ba sự thật chọi nhau. Nhưng để
chúng nằm cạnh nhau không ghi chú thì người đo kế tiếp **phải đoán**, và đã đoán sai
một lần.

## ⛔ `t19-mot-nha-may-sau.json` LỖI THỜI — đừng dùng, đừng xoá

Nó ghim mã định danh **trước** lần sinh lại dữ liệu. So với nó hôm nay sẽ ra "lệch 2
trường" và người đọc dễ tưởng là **hồi quy** trong khi chỉ là dữ liệu đã đổi. Một
agent đã phải mất công giải thích đúng chuyện này.

**Không xoá** (xoá tệp phải hỏi chủ dự án, và nó vẫn là bằng chứng của các vòng trước
`339ebed2`). Chỉ **đừng lấy nó làm bản chuẩn**.

## Nhắc kèm: mã định danh đổi mỗi lần sinh lại

Bộ sinh tất định, nhưng `--go` + `--ghi` cấp **mã mới**. Mọi harness phải đọc từ
`.qa-tapdoan/sinh-summary.json`, **cấm** chép số id từ tài liệu cũ. Và `--go` **xoá
hai bảng gán tài khoản** mà `--ghi` không dựng lại — chạy
`node .qa-tapdoan/b1-khoi-phuc-gan.mjs` sau đó, **đừng** dùng `--gan` (nó gán cả ba
công ty cho mọi vai, phá chính phép đo phạm vi). Bộ sinh nay tự cảnh báo ở cuối `--ghi`.
