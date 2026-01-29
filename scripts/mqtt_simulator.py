#!/usr/bin/env python3
"""
AVI/AOI MQTT Simulator - Mô phỏng máy AVI/AOI gửi dữ liệu kiểm tra
Sử dụng để test luồng real-time với MES server
"""

import json
import time
import random
import argparse
from datetime import datetime
import paho.mqtt.client as mqtt

# Default Configuration
DEFAULT_BROKER = "localhost"
DEFAULT_PORT = 1884
FACTORY_ID = 1
WORKSHOP_ID = 1
STATION_ID = 1
MACHINE_CODE = "AVI-SIM-001"

# Topic prefix
TOPIC_PREFIX = f"avi/{FACTORY_ID}/workshop/{WORKSHOP_ID}/station/{STATION_ID}"

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ Connected to MQTT Broker!")
    else:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Failed to connect, return code {rc}")

def on_disconnect(client, userdata, rc, properties=None):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️ Disconnected from MQTT Broker")

def on_publish(client, userdata, mid, properties=None):
    pass  # Silent publish confirmation

def create_client(broker, port, username=None, password=None):
    client = mqtt.Client(
        client_id=f"avi_simulator_{MACHINE_CODE}_{int(time.time())}",
        protocol=mqtt.MQTTv5
    )
    if username and password:
        client.username_pw_set(username, password)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_publish = on_publish
    return client

def send_inspection_result(client, serial_number, result, inspection_points):
    """Gửi kết quả kiểm tra"""
    payload = {
        "type": "INSPECTION_RESULT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "stationId": STATION_ID,
        "serialNumber": serial_number,
        "productModel": "MODEL-A",
        "result": result,
        "cycleTime": round(random.uniform(2.0, 3.5), 2),
        "inspectionPoints": inspection_points
    }
    
    topic = f"{TOPIC_PREFIX}/inspection"
    client.publish(topic, json.dumps(payload), qos=1)
    status = "✅ OK" if result == "OK" else "❌ NG"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 📋 Inspection: {serial_number} - {status}")

def send_ng_alert(client, serial_number, ng_points):
    """Gửi cảnh báo NG"""
    payload = {
        "type": "NG_ALERT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "stationId": STATION_ID,
        "serialNumber": serial_number,
        "productModel": "MODEL-A",
        "machineName": "AVI Simulator 001",
        "stationName": "Station 1",
        "productName": "Product Model A",
        "ngPoints": ng_points,
        "totalNG": len(ng_points)
    }
    
    topic = f"{TOPIC_PREFIX}/errors"
    client.publish(topic, json.dumps(payload), qos=2)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🚨 NG Alert: {serial_number} - {len(ng_points)} điểm NG")

def send_heartbeat(client, sequence):
    """Gửi heartbeat"""
    payload = {
        "type": "HEARTBEAT",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "sequence": sequence
    }
    
    topic = f"{TOPIC_PREFIX}/heartbeat"
    client.publish(topic, json.dumps(payload), qos=0)

def send_machine_status(client, status):
    """Gửi trạng thái máy"""
    payload = {
        "type": "MACHINE_STATUS",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "machineCode": MACHINE_CODE,
        "status": status,
        "uptime": int(time.time()) % 86400,
        "temperature": round(random.uniform(24.0, 26.0), 1),
        "humidity": round(random.uniform(40.0, 50.0), 1),
        "errorCode": None
    }
    
    topic = f"{TOPIC_PREFIX}/status"
    client.publish(topic, json.dumps(payload), qos=0)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🖥️ Machine Status: {status}")

def simulate_inspection(ng_rate=0.05):
    """Mô phỏng kết quả kiểm tra"""
    is_ok = random.random() > ng_rate
    
    inspection_points = []
    ng_points = []
    
    defect_types = ["INSUFFICIENT_SOLDER", "EXCESS_SOLDER", "BRIDGE", "VOID", "MISSING_COMPONENT", "MISALIGNMENT"]
    
    for i in range(1, 6):
        point_result = "OK" if is_ok or random.random() > 0.3 else "NG"
        actual_value = round(random.uniform(90, 100) if point_result == "OK" else random.uniform(70, 90), 1)
        
        point = {
            "pointId": i,
            "pointName": f"Solder Joint {i}",
            "result": point_result,
            "actualValue": str(actual_value),
            "standardValue": "95-100",
            "unit": "%"
        }
        inspection_points.append(point)
        
        if point_result == "NG":
            ng_points.append({
                **point,
                "defectType": random.choice(defect_types)
            })
    
    result = "OK" if len(ng_points) == 0 else "NG"
    return result, inspection_points, ng_points

def main():
    parser = argparse.ArgumentParser(description='AVI/AOI MQTT Simulator')
    parser.add_argument('--broker', default=DEFAULT_BROKER, help='MQTT broker address')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='MQTT broker port')
    parser.add_argument('--username', default=None, help='MQTT username')
    parser.add_argument('--password', default=None, help='MQTT password')
    parser.add_argument('--interval', type=int, default=5, help='Inspection interval in seconds')
    parser.add_argument('--ng-rate', type=float, default=0.1, help='NG rate (0.0-1.0)')
    parser.add_argument('--count', type=int, default=0, help='Number of inspections (0=infinite)')
    args = parser.parse_args()

    print("=" * 60)
    print("🏭 AVI/AOI MQTT Simulator")
    print("=" * 60)
    print(f"Broker: {args.broker}:{args.port}")
    print(f"Machine: {MACHINE_CODE}")
    print(f"Topic Prefix: {TOPIC_PREFIX}")
    print(f"Inspection Interval: {args.interval}s")
    print(f"NG Rate: {args.ng_rate * 100:.0f}%")
    print("=" * 60)

    client = create_client(args.broker, args.port, args.username, args.password)
    
    try:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🔌 Connecting to {args.broker}:{args.port}...")
        client.connect(args.broker, args.port, 60)
        client.loop_start()
        
        # Wait for connection
        time.sleep(2)
        
        # Send initial status
        send_machine_status(client, "running")
        
        sequence = 0
        inspection_count = 0
        
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🚀 Starting simulation... (Press Ctrl+C to stop)\n")
        
        while args.count == 0 or inspection_count < args.count:
            sequence += 1
            
            # Send heartbeat
            send_heartbeat(client, sequence)
            
            # Simulate inspection
            inspection_count += 1
            serial_number = f"SN{datetime.now().strftime('%Y%m%d')}{inspection_count:04d}"
            
            result, inspection_points, ng_points = simulate_inspection(args.ng_rate)
            send_inspection_result(client, serial_number, result, inspection_points)
            
            if ng_points:
                send_ng_alert(client, serial_number, ng_points)
            
            # Send status every 10 inspections
            if inspection_count % 10 == 0:
                send_machine_status(client, "running")
                print(f"[{datetime.now().strftime('%H:%M:%S')}] 📊 Progress: {inspection_count} inspections completed")
            
            time.sleep(args.interval)
            
    except KeyboardInterrupt:
        print(f"\n\n[{datetime.now().strftime('%H:%M:%S')}] ⏹️ Stopping simulation...")
        send_machine_status(client, "stopped")
        time.sleep(1)
    except Exception as e:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ❌ Error: {e}")
    finally:
        client.loop_stop()
        client.disconnect()
        print(f"[{datetime.now().strftime('%H:%M:%S')}] 👋 Disconnected. Total inspections: {inspection_count}")

if __name__ == "__main__":
    main()
