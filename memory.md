# GRC Wisdom — Codebase Memory (`memory.md`)

> **Generated**: 2026-07-27 — verified against every file in both `grc_wisdom_web` (frontend) and `grc_wisdom_api` (backend).  
> **Core Directive**: _Never assume. Verify everything from code._

---

## 1. What the Project Does

**GRC Wisdom** is a **multi-tenant, multi-portal SaaS platform** for Governance, Risk, and Compliance (GRC), with deep Saudi Arabia regulatory alignment (PDPL, ZATCA, NCA). It enables organizations of various operating models — holding groups, multi-branch companies, franchises, consulting partners — to centrally manage:

- **Document lifecycle** (authoring → approval → e-signature → publication → acknowledgement → retention → legal hold)
- **Risk registers**, controls, implementations, and evidence
- **Audit programmes** (internal and external auditor portals)
- **ITSM** (service desk, ticket queues, SLA management)
- **Security services** (Wisdom Eye ASM — Attack Surface Management, Eye Phish — phishing simulations)
- **Open-source tool marketplace** (curated security tools with entitlements per tenant)
- **Billing** (plans, subscriptions, invoices, ZATCA e-invoicing, payment reconciliation)
- **AI compliance assistant** (RAG-based question answering over uploaded documents)

## 2. Why It Exists

Saudi Arabia's Vision 2030 regulatory environment demands that every organization (government, private, healthcare, retail) demonstrate auditable compliance with frameworks like ISO 27001, NCA ECC, Saudi PDPL, and ZATCA. GRC Wisdom fills the gap by providing a **region-first**, Arabic-ready, PDPL-compliant platform with:

- **Multi-tenant isolation** at the database level (materialized path hierarchy)
- **Immutable audit logging** (WORM — Write-Once-Read-Many with SHA-256 hash chaining)
- **E-signature** with MFA verification for document approvals
- **ZATCA-compliant invoicing** (UBL 2.1 XML, ECDSA signatures, TLV QR codes)
- **Entity hierarchy governance** (Holding → Subsidiary → BU → Branch → Department)

## 3. How It Works — System Overview

```
┌──────────────────────────────────────────────┐
│  FRONTEND (React 19 / Vite)                  │
│  Port: 5173                                  │
│  ┌──────────┐ ┌────────────┐ ┌────────────┐  │
│  │ Portal   │ │ Portal     │ │ AppShell   │  │
│  │ Directory│→│ Login      │→│ (Dashboard)│  │
│  │ (/)      │ │ (/login/X) │ │ (/app/*)   │  │
│  └──────────┘ └────────────┘ └────────────┘  │
│       ↓ fetch('http://localhost:3000/api/data')│
├──────────────────────────────────────────────┤
│  BACKEND (Express / Prisma / SQLite)         │
│  Port: 3000                                  │
│  ┌──────┐ ┌──────────┐ ┌────────────────┐   │
│  │app.ts│→│server.ts  │ │ Prisma ORM     │   │
│  │      │ │(listen)   │ │ (SQLite dev.db)│   │
│  └──────┘ └──────────┘ └────────────────┘   │
│  8 Controllers  │ 7 Middlewares │ 9 Utils    │
└──────────────────────────────────────────────┘
```

### Current State

The platform is a **functional prototype** — the frontend renders 8 portal experiences using a massive `appMockEngine.js` (546 lines, 245KB) that generates HTML dashboards from seed data stored in localStorage. The backend has a Prisma schema with 15 models, seed data, controllers, and middleware scaffolded but largely returning **mock responses** (DB calls are commented out). The system is **not yet production-ready**.

## 4. Repository Structure

