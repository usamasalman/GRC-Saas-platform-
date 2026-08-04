# GRC Wisdom — Database Map (`database-map.md`)

> **Generated**: 2026-07-27 — verified against `prisma/schema.prisma` (304 lines) and `seed.ts`.

---

## 1. Database Engine

| Property | Value |
|---|---|
| **ORM** | Prisma 6 (`@prisma/client`) |
| **Dev Database** | SQLite via `prisma-adapter-node-sqlite` |
| **Connection** | `file:dev.db` (relative to `grc_wisdom_api/`) |
| **Production Target** | PostgreSQL with pgvector extension + Row-Level Security |

**Connection file**: `grc_wisdom_api/src/db.ts`
```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaNodeSQLite } from 'prisma-adapter-node-sqlite';

const adapter = new PrismaNodeSQLite({ url: 'file:dev.db' });
export const prisma = new PrismaClient({ adapter });
```

---

## 2. Complete Model Reference

### 2.1 Tenant

> Root entity for multi-tenancy. Uses materialized path for hierarchical queries.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | Auto-generated |
| `name` | String | Required | e.g., "Al Noor Holding Group" |
| `type` | String | Required | HOLDING, SAAS, MULTIBRANCH, PARTNER |
| `parentId` | String? | FK → Tenant.id | Self-referential hierarchy |
| `path` | String | Default: "/" | Materialized path: `/GROUP_1/ORG_2/` |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

**Relations**: `parent`, `children` (self), `users`, `subscriptions`, `invoices`, `auditLogs`, `documents`, `apiKeys`, `webhooks`, `riskSnapshots`, `tickets`, `asmAssets`, `phishCampaigns`

---

### 2.2 User

> Core identity model. PDPL-compliant with encrypted PII fields.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `email` | String | UNIQUE | Login credential |
| `name` | String | Required | Display name |
| `passwordHash` | String | Required | bcrypt hash (mock: "mock-hash") |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `role` | String | Required | e.g., "SUPER_ADMIN", "SECURITY_ADMIN" |
| `profile` | String? | | e.g., "Platform Owner" |
| `context` | String? | | Organization name |
| `branch` | String? | | Branch name |
| `department` | String? | | Department name |
| `status` | String | Default: "Active" | Active, Suspended, etc. |
| `mfaEnabled` | Boolean | Default: false | Phase 1: MFA |
| `mfaSecret` | String? | | TOTP secret |
| `backupCodes` | String? | | JSON string array |
| `encryptedNationalId` | String? | | AES-256-GCM encrypted (PDPL) |
| `encryptedPhone` | String? | | AES-256-GCM encrypted (PDPL) |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

**Relations**: `tenant`, `auditLogs`, `documentsOwned`, `approvals`, `ticketsAssigned`, `ticketsRequested`

---

### 2.3 Plan

> Commercial pricing tiers.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `name` | String | Required | Essentials, Professional, Enterprise |
| `priceMonthly` | Decimal | Required | In SAR |
| `maxUsers` | Int | Required | User quota |
| `features` | String | Required | JSON string of feature flags |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

**Relations**: `subscriptions`

---

### 2.4 Subscription

> Links a Tenant to a Plan.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `planId` | String | FK → Plan.id | |
| `status` | String | Required | ACTIVE, PENDING, CANCELLED |
| `startDate` | DateTime | Default: now() | |
| `endDate` | DateTime? | | Null = indefinite |

---

### 2.5 Invoice

> ZATCA-compliant invoicing.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `amount` | Decimal | Required | |
| `currency` | String | Default: "SAR" | |
| `status` | String | Required | PAID, UNPAID |
| `zatcaXml` | String? | | UBL 2.1 XML content |
| `zatcaHash` | String? | | SHA-256 of XML |
| `zatcaQr` | String? | | TLV Base64 QR string |
| `isCleared` | Boolean | Default: false | ZATCA clearance status |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.6 AuditLog ⚠️ WORM

