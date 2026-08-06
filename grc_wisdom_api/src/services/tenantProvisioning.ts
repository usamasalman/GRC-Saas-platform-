/**
 * Structural rules for growing the tenant tree.
 *
 * A customer administrator may create entities beneath themselves, but the
 * shape has to stay meaningful: a branch is a leaf, a franchise network grows
 * locations, a holding group grows operating companies. Without a lattice,
 * self-service tenant creation would let anyone build arbitrary nesting that
 * the scope resolver was never designed to walk.
 */

export const TENANT_TYPES = [
  'SAAS', 'SAAS_UNIT', 'HOLDING', 'MULTIBRANCH', 'BRANCH', 'FRANCHISE', 'PARTNER',
] as const;

/** What each shape may create directly beneath itself. */
const ALLOWED_CHILDREN: Record<string, string[]> = {
  // The platform operator provisions any customer shape at the root.
  SAAS: ['HOLDING', 'MULTIBRANCH', 'BRANCH', 'FRANCHISE', 'PARTNER', 'SAAS_UNIT'],
  // Internal business units of the operator do not own customers.
  SAAS_UNIT: [],
  // A group grows operating companies and their sites.
  HOLDING: ['MULTIBRANCH', 'BRANCH'],
  // One legal entity grows branches.
  MULTIBRANCH: ['BRANCH'],
  // A network grows locations.
  FRANCHISE: ['BRANCH'],
  // A consultancy grows client workspaces.
  PARTNER: ['MULTIBRANCH', 'BRANCH'],
  // A leaf stays a leaf.
  BRANCH: [],
};

export function allowedChildTypes(parentType: string): string[] {
  return ALLOWED_CHILDREN[parentType] ?? [];
}

/**
 * Returns null when the pairing is legal, otherwise the reason it is not —
 * phrased for the administrator who attempted it.
 */
export function checkChildShape(parentType: string, childType: string): string | null {
  const allowed = allowedChildTypes(parentType);
  if (allowed.length === 0) {
    return `A ${parentType} entity cannot contain sub-entities.`;
  }
  if (!allowed.includes(childType)) {
    return `A ${parentType} entity may contain ${allowed.join(' or ')}, not ${childType}.`;
  }
  return null;
}
