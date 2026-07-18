#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ví dụ: máy BẮT VÍT gửi kết quả siết mô-men (torque) theo ST4I Process Feed v1.

Minh họa trọn vòng đời:
  1. Bootstrap khóa mk_  (claim mct_  hoặc enroll met_ — chọn 1; ở đây dùng ENV).
  2. Gửi RESULT cho từng con vít: torque + angle + waveform torque-vs-angle.
  3. Heartbeat định kỳ.
  4. Nếu mất mạng: tự xếp hàng local rồi replay ở chu trình sau.

CHẠY:
    # cách A — đã có sẵn mk_ (khuyên dùng khi máy đã onboard):
    set ST4I_SERVER=https://factory.local:5000        (Windows: set / Linux: export)
    set ST4I_MK_KEY=mk_live_xxxxxxxx
    python example_screwdriver.py

    # cách B — bootstrap lần đầu bằng claim token do admin cấp:
    set ST4I_SERVER=https://factory.local:5000
    set ST4I_CLAIM_TOKEN=mct_xxxxxxxx
    set ST4I_SERIAL=SCRW-01-DEVICE
    python example_screwdriver.py

    # cách C — zero-touch enroll (server bật ENROLLMENT_ENABLED):
    set ST4I_ENROLL_TOKEN=met_xxxxxxxx
    set ST4I_SERIAL=SCRW-01-DEVICE
    python example_screwdriver.py

