# 24 — Kế hoạch Mua sắm Phần cứng (P6) & Nghiệm thu An toàn

> **Bối cảnh:** P0–P5 (phần mềm) đã xong (doc 22 §7). Phần còn lại **bất-khả-thay-bằng-phần-mềm** là phần cứng OT/an toàn/kết nối — mở khóa các tính năng đang ở dạng *seam* (đã code + flag OFF). Doc này là **kế hoạch mua sắm + tích hợp + nghiệm thu**, không phải cam kết giá.
> **Ngày:** 2026-07-02 · Liên quan: doc 22 (đánh giá/kế hoạch), doc 23 (flip-cờ, Tier D), doc 20 (pre-hardware).
> ⚠️ **Chi phí là ƯỚC TÍNH SƠ BỘ (order-of-magnitude), CẦN BÁO GIÁ THỰC TẾ từ nhà cung cấp/nhà tích hợp trước khi duyệt CAPEX.** Tên hãng/model chỉ để tham chiếu kỹ thuật, không phải khuyến nghị thương mại độc quyền.

---

## 0. Nguyên tắc

1. **An toàn đi trước** — hạng mục safety (SIL PLC, tracking người) ưu tiên #1 vì vừa bắt buộc pháp lý (ISO/IEC) vừa mở khóa Khối 3.
2. **Phần mềm KHÔNG thay thế safety-rated stop** — mọi hạng mục an toàn là *phần cứng chứng nhận*; phần mềm chỉ giám sát/log/đề xuất (đã tuân thủ trong code).
3. **Mua theo nhu cầu thiết bị THẬT của nhà máy** — không mua "cho có". Mỗi hạng mục ánh xạ tới cờ/tính năng cụ thể nó mở khóa.
4. **Nghiệm thu = risk assessment + đo đạc thực tế** theo chuẩn, không chỉ "cắm là chạy".

---

## 1. Danh mục phần cứng (BOM) — ánh xạ tính năng · vendor tham chiếu · ước tính · lead-time

| # | Hạng mục | Mở khóa (cờ/tính năng) | Vendor/model tham chiếu | SL gợi ý | Ước tính đơn giá (USD, sơ bộ) | Lead-time | Effort tích hợp |
|---|---|---|---|---|---|---|---|
| **H1** | **Safety PLC SIL 2/3** + safety I/O | Khối 3 rated-stop; `SAFETY_ZONE_SW`/`SAFETY_PLC_ADAPTER` (đọc trạng thái) | Pilz PNOZmulti 2 · Sick Flexi Soft · Siemens S7-1500F | 1–2 / cell | 1.5k–5k | 4–10 tuần | Cao — cần kỹ sư safety + wiring |
| **H2** | **Cảm biến hiện diện người** (chọn 1–2): safety laser scanner / UWB RTLS | Dynamic safety zoning; `SAFETY_ZONE_SW` (nguồn vị trí thật) | SICK microScan3 / nanoScan3 (laser SIL2) · Sewio/Ubisense (UWB) | 1–3 / cell | 3k–8k (laser) · 5k–15k (UWB hệ) | 4–12 tuần | Cao — layout vùng + hiệu chuẩn |
| **H3** | **Camera công nghiệp + edge GPU** cho phát hiện người (YOLO) | `SAFETY_VISION` (advisory); export `yolo26n.pt→.onnx` + hiệu chuẩn homography | Camera GigE Basler/Hikrobot · Edge NVIDIA Jetson Orin NX/AGX | 1–2 cam + 1 edge / cell | 0.5k–2k cam · 1k–2k edge | 2–6 tuần | Trung — train/convert model + calib |
| **H4** | **FOCAS / Fanuc CNC kết nối** | Khối 1B FOCAS adapter (`EQ_INTEG`) | Fanuc FOCAS2 (Fwlib32) license + CNC có Ethernet/Option | theo số CNC | license theo Fanuc quote | 3–8 tuần | Trung — cần option + license Fanuc |
| **H5** | **EtherCAT master real-time** | Điều khiển real-time <50ms (khối control nâng cao) | Beckhoff TwinCAT 3 · acontis EC-Master · NIC Intel i210 | 1 / control node | 0.5k–3k (license+NIC) | 2–6 tuần | Trung-Cao — RT OS/patch |
| **H6** | **(Nếu có SEMI equipment)** HSMS/SECS gateway | Khối 1B SECS/GEM E30 (`SECS_GEM`/`EQ_INTEG`) | Thiết bị SEMI hỗ trợ HSMS-SS + host PC | theo thiết bị | thấp (dùng codec đã có) | 2–4 tuần | Thấp-Trung — codec/E30 đã code |
| **H7** | **Cobot/robot** (nếu chưa có) + tay kẹp/jig | Khối 2/3 orchestration thật | UR (URScript — đã có transpiler) · Techman · Doosan | theo dây chuyền | 25k–50k / cobot | 6–16 tuần | Cao — commissioning |

