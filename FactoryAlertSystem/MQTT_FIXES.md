# MQTT Connection Error Fixes

## Problems Fixed

### 1. TcpSocket Error: undefined ✅
- **Issue**: React Native TCP socket was emitting undefined errors causing crashes
- **Fix**: Added proper error handling and fallback error messages
- **Files Modified**: 
  - `src/services/mqttService.ts`
  - `shims/net.js`
  - `shim.js`

### 2. Unhandled Error (undefined) ✅  
- **Issue**: Undefined errors not being properly caught and handled
- **Fix**: Added error wrapping to ensure all errors are proper Error objects
- **Impact**: Prevents app crashes from undefined error events

### 3. Connection Timeout Issues ✅
- **Issue**: TCP connections hanging without proper timeout handling
- **Fix**: Added comprehensive timeout management with cleanup
- **Features Added**:
  - Connection timeout with configurable duration
  - Proper cleanup on timeout or socket destruction
  - Improved error propagation

## How to Test

1. **Start the app**:
   ```bash
   pnpm start
   ```

2. **Navigate to the Simulator screen** (bottom tab)

3. **Use the MQTT Connection Test component** at the top of the screen:
   - Click "Test Connection" to verify broker connectivity
   - Click "Connect" to establish a connection 
   - Click "Disconnect" to close the connection
   - Monitor the connection logs for detailed feedback

## Configuration

### Default MQTT Settings
- **Broker**: `localhost:1883` (TCP) / `localhost:8883` (WebSocket)
- **Protocol**: TCP (with WebSocket fallback)
- **Topics**: `avi/+/workshop/+/station/+/errors`, etc.

### Android Device Notes
- **Emulator**: `localhost` is automatically converted to `10.0.2.2`
- **Physical Device**: Use your computer's IP address (e.g., `192.168.1.100`)
- **Port Forwarding**: Use `adb reverse tcp:1883 tcp:1883` for localhost access

## Error Prevention

### Socket Error Handling
```typescript
// Before (causing crashes)
socket.on('error', (err: Error) => {
  console.error(err.message); // err might be undefined
});

// After (crash-safe)
socket.on('error', (err: Error | undefined) => {
  const errorMsg = err?.message || 'Unknown socket error';
  console.error('[MQTT] TcpSocket error:', errorMsg);
  // Re-emit proper Error object
  wrappedSocket.emit('error', err || new Error(errorMsg));
});
```

### Connection Timeout Management
```typescript
// Added proper timeout handling
connectionTimeout = setTimeout(() => {
  console.error('[MQTT] TCP connection timeout');
  if (wrappedSocket && typeof wrappedSocket.emit === 'function') {
    wrappedSocket.emit('error', new Error('Connection timeout'));
  }
  socket.destroy();
}, timeoutMs);
```

## Troubleshooting

### If Connection Still Fails

1. **Check broker availability**:
   ```bash
   # Test with mosquitto client
   mosquitto_pub -h localhost -p 1883 -t test -m "hello"
   ```

2. **Verify network connectivity**:
   - Ensure MQTT broker is running
   - Check firewall settings
   - Verify port availability

3. **Try WebSocket fallback**:
   - Change protocol from "tcp" to "ws" in settings
   - Use WebSocket port (typically 8083 or 8884)

4. **Enable verbose logging**:
   - Check React Native logs for detailed error messages
   - Monitor MQTT service logs in the console

### Common Issues

- **"Connection timeout"**: Broker not reachable or wrong address/port
- **"ECONNREFUSED"**: Broker not running on specified port
- **"Authentication failed"**: Check username/password format for local brokers

## Next Steps

The MQTT connection should now be stable with proper error handling. You can:

1. Test with a real MQTT broker
2. Configure production broker settings
3. Set up proper authentication
4. Add more robust reconnection logic if needed

## Files Modified

- ✅ `src/services/mqttService.ts` - Main MQTT service fixes
- ✅ `shims/net.js` - TCP socket shim improvements  
- ✅ `shim.js` - Main polyfill fixes
- ✅ `src/components/MqttConnectionTest.tsx` - Test component (new)
- ✅ `src/screens/SimulatorScreen.tsx` - Added test component
- ✅ `src/components/index.ts` - Export test component