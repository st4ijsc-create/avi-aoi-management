/**
 * Script to export all system modules to JSON file for License Server import
 * Usage: npx tsx scripts/export-modules.ts
 */
import { SYSTEM_MODULES, toExportFormat } from '../shared/module-registry';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// R-2 rebrand: default export code is the new canonical one; LICENSE_PRODUCT_CODE wins.
// Legacy AVI-AOI-* codes remain accepted at validation (server/license/productCode.ts).
const productCode = process.env.LICENSE_PRODUCT_CODE || 'SYNAPSE-PLATFORM';
const exportData = toExportFormat(productCode);

const outPath = join(__dirname, '..', 'synapse-modules-export.json');
writeFileSync(outPath, JSON.stringify(exportData, null, 2), 'utf-8');

const totalFeatures = SYSTEM_MODULES.reduce((sum, m) => sum + m.features.length, 0);

console.log(`✅ Exported ${exportData.modules.length} modules to: synapse-modules-export.json`);
console.log(`   Product Code: ${exportData.productCode}`);
console.log(`   Core modules: ${exportData.modules.filter(m => m.isCore).length}`);
console.log(`   Optional modules: ${exportData.modules.filter(m => !m.isCore).length}`);
console.log(`   Total features: ${totalFeatures}`);
console.log('\nModules:');
exportData.modules.forEach((m, i) => {
  console.log(`  ${i + 1}. [${m.isCore ? 'CORE' : 'OPT '}] ${m.code} - ${m.name}`);
  const boolFeats = m.features.filter(f => f.featureType === 'boolean').length;
  const limitFeats = m.features.filter(f => f.featureType === 'limit').length;
  console.log(`     Features: ${m.features.length} (boolean: ${boolFeats}, limit: ${limitFeats})`);
});
