#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" \
  | node -pe "try{JSON.parse(require('fs').readFileSync(0)).token||''}catch(e){''}" 0; }

STAFF=$(tok top.management@omniops.me)          # Executive Sponsor, custom role
ORGADMIN=$(tok company.admin@omniops.me)        # Organization Admin — add-a-user
SECADMIN=$(tok security@grcwisdom.com)          # Platform Security Admin — monitor-security

echo "=== catalog: which items route through a workflow ==="
curl -s $API/api/itsm/catalog -H "Authorization: Bearer $STAFF" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
r.items.map(i=>'  '+i.name.padEnd(32)+i.derivedPriority.padEnd(13)+(i.workflowName?('-> '+i.workflowName+' ('+i.workflowSteps+' steps)'):'-> direct to queue')).join('\n')" 0

ITEM=$(curl -s $API/api/itsm/catalog -H "Authorization: Bearer $STAFF" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).items.find(i=>i.key==='production-access').id" 0)

echo ""
echo "=== staff raises an access request (priority is COMPUTED) ==="
T=$(curl -s -X POST $API/api/itsm/tickets -H "Authorization: Bearer $STAFF" -H "Content-Type: application/json" \
  -d "{\"catalogItemId\":\"$ITEM\",\"subject\":\"Prod DB read access for quarter-end\",\"description\":\"Need read access to the reporting replica to close the quarter.\",\"priority\":\"P1 Critical\"}")
echo "$T" | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '  '+r.message+'\n  submitted priority=P1 Critical -> stored priority='+r.ticket.priority+'  status='+r.ticket.status" 0
TID=$(node -pe "JSON.parse(process.argv[1]).ticket.id" "$T")

echo ""
echo "=== approval inbox (cross-platform) ==="
for P in "org admin:$ORGADMIN" "security admin:$SECADMIN"; do
  L="${P%%:*}"; TK="${P##*:}"
  printf "  %-16s" "$L"
  curl -s $API/api/itsm/workflows/inbox -H "Authorization: Bearer $TK" | node -pe "
  const r=JSON.parse(require('fs').readFileSync(0));
  r.count+' pending'+(r.steps[0]?('  -> '+r.steps[0].name):'')" 0
done

RUN=$(curl -s $API/api/itsm/tickets/$TID -H "Authorization: Bearer $ORGADMIN" \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); r.ticket.workflowRun?r.ticket.workflowRun.id:''" 0)

echo ""
echo "=== wrong role tries to approve step 1 -> capability denied ==="
curl -s -X POST $API/api/itsm/workflows/runs/$RUN/decide -H "Authorization: Bearer $SECADMIN" \
  -H "Content-Type: application/json" -d '{"decision":"approve"}' | head -c 190

echo ""
echo ""
echo "=== step 1: manager review (org admin) ==="
curl -s -X POST $API/api/itsm/workflows/runs/$RUN/decide -H "Authorization: Bearer $ORGADMIN" \
  -H "Content-Type: application/json" -d '{"decision":"approve","comment":"Business case confirmed"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '  '+r.message+'  ['+r.workflowStatus+']'" 0

echo ""
echo "=== step 2: security approval (security admin) ==="
curl -s -X POST $API/api/itsm/workflows/runs/$RUN/decide -H "Authorization: Bearer $SECADMIN" \
  -H "Content-Type: application/json" -d '{"decision":"approve","comment":"Least-privilege verified"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '  '+r.message+'  ['+r.workflowStatus+']'" 0

echo ""
echo "=== ticket state after full approval ==="
curl -s $API/api/itsm/tickets/$TID -H "Authorization: Bearer $ORGADMIN" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); const t=r.ticket;
'  status='+t.status+'  priority='+t.priority+'  sla='+t.sla.state+'\n'+
'  route: '+t.workflowRun.stepRuns.map(s=>s.stepKey+':'+s.status).join(' -> ')" 0

echo ""
echo "=== work notes vs comments (schema-distinct) ==="
curl -s -X POST $API/api/itsm/tickets/$TID/comments -H "Authorization: Bearer $ORGADMIN" \
  -H "Content-Type: application/json" -d '{"body":"Internal: provisioning via IAM console","internal":true}' > /dev/null
curl -s -X POST $API/api/itsm/tickets/$TID/comments -H "Authorization: Bearer $ORGADMIN" \
  -H "Content-Type: application/json" -d '{"body":"Access granted, expires in 7 days."}' > /dev/null
printf "  %-22s" "agent sees:"
curl -s $API/api/itsm/tickets/$TID -H "Authorization: Bearer $ORGADMIN" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); r.ticket.comments.length+' comments, '+r.ticket.workNotes.length+' work notes'" 0
printf "  %-22s" "requester sees:"
curl -s $API/api/itsm/tickets/$TID -H "Authorization: Bearer $STAFF" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0)); r.ticket.comments.length+' comments, '+r.ticket.workNotes.length+' work notes'" 0
