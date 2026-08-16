#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
r() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message|| (r.audit?('status='+r.audit.status+(r.audit.conclusion?' · conclusion='+r.audit.conclusion:'')):JSON.stringify(r).slice(0,110)))" 0; }
AUD=$(tok internal.audit@omniops.me)
GRC=$(tok grc.manager@omniops.me)

A=$(curl -s -X POST "$API/api/grc/audits" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"title":"Lifecycle enforcement test","objective":"o","scope":"s","criteria":"ISO 27001"}')
ID=$(node -pe "try{JSON.parse(process.argv[1]).audit.id}catch(e){''}" "$A")
echo "engagement: $(node -pe "try{JSON.parse(process.argv[1]).audit.ref+' ('+JSON.parse(process.argv[1]).audit.status+')'}catch(e){'FAILED'}" "$A")"

echo ""
echo "1. THE OLD BUG — Planned -> Closed, skipping everything:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Closed"}' | r

echo ""
echo "2. Planned -> Reporting, skipping fieldwork:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Reporting"}' | r

echo ""
echo "3. Planned -> Fieldwork (the legal move):"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Fieldwork"}' | r

echo ""
echo "4. Fieldwork -> Reporting with no workpapers:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Reporting"}' | r

echo ""
echo "5. Add + review a workpaper, then retry -> now the conclusion is missing:"
WP=$(curl -s -X POST "$API/api/grc/audits/$ID/workpapers" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"title":"Access testing","section":"Fieldwork","content":"Sample of 20 tested."}')
WID=$(node -pe "try{JSON.parse(process.argv[1]).workpaper.id}catch(e){''}" "$WP")
curl -s -X POST "$API/api/grc/workpapers/$WID/submit" -H "Authorization: Bearer $AUD" > /dev/null
curl -s -X POST "$API/api/grc/workpapers/$WID/review" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{"conclusion":"Adequate"}' > /dev/null
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Reporting"}' | r

echo ""
echo "6. A conclusion with no narrative:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"conclusion":"Adequate"}' | r

echo ""
echo "7. Record the conclusion, then move to Reporting:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"conclusion":"NeedsImprovement","conclusionNarrative":"Access provisioning is sound but leaver revocation lags.","status":"Reporting"}' | r

echo ""
echo "8. Reporting -> Closed:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Closed"}' | r

echo ""
echo "9. Closed -> Fieldwork (the silent reopen):"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Fieldwork"}' | r

echo ""
echo "10. Rewriting the conclusion after closure:"
curl -s -X PATCH "$API/api/grc/audits/$ID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"conclusion":"Adequate","conclusionNarrative":"Actually it was fine."}' | r

echo ""
echo "11. Cancelling a fresh engagement with no reason:"
B=$(curl -s -X POST "$API/api/grc/audits" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"title":"To be cancelled","objective":"o","scope":"s","criteria":"ISO 27001"}')
BID=$(node -pe "try{JSON.parse(process.argv[1]).audit.id}catch(e){''}" "$B")
curl -s -X PATCH "$API/api/grc/audits/$BID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" -d '{"status":"Cancelled"}' | r
echo "   with a reason:"
curl -s -X PATCH "$API/api/grc/audits/$BID" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
 -d '{"status":"Cancelled","cancellationReason":"Entity divested before fieldwork began."}' | r
