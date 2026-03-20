/**
 * Unified tenant context for multi-tenant path resolution.
 *
 * All modules that need tenant-scoped paths should use this single interface
 * instead of defining their own duplicates.
 */
export interface TenantContext {
  tenantId: string;
  userId: string;
}
