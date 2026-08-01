/**
 * Polyfills required for MQTT.js to work in React Native
 */

console.log('[shim.js] Loading polyfills...');

// Buffer polyfill
if (typeof global.Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

// Process polyfill
if (typeof global.process === 'undefined') {
  global.process = require('process');
}

// URL polyfill
if (typeof global.URL === 'undefined') {
  global.URL = require('url').URL;
}

// Setup net module globally for MQTT
const TcpSocket = require('react-native-tcp-socket');
console.log('[shim.js] TcpSocket loaded with keys:', Object.keys(TcpSocket || {}));

// Create wrapped net module with debugging
const netModule = {
  Socket: TcpSocket.Socket,
  createConnection: function(options, callback) {
    console.log('[NET] createConnection called:', JSON.stringify({
      host: options?.host || options?.hostname,
      port: options?.port,
      path: options?.path,
    }));
    try {
      const socket = TcpSocket.createConnection(options, callback);
      console.log('[NET] Socket created, id:', socket?._id);
      socket.on('connect', () => console.log('[NET] Socket connected!'));
      socket.on('error', (err) => {
        const errorMsg = err?.message || 'Unknown socket error';
        console.log('[NET] Socket error:', errorMsg);
        // NOTE: Do NOT re-emit error here — it causes infinite recursion
        // The original error event already reaches all listeners.
      });
      socket.on('close', (hadError) => console.log('[NET] Socket closed, hadError:', hadError || false));
      socket.on('data', (data) => console.log('[NET] Socket data received, length:', data?.length));
      return socket;
    } catch (e) {
      console.error('[NET] createConnection error:', e?.message || e);
      throw e;
    }
  },
  connect: function(options, callback) {
    console.log('[NET] connect called');
    return netModule.createConnection(options, callback);
  },
  isIP: TcpSocket.isIP,
  isIPv4: TcpSocket.isIPv4,
  isIPv6: TcpSocket.isIPv6,
  Server: TcpSocket.Server,
};

// Also add default export for ES module imports
netModule.default = netModule;

// Try to set it globally
global.net = netModule;
console.log('[shim.js] net module setup complete');
