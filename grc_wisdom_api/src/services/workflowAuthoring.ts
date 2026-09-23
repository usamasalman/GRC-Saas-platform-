/**
 * Defining a workflow, and setting an SLA.
 *
 * Both halves of this were read-only. A workflow run could be decided,
 * cancelled and listed, but a definition could only arrive through the seed --
 * and `create-an-approval-or-automation-workflow` was granted to five roles
 * while guarding no route at all. The capability is enforced, but only as a
 * STEP's requiredCapability inside workflowEngine: it decides who may act on a
 * step, never who may author the thing the step belongs to. So the one grant
 * named after creating a workflow could not create one, and
 * capabilities-mean-something-test carried it on an allow-list reading
 * "workflow definitions cannot be created -- plan packet 6.4".
 *
 * SLA was the same shape: GET /sla reported how tickets were doing against
 * targets, POST /sla/scan re-ran the escalation sweep, and the targets
 * themselves -- the response and resolve minutes every one of those figures is
 * measured against -- could not be set.
 *
 * ── A definition is validated, not just stored ──────────────────────────────
 *
 * `steps` is a JSON string column. Storing whatever arrives means the first
 * sign of a malformed step is a run that cannot advance, discovered by the
 * person it was assigned to. Every step is parsed and checked here, where the
 * refusal names the step and what is wrong with it.
 *
 * Pure, and with no Prisma import, so every refusal runs without a database.
 */

/** Matches StepType in workflowEngine. */
export const STEP_TYPES = ['submit', 'review', 'approve', 'notify', 'wait', 'task'] as const;
export type StepType = (typeof STEP_TYPES)[number];

/** What a run can be about. */
export const SUBJECT_TYPES = ['Ticket', 'Document', 'AccessRequest', 'Change', 'Risk'] as const;

export const MAX_STEPS = 20;

export interface AuthoringRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

// ─── Steps ──────────────────────────────────────────────────────────────────

export interface StepDef {
  key: string;
  type: StepType;
  name: string;
  requiredCapability?: string;
  assigneeId?: string;
  dueInHours?: number;
  waitHours?: number;
  message?: string;
}

export interface StepsDecision {
  ok: true;
  steps: StepDef[];
}

/**
 * Parse and check the step array.
 *
 * `knownCapabilities` is passed in rather than imported so this stays pure --
 * and so a definition cannot name a capability the engine has never heard of,
 * which would make the step unassignable to anybody and the run permanently
 * stuck at it.
 */
export function parseSteps(
  raw: unknown,
  knownCapabilities: readonly string[],
): AuthoringRefusal | StepsDecision {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, status: 400, code: 'STEPS_NOT_JSON', message: 'The steps are not valid JSON.' };
    }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, status: 400, code: 'STEPS_NOT_A_LIST', message: 'Steps must be a list.' };
  }
  if (parsed.length === 0) {
    return {
      ok: false,
      status: 400,
      code: 'NO_STEPS',
      message: 'A workflow needs at least one step. A definition with none would start a run that is already finished.',
    };
  }
  if (parsed.length > MAX_STEPS) {
    return {
      ok: false,
      status: 400,
      code: 'TOO_MANY_STEPS',
      message: `A workflow has at most ${MAX_STEPS} steps; ${parsed.length} were given.`,
    };
  }

  const steps: StepDef[] = [];
  const keys = new Set<string>();

  for (let i = 0; i < parsed.length; i += 1) {
    const raw_ = parsed[i] as Record<string, unknown>;
    const where = `Step ${i + 1}`;

    if (!raw_ || typeof raw_ !== 'object') {
      return { ok: false, status: 400, code: 'BAD_STEP', message: `${where} is not an object.` };
    }

    const key = String(raw_.key ?? '').trim();
    if (!key) {
      return { ok: false, status: 400, code: 'STEP_KEY_REQUIRED', message: `${where} needs a key.` };
    }
    if (keys.has(key)) {
      return {
        ok: false,
        status: 400,
        code: 'STEP_KEY_REPEATED',
        message: `Two steps share the key "${key}". A run records its progress against the key, so it could not tell them apart.`,
      };
    }
    keys.add(key);

    const type = String(raw_.type ?? '').trim();
    if (!(STEP_TYPES as readonly string[]).includes(type)) {
      return {
        ok: false,
        status: 400,
        code: 'BAD_STEP_TYPE',
        message: `${where} has type "${type || 'none'}". It must be one of: ${STEP_TYPES.join(', ')}.`,
      };
    }

    const name = String(raw_.name ?? '').trim();
    if (!name) {
      return { ok: false, status: 400, code: 'STEP_NAME_REQUIRED', message: `${where} needs a name people will see in their inbox.` };
    }

    const step: StepDef = { key, type: type as StepType, name };

    const capability = raw_.requiredCapability ? String(raw_.requiredCapability).trim() : '';
    if (capability) {
      if (!knownCapabilities.includes(capability)) {
        return {
          ok: false,
          status: 400,
          code: 'UNKNOWN_CAPABILITY',
          message: `${where} requires "${capability}", which is not a capability this platform defines. Nobody could ever hold it, so the run would stop here for good.`,
        };
      }
      step.requiredCapability = capability;
    }

    const assignee = raw_.assigneeId ? String(raw_.assigneeId).trim() : '';
    if (assignee) step.assigneeId = assignee;

    // A step somebody has to act on needs somebody to act on it.
    const needsActor = type === 'review' || type === 'approve' || type === 'task';
    if (needsActor && !capability && !assignee) {
      return {
        ok: false,
        status: 400,
        code: 'STEP_HAS_NO_ACTOR',
        message: `${where} is a ${type} step with neither a required capability nor an assignee, so it would land in nobody's inbox and the run would stop there.`,
      };
    }

    for (const [field, value] of [['dueInHours', raw_.dueInHours], ['waitHours', raw_.waitHours]] as const) {
      if (value === undefined || value === null || value === '') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 8760) {
        return {
          ok: false,
          status: 400,
          code: 'BAD_STEP_HOURS',
          message: `${where} has ${field} of "${value}". It is a number of hours between 0 and 8760.`,
        };
      }
      if (field === 'dueInHours') step.dueInHours = Math.trunc(n);
      else step.waitHours = Math.trunc(n);
    }

    if (type === 'wait' && step.waitHours === undefined) {
      return {
        ok: false,
        status: 400,
        code: 'WAIT_NEEDS_HOURS',
        message: `${where} is a wait step with no waitHours, so it would hold the run for ever.`,
      };
    }

    if (raw_.message) step.message = String(raw_.message).trim();

    steps.push(step);
  }

  return { ok: true, steps };
}