> **Ước tính gói tối thiểu 1 cell an toàn (H1+H2+H3):** ~**10k–30k USD** phần cứng + tích hợp (chưa gồm cobot). **Cần báo giá thực tế.**

---

## 2. Ánh xạ: phần cứng → cờ/seam đã code sẵn

| Cờ (doc 23) | Trạng thái phần mềm | Phần cứng cần | Ghi chú |
|---|---|---|---|
| `SAFETY_ZONE_SW` (rated-stop THẬT) | 🟢 evaluator 3-cấp + audit (advisory) | **H1** + **H2** | Phần mềm chỉ log; PLC actuate dừng |
| `SAFETY_VISION` | 🟡 producer + backend `NoDetection` | **H3** + export `.onnx` | Chưa fabricate detection |
| `SAFETY_PLC_ADAPTER` (live) | 🟡 read-only adapter (sim ok) | **H1** (Modbus/OPC-UA read) | Chỉ đọc, không ghi |
| `EQ_INTEG` FOCAS/Euromap | 🔴 framework skeleton | **H4** (FOCAS) | Cần Fwlib32 native |
| `SECS_GEM` | 🟡 codec + E30 state model (đã code) | **H6** | Codec/E30 sẵn → effort thấp |
| Real-time control <50ms | 🟡 driver poll/subscribe | **H5** | EtherCAT master |

---

## 3. Lộ trình mua sắm (phân đợt)

- **P6a — An toàn (ưu tiên #1):** H1 (Safety PLC) + H2 (tracking người) + H3 (vision advisory). → Mở khóa Khối 3 rated-stop + đạt nền tảng ISO. *Bắt buộc trước khi vận hành cobot cạnh người.*
- **P6b — Tích hợp thiết bị:** H4 (FOCAS) + H6 (SECS nếu có) + H5 (EtherCAT nếu cần RT). → Khối 1B/1 thật.
- **P6c — Mở rộng robot:** H7 (cobot/jig) theo dây chuyền. → Khối 2 orchestration thật.

**Phụ thuộc:** P6a độc lập, làm trước. P6b/P6c theo nhu cầu thiết bị thực tế.

---

## 4. Tiêu chí nghiệm thu (Acceptance) theo chuẩn

| Chuẩn | Phạm vi | Tiêu chí nghiệm thu chính |
|---|---|---|
| **ISO 10218-1/2** | Robot công nghiệp + tích hợp cell | Risk assessment đầy đủ; safeguarded space; validated stop functions |
| **ISO/TS 15066** | Cobot cộng tác (HRC) | Giới hạn lực/áp suất theo bảng body-region; separation distance (SSM); power-&-force-limiting đo thực tế |
| **IEC 61508 / 62061** | Functional safety | Xác nhận **SIL** của safety function; rated-stop **dual-channel**; đo **thời gian dừng thực tế** (T_stop) → tính separation distance |
| **IEC 62443** | An ninh OT/IT | Network segmentation zone OT; xác thực; nhật ký |

**Bằng chứng phần mềm hỗ trợ nghiệm thu (đã có):** `safety_events` SIL-tagged + `responseTimeMs` (báo cáo latency PDCA ISO/TS 15066); command audit append-only; interlock log. → Xuất báo cáo phục vụ đánh giá viên.

**Đo đạc bắt buộc khi có H1/H2:** thời gian dừng thực tế (detection→rated-stop <100ms qua PLC), khoảng cách an toàn tối thiểu, kiểm thử E-stop dual-channel, kiểm thử intrusion 3-cấp (speed-reduce → stop → rated-stop).

---

## 5. Việc cần làm để đưa ra quyết định CAPEX

1. **Khảo sát thiết bị THẬT tại nhà máy:** liệt kê CNC (hãng/model → FOCAS?), có SEMI equipment (HSMS?) không, số cobot/jig hiện có, layout cell người-robot.
2. **Risk assessment sơ bộ** cho từng cell HRC → xác định SIL cần + loại cảm biến (laser vs UWB vs vision).
3. **Lấy báo giá** H1–H3 từ ≥2 nhà tích hợp safety (Pilz/Sick partner tại VN) → thay số ước tính ở §1 bằng giá thực.
4. **Chốt P6a scope + ngân sách** → mua → tích hợp → nghiệm thu theo §4 → bật cờ Tier D (doc 23) trên thiết bị thật.

---

## 6. Trạng thái

Phần mềm cho MỌI hạng mục trên **đã có seam + flag OFF** (doc 22/23). Doc này là **đầu vào cho quyết định mua sắm** — cần: (a) khảo sát thiết bị thật + risk assessment, (b) báo giá thực tế thay ước tính, (c) duyệt CAPEX. Không có hạng mục nào là "lỗi code" — tất cả chờ phần cứng + quyết định kinh doanh.
