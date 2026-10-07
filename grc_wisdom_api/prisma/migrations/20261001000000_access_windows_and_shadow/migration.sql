-- Consulting engagement, sprint 5: access while on hold, access windows and
-- their notices, the firm's extension requests, and the engagement guard's
-- shadow refusals.
--
-- The hold records what the delivery firm may do while it lasts (asked when it
-- starts) and when the resume proposal was settled. Each firm member keeps the
-- two notices sent for their current end date and any extension they asked
-- for. EngagementShadowRefusal counts what the guard would have refused, with
-- IDs only, as diagnostics apart from the audit trail.
--
-- Additive only: one new table and nullable columns.

-- AlterTable
ALTER TABLE "ProjectHold" ADD COLUMN     "firmAccess" TEXT,
ADD COLUMN     "firmAccessNote" TEXT,
ADD COLUMN     "firmAccessSetAt" TIMESTAMP(3),
ADD COLUMN     "firmAccessSetById" TEXT,
ADD COLUMN     "windowsSettledAt" TIMESTAMP(3),
ADD COLUMN     "windowsSettledById" TEXT;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "accessEndNoticeAt" TIMESTAMP(3),
ADD COLUMN     "accessWarnedAt" TIMESTAMP(3),
ADD COLUMN     "extensionRequestNote" TEXT,
ADD COLUMN     "extensionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "extensionRequestedById" TEXT,
ADD COLUMN     "extensionRequestedTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EngagementShadowRefusal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientTenantId" TEXT NOT NULL,
    "firmTenantId" TEXT,
    "rule" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "EngagementShadowRefusal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EngagementShadowRefusal_clientTenantId_lastSeenAt_idx" ON "EngagementShadowRefusal"("clientTenantId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "EngagementShadowRefusal_lastSeenAt_idx" ON "EngagementShadowRefusal"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "EngagementShadowRefusal_projectId_rule_route_key" ON "EngagementShadowRefusal"("projectId", "rule", "route");

-- AddForeignKey
ALTER TABLE "ProjectHold" ADD CONSTRAINT "ProjectHold_firmAccessSetById_fkey" FOREIGN KEY ("firmAccessSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectHold" ADD CONSTRAINT "ProjectHold_windowsSettledById_fkey" FOREIGN KEY ("windowsSettledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_extensionRequestedById_fkey" FOREIGN KEY ("extensionRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementShadowRefusal" ADD CONSTRAINT "EngagementShadowRefusal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