```
grc_wisdom_web/                          ← Workspace root = Vite frontend
├── src/
│   ├── App.tsx                          ← Router: / → /login/:portalId → /app/*
│   ├── main.tsx                         ← React root entry with AuthProvider
│   ├── index.css                        ← 54 lines, 34KB — entire design system
│   ├── api/
│   │   └── apiClient.ts                 ← Axios instance → localhost:3000
│   ├── context/
│   │   └── AuthContext.tsx              ← JWT-based auth state (localStorage)
│   ├── components/
│   │   ├── Navbar.tsx                   ← Top bar (search, lang, persona, logout)
│   │   ├── Sidebar.tsx                  ← Left nav (brand, workspace, nav items)
│   │   ├── StatCard.tsx                 ← KPI stat card component
│   │   └── PortalGuard.tsx             ← Route guard (role-based redirect)
│   ├── pages/
│   │   ├── PortalDirectory.tsx          ← Landing page: 8 portal cards
│   │   ├── PortalLogin.tsx              ← Per-portal login with demo identities
│   │   ├── AppShell.tsx                 ← Main app: sidebar + content via renderMockView()
│   │   ├── LoginGateway.tsx             ← Alternative real-API login (unused in main router)
│   │   └── SaasPortal.tsx              ← Alternative SaaS dashboard (unused in main router)
│   └── utils/
│       ├── mockData.ts                  ← 245KB single-line JSON (requirements + seed data)
│       └── appMockEngine.js             ← 546 lines — full mock rendering engine
├── grc_wisdom_api/                      ← Express backend (nested subfolder)
│   ├── src/
│   │   ├── server.ts                    ← Entry: imports app.ts, listens on 3000
│   │   ├── app.ts                       ← Express app: helmet, cors, /health, /api/data
│   │   ├── db.ts                        ← Prisma client (SQLite via prisma-adapter-node-sqlite)
│   │   ├── seed.ts                      ← Seeds DB from mockData (7 entity types)
│   │   ├── controllers/
│   │   │   ├── tenantController.ts      ← getEntityTree, distributePolicy
│   │   │   ├── documentController.ts    ← checkOut, checkIn, submitESignature
│   │   │   ├── auditorController.ts     ← exportAuditLogs, runTamperDetectionJob
│   │   │   ├── aiController.ts          ← askAiComplianceQuestion (RAG mock)
│   │   │   ├── subscriptionController.ts← createSubscription
│   │   │   ├── planController.ts        ← getPlans, createPlan
│   │   │   ├── apiKeysController.ts     ← generateApiKey (SHA-256 hashed)
│   │   │   └── webhooksController.ts    ← registerWebhook (HMAC secret)
│   │   ├── middlewares/
│   │   │   ├── authMiddleware.ts        ← JWT verify + req.user injection
│   │   │   ├── auditMiddleware.ts       ← SHA-256 hash chain WORM logger
│   │   │   ├── hierarchyMiddleware.ts   ← Materialized path scope enforcement
│   │   │   ├── apiKeyMiddleware.ts      ← x-api-key header verification
│   │   │   ├── i18nMiddleware.ts        ← Accept-Language → locale (en/ar)
│   │   │   ├── pdplScrubber.ts          ← PII redaction for non-PDPL_ADMIN
│   │   │   ├── aiQuotaLimiter.ts        ← Per-tenant AI query rate limiting
│   │   │   └── validateRequest.ts       ← Zod schema validation
│   │   ├── utils/
│   │   │   ├── cryptoUtils.ts           ← SHA-256 hash + chain verification
│   │   │   ├── mfaUtils.ts              ← TOTP secret, QR generation, verify
│   │   │   ├── llmUtils.ts              ← Mock embedding + LLM call stubs
│   │   │   ├── pdplUtils.ts             ← AES-256-GCM PII encryption/decryption
│   │   │   ├── treeUtils.ts             ← Materialized path generation + descendant check
│   │   │   ├── anomalyDetector.ts       ← Z-Score based risk anomaly detection
│   │   │   ├── rollupUtils.ts           ← Branch risk score aggregation
│   │   │   ├── summaryGenerator.ts      ← AI executive summary from rollup data
│   │   │   ├── webhookDispatcher.ts     ← HMAC SHA-256 signed webhook dispatch
│   │   │   ├── zatcaXmlBuilder.ts       ← ZATCA UBL 2.1 invoice XML generation
│   │   │   ├── zatcaCrypto.ts           ← ECDSA signing for ZATCA invoices
│   │   │   ├── zatcaQrUtils.ts          ← TLV Base64 QR code generation
│   │   │   └── mockData.ts             ← Re-exports from frontend mockData
│   │   └── locales/
│   │       ├── en.json                  ← English strings (4 keys)
│   │       └── ar.json                  ← Arabic strings (4 keys)
│   └── prisma/
│       └── schema.prisma                ← 15 models, SQLite, 304 lines
├── GRC_Wisdom_TRD_Production_Readiness_v1.md ← Technical Requirements Document
├── package.json                         ← Frontend deps (React, Vite, axios, react-router)
├── vite.config.ts                       ← Vite config (React plugin)
└── tsconfig*.json                       ← TypeScript configs
```

