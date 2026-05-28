-- Add GIN index for full-text search on claims.description
-- Used by: GET /admin/claims/search with full-text query
-- Query: SELECT * FROM claims WHERE to_tsvector('english', description) @@ plainto_tsquery('english', q) AND ...

CREATE INDEX IF NOT EXISTS "claims_description_search_idx"
  ON "claims" USING GIN(to_tsvector('english', COALESCE("description", '')));

-- Composite index for search with filters
CREATE INDEX IF NOT EXISTS "claims_search_composite_idx"
  ON "claims"("deletedAt", "status", "createdAt");
