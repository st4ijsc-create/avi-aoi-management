#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
St4iDeviceClient — SDK tham chiếu (reference client) cho firmware / gateway nội bộ
đẩy dữ liệu vào nền tảng ST4I AVI/AOI Management.

Chuẩn tuân theo:
  - doc 57  ST4I Standard Process Feed v1   (RESULT + TELEMETRY)
  - doc 56  Device Connectivity Standardization (onboarding khóa mk_)

Đặc điểm:
  - CHỈ dùng thư viện chuẩn của Python (urllib) — KHÔNG cần `pip install`.
    (Nếu muốn dùng `requests` cho gọn, xem ghi chú ở README; mặc định urllib để
     copy-chạy ngay trên máy công nghiệp không có Internet cài package.)
  - Bootstrap khóa mk_ qua enroll (met_) hoặc claim (mct_).
  - Gửi RESULT (máy vít/keo/hàn…) + TELEMETRY (cảm biến) theo envelope Feed v1.
  - idempotencyKey (exactly-once) + retry backoff + hàng đợi local (store-and-forward)
    replay khi mất mạng.
  - Timestamp RFC 3339 KÈM offset tường minh (naive time bị server reject — doc 57 §4).

Chạy tối thiểu: Python 3.8+.

────────────────────────────────────────────────────────────────────────────
KHÓA & ENDPOINT (đọc kỹ):
  Ingest (RESULT/TELEMETRY):  header  `Authorization: Bearer <mk_...>`
                                 hoặc  `X-API-Key: <mk_...>`
    POST {SERVER}/api/v1/ingest/process-result   -> RESULT (Feed v1)
    POST {SERVER}/api/v1/ingest/telemetry        -> TELEMETRY (CanonicalSample[])
  Heartbeat:                     header  `X-API-Key: <mk_...>`  (hoặc body.apiKey)
    POST {SERVER}/api/machine/heartbeat
  Bootstrap (một lần, không cần auth — token CHÍNH LÀ credential):
    POST {SERVER}/api/trpc/machine.enroll        (met_ token -> mk_)
    POST {SERVER}/api/trpc/machine.claimKey      (mct_ token -> mk_)
────────────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations

import json
import os
import ssl
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union
from urllib import error as urllib_error
from urllib import request as urllib_request


# ── Ngoại lệ ────────────────────────────────────────────────────────────────
class St4iConfigError(Exception):
    """Cấu hình client sai (thiếu mk_, thiếu serverURL…)."""


class St4iNetworkError(Exception):
    """Lỗi mạng/timeout — retryable, sẽ đưa vào hàng đợi local."""


