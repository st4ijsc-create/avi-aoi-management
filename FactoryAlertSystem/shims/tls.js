/**
 * Stub for Node.js 'tls' module
 * MQTT over WebSocket doesn't need this, but the bundler requires it to resolve
 */
module.exports = {
  TLSSocket: class TLSSocket {
    constructor() {}
    connect() { return this; }
    write() { return true; }
    end() {}
    destroy() {}
    on() { return this; }
    once() { return this; }
    off() { return this; }
    removeListener() { return this; }
    setTimeout() {}
    setNoDelay() {}
    setKeepAlive() {}
    getPeerCertificate() { return {}; }
    getCipher() { return {}; }
  },
  connect: function(options, callback) {
    const socket = new module.exports.TLSSocket();
    if (callback) setTimeout(callback, 0);
    return socket;
  },
  createSecureContext: function() { return {}; },
};
