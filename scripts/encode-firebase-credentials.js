#!/usr/bin/env node
/**
 * Script encode Firebase Service Account JSON thành base64
 * Sử dụng: node encode-firebase-credentials.js <path-to-json-file>
 */

const fs = require('fs');
const path = require('path');

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     Firebase Credentials Encoder                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Sử dụng:');
    console.log('  node encode-firebase-credentials.js <path-to-json-file>');
    console.log('');
    console.log('Ví dụ:');
    console.log('  node encode-firebase-credentials.js ~/Downloads/firebase-adminsdk.json');
    console.log('');
    console.log('Kết quả sẽ được lưu vào file firebase_encoded.txt');
    process.exit(1);
  }
  
  const inputPath = args[0];
  
  // Kiểm tra file tồn tại
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Lỗi: File không tồn tại: ${inputPath}`);
    process.exit(1);
  }
  
  try {
    // Đọc file JSON
    const jsonContent = fs.readFileSync(inputPath, 'utf8');
    
    // Validate JSON
    const parsed = JSON.parse(jsonContent);
    
    // Kiểm tra các fields bắt buộc
    const requiredFields = ['type', 'project_id', 'private_key', 'client_email'];
    const missingFields = requiredFields.filter(field => !parsed[field]);
    
    if (missingFields.length > 0) {
      console.error(`❌ Lỗi: File JSON thiếu các fields: ${missingFields.join(', ')}`);
      process.exit(1);
    }
    
    if (parsed.type !== 'service_account') {
      console.error('❌ Lỗi: File không phải là Service Account JSON');
      process.exit(1);
    }
    
    // Encode base64
    const base64Encoded = Buffer.from(jsonContent).toString('base64');
    
    // Lưu vào file
    const outputPath = path.join(process.cwd(), 'firebase_encoded.txt');
    fs.writeFileSync(outputPath, base64Encoded);
    
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║     ✅ Encode thành công!                                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Thông tin Service Account:');
    console.log(`  Project ID: ${parsed.project_id}`);
    console.log(`  Client Email: ${parsed.client_email}`);
    console.log('');
    console.log(`Kết quả đã lưu vào: ${outputPath}`);
    console.log('');
    console.log('Bước tiếp theo:');
    console.log('1. Copy nội dung file firebase_encoded.txt');
    console.log('2. Vào Management UI > Settings > Secrets');
    console.log('3. Thêm secret: FIREBASE_SERVICE_ACCOUNT_JSON');
    console.log('4. Paste nội dung đã copy vào value');
    console.log('5. Restart server');
    console.log('');
    console.log('Hoặc set environment variable:');
    console.log(`  export FIREBASE_SERVICE_ACCOUNT_JSON="${base64Encoded.substring(0, 50)}..."`);
    
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('❌ Lỗi: File không phải JSON hợp lệ');
    } else {
      console.error(`❌ Lỗi: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
