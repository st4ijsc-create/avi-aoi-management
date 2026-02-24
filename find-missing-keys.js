// Script to help find missing React keys in .tsx files
// Run with: node find-missing-keys.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findTsxFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && file !== 'node_modules' && file !== 'dist' && file !== '.git') {
      findTsxFiles(filePath, fileList);
    } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function checkFileForMissingKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];
  
  lines.forEach((line, index) => {
    // Look for .map( followed by JSX but check if a key prop exists nearby
    if (line.includes('.map(') && line.includes( '=>')) {
      // Check next few lines for key prop
      let hasKey = false;
      const lookAhead = 5;
      for (let i = 0; i < lookAhead && index + i < lines.length; i++) {
        if (lines[index + i].includes('key=')) {
          hasKey = true;
          break;
        }
      }
      
      if (!hasKey) {
        // Check if it returns JSX (has < character)
        let returnsJSX = false;
        for (let i = 0; i < lookAhead && index + i < lines.length; i++) {
          if (lines[index + i].match(/<[A-Z]/) || lines[index + i].match(/<[a-z]/)) {
            returnsJSX = true;
            break;
          }
        }
        
        if (returnsJSX) {
          issues.push({
            line: index + 1,
            content: line.trim()
          });
        }
      }
    }
  });
  
  return issues;
}

// Check client/src files
const clientDir = path.join(__dirname, 'client', 'src');
if (fs.existsSync(clientDir)) {
  const files = findTsxFiles(clientDir);
  let totalIssues = 0;
  
  console.log('Checking for potential missing React keys...\n');
  
  files.forEach(file => {
    const issues = checkFileForMissingKeys(file);
    if (issues.length > 0) {
      console.log(`\n📄 ${path.relative(__dirname, file)}`);
      issues.forEach(issue => {
        console.log(`   Line ${issue.line}: ${issue.content}`);
        totalIssues++;
      });
    }
  });
  
  console.log(`\n\n✅ Scan complete. Found ${totalIssues} potential issues.`);
  if (totalIssues === 0) {
    console.log('   No obvious missing keys found. The issue might be:');
    console.log('   - In a third-party component');
    console.log('   - In dynamically generated content');
    console.log('   - A false positive from React DevTools');
  }
} else {
  console.log('client/src directory not found');
}
