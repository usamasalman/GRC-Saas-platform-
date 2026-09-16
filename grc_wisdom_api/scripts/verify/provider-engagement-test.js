/**
 * Naming the organisation that delivers an engagement.
 *
 * Project.providerTenantId was copied out of the request body straight into the
 * row: no existence check, no scope check, no comparison against the client, no
 * mention in the audit entry. createProject was the only write site, and
 * updateProject never assigned it, so the value was write-once -- an engagement
 * created naming the wrong firm stayed that way for the life of the row.
 *
 * That column is not decorative. Through services/projectAccess it puts the
 * named tenant into projectWhere's OR, makes canReadProject true for its users
 * and makes sideOf return 'Provider', which unlocks ten write paths across
 * evidence, clause mapping, impediments, the schedule and the engagement's own
 * framework scope. One unvalidated string handed an outside organisation read
 * of the client's plan, evidence files and reports.
 *
 * A bogus id did not even fail cleanly: nothing looked it up, so the foreign key
 * rejected the INSERT and the caller got 500 "Failed to create project",
 * indistinguishable from a database outage.
 *
 * Separately, deleteTenant counted users, children, documents and invoices and
 * stopped there. Because the engagement foreign key is ON DELETE SET NULL, a
 * firm holding none of those four could be hard-deleted while delivering live
 * engagements, and each one silently lost its deliverer -- after which three of
 * the five exported reports printed "Delivered by: The organisation itself",
 * an affirmative false statement, while impediments on the same engagement kept
 * exporting as "Owed by: Provider".
 *
 *   node scripts/verify/provider-engagement-test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const API = path.join(__dirname, '..', '..', 'src');
const WEB = path.join(__dirname, '..', '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** Comments are prose. Only what runs counts. */
const code = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ctrl = read(API, 'controllers', 'projectController.ts');
const ctrlCode = code(ctrl);
const routes = read(API, 'routes', 'projectRoutes.ts');
const tenantCtrl = code(read(API, 'controllers', 'tenantController.ts'));
const newProject = code(read(WEB, 'pages', 'grc', 'project', 'NewProject.tsx'));
const team = code(read(WEB, 'pages', 'grc', 'project', 'ProjectTeam.tsx'));

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

const {
  planProviderNomination, deliveryBlocksDeletion, DELIVERY_PARTNER_TYPES,
} = require('../../dist/services/providerEngagement');

const FIRM = { id: 'p1', name: 'GRC Consulting Partners', type: 'PARTNER', suspendedAt: null };
const CUSTOMER = { id: 'c9', name: 'Another Customer', type: 'MULTIBRANCH', suspendedAt: null };
const base = {
  clientTenantId: 't1',
  current: null,
  callerTenantIds: ['t1'],
  isPlatform: false,
};

// ── The rules run without a database ─────────────────────────────────────
{
  const svc = read(API, 'services', 'providerEngagement.ts');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'|@prisma\/client/.test(svc),
    'providerEngagement must stay pure. Every refusal in it is a sentence somebody will read, '
    + 'and a rule that needs a database to exercise is a rule nobody exercises.',
  );
}

