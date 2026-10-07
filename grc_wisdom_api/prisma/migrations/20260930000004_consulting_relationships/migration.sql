-- Consulting engagement, sprint 4: relationship, invitation, the firm's
-- people and the delivery style.
--
-- A firm named on an engagement read all of it, with no invitation, no say
-- for the organisation over which of the firm's people, and no record of the
-- relationship. Now an engagement's firm is invited (to its organisation, once,
-- for 14 days); the relationship is made when the firm first accepts; the
-- firm's Lead nominates people and the organisation approves each one; and
-- the organisation sets the delivery style. All of it behind the per-tenant
-- flag "Consulting Engagements".
--
-- Additive only: two new tables and nullable columns. Engagements that already
-- name a firm keep deliveryStyle null and behave exactly as before.

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deliveryStyle" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "accessFrom" TIMESTAMP(3),
ADD COLUMN     "accessTo" TIMESTAMP(3),
ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "engagementRole" TEXT,
ADD COLUMN     "memberStatus" TEXT,
ADD COLUMN     "nominatedAt" TIMESTAMP(3),
ADD COLUMN     "nominatedById" TEXT;

-- CreateTable
CREATE TABLE "ProviderRelationship" (
    "id" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "firmTenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "establishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "establishedByInvitationId" TEXT,

    CONSTRAINT "ProviderRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "firmTenantId" TEXT NOT NULL,
    "deliveryStyle" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "invitedById" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "EngagementInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderRelationship_firmTenantId_idx" ON "ProviderRelationship"("firmTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRelationship_clientTenantId_firmTenantId_key" ON "ProviderRelationship"("clientTenantId", "firmTenantId");

-- CreateIndex
CREATE INDEX "EngagementInvitation_projectId_status_idx" ON "EngagementInvitation"("projectId", "status");

-- CreateIndex
CREATE INDEX "EngagementInvitation_firmTenantId_status_idx" ON "EngagementInvitation"("firmTenantId", "status");

-- CreateIndex
CREATE INDEX "EngagementInvitation_clientTenantId_status_idx" ON "EngagementInvitation"("clientTenantId", "status");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_nominatedById_fkey" FOREIGN KEY ("nominatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRelationship" ADD CONSTRAINT "ProviderRelationship_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderRelationship" ADD CONSTRAINT "ProviderRelationship_firmTenantId_fkey" FOREIGN KEY ("firmTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_clientTenantId_fkey" FOREIGN KEY ("clientTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_firmTenantId_fkey" FOREIGN KEY ("firmTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_respondedById_fkey" FOREIGN KEY ("respondedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementInvitation" ADD CONSTRAINT "EngagementInvitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
