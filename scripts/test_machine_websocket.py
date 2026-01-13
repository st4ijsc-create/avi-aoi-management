#!/usr/bin/env python3
"""
Test script for Machine WebSocket Registration and Heartbeat
This script simulates an AVI/AOI machine connecting to the system via WebSocket.

Usage:
    python3 test_machine_websocket.py --url ws://localhost:3000 --code AVI-TEST-001 --name "Test AVI Machine"

Requirements:
    pip install python-socketio websocket-client
"""

import argparse
import json
import time
import sys
from datetime import datetime

try:
    import socketio
except ImportError:
    print("Error: python-socketio not installed. Run: pip install python-socketio")
    sys.exit(1)


class MachineSimulator:
    def __init__(self, server_url: str, machine_code: str, machine_name: str, machine_type: str = "AVI"):
        self.server_url = server_url
        self.machine_code = machine_code
        self.machine_name = machine_name
        self.machine_type = machine_type
        self.machine_id = None
        self.api_key = None
        self.is_approved = False
        self.is_connected = False
        
        # Create Socket.IO client
        self.sio = socketio.Client()
        self._setup_handlers()
    
    def _setup_handlers(self):
        """Setup Socket.IO event handlers"""
        
        @self.sio.event
        def connect():
            self.is_connected = True
            print(f"[{self._timestamp()}] ✓ Connected to server")
            self._send_registration()
        
        @self.sio.event
        def disconnect():
            self.is_connected = False
            print(f"[{self._timestamp()}] ✗ Disconnected from server")
        
        @self.sio.event
        def connect_error(data):
            print(f"[{self._timestamp()}] ✗ Connection error: {data}")
        
        @self.sio.on("machine:register_ack")
        def on_register_ack(data):
            print(f"[{self._timestamp()}] ← Registration acknowledged:")
            print(f"    Status: {data.get('status')}")
            print(f"    Message: {data.get('message')}")
        
        @self.sio.on("machine:registration_approved")
        def on_approved(data):
            self.is_approved = True
            self.machine_id = data.get("machineId")
            self.api_key = data.get("apiKey")
            print(f"[{self._timestamp()}] ✓ Registration APPROVED!")
            print(f"    Machine ID: {self.machine_id}")
            print(f"    API Key: {self.api_key}")
            print(f"    Message: {data.get('message')}")
            
            # Confirm mapping
            self._confirm_mapping()
        
        @self.sio.on("machine:registration_rejected")
        def on_rejected(data):
            print(f"[{self._timestamp()}] ✗ Registration REJECTED!")
            print(f"    Reason: {data.get('reason')}")
            print(f"    Message: {data.get('message')}")
    
    def _timestamp(self) -> str:
        return datetime.now().strftime("%H:%M:%S")
    
    def _send_registration(self):
        """Send machine registration request"""
        registration_data = {
            "code": self.machine_code,
            "name": self.machine_name,
            "type": self.machine_type,
            "serialNumber": f"SN-{self.machine_code}-001",
            "manufacturer": "Test Manufacturer",
            "model": f"{self.machine_type}-2000",
            "firmwareVersion": "1.0.0",
        }
        
        print(f"[{self._timestamp()}] → Sending registration request:")
        print(f"    Code: {registration_data['code']}")
        print(f"    Name: {registration_data['name']}")
        print(f"    Type: {registration_data['type']}")
        
        self.sio.emit("machine:register", registration_data)
    
    def _confirm_mapping(self):
        """Confirm machine mapping after approval"""
        if self.machine_id and self.api_key:
            print(f"[{self._timestamp()}] → Confirming mapping...")
            self.sio.emit("machine:confirm_mapping", {
                "machineId": self.machine_id,
                "apiKey": self.api_key,
            })
    
    def send_heartbeat(self, status: str = "running", metrics: dict = None):
        """Send heartbeat to server"""
        if not self.is_approved or not self.machine_id:
            print(f"[{self._timestamp()}] ⚠ Cannot send heartbeat: Not approved yet")
            return
        
        heartbeat_data = {
            "machineId": self.machine_id,
            "status": status,
            "metrics": metrics or {
                "temperature": 45.5,
                "cpuUsage": 32.1,
                "memoryUsage": 48.7,
                "inspectionCount": 1234,
            },
        }
        
        print(f"[{self._timestamp()}] ♥ Sending heartbeat (status: {status})")
        self.sio.emit("machine:heartbeat", heartbeat_data)
    
    def connect(self):
        """Connect to WebSocket server"""
        print(f"\n{'='*60}")
        print(f"Machine WebSocket Simulator")
        print(f"{'='*60}")
        print(f"Server URL: {self.server_url}")
        print(f"Machine Code: {self.machine_code}")
        print(f"Machine Name: {self.machine_name}")
        print(f"Machine Type: {self.machine_type}")
        print(f"{'='*60}\n")
        
        try:
            print(f"[{self._timestamp()}] Connecting to {self.server_url}...")
            self.sio.connect(
                self.server_url,
                socketio_path="/api/socket.io",
                transports=["websocket", "polling"],
            )
        except Exception as e:
            print(f"[{self._timestamp()}] ✗ Failed to connect: {e}")
            return False
        
        return True
    
    def run_heartbeat_loop(self, interval: int = 30):
        """Run continuous heartbeat loop"""
        print(f"\n[{self._timestamp()}] Starting heartbeat loop (interval: {interval}s)")
        print(f"[{self._timestamp()}] Press Ctrl+C to stop\n")
        
        try:
            while self.is_connected:
                if self.is_approved:
                    self.send_heartbeat()
                time.sleep(interval)
        except KeyboardInterrupt:
            print(f"\n[{self._timestamp()}] Stopping heartbeat loop...")
    
    def disconnect(self):
        """Disconnect from server"""
        if self.is_connected:
            print(f"[{self._timestamp()}] Disconnecting...")
            self.sio.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Machine WebSocket Simulator")
    parser.add_argument("--url", default="http://localhost:3000", help="WebSocket server URL")
    parser.add_argument("--code", default="AVI-TEST-001", help="Machine code")
    parser.add_argument("--name", default="Test AVI Machine", help="Machine name")
    parser.add_argument("--type", default="AVI", choices=["AVI", "AOI"], help="Machine type")
    parser.add_argument("--heartbeat", type=int, default=30, help="Heartbeat interval in seconds")
    parser.add_argument("--no-loop", action="store_true", help="Don't run heartbeat loop")
    
    args = parser.parse_args()
    
    # Create and run simulator
    simulator = MachineSimulator(
        server_url=args.url,
        machine_code=args.code,
        machine_name=args.name,
        machine_type=args.type,
    )
    
    if simulator.connect():
        if not args.no_loop:
            # Wait a bit for registration to complete
            time.sleep(2)
            simulator.run_heartbeat_loop(args.heartbeat)
        else:
            # Just wait for registration response
            print(f"\n[{simulator._timestamp()}] Waiting for admin approval...")
            print(f"[{simulator._timestamp()}] Press Ctrl+C to exit\n")
            try:
                while simulator.is_connected and not simulator.is_approved:
                    time.sleep(1)
                if simulator.is_approved:
                    print(f"\n[{simulator._timestamp()}] Machine approved! Exiting...")
            except KeyboardInterrupt:
                pass
        
        simulator.disconnect()


if __name__ == "__main__":
    main()
