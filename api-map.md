# GRC Wisdom — API Map (`api-map.md`)

> **Generated**: 2026-07-27 — verified against `app.ts`, all controllers, all middlewares.

---

## 1. Active Endpoints

### `GET /health`

**File**: `app.ts:24-30`  
**Auth**: None  
**Response**:
```json
{
  "status": "success",
  "message": "GRC Wisdom API is running.",
  "timestamp": "2026-07-27T12:00:00.000Z"
}
```

---

### `GET /api/data`

**File**: `app.ts:35-96`  
**Auth**: None  
**Purpose**: Returns ALL platform data from the Prisma database. This is the **only data endpoint** currently used by the frontend.

**Database Queries** (7 parallel `findMany`):
- `prisma.user.findMany({ include: { tenant: true } })`
- `prisma.document.findMany()`
- `prisma.ticket.findMany()`
- `prisma.openSourceTool.findMany()`
- `prisma.asmAsset.findMany()`
- `prisma.phishCampaign.findMany()`
- `prisma.tenant.findMany()`

**Response Shape**:
```json
{
  "accounts": [...],       // Users mapped with portal/scope/color fields
  "platformUsers": [...],  // Same as accounts
  "docs": [...],           // Documents
  "tickets": [...],        // ITSM tickets
  "openTools": [...],      // Open-source marketplace tools
  "asmAssets": [...],      // Attack surface assets
  "phishCampaigns": [...], // Phishing campaigns
  "logs": [],              // Empty (not yet populated)
  "invoicesV3": []         // Empty (not yet populated)
}
```

**Portal Mapping Logic** (app.ts:69-76):
```typescript
portal: u.context === 'GRC Wisdom SaaS Control Plane' ? 'saas' :
        u.context === 'Al Noor Holding Group' ? 'holding' :
        u.context === 'OmniOps' ? 'multibranch' :
        u.context === 'Hayat National Hospital — Madinah' ? 'branch' :
        u.context === 'Global Bank — Information Security' ? 'document' :
        u.context === 'GRC Consulting Partners' ? 'partner' :
        u.context === 'RetailCo Franchise Network' ? 'franchise' :
        u.email === 'marcus.thorne@auditco.com' ? 'auditor' : 'saas'
```

---

## 2. Controller Functions (Not Yet Mounted as Routes)

### Tenant Controller (`tenantController.ts`)

#### `getEntityTree`
- **Purpose**: Returns the tenant hierarchy tree for the authenticated user's scope
- **Expected Route**: `GET /api/tenants/tree`
- **Auth**: `authMiddleware` + `hierarchyMiddleware`
- **Current State**: Returns mock tree data (Prisma calls commented out)

#### `distributePolicy`
- **Purpose**: Clones a document to all descendant tenant entities
- **Expected Route**: `POST /api/tenants/distribute`
- **Body**: `{ documentId: string }`
- **Auth**: `authMiddleware`
- **Current State**: Returns mock success message

---

### Document Controller (`documentController.ts`)

#### `checkOutDocument`
- **Purpose**: Locks a document for editing by the current user
- **Expected Route**: `POST /api/documents/:documentId/checkout`
- **Auth**: `authMiddleware`
- **Current State**: Returns mock success message

#### `checkInDocument`
- **Purpose**: Unlocks a document, creates a new version
- **Expected Route**: `POST /api/documents/:documentId/checkin`
- **Body**: `{ newVersionFileUrl: string, fileHash: string }`
- **Auth**: `authMiddleware`
- **Current State**: Returns mock success message

#### `submitESignature`
- **Purpose**: Verifies MFA token and creates a cryptographic approval signature
- **Expected Route**: `POST /api/approvals/:approvalId/sign`
- **Body**: `{ mfaToken: string }`
- **Auth**: `authMiddleware`
- **Signature Generation**: `SHA-256(APPROVAL_{id}_USER_{userId}_TIME_{timestamp})`
- **Current State**: MFA verification commented out; returns mock signature

---

### Auditor Controller (`auditorController.ts`)

#### `exportAuditLogs`
- **Purpose**: Exports audit logs as CSV for the tenant
- **Expected Route**: `GET /api/audit/export`
- **Auth**: `authMiddleware`
- **Response**: `Content-Type: text/csv` with attachment header
- **Current State**: Returns mock CSV data

#### `runTamperDetectionJob` (Background Job)
- **Purpose**: Verifies the mathematical hash chain integrity of audit logs
- **Not an HTTP endpoint** — designed to be called by a scheduler
- **Current State**: Validates mock chain data

---

### AI Controller (`aiController.ts`)

#### `askAiComplianceQuestion`
- **Purpose**: RAG-based compliance Q&A — embeds question, retrieves context chunks, calls LLM
- **Expected Route**: `POST /api/ai/ask`
- **Body**: `{ question: string }`
- **Auth**: `authMiddleware` + `aiQuotaLimiter`
- **Pipeline**: `generateEmbeddingMock()` → vector search (mock) → `callLlmMock(prompt)`
- **Current State**: Returns mock AI response with hardcoded context chunks