## 5. Data Flow

### 5.1 Mock Flow (Current — Primary)

```
User clicks portal card → PortalDirectory.tsx
  ↓
Navigate to /login/:portalId → PortalLogin.tsx
  ↓
fetch('http://localhost:3000/api/data')
  ↓ returns all users, docs, tickets, tools, etc.
Matches email + "Demo@2026" password against returned accounts[]
  ↓
localStorage.setItem('authPersonaId', match.id)
  ↓
Navigate to /app → AppShell.tsx
  ↓
AppShell reads authPersonaId from localStorage
  ↓ fetch('/api/data') again
Builds account object from apiData.accounts[]
  ↓
renderMockView(activePage, account, apiData)
  ↓ returns HTML string
dangerouslySetInnerHTML renders it + delayed event binding
```

### 5.2 Real Auth Flow (Scaffolded — Unused)

```
LoginGateway.tsx → POST /api/auth/login
  ↓
authMiddleware.ts verifies JWT
  ↓
AuthContext stores { token, role, tenantId }
  ↓
PortalGuard.tsx checks role against allowedRoles
  ↓
apiClient.ts attaches Bearer token to all requests
```

**Current status**: The real auth flow is scaffolded but `/api/auth/login` is not wired in `app.ts`. The `routes/` directory is empty. The `LoginGateway.tsx` page is not in the main router (`App.tsx`).

## 6. Frontend ↔ Backend Communication

| Endpoint | Method | Source | Purpose | Status |
|---|---|---|---|---|
| `/health` | GET | `app.ts` | Health check | ✅ Works |
| `/api/data` | GET | `app.ts` | Returns ALL mock data from Prisma | ✅ Works |
| `/api/auth/login` | POST | `LoginGateway.tsx` | Real login | ❌ Not wired |
| All controller endpoints | Various | Controllers | Business logic | ❌ No routes mounted |

**Key gap**: No route files exist. Controllers are defined but never `app.use()`-mounted. The only working backend endpoint is `/api/data`.

## 7. Routing

### Frontend Routes (App.tsx)

| Path | Component | Description |
|---|---|---|
| `/` | `PortalDirectory` | Landing page with 8 portal cards |
| `/login/:portalId` | `PortalLogin` | Per-portal login (saas, holding, multibranch, branch, document, auditor, partner, franchise) |
| `/app/*` | `AppShell` | Main dashboard — renders views from appMockEngine |
| `*` | Redirect to `/` | Catch-all |

### AppShell Internal Navigation (Client-Side Only)

The AppShell uses `activePage` state (not URL-based routing) to determine which view `renderMockView()` produces. Each portal type has a full navigation tree defined in the `NAV` constant (see AppShell.tsx lines 6-62).

## 8. Authentication

### Mock Authentication (Active)

1. `PortalLogin.tsx` fetches `/api/data` → gets all users
2. Matches `email + password` against `accounts[]` array
3. Stores `authPersonaId` in localStorage
4. `AppShell` reads persona from localStorage

### Real Authentication (Scaffolded)

1. `AuthContext.tsx` manages `{ isAuthenticated, token, role, tenantId }` in state + localStorage
2. `apiClient.ts` attaches `Authorization: Bearer <token>` via interceptor
3. `authMiddleware.ts` verifies JWT using `process.env.JWT_SECRET`
4. `PortalGuard.tsx` checks user role against allowed roles for route

**Security gaps**: JWT secret is read from env (good) but no `.env` file exists. No refresh token mechanism. No session expiry.

## 9. State Management

- **AuthContext** (`useContext`): Global auth state for real JWT flow
- **localStorage**: Primary state for mock flow (`authPersonaId`, `gw_docs_v2`, `gw_logs_v2`, `gw_tickets_v3`, etc.)
- **appMockEngine.js**: Uses `loadJSON()`/`saveJSON()` wrappers around localStorage for all mock data persistence
- **No Redux/Zustand**: No external state management library

