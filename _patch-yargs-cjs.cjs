const fs = require('fs');
const p = 'C:/Apps/avi-aoi-management/node_modules/.pnpm/yargs@17.7.2/node_modules/yargs/build/index.cjs';
let c = fs.readFileSync(p, 'utf8');

const old = 'ae=require("yargs-parser")';
const polyfill = old + `;if(typeof ae.looksLikeNumber!=="function"){ae.looksLikeNumber=function(x){if(x==null)return false;if(typeof x==="number")return true;if(/^0x[0-9a-f]+$/i.test(x))return true;if(/^0[^.]/.test(x))return false;return/^[-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(e[-+]?\\d+)?$/.test(x)};ae.camelCase=function(s){var r=s!==s.toLowerCase()&&s!==s.toUpperCase();if(!r)s=s.toLowerCase();if(s.indexOf("-")===-1&&s.indexOf("_")===-1)return s;return s.replace(/[-_]([^-_])/g,function(_,c){return c.toUpperCase()})};ae.decamelize=function(s,j){j=j||"-";return s.replace(/([a-z\\d])([A-Z])/g,"$1"+j+"$2").replace(/([A-Z]+)([A-Z][a-z\\d]+)/g,"$1"+j+"$2").toLowerCase()}}`;

if (c.includes(old)) {
  c = c.replace(old, polyfill);
  fs.writeFileSync(p, c, 'utf8');
  console.log('CJS bundle patched successfully!');
} else {
  console.log('Pattern not found in CJS bundle!');
}
