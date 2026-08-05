#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,110))" 0; }

AUD=$(tok internal.audit@omniops.me)
MGT=$(tok risk.manager@omniops.me)
GRC=$(tok grc.manager@omniops.me)

AID=$(curl -s $API/api/grc/audits -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const a=r.audits.find(x=>x.status!=='Closed'); a?a.id:''" 0)
MGTID=$(curl -s "$API/api/iam/users" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const u=(r.users||[]).find(x=>x.email==='risk.manager@omniops.me'); u?u.id:''" 0)

# raise -> respond (MGT) -> CAP owned BY MGT -> submit
FID=$(curl -s -X POST "$API/api/grc/audits/$AID/findings" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"title":"Vendor risk assessments not refreshed","criterion":"Policy requires annual reassessment.","condition":"11 critical vendors overdue.","cause":"No renewal trigger.","recommendation":"Automate reassessment reminders.","riskRating":"Medium"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).finding.id" 0)
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"responseType":"Agree","responseNarrative":"Agreed.","managementActionPlan":"Automate reminders in Q3."}' > /dev/null
curl -s -X POST "$API/api/grc/issues/$FID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$MGTID\",\"capDueDate\":\"2026-10-01\",\"capDescription\":\"Automate reminders.\"}" > /dev/null
curl -s -X POST "$API/api/grc/issues/$FID/submit-closure" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"evidenceNote":"Reminders live; all 11 refreshed."}' > /dev/null

echo "The responder AND CAP owner tries to validate their own remediation -> expect blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/close" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"note":"Done, closing."}' | msg
echo ""
echo "An independent validator closes it -> expect accepted:"
curl -s -X POST "$API/api/grc/issues/$FID/close" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"Sampled 11 vendors; all reassessments on file."}' | msg
