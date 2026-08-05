#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,140))" 0; }

RISK=$(tok risk.manager@omniops.me)
ADMIN=$(tok company.admin@omniops.me)
GRC=$(tok grc.manager@omniops.me)
AUD=$(tok internal.audit@omniops.me)

echo "=== A. Risk appetite ==="
echo "A1. tolerance below appetite -> blocked:"
curl -s -X POST "$API/api/grc/appetite" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"category":"Reputational","statement":"Test","appetiteThreshold":12,"toleranceThreshold":6}' | msg

echo ""
echo "A2. threshold out of the 1-25 band -> blocked:"
curl -s -X POST "$API/api/grc/appetite" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"category":"Reputational","statement":"Test","appetiteThreshold":4,"toleranceThreshold":40}' | msg

echo ""
echo "A3. set a valid draft:"
AP=$(curl -s -X POST "$API/api/grc/appetite" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"category":"Reputational","statement":"No appetite for public regulatory censure.","appetiteThreshold":6,"toleranceThreshold":12}')
APID=$(node -pe "try{JSON.parse(process.argv[1]).appetite.id}catch(e){''}" "$AP")
echo "$AP" | msg

echo ""
echo "A4. the drafter approves their own appetite -> blocked:"
curl -s -X POST "$API/api/grc/appetite/$APID/approve" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "A5. an independent approver signs it off:"
curl -s -X POST "$API/api/grc/appetite/$APID/approve" -H "Authorization: Bearer $ADMIN" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "A6. appetite posture across the live register:"
curl -s "$API/api/grc/appetite/posture" -H "Authorization: Bearer $RISK" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const t=r.totals;
let o='   '+t.risks+' open risks · within appetite '+t.withinAppetite+' · within tolerance '+t.withinTolerance+' · BEYOND tolerance '+t.beyondTolerance+' · no appetite set '+t.noAppetiteSet;
const b=r.beyondTolerance.slice(0,3);
o+='\n   worst: '+(b.length?b.map(x=>x.ref+' '+x.category+' score '+x.residualScore+' > tol '+x.toleranceThreshold).join('; '):'none');
o" 0

echo ""
echo "=== B. Appetite gates risk acceptance ==="
# The acceptor needs ASSESS_RISK and must not own the risk, so pick
# accordingly rather than assuming.
MEID=$(curl -s "$API/api/iam/users" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const u=(r.users||[]).find(x=>x.email==='grc.manager@omniops.me'); u?u.id:''" 0)
POST=$(curl -s "$API/api/grc/appetite/posture" -H "Authorization: Bearer $GRC")
BEYOND=$(node -pe "
const r=JSON.parse(process.argv[1]);
const x=r.beyondTolerance.find(y=>y.owner&&y.owner.id!==process.argv[2])||r.beyondTolerance[0]; x?x.id:''" "$POST" "$MEID")
WITHIN=$(node -pe "
const r=JSON.parse(process.argv[1]);
const x=r.risks.find(y=>y.band==='WithinAppetite'&&y.status!=='Accepted'&&y.owner&&y.owner.id!==process.argv[2]); x?x.id:''" "$POST" "$MEID")

echo "B1. accept a risk BEYOND tolerance -> blocked:"
curl -s -X POST "$API/api/grc/risks/$BEYOND/accept" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"until":"2027-01-01","reason":"We will live with it."}' | msg

echo ""
echo "B2. accept a risk WITHIN appetite -> allowed:"
curl -s -X POST "$API/api/grc/risks/$WITHIN/accept" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"until":"2027-01-01","reason":"Residual is inside the approved appetite for this category."}' | msg

echo ""
echo "=== C. RCSA campaign engine ==="
C=$(curl -s -X POST "$API/api/grc/rcsa" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"title":"H2 2026 control self-assessment","period":"2026-H2","dueDate":"2026-11-30"}')
CID=$(node -pe "try{JSON.parse(process.argv[1]).campaign.id}catch(e){''}" "$C")
echo "C1. campaign created: $(node -pe "try{JSON.parse(process.argv[1]).campaign.ref}catch(e){'FAILED'}" "$C")"

echo ""
echo "C2. launch with no controls in scope -> blocked:"
curl -s -X POST "$API/api/grc/rcsa/$CID/launch" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "C3. add a control to scope (respondent defaults to the control owner):"
IMPL=$(curl -s "$API/api/grc/implementations" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const i=r.implementations.find(x=>x.tenant.name==='OmniOps'&&x.ownerId); i?i.id:''" 0)
SC=$(curl -s -X POST "$API/api/grc/rcsa/$CID/scope" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"implementationId\":\"$IMPL\"}")
AID2=$(node -pe "try{JSON.parse(process.argv[1]).assessment.id}catch(e){''}" "$SC")
RESP=$(node -pe "try{JSON.parse(process.argv[1]).assessment.respondentId}catch(e){''}" "$SC")
echo "$SC" | msg

echo ""
echo "C4. the same control twice -> blocked:"
curl -s -X POST "$API/api/grc/rcsa/$CID/scope" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"implementationId\":\"$IMPL\"}" | msg

echo ""
echo "C5. attest before launch -> blocked:"
curl -s -X POST "$API/api/grc/rcsa-assessments/$AID2/submit" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"designRating":"Effective","operatingRating":"Effective"}' | msg

echo ""
echo "C6. launch:"
curl -s -X POST "$API/api/grc/rcsa/$CID/launch" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "C7. scope is frozen after launch -> blocked:"
IMPL2=$(curl -s "$API/api/grc/implementations" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const l=r.implementations.filter(x=>x.tenant.name==='OmniOps'&&x.ownerId); l[1]?l[1].id:''" 0)
curl -s -X POST "$API/api/grc/rcsa/$CID/scope" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"implementationId\":\"$IMPL2\"}" | msg

echo ""
echo "C8. somebody other than the assigned respondent attests -> blocked:"
curl -s -X POST "$API/api/grc/rcsa-assessments/$AID2/submit" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"designRating":"Effective","operatingRating":"Effective"}' | msg

echo ""
echo "C9. close with an outstanding attestation -> blocked:"
curl -s -X POST "$API/api/grc/rcsa/$CID/close" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "=== D. KRIs ==="
echo "D1. Higher-is-worse KRI with red below amber -> blocked:"
curl -s -X POST "$API/api/grc/kris" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"name":"Bad thresholds test","direction":"Higher","amberThreshold":20,"redThreshold":5}' | msg

