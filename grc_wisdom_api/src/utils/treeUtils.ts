/**
 * Generates a Materialized Path for a new Tenant.
 * Used for extremely fast hierarchical database queries using SQL LIKE.
 */
export const generateMaterializedPath = (parentPath: string | null, newTenantId: string): string => {
  if (!parentPath) {
    // This is a Root Tenant (e.g., Holding Company)
    return `/${newTenantId}/`;
  }
  // This is a Child Tenant (e.g., Subsidiary or Branch)
  return `${parentPath}${newTenantId}/`;
};

/**
 * Checks if a target path is a descendant of a requester's path.
 * In SQL, this is equivalent to: WHERE target.path LIKE 'requester.path%'
 */
export const isDescendant = (requesterPath: string, targetPath: string): boolean => {
  return targetPath.startsWith(requesterPath);
};
