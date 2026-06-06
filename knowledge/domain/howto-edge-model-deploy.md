# Hướng dẫn — Triển khai mô hình AI xuống Edge (máy AOI)

> **Đối tượng**: kỹ sư AI/MLOps, kỹ sư hệ thống.
> **Module**: AI Models › Deployment, AOI Inspection.
> **Backend liên quan**: dịch vụ Edge Agent (Python/Node) chạy trên máy AOI, kết nối MQTT broker nội bộ.

## 1. Tổng quan

Hệ thống hỗ trợ huấn luyện mô hình AI ở backend (server trung tâm) rồi đẩy về từng máy AOI để chạy inference cục bộ — giảm độ trễ và không phụ thuộc mạng.

Định dạng mô hình hỗ trợ: `ONNX`, `TensorRT engine`, `OpenVINO IR`. Phần backend chỉ giữ file gốc + metadata; mỗi máy AOI tự convert nếu cần.

## 2. Quy trình deploy

```
[Admin] → AI Models → chọn model version → Tab "Deployment"
       → chọn target machines (multi-select) → Bấm "Deploy"
       → Server publish MQTT topic edge/<machineCode>/model/install
       → Edge Agent tải file qua HTTPS → verify SHA-256 → swap symlink → reload pipeline
       → Edge Agent gửi MQTT ack edge/<machineCode>/model/status {ok, version, latencyMs}
       → UI cập nhật trạng thái real-time
```

## 3. Các bước thực hiện trên UI

1. Mở `Menu › AI Models`.
2. Chọn model muốn deploy → tab **Versions** → chọn version đã PASS evaluation.
3. Chuyển sang tab **Deployment** → bấm **+ Deploy mới**.
4. Trong hộp thoại:
   - **Target**: chọn từng máy hoặc theo line/factory.
   - **Strategy**:
     - `rolling` — deploy lần lượt 1 máy/phút (an toàn).
     - `canary` — 1 máy trước, đợi xác nhận, rồi cả nhóm.
     - `parallel` — đẩy đồng loạt (chỉ dùng khi cần khẩn cấp).
   - **Auto-rollback**: bật nếu inference fail-rate > 5 % trong 10 phút sau deploy.
5. Bấm **Bắt đầu** → theo dõi cột **Status** (Pending → Downloading → Verifying → Active).

## 4. Cấu trúc gói model trên server

```
uploads/models/<modelId>/v<version>/
  ├─ model.onnx              # mô hình chính
  ├─ classes.json            # danh sách class
  ├─ preprocess.json         # tham số tiền xử lý
  ├─ postprocess.json        # ngưỡng confidence, NMS
  ├─ checksum.sha256         # SHA-256 của model.onnx
  └─ manifest.json           # version, framework, inputShape, createdAt
```

## 5. Cấu hình Edge Agent

File `/etc/avi-edge/config.yaml` trên máy AOI:

```yaml
machineCode: AOI-L01-M01
broker: mqtts://server.local:8883
modelDir: /var/lib/avi-edge/models
runtime: onnxruntime        # onnxruntime | tensorrt | openvino
device: cuda:0              # cpu | cuda:0 | npu
maxConcurrent: 2
heartbeatSec: 30
```

Khởi động lại: `systemctl restart avi-edge`.

## 6. Rollback nhanh

- UI: `AI Models › Deployment › chọn deployment › nút **Rollback**` → tự đẩy version cũ liền kề.
- CLI trên máy AOI: `avi-edge model use <previous-version>`.
- Auto-rollback kích hoạt khi:
  - inference error rate > 5 %, HOẶC
  - p95 latency tăng > 200 % so với baseline trước deploy.

## 7. Đánh giá mô hình trước khi deploy

> **Bắt buộc**: chỉ được deploy version đã có evaluation **PASS**.

Eval gồm:

- Accuracy / Precision / Recall trên tập test gắn nhãn (>= 1000 ảnh/class).
- Latency p95 trên phần cứng tương đương edge.
- So sánh với baseline (champion model) — version mới phải tốt hơn ≥ 0.5 % accuracy.

Xem `Menu › AI Models › Evaluations` để chạy hoặc kiểm tra kết quả.

## 8. Khắc phục sự cố

| Trạng thái | Nguyên nhân | Cách xử lý |
|---|---|---|
| `Downloading` quá 5 phút | Mạng nội bộ chậm | Kiểm tra ping từ máy AOI tới server; xem `journalctl -u avi-edge -n 200` |
| `Verify Failed` | SHA-256 không khớp | Re-upload model bản gốc; có thể file bị hỏng khi upload |
| `Active` nhưng inference vẫn dùng version cũ | Pipeline chưa reload | Bấm **Force restart pipeline** trong UI hoặc `systemctl restart avi-edge` |
| Auto-rollback liên tục | Model thật sự kém hơn baseline | Mở Evaluation tab so sánh chi tiết, không deploy version này |

## 9. Bảo mật

- File model truyền qua HTTPS, có signed URL hết hạn 5 phút.
- Edge Agent xác thực bằng client cert lưu tại `/etc/avi-edge/certs/`.
- Không deploy model từ tài khoản chưa có quyền `ai-model:deploy` (RBAC).

## 10. Liên kết

- Audit AI Analytics: `AI_ANALYTICS_MODULE_AUDIT.md`.
- MQTT topic spec: xem README module MQTT (`server/services/mqtt/`).
