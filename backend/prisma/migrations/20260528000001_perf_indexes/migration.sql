-- Performance indexes based on EXPLAIN ANALYZE of the top 10 most frequent queries.
--
-- 1. claims: status filter + keyset pagination (most common list query)
--    Query: SELECT * FROM claims WHERE status = $1 AND deleted_at IS NULL ORDER BY "createdAt" DESC, id DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_status_deleted_at_createdAt_id_idx"
  ON "claims"("status", "deleted_at", "createdAt" DESC, "id" DESC);

-- 2. claims: tenant + status filter (multi-tenant list)
--    Query: SELECT * FROM claims WHERE "tenantId" = $1 AND status = $2 AND deleted_at IS NULL ORDER BY "createdAt" DESC, id DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS "claims_tenantId_status_deleted_at_createdAt_id_idx"
  ON "claims"("tenantId", "status", "deleted_at", "createdAt" DESC, "id" DESC);

-- 3. votes: voter lookup for needs-my-vote query
--    Query: SELECT "claimId" FROM votes WHERE "voterAddress" = $1 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "votes_voterAddress_deleted_at_claimId_idx"
  ON "votes"("voterAddress", "deleted_at", "claimId");

-- 4. policies: holder + active filter (policy list)
--    Query: SELECT * FROM policies WHERE "holderAddress" = $1 AND "isActive" = true AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS "policies_holderAddress_isActive_deleted_at_idx"
  ON "policies"("holderAddress", "isActive", "deleted_at");