// ── The refusals ─────────────────────────────────────────────────────────
{
  // The case that used to be a 500.
  const missing = planProviderNomination({ ...base, requested: 'nope', candidate: null });
  checks += 1;
  assert.ok(
    missing.ok === false && missing.status === 400 && missing.code === 'PROVIDER_NOT_FOUND',
    'an id naming no organisation must be refused with a 400 naming the field. Nothing looked '
    + 'the tenant up, so the foreign key rejected the insert and the caller got a 500 that '
    + 'reads as a database outage.',
  );

  const self = planProviderNomination({
    ...base, requested: 't1', candidate: { ...FIRM, id: 't1', name: 'Northwind' },
  });
  checks += 1;
  assert.ok(
    self.ok === false && self.code === 'PROVIDER_IS_CLIENT',
    'a project cannot be delivered by its own client. sideOf resolves that tie to Client so '
    + 'nobody can ever be provider-side, while hasProvider stays true and the exported reports '
    + 'name the client as its own independent deliverer.',
  );
  ok(/Northwind/.test(self.message), 'and the refusal names the organisation');

  const suspended = planProviderNomination({
    ...base, requested: 'p1', candidate: { ...FIRM, suspendedAt: new Date('2026-01-01') },
  });
  checks += 1;
  assert.ok(
    suspended.ok === false && suspended.code === 'PROVIDER_SUSPENDED',
    'a suspended firm cannot deliver: none of its people can sign in, and naming it would put '
    + 'it on every report as the deliverer of work nobody there can do',
  );

  const stranger = planProviderNomination({ ...base, requested: 'c9', candidate: CUSTOMER });
  checks += 1;
  assert.ok(
    stranger.ok === false && stranger.status === 403
    && stranger.code === 'PROVIDER_NOT_ENGAGEABLE',
    'an unrelated customer must be refused. Naming one handed that organisation read of this '
    + 'client\'s plan, evidence files and reports, and write over its traceability.',
  );
}

// ── What is allowed, and what the person is told ─────────────────────────
{
  const firm = planProviderNomination({ ...base, requested: 'p1', candidate: FIRM });
  ok(firm.ok === true, 'a registered delivery firm may be named');
  checks += 1;
  assert.strictEqual(firm.providerTenantId, 'p1');
  checks += 1;
  assert.strictEqual(firm.change, 'set');
  checks += 1;
  assert.ok(
    firm.warnings.some((w) => /read this engagement in full/.test(w))
    && firm.warnings.some((w) => /remove them again/.test(w)),
    'the person naming a firm must be told what it grants and that it is reversible. That '
    + 'sentence is the one that would have prevented the defect.',
  );

  // An organisation inside the caller's own group.
  const inGroup = planProviderNomination({
    ...base,
    requested: 'g2',
    candidate: { id: 'g2', name: 'Group IT', type: 'BRANCH', suspendedAt: null },
    callerTenantIds: ['t1', 'g2'],
  });
  ok(inGroup.ok === true, 'an entity in the caller\'s own group may deliver for it');

  // A platform operator administering the estate.
  const platform = planProviderNomination({
    ...base, requested: 'c9', candidate: CUSTOMER, isPlatform: true,
  });
  ok(platform.ok === true, 'a platform operator may name any organisation');
  ok(
    platform.warnings.some((w) => /this entry will show that you did/.test(w)),
    'and is told the act is on the record',
  );
}

// ── Removing and changing ────────────────────────────────────────────────
{
  const cleared = planProviderNomination({
    ...base, requested: '', candidate: null, current: 'p1',
  });
  checks += 1;
  assert.ok(
    cleared.ok === true && cleared.providerTenantId === null && cleared.change === 'cleared',
    'removing the deliverer must always be allowed. Refusing it is how an organisation ends '
    + 'up unable to revoke access it granted by mistake.',
  );
  ok(
    cleared.warnings.some((w) => /loses access/.test(w)),
    'and the person is told what the firm loses',
  );

  const none = planProviderNomination({ ...base, requested: '', candidate: null, current: null });
  ok(none.change === 'unchanged', 'clearing an already-empty deliverer changes nothing');

  const swapped = planProviderNomination({
    ...base, requested: 'p1', candidate: FIRM, current: 'p0',
  });
  ok(swapped.ok === true && swapped.change === 'changed', 'the deliverer can be swapped');
  ok(
    swapped.warnings.some((w) => /named before loses its access/.test(w)),
    'and the outgoing firm\'s loss is stated',
  );

  const same = planProviderNomination({
    ...base, requested: 'p1', candidate: FIRM, current: 'p1',
  });
  checks += 1;
  assert.ok(
    same.change === 'unchanged' && same.warnings.length === 0,
    're-sending the same deliverer is not a change and must not notify anybody again',
  );
}

