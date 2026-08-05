#!/bin/bash
# Full impersonation lifecycle test with the token kept in scope.
API=http://localhost:3000

tok() { node -pe "try{JSON.parse(require('fs').readFileSync(0)).token||''}catch(e){''}" 0; }

SDM=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"servicedesk@grcwisdom.com","password":"Demo@2026"}' | tok)
CUST=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"company.admin@omniops.me","password":"Demo@2026"}' | tok)

# End any leftover active session so we start clean.
OLD=$(curl -s $API/api/impersonation -H "Authorization: Bearer $SDM" \
  | node -pe "const s=JSON.parse(require('fs').readFileSync(0)).sessions.find(x=>['PENDING','APPROVED','ACTIVE'].includes(x.status)); s?s.id:''" 0)
if [ -n "$OLD" ]; then
  curl -s -X POST "$API/api/impersonation/$OLD/end" -H "Authorization: Bearer $SDM" \
    -H "Content-Type: application/json" -d '{"reason":"test cleanup"}' > /dev/null
  curl -s -X POST "$API/api/impersonation/$OLD/deny" -H "Authorization: Bearer $CUST" \
    -H "Content-Type: application/json" -d '{"note":"test cleanup"}' > /dev/null
fi

# Pick an OmniOps subject that is NOT the approver.
SUBJ=$(curl -s $API/api/auth/demo-identities | node -pe "
const u=JSON.parse(require('fs').readFileSync(0)).users
  .find(x=>x.context==='OmniOps' && x.email!=='company.admin@omniops.me');
u.id+'|'+u.email" 0)
SID="${SUBJ%%|*}"; SEMAIL="${SUBJ##*|}"
echo "subject: $SEMAIL"

REQ=$(curl -s -X POST $API/api/impersonation -H "Authorization: Bearer $SDM" \
  -H "Content-Type: application/json" \
  -d "{\"subjectUserId\":\"$SID\",\"reason\":\"Reproduce Word export timeout per INC-2026-0142\",\"ticketRef\":\"INC-2026-0142\",\"durationMins\":30}")
IMPID=$(node -pe "try{JSON.parse(process.argv[1]).session.id}catch(e){''}" "$REQ")
if [ -z "$IMPID" ]; then echo "request failed: $REQ"; exit 1; fi

curl -s -X POST "$API/api/impersonation/$IMPID/approve" -H "Authorization: Bearer $CUST" \
  -H "Content-Type: application/json" -d '{"note":"Verified by phone"}' > /dev/null

START=$(curl -s -X POST "$API/api/impersonation/$IMPID/start" -H "Authorization: Bearer $SDM")
IMPTOK=$(node -pe "try{JSON.parse(process.argv[1]).impersonationToken}catch(e){''}" "$START")
if [ -z "$IMPTOK" ]; then echo "start failed: $START"; exit 1; fi

echo ""
echo "=== read comparison (same endpoint, three identities) ==="
for PAIR in "service desk (platform):$SDM" "impersonating $SEMAIL:$IMPTOK" "omniops admin:$CUST"; do
  L="${PAIR%%:*}"; T="${PAIR##*:}"
  printf "  %-34s" "$L"
  curl -s $API/api/tickets -H "Authorization: Bearer $T" \
    | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); r.scope+' -> '+r.count+' tickets'" 0
done

echo ""
echo "=== write attempt inside session (full payload) ==="
curl -s -X POST $API/api/documents -H "Authorization: Bearer $IMPTOK" \
  -H "Content-Type: application/json" \
  -d '{"code":"HACK-1","title":"x","category":"Policy","classification":"Internal","content":"x"}'
echo ""

echo ""
echo "=== customer revokes mid-session ==="
curl -s -X POST "$API/api/impersonation/$IMPID/end" -H "Authorization: Bearer $CUST" \
  -H "Content-Type: application/json" -d '{"reason":"Support call finished"}' \
  | node -pe "const r=JSON.parse(require('fs').readFileSync(0)); r.status+' -> '+r.finalStatus" 0

echo ""
echo "=== token dead immediately after revoke ==="
curl -s $API/api/tickets -H "Authorization: Bearer $IMPTOK"
echo ""

echo ""
echo "=== audit trail written to the CUSTOMER's tenant ==="
curl -s $API/api/audit-logs -H "Authorization: Bearer $CUST" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
r.logs.filter(l=>l.action.startsWith('IMPERSONATION'))
 .map(l=>'  '+l.action.padEnd(30)+(l.actor?l.actor.email:'?')).join('\n')" 0
