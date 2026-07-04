const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 */
const config = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  resolver: {
    sourceExts: ['jsx', 'js', 'ts', 'tsx', 'json'],
    extraNodeModules: {
      // Polyfills for MQTT.js
      buffer: require.resolve('buffer'),
      stream: require.resolve('stream-browserify'),
      url: require.resolve('url'),
      events: require.resolve('events'),
      process: require.resolve('process'),
      dns: require.resolve('dns-js'),
      assert: require.resolve('assert'),
      util: require.resolve('util'),
      net: require.resolve('./shims/net.js'),
      tls: require.resolve('./shims/tls.js'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
