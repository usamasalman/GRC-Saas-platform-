#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,150))" 0; }

GRC=$(tok grc.manager@omniops.me)     # holds import-or-enable-a-standard
AUD=$(tok internal.audit@omniops.me)  # does not
OWNER=$(tok owner@grcwisdom.com)      # platform operator
ALNOOR=$(tok group.admin@alnoor.com)  # a different organisation

echo "=== 1. Author a new standard, clauses included ==="
NEW=$(curl -s -X POST "$API/api/grc/standards" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" -d '{
  "code":"PCI-DSS","title":"Payment Card Industry Data Security Standard",
  "authority":"PCI Security Standards Council","version":"4.0",
  "description":"Card data protection requirements for merchants and processors.",
  "clauses":[
    {"ref":"1.2.1","title":"Restrict inbound and outbound traffic","text":"Configuration standards for network security controls are defined and implemented."},
    {"ref":"3.5.1","title":"Render PAN unreadable","text":"Primary account number is rendered unreadable anywhere it is stored."},
    {"ref":"8.3.1","title":"Strong authentication","text":"All user access is authenticated with at least one authentication factor."},
    {"ref":"10.2.1","title":"Audit logs capture all access","text":"Audit logs record all individual user access to cardholder data."}
  ]}')
SID=$(node -pe "try{JSON.parse(process.argv[1]).standard.id}catch(e){''}" "$NEW")
echo "$NEW" | msg

echo ""
echo "2. A role without the capability tries the same -> blocked:"
curl -s -X POST "$API/api/grc/standards" -H "Authorization: Bearer $AUD" -H "Content-Type: application/json" \
  -d '{"code":"X","title":"t","authority":"a","version":"1"}' | msg

echo ""
echo "3. Duplicate code in the same scope -> blocked:"
curl -s -X POST "$API/api/grc/standards" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"code":"PCI-DSS","title":"Dup","authority":"x","version":"1"}' | msg

echo ""
echo "4. Malformed clause set -> blocked:"
curl -s -X POST "$API/api/grc/standards" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"code":"BAD1","title":"t","authority":"a","version":"1","clauses":[{"ref":"1.1","title":"ok"},{"ref":"1.1","title":"dupe"}]}' | msg

echo ""
echo "5. A tenant tries to publish platform-wide -> blocked:"
curl -s -X POST "$API/api/grc/standards" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"code":"SNEAK","title":"t","authority":"a","version":"1","scope":"platform"}' | msg

echo ""
echo "6. Editing a published standard (ISO 27001) -> blocked:"
ISO=$(curl -s "$API/api/grc/standards" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const s=r.standards.find(x=>x.code==='ISO27001'); s?s.id:''" 0)
curl -s -X PATCH "$API/api/grc/standards/$ISO" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"version":"9.9"}' | msg

echo ""
echo "7. Append more clauses to your own standard:"
curl -s -X POST "$API/api/grc/standards/$SID/clauses" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"clauses":[{"ref":"12.1.1","title":"Information security policy","text":"An overall policy is established and maintained."}]}' | msg

echo ""
echo "8. Re-adding an existing clause ref -> blocked:"
curl -s -X POST "$API/api/grc/standards/$SID/clauses" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d '{"clauses":[{"ref":"1.2.1","title":"Duplicate"}]}' | msg

echo ""
echo "9. Another organisation cannot see your private framework:"
curl -s "$API/api/grc/standards" -H "Authorization: Bearer $ALNOOR" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
'   Al Noor sees: '+r.standards.map(s=>s.code).join(', ')" 0
curl -s "$API/api/grc/standards" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
'   OmniOps sees: '+r.standards.map(s=>s.code).join(', ')" 0

echo ""
echo "10. Enable it, then map a control to its clauses:"
curl -s -X POST "$API/api/grc/standards/enable" -H "Authorization: Bearer $GRC" -H "Content-Type: application/json" \
  -d "{\"standardId\":\"$SID\",\"applicability\":\"Full\"}" | msg
CTRL=$(curl -s "$API/api/grc/controls" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const c=r.controls.find(x=>x.code==='AC-01'); c?c.id:''" 0)
CL=$(curl -s "$API/api/grc/standards" -H "Authorization: Bearer $GRC" > /dev/null; node -e "1")
CLAUSES=$(curl -s "$API/api/grc/controls?standard=PCI-DSS" -H "Authorization: Bearer $GRC" > /dev/null; echo "")
echo ""
echo "11. Delete a standard that is enabled -> blocked:"
curl -s -X DELETE "$API/api/grc/standards/$SID" -H "Authorization: Bearer $GRC" | msg

echo ""
echo "12. The new standard now appears in the library:"
curl -s "$API/api/grc/standards" -H "Authorization: Bearer $GRC" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const s=r.standards.find(x=>x.code==='PCI-DSS');
s ? '   '+s.code+' v'+s.version+' · '+s.clauseCount+' clauses · owned here: '+s.isOwnedHere+' · enabled: '+s.isEnabledHere : '   NOT FOUND'" 0
