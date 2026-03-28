// ESM wrapper for the obfuscated CJS SDK
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const sdk = require(join(__dirname, 'index.cjs'));

export const LicenseClient = sdk.LicenseClient;
export const HardwareFingerprint = sdk.HardwareFingerprint;
export default sdk.default;