## 10. Database Schema (Prisma)

15 models across 5 phases:

| Phase | Models | Purpose |
|---|---|---|
| Core | `Tenant`, `User`, `Plan`, `Subscription`, `Invoice` | Multi-tenancy, billing |
| Phase 1: Trust | `AuditLog`, `Document`, `DocumentVersion`, `ApprovalQueue` | Immutable logs, DMS |
| Mock Data | `Ticket`, `OpenSourceTool`, `AsmAsset`, `PhishCampaign` | ITSM, security services |
| Phase 4: Ecosystem | `ApiKey`, `WebhookEndpoint` | Partner integrations |
| Phase 5: Intelligence | `DocumentChunk`, `RiskScoreSnapshot` | AI/RAG, anomaly detection |

**Key design decisions**:
- `Tenant.path` uses materialized path pattern (`/HOLDING_1/ORG_2/BRANCH_3/`)
- `AuditLog` has `previousHash` + `currentHash` for WORM chain verification
- `Document.inheritedFromId` enables policy distribution (cloning from parent)
- `User.encryptedNationalId` and `encryptedPhone` for PDPL compliance (AES-256-GCM)
- SQLite for dev; production target is PostgreSQL with RLS

## 11. API Map

### Mounted (Working)

| Method | Path | Handler | Auth |
|---|---|---|---|
| GET | `/health` | Inline (app.ts) | None |
| GET | `/api/data` | Inline (app.ts) | None |

### Controller Functions (Defined but NOT Mounted)

| Controller | Function | Expected Endpoint |
|---|---|---|
| `tenantController` | `getEntityTree` | GET `/api/tenants/tree` |
| `tenantController` | `distributePolicy` | POST `/api/tenants/distribute` |
| `documentController` | `checkOutDocument` | POST `/api/documents/:id/checkout` |
| `documentController` | `checkInDocument` | POST `/api/documents/:id/checkin` |
| `documentController` | `submitESignature` | POST `/api/approvals/:id/sign` |
| `auditorController` | `exportAuditLogs` | GET `/api/audit/export` |
| `aiController` | `askAiComplianceQuestion` | POST `/api/ai/ask` |
| `subscriptionController` | `createSubscription` | POST `/api/subscriptions` |
| `planController` | `getPlans` | GET `/api/plans` |
| `planController` | `createPlan` | POST `/api/plans` |
| `apiKeysController` | `generateApiKey` | POST `/api/keys` |
| `webhooksController` | `registerWebhook` | POST `/api/webhooks` |

## 12. Middleware Pipeline

| Middleware | File | Purpose | Status |
|---|---|---|---|
| Helmet | `app.ts` | HTTP security headers | ✅ Active |
| CORS | `app.ts` | Origin restriction | ✅ Active |
| JSON Parser | `app.ts` | Body parsing | ✅ Active |
| Auth | `authMiddleware.ts` | JWT verification | 🔧 Defined, not mounted |
| Audit | `auditMiddleware.ts` | WORM hash chain logging | 🔧 Defined, not mounted |
| Hierarchy | `hierarchyMiddleware.ts` | Tenant scope enforcement | 🔧 Defined, not mounted |
| API Key | `apiKeyMiddleware.ts` | External API key auth | 🔧 Defined, not mounted |
| i18n | `i18nMiddleware.ts` | Locale detection (en/ar) | 🔧 Defined, not mounted |
| PDPL Scrubber | `pdplScrubber.ts` | PII field redaction | 🔧 Defined, not mounted |
| AI Quota | `aiQuotaLimiter.ts` | Per-tenant AI rate limit | 🔧 Defined, not mounted |
| Validation | `validateRequest.ts` | Zod schema validation | 🔧 Defined, not mounted |

## 13. Deployment

### Current: Local Development

```bash
# Frontend
cd grc_wisdom_web
npm install
npm run dev  # → http://localhost:5173

# Backend
cd grc_wisdom_api
npm install
npx prisma generate
npx prisma db push
npx ts-node src/seed.ts
npx ts-node src/server.ts  # → http://localhost:3000
```

### Target: OCI Riyadh (per TRD)