---

### Subscription Controller (`subscriptionController.ts`)

#### `createSubscription`
- **Purpose**: Creates a new subscription for a tenant
- **Expected Route**: `POST /api/subscriptions`
- **Body**: `{ planId: string }`
- **Auth**: `authMiddleware`
- **Current State**: Returns mock subscription object

---

### Plan Controller (`planController.ts`)

#### `getPlans`
- **Purpose**: Lists all available commercial plans
- **Expected Route**: `GET /api/plans`
- **Auth**: None (public)
- **Current State**: Returns hardcoded array: Essentials ($1,500), Professional ($4,500), Enterprise ($12,000)

#### `createPlan`
- **Purpose**: Creates a new pricing plan
- **Expected Route**: `POST /api/plans`
- **Body**: `{ name, priceMonthly, maxUsers, features }`
- **Current State**: Returns mock plan object

---

### API Keys Controller (`apiKeysController.ts`)

#### `generateApiKey`
- **Purpose**: Generates a new API key for external integrations
- **Expected Route**: `POST /api/keys`
- **Body**: `{ name: string, scopes: string[] }`
- **Auth**: `authMiddleware`
- **Key Format**: `grc_live_` + 32 random hex bytes
- **Storage**: SHA-256 hash stored (never raw key)
- **Current State**: Returns raw key (show-once pattern)

---

### Webhooks Controller (`webhooksController.ts`)

#### `registerWebhook`
- **Purpose**: Registers an external URL to receive event notifications
- **Expected Route**: `POST /api/webhooks`
- **Body**: `{ url: string, events: string[] }`
- **Auth**: `authMiddleware`
- **Secret**: 32 random hex bytes for HMAC SHA-256 signing
- **Current State**: Returns mock webhook config

---

## 3. Middleware API

| Middleware | Injection | Effect on `req` | Effect on `res` |
|---|---|---|---|
| `authMiddleware` | Route-level | Adds `req.user: { id, role, tenantId }` | 401 if invalid token |
| `auditMiddleware` | Route-level | None | Intercepts `res.json()` to log action with hash chain |
| `hierarchyMiddleware` | Route-level | None | 403 if requester's path doesn't contain target path |
| `apiKeyMiddleware` | Route-level | Adds `req.apiKey: { tenantId, scopes }` | 401 if invalid key |
| `i18nMiddleware` | Global | Adds `req.language`, `req.isRtl` | Sets `res.locals.locale` |
| `pdplScrubber` | Global | None | Replaces PII fields with `[REDACTED FOR PDPL COMPLIANCE]` |
| `aiQuotaLimiter` | Route-level | None | 429 if usage >= 500 queries |
| `validateRequest` | Route-level | None | 400 with Zod errors if validation fails |

---

## 4. Utility Functions (Non-HTTP)

| Module | Function | Purpose |
|---|---|---|
| `cryptoUtils` | `generateHash(payload)` | SHA-256 hash |
| `cryptoUtils` | `verifyHashChain(prev, payload, expected)` | Chain integrity check |
| `mfaUtils` | `generateMfaSecret(email)` | TOTP secret + otpauth URL |
| `mfaUtils` | `generateQrCodeUrl(otpauthUrl)` | QR data URL |
| `mfaUtils` | `verifyMfaToken(token, secret)` | TOTP verification |
| `llmUtils` | `generateEmbeddingMock(text)` | Mock 1536-dim vector |
| `llmUtils` | `callLlmMock(prompt)` | Mock LLM response |
| `pdplUtils` | `encryptPii(text)` | AES-256-GCM encrypt |
| `pdplUtils` | `decryptPii(encrypted)` | AES-256-GCM decrypt |
| `treeUtils` | `generateMaterializedPath(parent, id)` | Build path string |
| `treeUtils` | `isDescendant(requester, target)` | Check hierarchy |
| `anomalyDetector` | `detectRiskAnomalies(tenantId)` | Z-Score analysis |
| `rollupUtils` | `calculateScorecardRollup(scores)` | Aggregate risk scores |
| `summaryGenerator` | `generateExecutiveSummary(scores)` | AI-powered CEO brief |
| `webhookDispatcher` | `dispatchWebhook(url, secret, event, payload)` | HMAC-signed POST |
| `webhookDispatcher` | `triggerDocumentPublishedEvent(tenantId, data)` | Document event dispatch |
| `zatcaXmlBuilder` | `buildZatcaInvoiceXml(data)` | UBL 2.1 XML |
| `zatcaCrypto` | `signZatcaInvoice(xml)` | ECDSA signature |
| `zatcaQrUtils` | `generateZatcaQr(seller, vat, time, total, vatAmt)` | TLV QR code |
