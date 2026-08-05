#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,90))" 0; }

AUD=$(tok internal.audit@omniops.me)   # preparer
GRC=$(tok grc.manager@omniops.me)      # reviewer

AID=$(curl -s $API/api/grc/audits -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const a=r.audits.find(x=>x.status!=='Closed'); a?a.id:''" 0)
AREF=$(curl -s $API/api/grc/audits -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const a=r.audits.find(x=>x.status!=='Closed'); a?a.ref:''" 0)
echo "engagement: $AREF"

echo ""
echo "1. add an RCM row linked to a real control:"
IMPL=$(curl -s $API/api/grc/implementations -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const i=r.implementations.find(x=>x.tenant.name==='OmniOps'); i?i.id:''" 0)
ROW=$(curl -s -X POST "$API/api/grc/audits/$AID/matrix" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d "{\"title\":\"Unauthorised privileged access granted\",\"description\":\"Access granted without documented approval.\",\"riskRating\":\"High\",\"implementationId\":\"$IMPL\",\"controlType\":\"Preventive\",\"controlNature\":\"Manual\"}")
RID=$(node -pe "try{JSON.parse(process.argv[1]).row.id}catch(e){''}" "$ROW")
echo "$ROW" | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   row '+(r.row?r.row.ref:'FAILED')+' added'" 0

echo ""
echo "2. add a test procedure with sampling method:"
PROC=$(curl -s -X POST "$API/api/grc/matrix/$RID/procedures" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"objective":"Verify every privileged grant had prior approval.","procedure":"Select a sample of grants; agree each to an approved request.","testType":"OperatingEffectiveness","samplingMethod":"Statistical","populationSize":412,"sampleSize":25}')
PID=$(node -pe "try{JSON.parse(process.argv[1]).procedure.id}catch(e){''}" "$PROC")
echo "$PROC" | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.procedure?r.procedure.ref+' ('+r.procedure.samplingMethod+', n='+r.procedure.sampleSize+' of '+r.procedure.populationSize+')':'FAILED')" 0

echo ""
echo "3. exceptions found but conclusion Satisfactory -> rejected:"
curl -s -X POST "$API/api/grc/procedures/$PID/result" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"itemsTested":25,"exceptionsFound":3,"conclusion":"Satisfactory","narrative":"Three grants lacked approval."}' | msg

echo ""
echo "4. exceptions exceed items tested -> rejected:"
curl -s -X POST "$API/api/grc/procedures/$PID/result" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"itemsTested":25,"exceptionsFound":30,"conclusion":"Unsatisfactory","narrative":"Impossible numbers."}' | msg

echo ""
echo "5. consistent result -> accepted:"
curl -s -X POST "$API/api/grc/procedures/$PID/result" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"itemsTested":25,"exceptionsFound":3,"conclusion":"SatisfactoryWithExceptions","narrative":"3 of 25 privileged grants had no documented approval."}' | msg

echo ""
echo "6. results are immutable -> re-record rejected:"
curl -s -X POST "$API/api/grc/procedures/$PID/result" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"itemsTested":25,"exceptionsFound":0,"conclusion":"Satisfactory","narrative":"Trying to overwrite."}' | msg

echo ""
echo "7. create workpaper + submit for review:"
WP=$(curl -s -X POST "$API/api/grc/audits/$AID/workpapers" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d "{\"title\":\"Privileged access sample testing\",\"section\":\"Fieldwork\",\"procedureId\":\"$PID\",\"content\":\"Sample of 25 grants tested; 3 exceptions.\"}")
WID=$(node -pe "try{JSON.parse(process.argv[1]).workpaper.id}catch(e){''}" "$WP")
WREF=$(node -pe "try{JSON.parse(process.argv[1]).workpaper.ref}catch(e){''}" "$WP")
echo "   workpaper $WREF created"
curl -s -X POST "$API/api/grc/workpapers/$WID/submit" -H "Authorization: Bearer $AUD" | msg

echo ""
echo "8. SoD: the PREPARER tries to sign off their own workpaper:"
curl -s -X POST "$API/api/grc/workpapers/$WID/review" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "9. reviewer raises a note -> paper returned:"
NOTE=$(curl -s -X POST "$API/api/grc/workpapers/$WID/notes" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"note":"Cross-reference the exception detail to the source extract."}')
NID=$(node -pe "try{JSON.parse(process.argv[1]).note.id}catch(e){''}" "$NOTE")
echo "$NOTE" | msg

echo ""
echo "10. resubmit, then sign off with the note still OPEN -> blocked:"
curl -s -X POST "$API/api/grc/workpapers/$WID/submit" -H "Authorization: Bearer $AUD" > /dev/null
curl -s -X POST "$API/api/grc/workpapers/$WID/review" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{}' | msg

echo ""
echo "11. clear the note, then sign off -> succeeds:"
curl -s -X POST "$API/api/grc/review-notes/$NID/clear" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"response":"Cross-reference added at B-1.1."}' > /dev/null
curl -s -X POST "$API/api/grc/workpapers/$WID/review" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"conclusion":"Testing adequate; exceptions supported."}' | msg

echo ""
echo "12. move engagement to Reporting (all papers reviewed) -> allowed:"
curl -s -X PATCH "$API/api/grc/audits/$AID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"status":"Reporting"}' | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': '+r.message:'status -> '+r.audit.status)" 0

echo ""
echo "13. matrix summary:"
curl -s "$API/api/grc/audits/$AID/matrix" -H "Authorization: Bearer $AUD" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
'   '+r.totals.rows+' RCM rows · '+r.totals.procedures+' procedures · '+r.totals.completed+' completed · '+r.totals.exceptions+' exceptions'" 0
