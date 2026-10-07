-- Consulting engagement, sprint 9: threads, document review and suggestions.
--
-- Additive: six new tables. A thread's visibility is fixed when it starts;
-- posts are never edited (a retraction keeps the words); a review is of one
-- version of a shared document; a suggestion is wording proposed for a
-- published version, pulled into the organisation's next version.

-- CreateTable
CREATE TABLE "DiscussionThread" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "subjectLabel" TEXT,
    "title" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "convertedToType" TEXT,
    "convertedToId" TEXT,
    "convertedToLabel" TEXT,
    "convertedAt" TIMESTAMP(3),
    "convertedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionPost" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retractedAt" TIMESTAMP(3),
    "retractedById" TEXT,
    "retractReason" TEXT,

    CONSTRAINT "DiscussionPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMention" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PostMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentReviewComment" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "quote" TEXT,
    "page" INTEGER,
    "body" TEXT NOT NULL,

    CONSTRAINT "DocumentReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSuggestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "currentWording" TEXT,
    "proposedWording" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "versionId" TEXT,
    "pulledAt" TIMESTAMP(3),
    "pulledById" TEXT,
    "wordingAppliedAt" TIMESTAMP(3),
    "acceptedInto" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionReason" TEXT,

    CONSTRAINT "DocumentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscussionThread_projectId_visibility_lastPostAt_idx" ON "DiscussionThread"("projectId", "visibility", "lastPostAt");

-- CreateIndex
CREATE INDEX "DiscussionThread_projectId_subjectType_subjectId_idx" ON "DiscussionThread"("projectId", "subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionThread_projectId_ref_key" ON "DiscussionThread"("projectId", "ref");

-- CreateIndex
CREATE INDEX "DiscussionPost_threadId_createdAt_idx" ON "DiscussionPost"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "PostMention_userId_idx" ON "PostMention"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PostMention_postId_userId_key" ON "PostMention"("postId", "userId");

-- CreateIndex
CREATE INDEX "DocumentReview_projectId_documentId_createdAt_idx" ON "DocumentReview"("projectId", "documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentReviewComment_reviewId_idx" ON "DocumentReviewComment"("reviewId");

-- CreateIndex
CREATE INDEX "DocumentSuggestion_documentId_status_idx" ON "DocumentSuggestion"("documentId", "status");

-- CreateIndex
CREATE INDEX "DocumentSuggestion_versionId_idx" ON "DocumentSuggestion"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSuggestion_projectId_ref_key" ON "DocumentSuggestion"("projectId", "ref");

-- AddForeignKey
ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionPost" ADD CONSTRAINT "DiscussionPost_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionPost" ADD CONSTRAINT "DiscussionPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMention" ADD CONSTRAINT "PostMention_postId_fkey" FOREIGN KEY ("postId") REFERENCES "DiscussionPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMention" ADD CONSTRAINT "PostMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReview" ADD CONSTRAINT "DocumentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentReviewComment" ADD CONSTRAINT "DocumentReviewComment_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "DocumentReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSuggestion" ADD CONSTRAINT "DocumentSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