Ghi chú: tất cả điểm cần điền đều đọc từ biến môi trường để KHÔNG hardcode secret
vào firmware. Với dev self-signed TLS, đặt ST4I_VERIFY_TLS=0.
"""
import os
import random
import sys
import time

# Cho phép chạy trực tiếp từ thư mục này (import client cạnh bên).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from st4i_device_client import (  # noqa: E402
    St4iDeviceClient,
    St4iApiError,
    St4iNetworkError,
)

# ── Cấu hình (điền qua ENV — KHÔNG hardcode secret) ─────────────────────────
SERVER_URL   = os.environ.get("ST4I_SERVER", "https://localhost:5000")
MACHINE_CODE = os.environ.get("ST4I_MACHINE_CODE", "SCRW-01")   # mã máy đã đăng ký
DEVICE_SERIAL = os.environ.get("ST4I_SERIAL", "SCRW-01-DEVICE") # serial của CHÍNH máy vít
VERIFY_TLS   = os.environ.get("ST4I_VERIFY_TLS", "1") not in ("0", "false", "no")
KEY_CACHE    = os.environ.get("ST4I_KEY_FILE", "st4i_scrw01_key.json")
QUEUE_FILE   = os.environ.get("ST4I_QUEUE_FILE", "st4i_scrw01_queue.jsonl")

# Recipe + spec-limit của công đoạn siết vít M3 (self-describing — server dùng cho SPC/CPK).
RECIPE = {"code": "TQ-M3-08", "version": "2.1", "checksum": "a1b2c3d4"}
TORQUE_LSL, TORQUE_USL, TORQUE_NOMINAL = 0.70, 0.95, 0.82   # Nm
ANGLE_LSL, ANGLE_USL, ANGLE_NOMINAL = 360, 450, 410         # deg


def build_client():
    c = St4iDeviceClient(
        server_url=SERVER_URL,
        machine_code=MACHINE_CODE,
        serial_number=DEVICE_SERIAL,
        queue_path=QUEUE_FILE,       # hàng đợi BỀN qua restart
        verify_tls=VERIFY_TLS,
        max_retries=4,
    )

    # 1) Ưu tiên khóa đã cache, rồi ENV, rồi bootstrap bằng token.
    if c.load_key(KEY_CACHE):
        print(f"[key] Dùng mk_ đã lưu ({KEY_CACHE}).")
        return c
    if c.mk_key:  # từ ENV ST4I_MK_KEY
        print("[key] Dùng mk_ từ ENV ST4I_MK_KEY.")
        c.save_key(KEY_CACHE)
        return c

    claim = os.environ.get("ST4I_CLAIM_TOKEN")
    enroll = os.environ.get("ST4I_ENROLL_TOKEN")
    if claim:
        print("[bootstrap] claim mct_ -> mk_ ...")
        res = c.claim(claim, serial_number=DEVICE_SERIAL)
        print(f"[bootstrap] OK machine={res.get('code')} id={res.get('machineId')}")
    elif enroll:
        print("[bootstrap] enroll met_ -> mk_ ...")
        res = c.enroll(
            enroll,
            serial_number=DEVICE_SERIAL,
            machine_info={"name": "Screwdriver 01", "machineType": "AUTOMATION",
                          "manufacturer": "ST4I", "firmwareVersion": "1.0.0"},
        )
        print(f"[bootstrap] OK machine={res.get('code')} scopes={res.get('scopes')}")
    else:
        raise SystemExit(
            "Chưa có mk_. Đặt ST4I_MK_KEY, hoặc ST4I_CLAIM_TOKEN, hoặc ST4I_ENROLL_TOKEN."
        )
    c.save_key(KEY_CACHE)   # lưu mk_ mới nhận (chỉ show 1 lần!)
    return c


def read_torque_cycle():
    """
    Giả lập 1 chu trình siết: đọc torque/angle từ bộ điều khiển vít.
    >>> THAY BẰNG mã đọc PLC/Modbus/serial thật của bạn <<<
    Trả (torque_nm, angle_deg, waveform_samples).
    """
    torque = round(random.uniform(0.72, 0.90), 3)
    angle = random.randint(390, 430)
    # Waveform torque-vs-angle (đường cong siết) — cửa sổ quanh sự kiện, hạ mẫu để < 64KB.
    steps = [0, 90, 180, 270, 360, angle]
    samples = [[a, round(torque * (a / angle), 3)] for a in steps]
    return torque, angle, samples


def classify(torque):
    if torque < TORQUE_LSL or torque > TORQUE_USL:
        return "fail"
    if torque < TORQUE_LSL + 0.03 or torque > TORQUE_USL - 0.03:
        return "warn"   # gần biên — firmware tự phân loại (doc 57 §8.2)
    return "pass"


def main():
    c = build_client()

    # Heartbeat mở màn (xác nhận online).
    try:
        c.heartbeat()
        print("[hb] online")
    except (St4iApiError, St4iNetworkError) as e:
        print(f"[hb] cảnh báo: {e}")

    cycle = int(time.time())   # bộ đếm chu trình -> idempotencyKey ỔN ĐỊNH
    for i in range(5):         # demo 5 con vít; thực tế là vòng lặp vô hạn của máy
        cycle += 1
        unit_serial = f"SN-2026-{cycle:06d}"
        torque, angle, wave = read_torque_cycle()
        verdict = classify(torque)

        # idempotencyKey ổn định theo chu trình vật lý -> retry KHÔNG ghi trùng (§5).
        idem = f"{MACHINE_CODE}:{RECIPE['code']}:{cycle}"

        try:
            data = c.submit_process_result(
                serial_number=unit_serial,
                step_type="screw_tightening",
                result=verdict,
                recipe=RECIPE,
                metrics=[
                    {"name": "torque", "value": torque, "unit": "Nm",
                     "lsl": TORQUE_LSL, "usl": TORQUE_USL, "nominal": TORQUE_NOMINAL},
                    {"name": "angle", "value": angle, "unit": "deg",
                     "lsl": ANGLE_LSL, "usl": ANGLE_USL, "nominal": ANGLE_NOMINAL},
                ],
                waveforms=[{"name": "torque_vs_angle", "unit": "Nm", "rateHz": 500, "samples": wave}],
                idempotency_key=idem,
                # Genealogy (tùy chọn). LƯU Ý: stationId PHẢI là SỐ (platform station id) —
                # gửi chuỗi bị 400. Firmware thường chỉ biết mã trạm dạng chuỗi nên dùng
                # lineCode/lotCode (đều string). Field lạ top-level bị server STRIP âm thầm
                # (rawExtras CHƯA cài cho process-result) -> đưa số đo vendor vào metrics[].
                extra={"lineCode": "LINE-01", "lotCode": "LOT-2026-0001"},
            )
            # Replay cùng idempotencyKey trả processResultId gốc + duplicate:true (KHÔNG ghi trùng).
            pid = data.get("processResultId", "?")
            dup = " (duplicate)" if data.get("duplicate") else ""
            print(f"[{i+1}] {verdict.upper():4} torque={torque}Nm angle={angle}° -> id={pid}{dup}")
        except St4iNetworkError as e:
            # Đã tự xếp vào hàng đợi local; sẽ replay ở chu trình sau khi có mạng.
            print(f"[{i+1}] MẤT MẠNG -> đã xếp hàng: {e}")
        except St4iApiError as e:
            # 400/401/403/409: payload/khóa/version sai -> KHÔNG retry, cần sửa.
            print(f"[{i+1}] BỊ TỪ CHỐI (HTTP {e.status} {e.code}): {e}")

        time.sleep(1.0)

    # Cố xả nốt hàng đợi trước khi thoát.
    stats = c.flush_queue()
    print(f"[queue] flush cuối: sent={stats['sent']} kept={stats['kept']}")
    print("Hoàn tất demo máy bắt vít.")


if __name__ == "__main__":
    main()
