-- Consulting engagement, sprint 11: risk and asset challenges, and proposals.
--
-- Additive: proposals for the register, kept apart from it so no figure
-- counts them until accepted; and challenges to a risk's or an asset's
-- scores, which no figure reads until the owner decides. One open challenge
-- per record per engagement.

-- CreateTable
CREATE TABLE "RegisterProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reason" TEXT NOT NULL,
    "category" TEXT,
    "likelihood" INTEGER,
    "impact" INTEGER,
    "confidentiality" INTEGER,
    "integrity" INTEGER,
    "availability" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'Proposed',
    "proposedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "riskId" TEXT,
    "assetId" TEXT,

    CONSTRAINT "RegisterProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterChallenge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "riskId" TEXT,
    "assetId" TEXT,
    "scoresBefore" TEXT NOT NULL,
    "scoresProposed" TEXT NOT NULL,
    "scoresAfter" TEXT,
    "reason" TEXT NOT NULL,
    "restingAssetId" TEXT,
    "restingControlId" TEXT,
    "restingLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,

    CONSTRAINT "RegisterChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegisterProposal_projectId_status_idx" ON "RegisterProposal"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterProposal_projectId_ref_key" ON "RegisterProposal"("projectId", "ref");

-- CreateIndex
CREATE INDEX "RegisterChallenge_projectId_status_idx" ON "RegisterChallenge"("projectId", "status");

-- CreateIndex
CREATE INDEX "RegisterChallenge_riskId_status_idx" ON "RegisterChallenge"("riskId", "status");

-- CreateIndex
CREATE INDEX "RegisterChallenge_assetId_status_idx" ON "RegisterChallenge"("assetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RegisterChallenge_projectId_ref_key" ON "RegisterChallenge"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "RegisterProposal" ADD CONSTRAINT "RegisterProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterProposal" ADD CONSTRAINT "RegisterProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterProposal" ADD CONSTRAINT "RegisterProposal_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChallenge" ADD CONSTRAINT "RegisterChallenge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChallenge" ADD CONSTRAINT "RegisterChallenge_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChallenge" ADD CONSTRAINT "RegisterChallenge_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChallenge" ADD CONSTRAINT "RegisterChallenge_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChallenge" ADD CONSTRAINT "RegisterChallenge_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One open challenge of a record per engagement.
CREATE UNIQUE INDEX "RegisterChallenge_one_open_risk" ON "RegisterChallenge"("projectId", "riskId") WHERE "status" = 'Open' AND "riskId" IS NOT NULL;
CREATE UNIQUE INDEX "RegisterChallenge_one_open_asset" ON "RegisterChallenge"("projectId", "assetId") WHERE "status" = 'Open' AND "assetId" IS NOT NULL;
