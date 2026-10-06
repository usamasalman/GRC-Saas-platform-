-- Consulting engagement, sprint 10: gap assessment and the context register.
--
-- Additive: clause assessments (one current per clause, entity and
-- engagement; earlier ones kept as history), three nullable columns on Issue
-- for a gap's engagement, clause and type, and the context and
-- interested-parties register with the risks each entry bears on.

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "clauseId" TEXT,
ADD COLUMN     "gapType" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "ClauseAssessment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "gapType" TEXT,
    "issueId" TEXT,
    "assessedById" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ClauseAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "relevance" TEXT NOT NULL,
    "requirements" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Accepted',
    "projectId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ContextEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextEntryRisk" (
    "contextEntryId" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,

    CONSTRAINT "ContextEntryRisk_pkey" PRIMARY KEY ("contextEntryId","riskId")
);

-- CreateIndex
CREATE INDEX "ClauseAssessment_projectId_tenantId_clauseId_supersededAt_idx" ON "ClauseAssessment"("projectId", "tenantId", "clauseId", "supersededAt");

-- CreateIndex
CREATE INDEX "ContextEntry_tenantId_status_idx" ON "ContextEntry"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ContextEntry_projectId_idx" ON "ContextEntry"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContextEntry_tenantId_ref_key" ON "ContextEntry"("tenantId", "ref");

-- CreateIndex
CREATE INDEX "ContextEntryRisk_riskId_idx" ON "ContextEntryRisk"("riskId");

-- CreateIndex
CREATE INDEX "Issue_projectId_idx" ON "Issue"("projectId");

-- AddForeignKey
ALTER TABLE "ClauseAssessment" ADD CONSTRAINT "ClauseAssessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClauseAssessment" ADD CONSTRAINT "ClauseAssessment_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "StandardClause"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClauseAssessment" ADD CONSTRAINT "ClauseAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntryRisk" ADD CONSTRAINT "ContextEntryRisk_contextEntryId_fkey" FOREIGN KEY ("contextEntryId") REFERENCES "ContextEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntryRisk" ADD CONSTRAINT "ContextEntryRisk_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One current assessment of a clause, per entity, per engagement.
CREATE UNIQUE INDEX "ClauseAssessment_one_current" ON "ClauseAssessment"("projectId", "tenantId", "clauseId") WHERE "supersededAt" IS NULL;
