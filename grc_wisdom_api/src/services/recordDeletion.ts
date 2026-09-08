/**
 * Whether a record may be deleted outright, and what to say when it may not.
 *
 * Almost every register in this product is create-only today: you can add a
 * risk, an asset, a vendor, a KRI, and then you are stuck with it. The obvious
 * fix is to add DELETE everywhere, and it is the wrong one. Half of these rows
 * are audit evidence, and the schema will help you destroy them without a
 * murmur -- Risk alone cascades to its treatments, its score snapshots, its
 * control links and its asset links, so one DELETE takes out the entire record
 * of how a risk was managed and leaves the register looking like it never
 * existed.
 *
 * The other half genuinely is junk: a duplicate entered twice, a typo caught a
 * minute later, a test row. Refusing to remove those is its own failure -- it
 * is why registers fill with rows nobody trusts.
 *
 * So the rule is: a record may be hard-deleted while nothing has happened to
 * it. Once anything has -- a treatment, an assessment, a reading, a link, a
 * review -- the deletion is refused and the caller is told exactly what is
 * attached and what to do instead. The refusal is the useful part. "Cannot
 * delete" teaches nobody anything; "3 treatments and 2 control links reference
 * this risk; close it instead" does.
 *
 * Pure, so it is tested without a database.
 */

/** One kind of thing hanging off the record, and how many there are. */
export type Dependant = {
  /** Plural noun as a user would say it: "treatments", "linked controls". */
  label: string;
  count: number;
};

export type DeletionVerdict =
  | { allowed: true }
  | {
    allowed: false;
    /** Machine-readable so the frontend can react without matching on prose. */
    code: 'RECORD_HAS_HISTORY' | 'RECORD_STATUS_FORBIDS_DELETE';
    message: string;
    dependants: Dependant[];
    /** What the user should do instead. Always populated on a refusal. */
    alternative: string;
  };

/** Renders "3 treatments, 1 linked control" — only the non-empty ones. */
export function describeDependants(dependants: Dependant[]): string {
  const present = dependants.filter((d) => d.count > 0);
  if (present.length === 0) return '';
  const parts = present.map((d) => `${d.count} ${d.label}`);
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function judgeDeletion(opts: {
  /** How the record is named in the refusal: "risk", "vendor assessment". */
  recordLabel: string;
  dependants: Dependant[];
  /**
   * Statuses from which deletion is refused regardless of dependants.
   *
   * A risk somebody formally accepted, or an audit that has been through
   * fieldwork, is a decision on the record. It stops being deletable the moment
   * it is taken, not when the first child row appears.
   */
  status?: string;
  forbiddenStatuses?: readonly string[];
  /** What to do instead. Named, not implied — "use the other thing" helps nobody. */
  alternative: string;
}): DeletionVerdict {
  const { recordLabel, dependants, status, forbiddenStatuses, alternative } = opts;

  if (status && forbiddenStatuses && forbiddenStatuses.includes(status)) {
    return {
      allowed: false,
      code: 'RECORD_STATUS_FORBIDS_DELETE',
      message: `This ${recordLabel} is ${status}, which is a decision on the record rather than a draft. `
        + `Deleting it would remove the evidence that the decision was ever taken. ${alternative}`,
      dependants: dependants.filter((d) => d.count > 0),
      alternative,
    };
  }

  const attached = dependants.filter((d) => d.count > 0);
  if (attached.length > 0) {
    return {
      allowed: false,
      code: 'RECORD_HAS_HISTORY',
      message: `This ${recordLabel} has ${describeDependants(attached)} attached. `
        + `Deleting it would remove ${attached.length === 1 ? 'that' : 'those'} too, `
        + `and that history is what shows how the ${recordLabel} was managed. ${alternative}`,
      dependants: attached,
      alternative,
    };
  }

  return { allowed: true };
}