> Immutable audit trail with cryptographic hash chaining.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `actorId` | String? | FK → User.id | SetNull on user delete |
| `action` | String | Required | DOCUMENT_PUBLISHED, MFA_ENABLED, etc. |
| `payload` | String | Required | JSON string of event data |
| `previousHash` | String | Required | Links to previous log's currentHash |
| `currentHash` | String | UNIQUE | SHA-256(previousHash + payload) |
| `timestamp` | DateTime | Default: now() | |
| `wormLocked` | Boolean | Default: true | Prevents modification |

**Integrity verification**: `cryptoUtils.verifyHashChain(previousHash, payload, currentHash)`

---

### 2.7 Document

> Enterprise document with version control and approval workflow.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `code` | String | Required | e.g., "POL-SEC-001" |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `ownerId` | String | FK → User.id | |
| `title` | String | Required | |
| `category` | String | Required | Policy, Procedure, Report |
| `classification` | String | Required | Confidential, Internal, Restricted |
| `status` | String | Required | DRAFT, IN_REVIEW, PUBLISHED |
| `version` | String | Default: "1.0" | |
| `content` | String | Required | HTML content |
| `isLockedOut` | Boolean | Default: false | Check-out lock |
| `inheritedFromId` | String? | | Parent document for policy distribution |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

**Relations**: `tenant`, `owner`, `versions`, `approvals`, `chunks`

---

### 2.8 DocumentVersion

> Version history for documents.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `documentId` | String | FK → Document.id | Cascade delete |
| `versionNumber` | String | Required | |
| `summary` | String? | | Change description |
| `content` | String? | | Full content snapshot |
| `fileUrl` | String? | | Object storage URL |
| `fileHash` | String? | | SHA-256 of file |
| `createdAt` | DateTime | Auto | |

---

### 2.9 ApprovalQueue

> Sequential approval workflow with e-signature.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `documentId` | String | FK → Document.id | Cascade delete |
| `approverId` | String | FK → User.id | |
| `sequenceOrder` | Int | Required | Approval sequence position |
| `status` | String | Required | PENDING, APPROVED, REJECTED |
| `signatureHash` | String? | | SHA-256 cryptographic signature (MFA-verified) |
| `reviewedAt` | DateTime? | | |
| `createdAt` | DateTime | Auto | |

---

### 2.10 Ticket

> ITSM service management.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `requesterId` | String | FK → User.id | |
| `assigneeId` | String? | FK → User.id | |
| `type` | String | Required | Incident, Service Request, Security Event |
| `service` | String | Required | e.g., "Document Management" |
| `subject` | String | Required | |
| `description` | String | Required | |
| `priority` | String | Required | P1 Critical, P2 High, P3 Medium, P4 Low |
| `status` | String | Required | New, In Progress, Pending Customer, Resolved |
| `assignedTeam` | String? | | |
| `sla` | String? | | e.g., "8 business hours" |
| `dueAt` | DateTime? | | |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.11 OpenSourceTool

> Curated marketplace of security tools.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `name` | String | Required | e.g., "Wazuh", "OWASP ZAP" |
| `category` | String | Required | SIEM/XDR, Application Security, etc. |
| `license` | String | Required | GPLv2, Apache-2.0, etc. |
| `maturity` | String | Required | Approved, Pilot, Under Review |
| `review` | String | Required | Security Review Passed, etc. |
| `deployment` | String | Required | Deployment model description |
| `description` | String | Required | |
| `annualPrice` | Decimal | Required | In SAR |
| `risk` | String | Required | Low, Medium, High |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.12 AsmAsset

> Wisdom Eye — Attack Surface Management assets.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `asset` | String | Required | Domain, URL, IP |
| `type` | String | Required | Root Domain, Web Application, etc. |
| `owner` | String | Required | |
| `authorization` | String | Required | Approved, Pending |
| `score` | Int | Required | 0-100 security score |
| `critical` | Int | Required | Critical vulnerability count |
| `high` | Int | Required | High vulnerability count |
| `lastScan` | DateTime | Required | |
| `branch` | String | Required | |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.13 PhishCampaign

