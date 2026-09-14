import fs from 'fs'; import path from 'path';
const ROOT='client/src';
const files=[];
const norm=s=>s.split(path.sep).join('/');
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())walk(p); else if(/[.](tsx?|jsx?)$/.test(e.name))files.push(norm(p));}})(ROOT);
const isTest=f=>/[.](test|spec)[.](tsx?|jsx?)$/.test(f)||/__tests__/.test(f);
function resolve(spec,from){
  let base;
  if(spec.startsWith('@/')) base=ROOT+'/'+spec.slice(2);
  else if(spec.startsWith('.')) base=path.posix.normalize(path.posix.join(path.posix.dirname(from),spec));
  else return null;
  const cands=[base,base+'.tsx',base+'.ts',base+'.jsx',base+'.js',base+'/index.tsx',base+'/index.ts'];
  for(const c of cands){ if(files.includes(c)) return c; }
  return null;
}
const imports={}, raw={};
for(const f of files){
  const src=fs.readFileSync(f,'utf8');
  const specs=[...src.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m=>m[1]);
  raw[f]=specs;
  imports[f]=specs.map(s=>resolve(s,f)).filter(Boolean);
}
const seeds=files.filter(f=>raw[f].some(s=>s==='three'||s.startsWith('three/')||s.startsWith('@react-three/')));
const rev={}; for(const f of files) rev[f]=[];
for(const f of files) for(const t of imports[f]) rev[t].push(f);
const reach=new Set(seeds); const q=[...seeds];
while(q.length){const c=q.pop(); for(const p of rev[c]) if(!reach.has(p)){reach.add(p);q.push(p);}}
const out={seeds:seeds.sort(),
 pagesWith3D:[...reach].filter(f=>f.startsWith(ROOT+'/pages/')&&!isTest(f)).sort(),
 compWith3D:[...reach].filter(f=>!f.startsWith(ROOT+'/pages/')&&!isTest(f)).sort(),
 testsWith3D:[...reach].filter(isTest).sort()};
fs.writeFileSync('.qa-dot60/01-graph.json',JSON.stringify({...out,imports,rev},null,1));
console.log('SEEDS non-test ('+seeds.filter(f=>!isTest(f)).length+'):'); seeds.filter(f=>!isTest(f)).forEach(f=>console.log('  '+f));
console.log('');
console.log('PAGES reaching 3D ('+out.pagesWith3D.length+'):'); out.pagesWith3D.forEach(f=>console.log('  '+f));
console.log('');
console.log('NON-PAGE comps reaching 3D ('+out.compWith3D.length+')');