- **Compute**: OCI Container Instances / Kubernetes
- **Database**: PostgreSQL with Row-Level Security (RLS)
- **Object Storage**: OCI Object Storage for documents
- **Secrets**: OCI Vault for JWT_SECRET, PDPL keys
- **CDN**: OCI Edge for frontend assets
- **Vector DB**: pgvector extension on PostgreSQL

## 14. Dependencies

### Frontend (package.json)

| Package | Version | Purpose |
|---|---|---|
| react | ^19 | UI library |
| react-dom | ^19 | DOM rendering |
| react-router-dom | ^7 | Client-side routing |
| axios | ^1 | HTTP client |
| vite | ^6 | Dev server & build tool |
| typescript | ~5.8 | Type checking |

### Backend (grc_wisdom_api/package.json)

| Package | Version | Purpose |
|---|---|---|
| express | ^4 | HTTP framework |
| @prisma/client | ^6 | ORM |
| prisma | ^6 | Schema management |
| prisma-adapter-node-sqlite | * | SQLite adapter |
| cors | ^2 | CORS middleware |
| helmet | ^8 | Security headers |
| jsonwebtoken | ^9 | JWT signing/verification |
| bcryptjs | ^2 | Password hashing |
| zod | ^3 | Schema validation |
| otplib | ^12 | TOTP/MFA |
| qrcode | ^1 | QR code generation |

## 15. Critical Files — Quick Reference

| Purpose | File |
|---|---|
| Frontend router | `src/App.tsx` |
| Auth state | `src/context/AuthContext.tsx` |
| Mock rendering engine | `src/utils/appMockEngine.js` |
| All mock seed data | `src/utils/mockData.ts` |
| Portal directory UI | `src/pages/PortalDirectory.tsx` |
| Portal login UI | `src/pages/PortalLogin.tsx` |
| Main dashboard shell | `src/pages/AppShell.tsx` |
| Entire CSS design system | `src/index.css` |
| Backend entry point | `grc_wisdom_api/src/server.ts` |
| Express app config | `grc_wisdom_api/src/app.ts` |
| Database schema | `grc_wisdom_api/prisma/schema.prisma` |
| Database seed | `grc_wisdom_api/src/seed.ts` |
| Technical requirements | `GRC_Wisdom_TRD_Production_Readiness_v1.md` |

## 16. Known Issues & Technical Debt

1. **No route files**: The `routes/` directory is empty. All 8 controllers are unreachable.
2. **Dual auth systems**: Mock (localStorage persona) and real (JWT) coexist but never intersect.
3. **245KB mockData.ts**: Single-line JSON blob with 156 BRD requirements embedded inline.
4. **appMockEngine.js returns raw HTML strings**: Rendered via `dangerouslySetInnerHTML` — XSS risk if data is untrusted.
5. **No `.env` file**: JWT_SECRET, PDPL_ENCRYPTION_KEY are hardcoded or missing.
6. **SQLite in dev**: No PostgreSQL migration or RLS policies exist yet.
7. **No tests**: Zero unit, integration, or e2e tests.
8. **Unused pages**: `LoginGateway.tsx` and `SaasPortal.tsx` are not in the router.
9. **i18n skeleton**: Only 4 translation keys per locale (en/ar).
10. **ZATCA utils are mock-only**: XML builder uses placeholder data, crypto generates ephemeral keys.

## 17. Glossary

| Term | Meaning |
|---|---|
| **WORM** | Write-Once-Read-Many — audit log records cannot be modified or deleted |
| **PDPL** | Saudi Personal Data Protection Law |
| **ZATCA** | Saudi Zakat, Tax and Customs Authority — electronic invoicing |
| **NCA ECC** | National Cybersecurity Authority Essential Controls |
| **ASM** | Attack Surface Management (Wisdom Eye) |
| **SoD** | Segregation of Duties — prevents self-approval |
| **RLS** | Row-Level Security — PostgreSQL feature for tenant isolation |
| **TLV** | Tag-Length-Value encoding for ZATCA QR codes |
| **Materialized Path** | Hierarchical tree encoding: `/GROUP/ORG/BRANCH/` |
| **RAG** | Retrieval-Augmented Generation — AI architecture pattern |