class St4iApiError(Exception):
    """Server trả lỗi có cấu trúc (HTTP 4xx/5xx với envelope error)."""

    def __init__(self, message: str, status: int = 0, code: str = "", payload: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.payload = payload


# ── Tiện ích thời gian ──────────────────────────────────────────────────────
def iso_now() -> str:
    """
    Trả timestamp RFC 3339 KÈM offset local tường minh, ví dụ:
        2026-07-17T14:03:00.480+07:00
    BẮT BUỘC có offset — server reject giờ naive (doc 57 §4, mã lỗi naive_timestamp).
    `datetime.now().astimezone()` gắn tzinfo local nên isoformat() luôn có ±hh:mm.
    """
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


# ── Kiểu dữ liệu tiện dụng ──────────────────────────────────────────────────
Metric = Dict[str, Any]        # {name, value, unit?, lsl?, usl?, nominal?}
Waveform = Dict[str, Any]      # {name, unit?, rateHz?, samples: [[t, v], ...]}
Sample = Dict[str, Any]        # CanonicalSample {metric, value, unit?, ts?, deviceId?, quality?}


class St4iDeviceClient:
    """
    Client cho MỘT thiết bị (1 mk_ = 1 máy). Tạo 1 instance / máy.

    Ví dụ nhanh:
        c = St4iDeviceClient("https://factory.local:5000",
                             machine_code="SCRW-01",
                             serial_number=None,
                             queue_path="st4i_scrw01_queue.jsonl",
                             verify_tls=False)   # verify_tls=False chỉ cho dev self-signed
        c.enroll("met_xxx", serial_number="SCRW-01-DEVICE")   # 1 lần -> có mk_
        c.submit_process_result(serial_number="SN-777", step_type="screw_tightening",
                                result="pass",
                                metrics=[{"name": "torque", "value": 0.82, "unit": "Nm",
                                          "lsl": 0.70, "usl": 0.95, "nominal": 0.82}])
        c.heartbeat()
    """

    SCHEMA_VERSION = "1.0"

    # HTTP status coi là tạm thời -> retry + đưa vào hàng đợi local.
    _RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

    def __init__(
        self,
        server_url: str,
        mk_key: Optional[str] = None,
        machine_code: Optional[str] = None,
        serial_number: Optional[str] = None,
        queue_path: Optional[str] = None,
        timeout: float = 10.0,
        verify_tls: bool = True,
        max_retries: int = 4,
        backoff_base: float = 0.5,
        backoff_max: float = 30.0,
    ):
        if not server_url:
            raise St4iConfigError("server_url là bắt buộc, ví dụ 'https://factory.local:5000'")
        self.server_url = server_url.rstrip("/")
        self.mk_key = mk_key or os.environ.get("ST4I_MK_KEY")  # có thể nạp từ ENV
        self.machine_code = machine_code
        self.serial_number = serial_number
        self.queue_path = queue_path
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.backoff_base = backoff_base
        self.backoff_max = backoff_max

        # Hàng đợi local: nếu queue_path -> file JSONL (bền qua restart);
        # nếu None -> danh sách trong RAM (mất khi tắt tiến trình).
        self._mem_queue: List[Dict[str, Any]] = []

        # SSL context: verify_tls=False tạo context KHÔNG kiểm chứng cert
        # (chỉ dùng cho máy chủ dev self-signed trong LAN xưởng — CẢNH BÁO an ninh).
        if verify_tls:
            self._ssl_ctx: Optional[ssl.SSLContext] = ssl.create_default_context()
        else:
            self._ssl_ctx = ssl.create_default_context()
            self._ssl_ctx.check_hostname = False
            self._ssl_ctx.verify_mode = ssl.CERT_NONE

    # ══════════════════════════════════════════════════════════════════════
    # HTTP tầng thấp
    # ══════════════════════════════════════════════════════════════════════
    def _http(
        self, method: str, url: str, headers: Dict[str, str], body: Optional[bytes]
    ) -> Tuple[int, bytes]:
        """
        Gọi HTTP thô bằng urllib. Trả (status, raw_bytes).
        - HTTPError (4xx/5xx) được BẮT và trả về (code, body) để caller xử lý envelope lỗi.
        - URLError (mất mạng/timeout) -> ném St4iNetworkError (retryable).
        """
        req = urllib_request.Request(url=url, data=body, headers=headers, method=method)
        try:
            ctx = self._ssl_ctx if url.lower().startswith("https") else None
            with urllib_request.urlopen(req, timeout=self.timeout, context=ctx) as resp:
                return resp.status, resp.read()
        except urllib_error.HTTPError as e:
            # Server phản hồi có status — đọc body để lấy envelope { ok:false, error }.
            try:
                raw = e.read()
            except Exception:
                raw = b""
            return e.code, raw
        except urllib_error.URLError as e:
            raise St4iNetworkError(f"Không kết nối được {url}: {e.reason}") from e
        except (TimeoutError, OSError) as e:  # socket timeout, DNS…
            raise St4iNetworkError(f"Lỗi mạng khi gọi {url}: {e}") from e

    def _auth_headers(self) -> Dict[str, str]:
        if not self.mk_key:
            raise St4iConfigError(
                "Chưa có khóa mk_. Gọi enroll()/claim() trước, hoặc truyền mk_key khi khởi tạo."
            )
        # Feed v1 §2: gửi mk_ qua Bearer HOẶC X-API-Key. Dùng cả hai cho chắc.
        return {
            "Authorization": f"Bearer {self.mk_key}",
            "X-API-Key": self.mk_key,
        }

    # ══════════════════════════════════════════════════════════════════════
    # Bootstrap: enroll (met_) / claim (mct_)  -> nhận mk_
    # ══════════════════════════════════════════════════════════════════════
    def _trpc_mutation(self, procedure: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Gọi 1 tRPC mutation (public) qua HTTP. Server dùng superjson transformer nên:
          - Body request:  {"json": <input>}
          - Response OK:    {"result": {"data": {"json": <data>}}}
          - Response lỗi:   {"error": {"json": {"message": ..., "code": ...}}}
        Hàm này bọc/mở lớp superjson đó.
        """
        url = f"{self.server_url}/api/trpc/{procedure}"
        body = json.dumps({"json": payload}).encode("utf-8")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}

        # Bootstrap cũng retry vài lần cho lỗi mạng, nhưng KHÔNG đưa vào hàng đợi
        # (đây là bước 1 lần, phải có người vận hành xem kết quả).
        last_err: Optional[Exception] = None
        for attempt in range(self.max_retries + 1):
            try:
                status, raw = self._http("POST", url, headers, body)
            except St4iNetworkError as e:
                last_err = e
                self._sleep_backoff(attempt)
                continue

            data = self._parse_json(raw)
            # Lỗi tRPC (superjson bọc trong error.json).
            err = data.get("error") if isinstance(data, dict) else None
            if status >= 400 or err is not None:
                err_json = (err or {}).get("json", err) if isinstance(err, dict) else err
                msg = ""
                if isinstance(err_json, dict):
                    msg = err_json.get("message") or ""
                raise St4iApiError(
                    msg or f"tRPC {procedure} lỗi (HTTP {status})",
                    status=status,
                    payload=data,
                )
            # OK: mở result.data.json
            result = ((data.get("result") or {}).get("data")) if isinstance(data, dict) else None
            if isinstance(result, dict) and "json" in result:
                result = result["json"]
            return result if isinstance(result, dict) else {}

        raise St4iNetworkError(f"tRPC {procedure} thất bại sau {self.max_retries + 1} lần: {last_err}")

    def enroll(
        self,
        enrollment_token: str,
        serial_number: Optional[str] = None,
        machine_info: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Đổi enrollment token (met_) lấy khóa mk_ (zero-touch — doc 56 Trục 1).
        Server phải bật cờ ENROLLMENT_ENABLED=true.

        machine_info (tùy chọn) cho phép TẠO máy chưa từng register trong 1 lần:
            {"name": "...", "machineType": "AUTOMATION"|"AOI"|"AVI", "model": "...",
             "manufacturer": "...", "firmwareVersion": "...", "syncMode": "online"}

        Sau khi thành công: self.mk_key được nạp và trả về dict
            {apiKey, machineId, code, scopes, created, message}
        """
        serial = serial_number or self.serial_number
        if not serial:
            raise St4iConfigError("enroll() cần serial_number (định danh thiết bị vật lý).")
        payload: Dict[str, Any] = {"serialNumber": serial, "enrollmentToken": enrollment_token}
        if machine_info:
            payload["machineInfo"] = machine_info
        data = self._trpc_mutation("machine.enroll", payload)
        self._absorb_credential(data)
        return data

    def claim(self, claim_token: str, serial_number: Optional[str] = None) -> Dict[str, Any]:
        """
        Đổi claim token (mct_) lấy khóa mk_ (kỹ thuật viên duyệt qua wizard — doc 56).
        Trả {apiKey, machineId, code, message}. Token là 1-lần (spent sau khi dùng).
        """
        serial = serial_number or self.serial_number
        if not serial:
            raise St4iConfigError("claim() cần serial_number.")
        data = self._trpc_mutation(
            "machine.claimKey", {"serialNumber": serial, "claimToken": claim_token}
        )
        self._absorb_credential(data)
        return data

    def _absorb_credential(self, data: Dict[str, Any]) -> None:
        """Nạp mk_ + machineCode từ kết quả enroll/claim vào client."""
        api_key = data.get("apiKey")
        if api_key:
            self.mk_key = api_key
        code = data.get("code")
        if code and not self.machine_code:
            self.machine_code = code

    def save_key(self, path: str) -> None:
        """Lưu mk_ ra file (0600) để dùng lại sau restart. mk_ chỉ show 1 lần khi cấp!"""
        if not self.mk_key:
            raise St4iConfigError("Chưa có mk_ để lưu.")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"mk_key": self.mk_key, "machineCode": self.machine_code}, f)
        try:
            os.chmod(path, 0o600)  # chỉ chủ sở hữu đọc (POSIX; Windows bỏ qua)
        except (OSError, NotImplementedError):
            pass

    def load_key(self, path: str) -> bool:
        """Nạp mk_ đã lưu. Trả True nếu có."""
        if not os.path.exists(path):
            return False
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        self.mk_key = obj.get("mk_key") or self.mk_key
        self.machine_code = obj.get("machineCode") or self.machine_code
        return bool(self.mk_key)

    # ══════════════════════════════════════════════════════════════════════
    # RESULT — POST /api/v1/ingest/process-result  (Feed v1)
    # ══════════════════════════════════════════════════════════════════════
    def submit_process_result(
        self,
        serial_number: str,
        step_type: str,
        result: str,
        metrics: Optional[Sequence[Metric]] = None,
        waveforms: Optional[Sequence[Waveform]] = None,
        recipe: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        ts: Optional[str] = None,
        machine_code: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Gửi 1 kết quả chu trình (1 con vít / 1 điểm keo / 1 mối hàn…).

        Tham số bắt buộc:
          serial_number : serial/barcode unit đang gia công (trục genealogy)
          step_type     : thuộc process_step_types, vd 'screw_tightening', 'glue_dispense',
                          'weld_spot', 'leak_test', 'functional_test', 'press_fit',
                          'label_apply', 'vision_check'
          result        : 'pass' | 'fail' | 'warn' | 'skip'  (chữ thường)

        Tùy chọn:
          metrics    : [{name, value, unit?, lsl?, usl?, nominal?}]  (đơn vị chuẩn — §6 doc 57)
          waveforms  : [{name, unit?, rateHz?, samples: [[t, v], ...]}]  (tổng <= ~64KB)
          recipe     : {code, version?, checksum?}
          idempotency_key : KHÓA exactly-once. Nếu bỏ trống -> tự sinh; NÊN đặt ổn định
                          theo chu trình vật lý '<machineCode>:<recipe>:<cycle>' để retry
                          KHÔNG tạo bản ghi trùng (doc 57 §5).
          ts         : ISO 3339 KÈM offset. Bỏ trống -> iso_now() (giờ local có offset).

        Trả envelope data {processResultId} hoặc {idempotent: true} (replay).
        Khi mất mạng và hết retry: payload được đưa vào hàng đợi local, ném St4iNetworkError.
        """
        result = str(result).lower().strip()
        if result not in ("pass", "fail", "warn", "skip"):
            raise St4iConfigError(f"result phải là pass|fail|warn|skip, nhận '{result}'")

        if not idempotency_key:
            mc = machine_code or self.machine_code or "dev"
            idempotency_key = f"{mc}:{step_type}:{uuid.uuid4().hex[:16]}"

        payload: Dict[str, Any] = {
            "schemaVersion": self.SCHEMA_VERSION,
            "serialNumber": serial_number,
            "stepType": step_type,
            "result": result,
            "ts": ts or iso_now(),
            "idempotencyKey": idempotency_key,
        }
        mc = machine_code or self.machine_code
        if mc:
            payload["machineCode"] = mc          # khuyến nghị gửi (envelope §3.1)
        if recipe:
            payload["recipe"] = recipe
        if metrics:
            payload["metrics"] = list(metrics)
        if waveforms:
            payload["waveforms"] = list(waveforms)
        if extra:
            payload.update(extra)                # stationId/lineCode/lotCode/rawExtras…

        return self._send_with_retry("process", "/api/v1/ingest/process-result", payload)

    # ══════════════════════════════════════════════════════════════════════
    # TELEMETRY — POST /api/v1/ingest/telemetry  (CanonicalSample[])
    # ══════════════════════════════════════════════════════════════════════
    def submit_telemetry(
        self, samples: Sequence[Union[Sample, Tuple[str, Any]]]
    ) -> Dict[str, Any]:
        """
        Gửi 1 batch mẫu telemetry liên tục (nhiệt/ẩm/dòng/mô-men…).

        `samples` là list các dict CanonicalSample:
            {metric, value, unit?, ts?, deviceId?, quality?}
        hoặc tuple ngắn gọn (metric, value) / (metric, value, unit) — sẽ tự chuẩn hóa,
        tự thêm ts=iso_now() và deviceId nếu client biết.

        Trả envelope data {accepted, received, machine} (HTTP 202).
        Mất mạng hết retry -> đưa vào hàng đợi local, ném St4iNetworkError.
        """
        norm: List[Sample] = []
        for s in samples:
            if isinstance(s, dict):
                item = dict(s)
            elif isinstance(s, (tuple, list)):
                item = {"metric": s[0], "value": s[1]}
                if len(s) >= 3 and s[2] is not None:
                    item["unit"] = s[2]
            else:
                raise St4iConfigError("Mỗi sample phải là dict hoặc tuple (metric, value[, unit]).")
            item.setdefault("ts", iso_now())     # NÊN gửi ts có offset để chính xác
            if self.machine_code and "deviceId" not in item and "machineId" not in item:
                item["deviceId"] = self.machine_code
            norm.append(item)

        if not norm:
            raise St4iConfigError("submit_telemetry cần ít nhất 1 sample.")

        return self._send_with_retry("telemetry", "/api/v1/ingest/telemetry", {"samples": norm})

    # ══════════════════════════════════════════════════════════════════════
    # Heartbeat — POST /api/machine/heartbeat  (X-API-Key)
    # ══════════════════════════════════════════════════════════════════════
    def heartbeat(self) -> Dict[str, Any]:
        """
        Báo 'còn sống' cho hệ thống (presence). Proxy REST này đọc X-API-Key (hoặc
        body.apiKey), KHÔNG đọc Authorization Bearer — nên gửi X-API-Key + body.apiKey.
        """
        if not self.mk_key:
            raise St4iConfigError("heartbeat cần mk_.")
        url = f"{self.server_url}/api/machine/heartbeat"
        headers = {"Content-Type": "application/json", "X-API-Key": self.mk_key}
        body = json.dumps({"apiKey": self.mk_key}).encode("utf-8")
        status, raw = self._http("POST", url, headers, body)
        data = self._parse_json(raw)
        if status >= 400:
            raise St4iApiError(
                (data.get("message") if isinstance(data, dict) else "") or f"Heartbeat lỗi (HTTP {status})",
                status=status,
                payload=data,
            )
        return data if isinstance(data, dict) else {}

    # ══════════════════════════════════════════════════════════════════════
    # Gửi có retry + hàng đợi local (store-and-forward)
    # ══════════════════════════════════════════════════════════════════════
    def _send_with_retry(self, kind: str, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        # Trước mỗi lần gửi, cố gắng xả bớt hàng đợi cũ (best-effort, không chặn).
        if self._queue_len() > 0:
            try:
                self.flush_queue()
            except St4iNetworkError:
                pass  # vẫn còn mạng kém — thử gửi bản ghi hiện tại rồi lại xếp hàng.

        url = f"{self.server_url}{path}"
        try:
            headers = {"Content-Type": "application/json", **self._auth_headers()}
        except St4iConfigError:
            raise
        body = json.dumps(payload).encode("utf-8")

        last_status = 0
        last_data: Any = None
        for attempt in range(self.max_retries + 1):
            try:
                status, raw = self._http("POST", url, headers, body)
            except St4iNetworkError as e:
                # Mất mạng: nếu còn lượt thì backoff & thử lại, hết lượt -> xếp hàng.
                if attempt < self.max_retries:
                    self._sleep_backoff(attempt)
                    continue
                self._enqueue(kind, path, payload)
                raise St4iNetworkError(f"{path}: mất mạng, đã xếp vào hàng đợi local. ({e})") from e

            data = self._parse_json(raw)
            last_status, last_data = status, data

            if 200 <= status < 300:
                # Envelope { ok:true, data:{...} } -> trả data (giữ nguyên nếu shape khác).
                if isinstance(data, dict) and data.get("ok") and "data" in data:
                    return data["data"] if isinstance(data["data"], dict) else data
                return data if isinstance(data, dict) else {}

            if status in self._RETRYABLE_STATUS:
                # 429/5xx: tạm thời -> backoff & thử lại; hết lượt -> xếp hàng (đặc biệt 503 db_unavailable).
                if attempt < self.max_retries:
                    self._sleep_backoff(attempt, retry_after=self._retry_after(raw))
                    continue
                self._enqueue(kind, path, payload)
                raise St4iNetworkError(
                    f"{path}: server tạm lỗi HTTP {status} sau {self.max_retries + 1} lần — đã xếp hàng."
                )

            # 4xx còn lại (400 payload sai / 401 / 403 / 409 version) = LỖI VĨNH VIỄN.
            # KHÔNG xếp hàng (gửi lại vẫn sai) — ném ngay để firmware sửa/loại bỏ.
            code, msg = self._envelope_error(data)
            raise St4iApiError(
                msg or f"{path} bị từ chối (HTTP {status})",
                status=status,
                code=code,
                payload=data,
            )

        # Không nên tới đây.
        raise St4iApiError(f"{path}: hết retry (HTTP {last_status})", status=last_status, payload=last_data)

    # ── Hàng đợi local ──────────────────────────────────────────────────────
    def _enqueue(self, kind: str, path: str, payload: Dict[str, Any]) -> None:
        entry = {"kind": kind, "path": path, "payload": payload, "queuedAt": iso_now()}
        if self.queue_path:
            # File JSONL: append 1 dòng (bền qua restart).
            with open(self.queue_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        else:
            self._mem_queue.append(entry)

    def _queue_len(self) -> int:
        if self.queue_path:
            if not os.path.exists(self.queue_path):
                return 0
            with open(self.queue_path, "r", encoding="utf-8") as f:
                return sum(1 for line in f if line.strip())
        return len(self._mem_queue)

    def flush_queue(self) -> Dict[str, int]:
        """
        Thử gửi lại toàn bộ bản ghi đang xếp hàng (mỗi bản 1 lần, cùng idempotencyKey
        nên server dedup — an toàn). Bản nào vẫn lỗi mạng thì GIỮ lại hàng đợi.
        Trả {sent, kept}.
        """
        pending = self._drain_queue()
        if not pending:
            return {"sent": 0, "kept": 0}

        sent, kept_entries = 0, []
        headers_cache: Optional[Dict[str, str]] = None
        for entry in pending:
            try:
                if headers_cache is None:
                    headers_cache = {"Content-Type": "application/json", **self._auth_headers()}
                url = f"{self.server_url}{entry['path']}"
                body = json.dumps(entry["payload"]).encode("utf-8")
                status, raw = self._http("POST", url, headers_cache, body)
            except St4iNetworkError:
                kept_entries.append(entry)       # vẫn mất mạng -> giữ lại
                continue

            if 200 <= status < 300 or status in (409,):  # 409 idempotent/version -> coi như đã xử lý
                sent += 1
            elif status in self._RETRYABLE_STATUS:
                kept_entries.append(entry)        # tạm lỗi -> giữ để lần sau
            else:
                # 4xx payload sai -> BỎ (không thể gửi thành công) nhưng vẫn đếm là "xử lý".
                sent += 1

        # Ghi lại các bản còn giữ.
        for e in kept_entries:
            self._enqueue(e["kind"], e["path"], e["payload"])
        return {"sent": sent, "kept": len(kept_entries)}

    def _drain_queue(self) -> List[Dict[str, Any]]:
        """Lấy hết bản ghi ra khỏi hàng đợi (xóa nguồn) để thử gửi lại."""
        if self.queue_path:
            if not os.path.exists(self.queue_path):
                return []
            with open(self.queue_path, "r", encoding="utf-8") as f:
                lines = [ln for ln in f if ln.strip()]
            # Xóa file (sẽ được ghi lại phần còn giữ).
            try:
                os.remove(self.queue_path)
            except OSError:
                open(self.queue_path, "w", encoding="utf-8").close()
            out = []
            for ln in lines:
                try:
                    out.append(json.loads(ln))
                except json.JSONDecodeError:
                    continue
            return out
        drained = self._mem_queue
        self._mem_queue = []
        return drained

    # ── Helpers ─────────────────────────────────────────────────────────────
    @staticmethod
    def _parse_json(raw: bytes) -> Any:
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    @staticmethod
    def _envelope_error(data: Any) -> Tuple[str, str]:
        """Bóc { ok:false, error:{ code, message } } -> (code, message)."""
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict):
                return str(err.get("code") or ""), str(err.get("message") or "")
            if isinstance(data.get("message"), str):
                return "", data["message"]
        return "", ""

    @staticmethod
    def _retry_after(raw: bytes) -> float:
        # Đơn giản: không parse header ở đây (urllib đã đóng response); trả 0.
        return 0.0

    def _sleep_backoff(self, attempt: int, retry_after: float = 0.0) -> None:
        # Exponential backoff có trần: base * 2^attempt, kẹp [.., backoff_max].
        delay = min(self.backoff_base * (2 ** attempt), self.backoff_max)
        if retry_after > 0:
            delay = max(delay, retry_after)
        time.sleep(delay)


__all__ = [
    "St4iDeviceClient",
    "St4iApiError",
    "St4iNetworkError",
    "St4iConfigError",
    "iso_now",
]
