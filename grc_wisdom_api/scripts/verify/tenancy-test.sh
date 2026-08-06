#!/bin/bash
API=http://localhost:3000
tok() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" \
  -d "{\"email\":\"$1\",\"password\":\"Demo@2026\"}" | node -pe "JSON.parse(require('fs').readFileSync(0)).token" 0; }
msg() { node -pe "const r=JSON.parse(require('fs').readFileSync(0)); '   '+(r.code?r.code+': ':'')+(r.message||JSON.stringify(r).slice(0,150))" 0; }

BRANCH=$(tok network.admin@givc.com.sa)     # Branch Admin
GROUP=$(tok group.admin@alnoor.com)          # Group Admin (HOLDING)
OWNER=$(tok owner@grcwisdom.com)             # Platform Super Admin
PS=$(tok presales@omniops.me)                # Pre-Sales Manager

echo "=== I1 · Capability ceiling ==="
SUPER=$(curl -s "$API/api/iam/roles" -H "Authorization: Bearer $BRANCH" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const s=(r.roles||[]).find(x=>x.name==='Platform Super Admin'); s?s.id:''" 0)
VID=$(curl -s "$API/api/iam/users" -H "Authorization: Bearer $BRANCH" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const u=(r.users||[]).find(x=>x.role!=='Branch Admin'); u?u.id:''" 0)
echo "1. Branch Admin promotes a colleague to Platform Super Admin:"
curl -s -X POST "$API/api/iam/users/$VID/role" -H "Authorization: Bearer $BRANCH" -H "Content-Type: application/json" \
  -d "{\"roleId\":\"$SUPER\"}" | msg

echo ""
echo "2. Branch Admin mints a role with privileges they lack:"
curl -s -X POST "$API/api/iam/roles" -H "Authorization: Bearer $BRANCH" -H "Content-Type: application/json" \
  -d '{"name":"Sneaky Role","portal":"Branch","businessPurpose":"x","capabilities":["create-or-manage-a-tenant","govern-a-feature-flag"]}' | msg

echo ""
echo "3. Branch Admin invites a new user AS Platform Super Admin:"
curl -s -X POST "$API/api/iam/users/invite" -H "Authorization: Bearer $BRANCH" -H "Content-Type: application/json" \
  -d "{\"email\":\"sneak$$@test.local\",\"name\":\"Sneak\",\"roleId\":\"$SUPER\"}" | msg

echo ""
echo "4. Branch Admin creates a role within their own privileges -> allowed:"
curl -s -X POST "$API/api/iam/roles" -H "Authorization: Bearer $BRANCH" -H "Content-Type: application/json" \
  -d '{"name":"Local Reviewer","portal":"Branch","businessPurpose":"legit","capabilities":["create-an-itsm-ticket","assess-and-treat-a-risk"]}' | msg

echo ""
echo "=== I3 · DB console is operator-only ==="
echo "5. Branch Admin hits the DB console:"
curl -s "$API/api/admin/db/table/User" -H "Authorization: Bearer $BRANCH" | msg
echo "6. Platform Super Admin hits the DB console:"
curl -s "$API/api/admin/db/table/User" -H "Authorization: Bearer $OWNER" | node -pe "
let r; try{r=JSON.parse(require('fs').readFileSync(0))}catch(e){console.log('   non-JSON'); process.exit(0)}
console.log(r.status==='success' ? '   operator still has access ('+((r.records||r.data||[]).length)+' rows)' : '   BROKEN: '+r.message)" 0

echo ""
echo "=== I2 · Structural containment ==="
ALNOOR=$(curl -s "$API/api/tenants" -H "Authorization: Bearer $OWNER" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const t=(r.tenants||[]).find(x=>x.name==='Al Noor Holding Group'); t?t.id:''" 0)
echo "7. Pre-Sales Manager creating under another group (was the injection hole):"
curl -s -X POST "$API/api/tenants" -H "Authorization: Bearer $PS" -H "Content-Type: application/json" \
  -d "{\"name\":\"Injected $$\",\"type\":\"BRANCH\",\"parentId\":\"$ALNOOR\"}" | msg

echo ""
echo "8. Group Admin creates a BRANCH under their OWN group -> allowed:"
curl -s -X POST "$API/api/tenants" -H "Authorization: Bearer $GROUP" -H "Content-Type: application/json" \
  -d "{\"name\":\"Al Noor — Jeddah $$\",\"type\":\"BRANCH\",\"parentId\":\"$ALNOOR\"}" | msg

echo ""
echo "9. Group Admin tries an illegal shape (HOLDING under HOLDING):"
curl -s -X POST "$API/api/tenants" -H "Authorization: Bearer $GROUP" -H "Content-Type: application/json" \
  -d "{\"name\":\"Nested Group $$\",\"type\":\"HOLDING\",\"parentId\":\"$ALNOOR\"}" | msg

echo ""
echo "10. Group Admin tries to create a ROOT tenant (no parent):"
curl -s -X POST "$API/api/tenants" -H "Authorization: Bearer $GROUP" -H "Content-Type: application/json" \
  -d "{\"name\":\"Rogue Root $$\",\"type\":\"HOLDING\"}" | msg

echo ""
echo "=== Atomic onboarding ==="
echo "11. Onboard without an administrator -> refused:"
curl -s -X POST "$API/api/tenants/onboard" -H "Authorization: Bearer $OWNER" -H "Content-Type: application/json" \
  -d "{\"name\":\"Orphan Co $$\",\"type\":\"MULTIBRANCH\"}" | msg

echo ""
echo "12. Onboard a full organization in one call:"
ORGROLE=$(curl -s "$API/api/iam/roles" -H "Authorization: Bearer $OWNER" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
const s=(r.roles||[]).find(x=>x.name==='Organization Admin'); s?s.id:''" 0)
OUT=$(curl -s -X POST "$API/api/tenants/onboard" -H "Authorization: Bearer $OWNER" -H "Content-Type: application/json" \
  -d "{\"name\":\"Najd Industrial $$\",\"type\":\"MULTIBRANCH\",\"admin\":{\"email\":\"admin.najd$$@test.local\",\"name\":\"Najd Admin\",\"roleId\":\"$ORGROLE\"}}")
echo "$OUT" | msg
NEWEMAIL=$(node -pe "try{JSON.parse(process.argv[1]).administrator.email}catch(e){''}" "$OUT")
NEWPASS=$(node -pe "try{JSON.parse(process.argv[1]).temporaryPassword}catch(e){''}" "$OUT")

echo ""
echo "13. The new admin can log in with the temporary credential:"
curl -s -X POST "$API/api/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"$NEWEMAIL\",\"password\":\"$NEWPASS\"}" | node -pe "
const r=JSON.parse(require('fs').readFileSync(0));
'   '+(r.token ? 'logged in · mustChangePassword='+r.mustChangePassword : 'FAILED: '+r.message)" 0
