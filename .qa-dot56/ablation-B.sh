#!/usr/bin/env bash
# DOT 56 muc B — ABLATION 2 CHIEU cho cong kieu e2e.
#   Chieu (+): cai loi kieu CO Y vao mot spec e2e ⇒ check:tests PHAI keu (27 -> 28).
#   Chieu (-): go loi ra ⇒ quay ve 27.
# G111: hang tam phai co trap EXIT.
set -u
SPEC="e2e/twin-lo-f.spec.ts"
BAK="$(mktemp)"
cp "$SPEC" "$BAK"
trap 'cp "$BAK" "$SPEC"; rm -f "$BAK"; echo "[trap] da tra $SPEC ve nguyen ban"' EXIT

dem() { npm run check:tests 2>&1 | grep -c "error TS"; }
dem_e2e() { npm run check:tests 2>&1 | grep "error TS" | grep -c "^e2e/"; }

echo "=== A0: nguyen ban ==="
A0=$(dem); A0E=$(dem_e2e); echo "tong=$A0  trong e2e=$A0E"

echo "=== A1: cai MOT loi kieu co y vao $SPEC ==="
printf '\n// DOT56 ABLATION — dong nay phai lam tsc KEU\nconst __dot56_ablation: number = "chuoi khong phai so";\nvoid __dot56_ablation;\n' >> "$SPEC"
A1=$(dem); A1E=$(dem_e2e); echo "tong=$A1  trong e2e=$A1E"

echo "=== A2: go loi ra (tra nguyen ban) ==="
cp "$BAK" "$SPEC"
A2=$(dem); A2E=$(dem_e2e); echo "tong=$A2  trong e2e=$A2E"

echo
echo "=== KET LUAN ABLATION ==="
if [ "$A1" -gt "$A0" ] && [ "$A1E" -gt "$A0E" ] && [ "$A2" -eq "$A0" ] && [ "$A2E" -eq "$A0E" ]; then
  echo "DAT: cong kieu e2e SONG — cai loi thi KEU ($A0->$A1, e2e $A0E->$A1E), go ra thi IM lai ($A2, e2e $A2E)."
else
  echo "HONG: cong khong phan ung dung 2 chieu (A0=$A0/$A0E A1=$A1/$A1E A2=$A2/$A2E)"
fi
