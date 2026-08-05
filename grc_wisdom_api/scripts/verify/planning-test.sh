#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }

AUD=$(tok internal.audit@omniops.me)
GRC=$(tok grc.manager@omniops.me)

echo "1. engagement from an APPROVED plan item:"
ITEM=$(curl -s $API/api/grc/plans -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const p=r.plans.find(x=>x.status==='Approved'||x.status==='Active');
const i=p.items.find(x=>!x.audit);
i? i.id+'|'+i.auditableEntity.name : ''" 0)
IID="${ITEM%%|*}"; ENAME="${ITEM##*|}"
echo "   plan item: $ENAME"
curl -s -X POST "$API/api/grc/plan-items/$IID/instantiate" -H "Authorization: Bearer $AUD" \
  -H "Content-Type: application/json" -d '{"criteria":"ISO 27001 A.5.23"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.message||r.message)" 0

echo ""
echo "2. same item again -> blocked (one engagement per plan item):"
curl -s -X POST "$API/api/grc/plan-items/$IID/instantiate" -H "Authorization: Bearer $AUD" \
  -H "Content-Type: application/json" -d '{}' | node -pe "'   '+JSON.parse(require('fs').readFileSync(0)).message" 0

echo ""
echo "3. new DRAFT plan, submit with NO high-risk coverage -> blocked:"
NP=$(curl -s -X POST $API/api/grc/plans -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"year":2027,"title":"2027 Plan","totalBudgetHours":400}')
NPID=$(node -pe "try{JSON.parse(process.argv[1]).plan.id}catch(e){''}" "$NP")
LOWID=$(curl -s $API/api/grc/universe -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const e=r.entities.find(x=>x.riskTier==='Low'); e?e.id:''" 0)
curl -s -X POST "$API/api/grc/plans/$NPID/items" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"auditableEntityId\":\"$LOWID\",\"plannedQuarter\":1}" > /dev/null
curl -s -X POST "$API/api/grc/plans/$NPID/submit" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code||'')+': '+r.message" 0

echo ""
echo "4. add a high-risk entity, then submit -> passes:"
HIGHID=$(curl -s $API/api/grc/universe -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const e=r.entities.find(x=>x.riskTier==='High'); e?e.id:''" 0)
curl -s -X POST "$API/api/grc/plans/$NPID/items" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"auditableEntityId\":\"$HIGHID\",\"plannedQuarter\":1,\"budgetHours\":160}" > /dev/null
curl -s -X POST "$API/api/grc/plans/$NPID/submit" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.message||r.code)" 0

echo ""
echo "5. SoD: the PREPARER tries to approve their own plan:"
curl -s -X POST "$API/api/grc/plans/$NPID/approve" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"self approve"}' | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code||'?')+': '+r.message" 0

echo ""
echo "6. INDEPENDENT approver succeeds:"
curl -s -X POST "$API/api/grc/plans/$NPID/approve" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"note":"Approved by audit committee."}' | node -pe "'   '+JSON.parse(require('fs').readFileSync(0)).message" 0

echo ""
echo "7. changing an APPROVED plan -> blocked:"
curl -s -X POST "$API/api/grc/plans/$NPID/items" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"auditableEntityId\":\"$LOWID\"}" | node -pe "'   '+JSON.parse(require('fs').readFileSync(0)).message" 0

echo ""
echo "8. audit trail:"
curl -s $API/api/audit-logs -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const g={}; r.logs.filter(l=>/AUDIT_PLAN|AUDIT_ENTITY|AUDIT_INSTANT/.test(l.action)).forEach(l=>g[l.action]=(g[l.action]||0)+1);
Object.entries(g).map(([k,v])=>'   '+k.padEnd(34)+v).join('\n')" 0
