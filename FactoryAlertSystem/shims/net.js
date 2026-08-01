/**
 * Net module shim for React Native using react-native-tcp-socket
 * This enables TCP connections for MQTT over TCP (mqtt://)
 */
const TcpSocket = require('react-native-tcp-socket');

console.log('[net.js shim] TcpSocket loaded:', Object.keys(TcpSocket || {}));

const netModule = {
  Socket: TcpSocket.Socket,
  Server: TcpSocket.Server,
  createConnection: function(options, callback) {
    console.log('[NET SHIM] createConnection called:', JSON.stringify({
      host: options?.host || options?.hostname,
      port: options?.port,
      path: options?.path,
    }));
    try {
      const socket = TcpSocket.createConnection(options, callback);
      console.log('[NET SHIM] Socket created, id:', socket?._id);
      // Ensure compatibility with Node.js EventEmitter interface expected by mqtt.js
      if (typeof socket.setMaxListeners !== 'function') {
        socket.setMaxListeners = function(_n) {
          // No-op implementation to satisfy mqtt.js expectations
          return this;
        };
      }
      socket.on('connect', () => console.log('[NET SHIM] Socket connected!'));
      socket.on('error', (err) => {
        const errorMsg = err?.message || 'Unknown socket error';
        console.log('[NET SHIM] Socket error:', errorMsg);
        // NOTE: Do NOT re-emit error here — it causes infinite recursion
        // The original error event already reaches all listeners.
      });
      socket.on('close', (hadError) => console.log('[NET SHIM] Socket closed, hadError:', hadError || false));
      socket.on('data', (data) => console.log('[NET SHIM] Socket data received, length:', data?.length));
      return socket;
    } catch (e) {
      console.error('[NET SHIM] createConnection error:', e?.message || e);
      throw e;
    }
  },
  connect: function(options, callback) {
    console.log('[NET SHIM] connect called');
    return netModule.createConnection(options, callback);
  },
  isIP: TcpSocket.isIP,
  isIPv4: TcpSocket.isIPv4,
  isIPv6: TcpSocket.isIPv6,
};

// Add default export for ES module compatibility (MQTT uses __importDefault)
netModule.default = netModule;

module.exports = netModule;