echo ""
echo "D2. create a valid KRI:"
K=$(curl -s -X POST "$API/api/grc/kris" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"name":"Unresolved access review exceptions","direction":"Higher","amberThreshold":5,"redThreshold":15,"frequency":"Monthly"}')
KID=$(node -pe "try{JSON.parse(process.argv[1]).kri.id}catch(e){''}" "$K")
echo "   $(node -pe "try{const k=JSON.parse(process.argv[1]).kri; k.name+' (amber '+k.amberThreshold+', red '+k.redThreshold+')'}catch(e){'FAILED'}" "$K")"

echo ""
echo "D3. a Green reading:"
curl -s -X POST "$API/api/grc/kris/$KID/readings" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"periodLabel":"2026-06","value":2}' | msg

echo ""
echo "D4. same period twice -> blocked:"
curl -s -X POST "$API/api/grc/kris/$KID/readings" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"periodLabel":"2026-06","value":3}' | msg

echo ""
echo "D5. an Amber reading:"
curl -s -X POST "$API/api/grc/kris/$KID/readings" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"periodLabel":"2026-07","value":8}' | msg

echo ""
echo "D6. a RED reading -> issue raised automatically:"
curl -s -X POST "$API/api/grc/kris/$KID/readings" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"periodLabel":"2026-08","value":19}' | msg

echo ""
echo "D7. KRI dashboard:"
curl -s "$API/api/grc/kris" -H "Authorization: Bearer $RISK" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const t=r.totals;
let o='   '+t.kris+' KRIs · red '+t.red+' · amber '+t.amber+' · green '+t.green+' · no data '+t.noData;
const red=r.kris.filter(k=>k.status==='Red').slice(0,3);
o+='\n   red: '+(red.length?red.map(k=>k.name+' = '+k.latest.value+k.unit+' ('+k.trend+')').join('; '):'none');
o" 0

echo ""
echo "=== E. Loss events ==="
echo "E1. discovered before it occurred -> blocked:"
curl -s -X POST "$API/api/grc/loss-events" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"title":"Time travel","description":"x","category":"ExternalFraud","occurredAt":"2026-05-01","discoveredAt":"2026-04-01","grossAmount":1000}' | msg

echo ""
echo "E2. recovery exceeding the gross loss -> blocked:"
curl -s -X POST "$API/api/grc/loss-events" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"title":"Over-recovery","description":"x","category":"ExternalFraud","occurredAt":"2026-04-01","discoveredAt":"2026-04-05","grossAmount":1000,"recoveredAmount":5000}' | msg

echo ""
echo "E3. an immaterial loss -> recorded, no issue:"
curl -s -X POST "$API/api/grc/loss-events" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"title":"Minor billing correction","description":"A rounding error credited two clients twice.","category":"ExecutionDeliveryProcessManagement","occurredAt":"2026-06-01","discoveredAt":"2026-06-09","grossAmount":8000,"recoveredAmount":3000}' | msg

echo ""
echo "E4. a MATERIAL loss -> issue raised automatically:"
curl -s -X POST "$API/api/grc/loss-events" -H "Authorization: Bearer $RISK" -H "Content-Type: application/json" \
  -d '{"title":"Fraudulent vendor bank change","description":"A spoofed change request diverted two payment runs.","category":"ExternalFraud","occurredAt":"2026-05-02","discoveredAt":"2026-05-28","grossAmount":260000,"recoveredAmount":40000}' | msg

echo ""
echo "E5. loss register rollup:"
curl -s "$API/api/grc/loss-events" -H "Authorization: Bearer $RISK" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const t=r.totals;
const f=n=>n.toLocaleString('en-US');
let o='   '+t.events+' events · gross '+f(t.grossAmount)+' · recovered '+f(t.recoveredAmount)+' · NET '+f(t.netAmount)+' SAR';
o+='\n   largest net '+f(t.largestNet)+' · mean detection lag '+t.avgDetectionLagDays+'d';
o+='\n   by category: '+Object.entries(r.byCategory).map(([k,v])=>k+'='+v.count+' ('+f(v.net)+')').join(', ');
o" 0

echo ""
echo "=== F. Everything lands in the one issue register ==="
curl -s "$API/api/grc/issues" -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const t=r.totals;
let o='   '+t.total+' issues · open '+t.open+' · overdue '+t.overdue+' · awaiting response '+t.awaitingResponse;
o+='\n   by source: '+Object.entries(r.bySource).map(([k,v])=>k+'='+v).join(', ');
const auto=r.issues.filter(i=>['SelfIdentified','RiskAssessment','Incident'].includes(i.source)).slice(0,4);
o+='\n   auto-raised: '+auto.map(i=>i.ref+' ['+i.source+'] '+i.title.slice(0,48)).join('\n                ');
o" 0