// ── A delivering organisation cannot be deleted from under its work ──────
{
  ok(deliveryBlocksDeletion({ projects: 0, projectsDelivered: 0 }) === null, 'an idle tenant is deletable');
  checks += 1;
  assert.ok(
    /delivers for others/.test(deliveryBlocksDeletion({ projects: 0, projectsDelivered: 3 }) || ''),
    'a firm delivering engagements must not be deletable. The foreign key is ON DELETE SET '
    + 'NULL, so deleting it silently cleared the column on every engagement and three reports '
    + 'began printing "Delivered by: The organisation itself".',
  );
  ok(
    /delivery project\(s\) of its own/.test(deliveryBlocksDeletion({ projects: 2, projectsDelivered: 0 }) || ''),
    'and neither must a client with its own engagements',
  );

  ok(
    /projects: true, projectsDelivered: true/.test(tenantCtrl),
    'deleteTenant must count both kinds of delivery work',
  );
  ok(
    /deliveryBlocksDeletion\(c\)/.test(tenantCtrl),
    'and act on the answer',
  );
}

// ── The controller validates on both write paths ─────────────────────────
{
  checks += 1;
  assert.strictEqual(
    (ctrlCode.match(/resolveProvider\(/g) || []).length, 3,
    'the resolver must be defined once and called from both createProject and updateProject. '
    + 'Validating only on create is what made a wrong deliverer permanent.',
  );

  checks += 1;
  assert.ok(
    !/providerTenantId: providerTenantId \? str\(providerTenantId\) : null/.test(ctrlCode),
    'createProject must not copy the raw body value into the row any more',
  );
  ok(
    /providerTenantId: provider\.providerTenantId/.test(ctrlCode),
    'it must store what the rule returned',
  );
  ok(
    /b\.providerTenantId !== undefined/.test(ctrlCode),
    'updateProject must accept the field it used to drop silently',
  );

  // Audited on BOTH trails.
  ok(/PROJECT_PROVIDER_NAMED/.test(ctrlCode), 'naming a firm must be audited');
  ok(/PROJECT_PROVIDER_REMOVED/.test(ctrlCode), 'and so must removing one');
  checks += 1;
  assert.ok(
    /providerTenantId: provider\.providerTenantId,/.test(ctrlCode),
    'the PROJECT_CREATED payload must record which organisation was given access. An audit '
    + 'trail that does not name it cannot answer the only question anybody would ask of it.',
  );

  // And the firm is told.
  ok(
    /notify\(tx,/.test(ctrlCode) && /providerAdmins\(/.test(ctrlCode),
    'the organisation being named must be told. A firm told nothing cannot object, and cannot '
    + 'notice a client that named it by mistake.',
  );
}

// ── The list the screens offer, and the route that serves it ─────────────
{
  ok(/export const engageableProviders/.test(ctrlCode), 'the offerable list must be served');
  ok(
    routes.includes("router.get('/engageable-providers', engageableProviders);"),
    'and routed',
  );

  // Ordering matters: '/:id' would otherwise swallow it.
  const at = routes.indexOf("router.get('/engageable-providers'");
  const wildcard = routes.indexOf("router.get('/:id', getProject);");
  checks += 1;
  assert.ok(
    at > 0 && wildcard > 0 && at < wildcard,
    'the literal path must be registered before the \'/:id\' wildcard, which would otherwise '
    + 'match it and answer "Project not found" for a path segment that is not an id.',
  );

  ok(
    /suspendedAt: null/.test(ctrlCode),
    'a suspended organisation must not be offered in the first place',
  );

  for (const [screen, name] of [[newProject, 'NewProject'], [team, 'ProjectTeam']]) {
    ok(
      screen.includes('/api/projects/engageable-providers'),
      `${name} must offer the list rather than ask for a tenant uuid`,
    );
  }
  ok(
    /providerTenantId: providerTenantId \|\| undefined/.test(newProject),
    'the creation form must send what was chosen',
  );
  ok(
    /providerTenantId: chosen \? chosen\.id : ''/.test(team),
    'and the team screen must be able to change it and to clear it',
  );
}

console.log(
  `provider-engagement: ${checks} assertions passed `
  + `(rules pure, delivery types: ${DELIVERY_PARTNER_TYPES.join(', ')})`,
);
