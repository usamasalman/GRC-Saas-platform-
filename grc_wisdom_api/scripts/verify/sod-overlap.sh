#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,120))" 0; }

AUD=$(tok internal.audit@omniops.me)
GRC=$(tok grc.manager@omniops.me)   # holds BOTH ASSESS_RISK and EXECUTE_AUDIT

AID=$(curl -s $API/api/grc/audits -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const a=r.audits.find(x=>x.status!=='Closed'); a?a.id:''" 0)
GRCID=$(curl -s "$API/api/iam/users" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const u=(r.users||[]).find(x=>x.email==='grc.manager@omniops.me'); u?u.id:''" 0)

FID=$(curl -s -X POST "$API/api/grc/audits/$AID/findings" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"title":"Change approvals missing for 4 releases","criterion":"CAB approval required pre-deploy.","condition":"4 of 30 releases had no CAB record.","cause":"Emergency path overused.","recommendation":"Restrict the emergency path and require retrospective CAB.","riskRating":"High"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).finding.id" 0)

echo "Same person responds, owns the CAP, and holds EXECUTE_AUDIT:"
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"responseType":"Agree","responseNarrative":"Agreed.","managementActionPlan":"Lock the emergency path behind a second approver."}' | msg
curl -s -X POST "$API/api/grc/issues/$FID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$GRCID\",\"capDueDate\":\"2026-10-01\",\"capDescription\":\"Second approver on emergency path.\"}" > /dev/null
curl -s -X POST "$API/api/grc/issues/$FID/submit-closure" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"evidenceNote":"Second approver enforced; 12 releases retested clean."}' > /dev/null

echo ""
echo "...now tries to validate their own remediation -> expect blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/close" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"All good, closing."}' | msg
