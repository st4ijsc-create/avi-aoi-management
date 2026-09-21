import fs from "node:fs";
export function ck(p="tmp/audit-ai/ck.txt"){
  return fs.readFileSync(p,"utf8").split(/\r?\n/)
    .map(l=>l.replace(/^#HttpOnly_/,""))
    .filter(l=>l && !l.startsWith("#"))
    .map(l=>l.split("\t")).filter(a=>a.length>=7)
    .map(a=>`${a[5]}=${a[6]}`).join("; ");
}