// ─── The definition ─────────────────────────────────────────────────────────

export interface DefinitionDecision {
  ok: true;
  key: string;
  name: string;
  subjectType: string;
  steps: StepDef[];
}

export function planDefinition(input: {
  key: unknown;
  name: unknown;
  subjectType: unknown;
  steps: unknown;
  knownCapabilities: readonly string[];
  /** Keys already used in this tenant, excluding the one being edited. */
  takenKeys: readonly string[];
  /** True when editing a definition that arrived with the platform. */
  isSystem?: boolean;
}): AuthoringRefusal | DefinitionDecision {
  if (input.isSystem) {
    return {
      ok: false,
      status: 409,
      code: 'SYSTEM_DEFINITION',
      message: 'This workflow ships with the platform. Copy it to a new key rather than editing it, so an upgrade cannot quietly undo your change.',
    };
  }

  const key = String(input.key ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!key) {
    return { ok: false, status: 400, code: 'KEY_REQUIRED', message: 'A workflow needs a key, such as access-request-approval.' };
  }
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(key)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_KEY',
      message: 'A key is 2 to 64 characters of lowercase letters, numbers and hyphens.',
    };
  }
  if (input.takenKeys.map((k) => String(k).toLowerCase()).includes(key)) {
    return {
      ok: false,
      status: 409,
      code: 'KEY_TAKEN',
      message: `A workflow with key ${key} already exists here. Runs point at the key, so two would be indistinguishable.`,
    };
  }

  const name = String(input.name ?? '').trim();
  if (name.length < 3) {
    return { ok: false, status: 400, code: 'NAME_REQUIRED', message: 'A workflow needs a name somebody will recognise.' };
  }

  const subjectType = String(input.subjectType ?? '').trim();
  if (!(SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_SUBJECT_TYPE',
      message: `A workflow is about one of: ${SUBJECT_TYPES.join(', ')}.`,
    };
  }

  const steps = parseSteps(input.steps, input.knownCapabilities);
  if (!steps.ok) return steps;

  return { ok: true, key, name, subjectType, steps: steps.steps };
}

// ─── SLA policies ───────────────────────────────────────────────────────────

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

/** A week. Beyond this a "target" is not one. */
export const MAX_TARGET_MINS = 10_080;

export interface SlaDecision {
  ok: true;
  priority: string;
  responseMins: number;
  resolveMins: number;
}

export function planSlaPolicy(input: {
  priority: unknown;
  responseMins: unknown;
  resolveMins: unknown;
}): AuthoringRefusal | SlaDecision {
  const priority = String(input.priority ?? '').trim().toUpperCase();
  if (!(PRIORITIES as readonly string[]).includes(priority)) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_PRIORITY',
      message: `A policy applies to one of: ${PRIORITIES.join(', ')}.`,
    };
  }

  const nums: Record<string, number> = {};
  for (const field of ['responseMins', 'resolveMins'] as const) {
    const n = Number((input as Record<string, unknown>)[field]);
    if (!Number.isFinite(n) || Math.trunc(n) !== n) {
      return { ok: false, status: 400, code: 'BAD_TARGET', message: `${field} is a whole number of minutes.` };
    }
    if (n < 1) {
      return {
        ok: false,
        status: 400,
        code: 'TARGET_TOO_SHORT',
        message: 'A target of zero minutes is breached the moment a ticket is raised.',
      };
    }
    if (n > MAX_TARGET_MINS) {
      return {
        ok: false,
        status: 400,
        code: 'TARGET_TOO_LONG',
        message: `A target is at most ${MAX_TARGET_MINS} minutes — a week. Beyond that it is not a target.`,
      };
    }
    nums[field] = n;
  }

  if (nums.resolveMins < nums.responseMins) {
    return {
      ok: false,
      status: 400,
      code: 'RESOLVE_BEFORE_RESPONSE',
      message: 'A ticket cannot be resolved before it has been responded to, so the resolve target cannot be shorter than the response target.',
    };
  }

  return { ok: true, priority, responseMins: nums.responseMins, resolveMins: nums.resolveMins };
}

/**
 * Which priorities have no policy.
 *
 * Said rather than left to a short list: every SLA figure on the escalations
 * screen is measured against these targets, and a priority with no policy is
 * measured against nothing while still appearing to be tracked.
 */
export function prioritiesWithoutPolicy(
  policies: readonly { priority: string }[],
): string[] {
  const have = new Set(policies.map((p) => String(p.priority).toUpperCase()));
  return (PRIORITIES as readonly string[]).filter((p) => !have.has(p));
}
