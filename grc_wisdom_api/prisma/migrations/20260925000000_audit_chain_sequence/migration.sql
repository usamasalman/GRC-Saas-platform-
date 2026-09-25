-- The audit chain forked whenever audited requests arrived together (QA-029).
--
-- writeAudit read an organisation's last entry and chained the new one to it,
-- with nothing stopping a second request reading the same entry at the same
-- moment. Both then chained to it: each entry intact, the chain no longer one
-- line, and every verifier reporting TAMPERED on records nobody changed. One
-- platform screen sends several audited requests at once, so this happened in
-- ordinary use.
--
-- chainSeq is the entry's position in its organisation's chain. writeAudit now
-- assigns it under a per-organisation lock, and the unique index below makes a
-- second entry at the same position fail loudly rather than fork quietly.
--
-- Existing entries are numbered in the order the verifier already read them
-- (when they landed, then id), so a chain that verified before verifies the
-- same way now. They are marked orderInferred: a fork among them happened
-- before appends were serialised, and the verifier reports it as a fork with
-- each entry intact, not as tampering. A fork among entries written from here
-- on is tampering.
--
-- Additive only: two columns and an index; no row is removed or rewritten
-- beyond receiving its position.
ALTER TABLE "AuditLog" ADD COLUMN "chainSeq" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN "orderInferred" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AuditLog" AS a
SET "chainSeq" = o.seq, "orderInferred" = true
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "timestamp", "id") AS seq
  FROM "AuditLog"
) AS o
WHERE a."id" = o."id";

CREATE UNIQUE INDEX "AuditLog_tenantId_chainSeq_key" ON "AuditLog"("tenantId", "chainSeq");