> Eye Phish — phishing simulation campaigns.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `name` | String | Required | Campaign name |
| `scope` | String | Required | Target population |
| `scenario` | String | Required | Credential Harvest, BEC, QR, Attachment |
| `language` | String | Required | English, Arabic, etc. |
| `targets` | Int | Required | Number of targeted users |
| `status` | String | Required | Completed, Scheduled, Approval Required |
| `failureRate` | Float | Required | % who fell for phish |
| `reportRate` | Float | Required | % who reported phish |
| `remediation` | Float | Required | Remediation metric |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.14 ApiKey

> External API authentication for partner integrations.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `name` | String | Required | Key description |
| `keyHash` | String | UNIQUE | SHA-256 hash of raw key |
| `secretPrefix` | String | Required | First 8-16 chars for identification |
| `scopes` | String | Required | JSON array: ["read:risks", "write:documents"] |
| `isActive` | Boolean | Default: true | |
| `expiresAt` | DateTime? | | |
| `lastUsedAt` | DateTime? | | |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.15 WebhookEndpoint

> External event notification endpoints.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `url` | String | Required | External partner URL |
| `secret` | String | Required | HMAC SHA-256 signing secret |
| `events` | String | Required | JSON array: ["document.published"] |
| `isActive` | Boolean | Default: true | |
| `createdAt` | DateTime | Auto | |
| `updatedAt` | DateTime | Auto | |

---

### 2.16 DocumentChunk (Phase 5: AI)

> Chunked document content for vector search (RAG).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `documentId` | String | FK → Document.id | Cascade delete |
| `content` | String | Required | Text chunk |
| `vectorMock` | String | Required | In prod: `vector(1536)` via pgvector |
| `createdAt` | DateTime | Auto | |

---

### 2.17 RiskScoreSnapshot (Phase 5: Analytics)

> Time-series risk data for anomaly detection.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, UUID | |
| `tenantId` | String | FK → Tenant.id | Cascade delete |
| `score` | Float | Required | 0.0 to 100.0 |
| `recordedAt` | DateTime | Default: now() | |

---

## 3. Seed Data Summary

**File**: `grc_wisdom_api/src/seed.ts`

| Entity | Source | Count | Notes |
|---|---|---|---|
| Tenants | `GW_DATA.accounts` → unique contexts | ~7 | Auto-deduped from account contexts |
| Users | `GW_DATA.platformUsers` + `GW_DATA.accounts` | ~65 | Fallback ensures no duplicates |
| Documents | `GW_DATA.docs` | ~4 | Matched to owner by name |
| Tickets | `GW_DATA.tickets` | ~7 | Matched to requester/assignee by name |
| OpenSourceTools | `GW_DATA.openTools` | ~10 | No tenant association |
| AsmAssets | `GW_DATA.asmAssets` | ~6 | Tenant-scoped |
| PhishCampaigns | `GW_DATA.phishCampaigns` | ~4 | Tenant-scoped |

---

## 4. Migration Gaps (SQLite → PostgreSQL)

| Feature | SQLite (Current) | PostgreSQL (Target) |
|---|---|---|
| Row-Level Security | ❌ Not supported | ✅ `CREATE POLICY` per table |
| Vector columns | String mock (`vectorMock`) | `vector(1536)` via pgvector |
| WORM enforcement | Application-level (`wormLocked` flag) | Database-level trigger |
| Decimal precision | Limited | Full `NUMERIC` precision |
| Concurrent writes | Limited (file locks) | Full MVCC |
| Full-text search | Not available | `tsvector` + `GIN` index |
| Connection pooling | N/A (embedded) | PgBouncer / Prisma pooling |
