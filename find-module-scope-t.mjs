import fs from 'fs';
import path from 'path';

function findTsxFiles(dir) {
  let results = [];
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && item !== 'node_modules') {
        results = results.concat(findTsxFiles(fullPath));
      } else if (item.endsWith('.tsx') || item.endsWith('.ts')) {
        results.push(fullPath);
      }
    }
  } catch (e) {}
  return results;
}

const files = findTsxFiles('client/src');

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  let firstFuncLine = -1;
  let problems = [];
  
  // Find first function/component declaration
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.match(/^(export\s+)?(default\s+)?function\s+\w+/) ||
        line.match(/^(export\s+)?(default\s+)?const\s+\w+\s*=\s*\(/) ||
        line.match(/^(export\s+)?(default\s+)?const\s+\w+\s*:\s*React/) ||
        line.match(/^(export\s+)?(default\s+)?const\s+\w+\s*=\s*React\./) ||
        line.match(/^(export\s+)?(default\s+)?const\s+\w+\s*=\s*function/) ||
        line.match(/^(export\s+)?(default\s+)?const\s+\w+\s*=\s*memo\s*\(/)) {
      firstFuncLine = i;
      break;
    }
  }
  
  if (firstFuncLine === -1) continue;
  
  // Check for t( before the first function/component
  for (let i = 0; i < firstFuncLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed.startsWith('import ')) continue;
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) continue;
    if (trimmed.startsWith('*')) continue;
    if (trimmed === '') continue;
    
    // Check for t('...' or t("..." call
    if (/(?<![a-zA-Z0-9_\.])t\s*\(['"]/.test(line)) {
      problems.push({ line: i + 1, code: trimmed, type: 'BEFORE component/function' });
    }
  }
  
  if (problems.length > 0) {
    const seen = new Set();
    const unique = problems.filter(p => {
      if (seen.has(p.line)) return false;
      seen.add(p.line);
      return true;
    });
    
    console.log('\n========================================');
    console.log('FILE: ' + filePath);
    console.log('========================================');
    for (const p of unique) {
      console.log('  Line ' + p.line + ' [' + p.type + ']: ' + p.code);
    }
    
    for (const p of unique) {
      console.log('\n  --- Context around line ' + p.line + ' ---');
      const start = Math.max(0, p.line - 6);
      const end = Math.min(lines.length - 1, p.line + 4);
      for (let j = start; j <= end; j++) {
        const marker = j === p.line - 1 ? '>>>' : '   ';
        console.log('  ' + marker + ' ' + (j + 1) + ': ' + lines[j]);
      }
    }
  }
}
