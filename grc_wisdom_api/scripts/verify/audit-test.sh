#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
uid() { curl -s $API/api/auth/me -H "Authorization: Bearer $1" | node -pe "JSON.parse(require('fs').readFileSync(0)).user.id" 0; }

AUD=$(tok internal.audit@omniops.me)
GRC=$(tok grc.manager@omniops.me)
GRC_ID=$(uid "$GRC")

# fresh audit + finding raised by AUD
AID=$(curl -s -X POST $API/api/grc/audits -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"title":"Closure Lifecycle Test","objective":"o","scope":"s","criteria":"ISO 27001 A.8.24"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).audit.id" 0)
FID=$(curl -s -X POST "$API/api/grc/audits/$AID/findings" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"criterion":"Keys rotated annually.","condition":"18 months since rotation.","cause":"No schedule.","recommendation":"Automate rotation.","riskRating":"High"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).finding.id" 0)
echo "audit=$AID finding=$FID (raised by internal.audit)"

echo ""
echo "4. assign CAP:"
curl -s -X PATCH "$API/api/grc/findings/$FID" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$GRC_ID\",\"capDueDate\":\"2026-12-31\",\"capDescription\":\"KMS auto-rotation\"}" \
  | node -pe "'   status -> '+JSON.parse(require('fs').readFileSync(0)).finding.status" 0

echo "5. submit for closure:"
curl -s -X PATCH "$API/api/grc/findings/$FID" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"submitForClosure":true}' | node -pe "'   status -> '+JSON.parse(require('fs').readFileSync(0)).finding.status" 0

echo "6. SoD: the RAISER (internal.audit) tries to close their own finding:"
curl -s -X POST "$API/api/grc/findings/$FID/close" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"note":"closing my own"}' | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code||'?')+': '+r.message" 0

echo "7. INDEPENDENT closer (grc.manager) succeeds:"
curl -s -X POST "$API/api/grc/findings/$FID/close" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"Retested; rotation confirmed."}' | node -pe "'   '+JSON.parse(require('fs').readFileSync(0)).message" 0

echo "8. reopen (insufficient):"
curl -s -X POST "$API/api/grc/findings/$FID/reopen" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"reason":"Rotation failed on one store."}' | node -pe "'   '+JSON.parse(require('fs').readFileSync(0)).message" 0

echo "9. audit trail written:"
curl -s $API/api/audit-logs -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const g={}; r.logs.filter(l=>/AUDIT_FINDING|AUDIT_CREATED|RISK_/.test(l.action)).forEach(l=>g[l.action]=(g[l.action]||0)+1);
Object.entries(g).map(([k,v])=>'   '+k.padEnd(28)+v).join('\n')" 0
