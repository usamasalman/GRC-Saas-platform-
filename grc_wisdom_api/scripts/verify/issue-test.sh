#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,110))" 0; }

# Four distinct parties, as a real engagement requires:
AUD=$(tok internal.audit@omniops.me)   # auditor      — raises
MGT=$(tok risk.manager@omniops.me)     # management   — responds
GRC=$(tok grc.manager@omniops.me)      # audit mgmt   — validates closure
OWNER_EMAIL=security.manager@omniops.me # CAP owner   — remediates

echo "=== A. Raise an internal-audit finding on an engagement ==="
AID=$(curl -s $API/api/grc/audits -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const a=r.audits.find(x=>x.status!=='Closed'); a?a.id:''" 0)
F=$(curl -s -X POST "$API/api/grc/audits/$AID/findings" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"title":"Privileged access granted without approval","criterion":"ISO 27001 A.5.15 requires documented authorisation.","condition":"3 of 25 privileged grants had no approval record.","cause":"The access request queue bypasses approval when raised by IT.","recommendation":"Enforce approval in the workflow before provisioning.","riskRating":"High"}')
FID=$(node -pe "try{JSON.parse(process.argv[1]).finding.id}catch(e){''}" "$F")
echo "$F" | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.finding?r.finding.ref+' raised ('+r.finding.source+', '+r.finding.riskRating+')':JSON.stringify(r).slice(0,120))" 0

echo ""
echo "=== B. Management response is mandatory before remediation ==="
echo "B1. assign a CAP with no management response -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"capOwnerId":"x","capDueDate":"2026-10-01","capDescription":"Fix it"}' | msg

echo ""
echo "B2. the AUDITOR who raised it tries to write management's response -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"responseType":"Agree","responseNarrative":"We agree.","managementActionPlan":"Will fix."}' | msg

echo ""
echo "B3. management agrees but commits to nothing -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"responseType":"Agree","responseNarrative":"Yes, this is correct."}' | msg

echo ""
echo "B4. management agrees WITH an action plan -> accepted:"
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"responseType":"Agree","responseNarrative":"Accepted; the bypass was unintended.","managementActionPlan":"Add a hard approval gate to the provisioning workflow by Q4."}' | msg

echo ""
echo "B5. responding twice -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/respond" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"responseType":"Disagree","responseNarrative":"Changed my mind."}' | msg

echo ""
echo "=== C. CAP -> closure with independent validation ==="
OWNER=$(curl -s "$API/api/iam/users" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const u=(r.users||[]).find(x=>x.email===process.argv[1]); u?u.id:''" "$OWNER_EMAIL" 0)
echo "C1. assign CAP now that management has responded:"
curl -s -X POST "$API/api/grc/issues/$FID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$OWNER\",\"capDueDate\":\"2026-10-01\",\"capDescription\":\"Hard approval gate in provisioning workflow.\"}" | msg

echo ""
echo "C2. submit for closure without evidence -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/submit-closure" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "C3. submit with evidence -> accepted:"
curl -s -X POST "$API/api/grc/issues/$FID/submit-closure" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"evidenceNote":"Workflow gate deployed; retested 20 grants, all approved. Evidence at WP B-4."}' | msg

echo ""
echo "C4. SoD — the auditor who RAISED it tries to close it -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/close" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"note":"Looks fine to me."}' | msg

echo ""
echo "C5. an independent auditor closes it -> accepted:"
curl -s -X POST "$API/api/grc/issues/$FID/close" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"Retested independently; 20 of 20 grants carried prior approval. Control effective."}' | msg

echo ""
echo "=== D. Cross-source register ==="
echo "D1. an InternalAudit issue cannot be created directly -> blocked:"
curl -s -X POST "$API/api/grc/issues" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"source":"InternalAudit","title":"Sneaking one in","recommendation":"Nope."}' | msg

