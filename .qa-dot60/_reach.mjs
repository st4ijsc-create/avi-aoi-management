import fs from 'fs';
const g=JSON.parse(fs.readFileSync('.qa-dot60/01-graph.json','utf8'));
const isTest=f=>/[.](test|spec)[.](tsx?|jsx?)$/.test(f)||/__tests__/.test(f);
const ROOTS=['client/src/App.tsx','client/src/main.tsx'];
// forward reachability from App.tsx (live app), excluding tests
const live=new Set(); const q=ROOTS.filter(r=>g.imports[r]);
q.forEach(r=>live.add(r));
while(q.length){const c=q.pop(); for(const t of (g.imports[c]||[])){ if(!isTest(t)&&!live.has(t)){live.add(t);q.push(t);} }}
const targets=['TwinHub','DigitalTwinCenter','DigitalTwinDashboard','FactoryLiveMap3D','FactoryFloorEditor','CellTwinPlayer','RfTestCellSim','Layout','MachineWorkspace','MachineCockpit','RobotCockpit','CommandCenter','CorporateLayout','FactoryCommandView','TwinVanHanh','TwinLine','TwinMay','TwinStudio','DeviceHub','SystemHealth','StationAnalysis'];
console.log('page'.padEnd(24),'LIVE?','| importers (non-test)');
for(const t of targets){
  const f='client/src/pages/'+t+'.tsx';
  const imps=(g.rev[f]||[]).filter(x=>!isTest(x));
  const tests=(g.rev[f]||[]).filter(isTest);
  console.log(t.padEnd(24), (live.has(f)?'YES ':'NO  '), '| imp:['+imps.join(', ')+'] tests:'+tests.length);
}
fs.writeFileSync('.qa-dot60/02-live.json',JSON.stringify({live:[...live].sort()},null,1));
console.log('\nTOTAL live modules from App.tsx:',live.size);
