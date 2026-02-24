# Debug React Key Warning

## Quick Fixes

### 1. Clear Browser Cache and Disable Extensions
The "message channel" errors are definitely from browser extensions.
Test in incognito mode or disable extensions.

### 2. Check if using production build
The warning appears because you're running a production build with development React.
Check your build:

```bash
# Use development mode instead
pnpm dev
```

###  3. If the issue persists, it's likely from a third-party component

The most common culprits in your stack:
- **Sonner (toast library)**: Check if multiple toasts render simultaneously
- **Recharts**: Chart components sometimes have this issue
- **Three.js/drei components**: 3D scene children

## Recommended Fix

Since the issue appears on the corporate-layout page specifically, and your Factory3DScene uses Three.js, let's add keys to potential problem areas:

### Check Factory3DScene.tsx
The workshop indicators at line 120-127 look correct, but let's ensure all dynamically generated elements have keys.

### Update Grid Component
If you see grid lines or similar repetitive elements without keys, that's likely the culprit.

## To Suppress the Warning (if from third-party)

Add this to your vite.config.ts:

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'react-vendor': ['react', 'react-dom'],
      }
    }
  }
}
```

## Run in Development Mode

```bash
pnpm dev
```

This will show the actual component name instead of minified `yst`, making it easier to find the issue.