echo ""
echo "D2. a Regulator issue with no source document -> blocked:"
curl -s -X POST "$API/api/grc/issues" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"source":"Regulator","title":"PDPL data residency gap","recommendation":"Repatriate personal data to in-Kingdom hosting."}' | msg

echo ""
echo "D3. a Regulator issue citing the letter -> created:"
R=$(curl -s -X POST "$API/api/grc/issues" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"source":"Regulator","sourceReference":"SDAIA/PDPL/2026-0447","title":"PDPL data residency gap","condition":"Personal data of KSA residents is processed in an EU region.","recommendation":"Repatriate personal data to in-Kingdom hosting.","riskRating":"High","targetCloseDate":"2026-06-01"}')
RID=$(node -pe "try{JSON.parse(process.argv[1]).issue.id}catch(e){''}" "$R")
echo "$R" | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.issue?r.issue.ref+' ('+r.issue.source+' · '+r.issue.sourceReference+')':JSON.stringify(r).slice(0,120))" 0

echo ""
echo "D4. an Incident-sourced issue -> created:"
curl -s -X POST "$API/api/grc/issues" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"source":"Incident","title":"Backup restore failed during DR test","condition":"The quarterly restore test failed for 2 of 9 systems.","recommendation":"Repair backup jobs and re-run the restore test.","riskRating":"Medium"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.issue?r.issue.ref+' ('+r.issue.source+')':JSON.stringify(r).slice(0,110))" 0

echo ""
echo "=== E. Dispute and escalation ==="
echo "E1. management DISAGREES with the regulator issue:"
curl -s -X POST "$API/api/grc/issues/$RID/respond" -H "Authorization: Bearer $MGT" -H "Content-Type: application/json" \
  -d '{"responseType":"Disagree","responseNarrative":"We read the adequacy decision as permitting EU processing for this data class."}' | msg

echo ""
echo "E2. a disputed issue cannot receive a CAP -> blocked:"
curl -s -X POST "$API/api/grc/issues/$RID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$OWNER\",\"capDueDate\":\"2026-09-01\"}" | msg

echo ""
echo "E3. escalate the dispute to executive management:"
curl -s -X POST "$API/api/grc/issues/$RID/escalate" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"reason":"Legal disagrees with the adequacy reading; regulator deadline is 1 June."}' | msg

echo ""
echo "E4. escalate again -> audit committee:"
curl -s -X POST "$API/api/grc/issues/$RID/escalate" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"reason":"No executive decision after two weeks."}' | msg

echo ""
echo "E5. a third escalation has nowhere to go -> blocked:"
curl -s -X POST "$API/api/grc/issues/$RID/escalate" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"reason":"Still stuck."}' | msg

echo ""
echo "=== F. Register view: aging and cross-source rollup ==="
curl -s "$API/api/grc/issues" -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const t=r.totals;
let o='   '+t.total+' issues · '+t.open+' open · '+t.overdue+' overdue · '+t.awaitingResponse+' awaiting response · '+t.disputed+' disputed · '+t.escalated+' escalated · '+t.closureRate+'% closed';
o+='\n   by source: '+Object.entries(r.bySource).map(([k,v])=>k+'='+v).join(', ');
const old=r.issues.filter(i=>i.aging.isOverdue).slice(0,3);
o+='\n   overdue sample: '+(old.length?old.map(i=>i.ref+' ('+i.aging.daysOverdue+'d over, bucket '+i.aging.ageBucket+')').join('; '):'none');
o" 0

echo ""
echo "=== G. Reopen voids the previous management response ==="
curl -s -X POST "$API/api/grc/issues/$FID/reopen" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"reason":"Two further unapproved grants found in the November sample."}' | msg
echo "G2. after reopen, a CAP again requires a fresh response -> blocked:"
curl -s -X POST "$API/api/grc/issues/$FID/cap" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"capOwnerId\":\"$OWNER\",\"capDueDate\":\"2026-11-01\"}" | msg
