module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        root: ['./'],
        alias: {
          '@': './src',
          '@components': './src/components',
          '@screens': './src/screens',
          '@services': './src/services',
          '@store': './src/store',
          '@types': './src/types',
          '@utils': './src/utils',
        },
      },
    ],
    // NOTE: reanimated/plugin MUST be listed last.
    'react-native-reanimated/plugin',
  ],
  env: {
    // Wave 2C: belt-and-braces log stripping. Hot-path logs are already guarded
    // by `if (__DEV__)` (Metro dead-code-eliminates those in release). This plugin
    // additionally strips ALL remaining console.* (except error/warn) from RELEASE
    // bundles only — Metro sets BABEL_ENV=production for `--dev false` builds.
    // Debug/dev builds keep every log.
    production: {
      plugins: [
        ['transform-remove-console', { exclude: ['error', 'warn'] }],
      ],
    },
  },
};
