/**
 * An engagement declares what it is being run against, and the report obeys it.
 *
 * Project.frameworks was a JSON array of free text: ["ISO27001"]. "ISO 27001",
 * "iso27001" and a typo were three different values, none resolved to a
 * Standard row, and nothing downstream could follow one to a clause. The
 * certification-readiness report therefore worked out an engagement's scope by
 * reading the clause links its own tasks already held:
 *
 *     const standardIds = [...new Set(
 *       tasks.flatMap((t) => t.clauseLinks.map((l) => l.clause.standard.id)),
 *     )];
 *
 * The denominator was a function of the numerator. A project with no clause
 * links named no standards, so it had no clauses in scope, so it had no gaps —
 * and the paper a certification body reads printed "Clauses in scope with no
 * task at all: 0" for the engagement that had mapped nothing at all.
 *
 * Meanwhile linkClauses and unlinkClause — routed and capability-guarded since
 * the module was written — had no caller in any screen, so the only way to map
 * work to a clause was to call the API by hand.
 *
 * Both halves are pinned here, along with the rules in services/projectStandards
 * which run without a database.
 *
 *   node scripts/verify/project-standards-test.js
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

const schema = read(API, '..', 'prisma', 'schema.prisma');
const routes = read(API, 'routes', 'projectRoutes.ts');
const projectCtrl = read(API, 'controllers', 'projectController.ts');
const stdCtrl = read(API, 'controllers', 'projectStandardController.ts');
const evidenceCtrl = read(API, 'controllers', 'projectEvidenceController.ts');
const reportCtrl = read(API, 'controllers', 'deliveryReportController.ts');
const planScreen = code(read(WEB, 'pages', 'grc', 'project', 'ProjectPlan.tsx'));
const evidenceScreen = code(read(WEB, 'pages', 'grc', 'project', 'ProjectEvidence.tsx'));
const newProject = code(read(WEB, 'pages', 'grc', 'project', 'NewProject.tsx'));

let checks = 0;
const ok = (cond, what) => { checks += 1; assert.ok(cond, what); };

// ── The binding exists and is additive ───────────────────────────────────
{
  ok(/model ProjectStandard \{/.test(schema), 'ProjectStandard must be modelled');
  ok(
    /@@unique\(\[projectId, standardId\]\)/.test(schema),
    'a project cannot be bound to the same framework twice',
  );

  const dir = path.join(API, '..', 'prisma', 'migrations');
  const mig = fs.readdirSync(dir).filter((d) => /project_standards$/.test(d));
  ok(mig.length === 1, 'the binding needs exactly one migration');
  const sql = fs.readFileSync(path.join(dir, mig[0], 'migration.sql'), 'utf8');
  checks += 1;
  assert.ok(
    !/\bDROP\b|ALTER COLUMN/i.test(sql),
    'the migration must be additive. This database holds customer engagements, and a '
    + 'destructive statement in a migration is not recoverable by editing the file afterwards.',
  );
  ok(/CREATE TABLE "ProjectStandard"/.test(sql), 'the migration must create the table');
}

// ── frameworks is readable and no longer written ─────────────────────────
// The build plan's own instruction: "Keep frameworks readable during migration;
// stop writing it."
{
  ok(/frameworks/.test(schema), 'the legacy column must remain, so old engagements still read');

  const stripped = code(projectCtrl);
  checks += 1;
  assert.ok(
    !/data\.frameworks\s*=/.test(stripped) && !/frameworks:\s*JSON\.stringify/.test(stripped),
    'nothing may write Project.frameworks any more. It is free text that resolves to no '
    + 'framework in the library, and every value written into it is one more engagement whose '
    + 'scope cannot be followed to a clause.',
  );
  ok(
    /FRAMEWORKS_READ_ONLY/.test(projectCtrl),
    'a caller still sending frameworks must be told where scope lives now, not silently ignored',
  );
  ok(
    /parseFrameworks\(p\.frameworks\)/.test(projectCtrl),
    'the legacy column must still be read for engagements that predate the binding',
  );
}

// ── Every write is routed, and every route has a caller ──────────────────
{
  const MUST_BE_REACHABLE = [
    ["router.get('/:id/standards'", '/standards`', evidenceScreen, 'reading the engagement scope'],
    ["router.put('/:id/standards'", '/standards`', evidenceScreen, 'setting the engagement scope'],
    ["router.get('/:id/clauses'", '/clauses`', planScreen, 'listing the clauses in scope'],
    ["router.post('/tasks/:taskId/clauses'", '/clauses`', planScreen, 'mapping a task to clauses'],
    ["router.delete('/clauses/:linkId'", '/api/projects/clauses/', planScreen, 'unmapping a clause'],
  ];

  for (const [route, call, screen, what] of MUST_BE_REACHABLE) {
    ok(routes.includes(route), `${route} must be routed`);
    ok(
      screen.includes(call),
      `No screen calls the endpoint for ${what}. linkClauses and unlinkClause were routed and `
      + 'guarded for the whole life of this module and no screen ever called either, which is '
      + 'why the traceability report measured engagements against whatever links somebody had '
      + 'managed to create through the API by hand.',
    );
  }

  ok(
    /requireCapability\(CAP\.MANAGE_PROJECT\), setProjectStandards\)/.test(routes),
    'declaring what an engagement is run against is a management act',
  );

  // The dialog has to reach the handler that calls them. A screen that merely
  // contains the URLs satisfies the checks above with a function nothing calls,
  // which is the exact shape of the defect this packet fixes.
  checks += 1;
  assert.ok(
    /onSubmit=\{\(ids\) => saveClauses\(/.test(planScreen),
    'the clause picker must submit into the handler that calls the link endpoints',
  );
  checks += 1;
  assert.ok(
    /onSubmit=\{saveScope\}/.test(evidenceScreen),
    'the framework picker must submit into the handler that calls the scope endpoint',
  );
}

// ── The denominator is the engagement, not the links ─────────────────────
{
  const at = reportCtrl.indexOf('async function evidenceSections');
  ok(at > 0, 'the readiness section builder was not found');
  const body = code(reportCtrl.slice(at, reportCtrl.indexOf('\nasync function ', at + 1) + 1
    || reportCtrl.length));

  checks += 1;
  assert.ok(
    /readinessScope\(/.test(body) && /projectStandard\.findMany/.test(body),
    'the readiness report must take its clause denominator from what the engagement is bound '
    + 'to. Deriving it from the clause links means a project that has mapped nothing has '
    + 'nothing in scope, therefore no gaps — which is what this document used to print.',
  );

  // The query itself, not merely the presence of the call: a scope computed and
  // then not used is exactly how the first version of this check passed while
  // the old behaviour was restored beside it.
  checks += 1;
  assert.ok(
    /where:\s*\{\s*standardId:\s*\{\s*in:\s*scope\.standardIds\s*\}\s*\}/.test(body),
    'the clause query must be driven by the engagement\'s bound standards',
  );

  // And `scope` has exactly one origin. The numerator legitimately groups its
  // own mapped clauses by standard code, so a blanket ban on reading a standard
  // through a link would be wrong; what must not happen is the DENOMINATOR
  // being computed that way. Pinning the single assignment says precisely that.
  const scopeAssignments = (body.match(/\bconst scope\s*=\s*[\s\S]{0,60}/g) || []);
  checks += 1;
  assert.ok(
    scopeAssignments.length === 1 && /readinessScope\(/.test(scopeAssignments[0]),
    'the readiness scope must come from readinessScope() and nowhere else. It used to be '
    + 'assembled from the clause links the tasks held, so a project with no links had no '
    + 'standards, no clauses in scope and therefore no gaps — and this document, which a '
    + 'certification body reads, printed "0" for the engagement that had mapped nothing.\n'
    + `Found: ${scopeAssignments.map((a) => a.replace(/\s+/g, ' ').slice(0, 70)).join(' | ')}`,
  );

  checks += 1;
  assert.ok(
    /boundStandardIds:\s*boundStandards\.map\(\(b\) => b\.standardId\)/.test(body),
    'and its bound ids must come from the ProjectStandard rows this engagement holds',
  );

  checks += 1;
  assert.ok(
    /scope\.stated \? String\(gaps\.length\)/.test(body),
    'the gap count must be printed only when it can be supported. "Nothing is missing" and '
    + '"nobody has looked" render identically as a zero, and only one of them is a reason to '
    + 'go to certification.',
  );
  ok(
    /This report states no readiness figure/.test(reportCtrl),
    'and the report must say why, rather than leaving a dash to be read as zero',
  );
}

// ── A clause outside the engagement's scope cannot be mapped ─────────────
{
  const at = evidenceCtrl.indexOf('export const linkClauses');
  ok(at > 0, 'linkClauses not found');
  const body = evidenceCtrl.slice(at, evidenceCtrl.indexOf('\nexport const ', at + 1));

  ok(/CLAUSE_OUT_OF_SCOPE/.test(body), 'another organisation\'s private framework stays refused');
  // Branched on, not merely called. A result destructured into a name nothing
  // reads is a check that runs and decides nothing.
  checks += 1;
  assert.ok(
    /const \{ rejected \} = clausesInScope\(/.test(body)
    && /if \(rejected\.length > 0\)/.test(body)
    && /CLAUSE_NOT_IN_ENGAGEMENT_SCOPE/.test(body),
    'a clause of a framework the engagement is not being run against must be refused. A link '
    + 'outside the denominator puts a row in the numerator the denominator does not contain, '
    + 'and a coverage fraction whose halves come from different sets is worse than no figure.',
  );
  ok(
    /PROJECT_HAS_NO_FRAMEWORKS/.test(body),
    'and an engagement bound to nothing must say so rather than refusing each clause in turn',
  );
}

// ── The screen stops asking people to type a framework ───────────────────
{
  checks += 1;
  assert.ok(
    !/placeholder="ISO27001, SOC2"/.test(newProject)
    && !/frameworks\.split\(','\)/.test(newProject),
    'the new-engagement form must not take frameworks as comma-separated free text. That field '
    + 'is where the unresolvable strings came from.',
  );
  ok(
    /standardIds/.test(newProject) && /isEnabledHere/.test(newProject),
    'it must choose from the frameworks the organisation has enabled',
  );
}

// ── The rules run without a database ─────────────────────────────────────
{
  const svc = read(API, 'services', 'projectStandards.ts');
  checks += 1;
  assert.ok(
    !/from '\.\.\/db'|@prisma\/client/.test(svc),
    'projectStandards must stay pure. Every refusal in it is a sentence a user will read, and '
    + 'a rule that needs a database to exercise is a rule nobody exercises.',
  );

  const { planStandardBinding, readinessScope, clausesInScope, MAX_STANDARDS } =
    require('../../dist/services/projectStandards');

  const iso = {
    id: 's1', code: 'ISO27001', title: 'ISO 27001', tenantId: null,
    enabled: true, applicability: 'Full',
  };
  const soc = {
    id: 's2', code: 'SOC2', title: 'SOC 2', tenantId: null,
    enabled: true, applicability: 'Partial',
  };
  const base = { projectTenantId: 't1', found: [iso, soc], bound: [], inUse: [] };

  // The ordinary case.
  {
    const p = planStandardBinding({ ...base, requested: ['s1', 's2'] });
    ok(p.ok === true, 'two enabled frameworks bind');
    assert.deepStrictEqual(p.add, ['s1', 's2']);
    assert.deepStrictEqual(p.remove, []);
    checks += 2;
  }

  // Duplicates are a client quirk, not a 400.
  {
    const p = planStandardBinding({ ...base, requested: ['s1', 's1'] });
    ok(p.ok === true, 'a repeated id is tolerated');
    assert.deepStrictEqual(p.add, ['s1']);
    checks += 1;
  }

  // Not enabled: the engagement cannot adopt on the organisation's behalf.
  {
    const p = planStandardBinding({
      ...base,
      found: [{ ...iso, enabled: false, applicability: null }],
      requested: ['s1'],
    });
    ok(p.ok === false && p.code === 'STANDARD_NOT_ENABLED', 'an unenabled framework is refused');
    ok(/Organization Standards/.test(p.message), 'and the refusal says where to enable it');
  }

  // Not applicable: the organisation has formally excluded it.
  {
    const p = planStandardBinding({
      ...base,
      found: [{ ...iso, applicability: 'Not applicable' }],
      requested: ['s1'],
    });
    ok(
      p.ok === false && p.code === 'STANDARD_NOT_APPLICABLE',
      'a framework the organisation marked Not applicable is refused — an engagement should not '
      + 'contradict the statement of applicability the same organisation signs',
    );
  }

  // Somebody else's private framework.
  {
    const p = planStandardBinding({
      ...base,
      found: [{ ...iso, tenantId: 'other', code: 'THEIRS' }],
      requested: ['s1'],
    });
    ok(p.ok === false && p.code === 'STANDARD_OUT_OF_SCOPE', 'a foreign private framework is refused');
    ok(/THEIRS/.test(p.message), 'and is named, so the refusal can be acted on');
  }

  // A framework this organisation authored for itself binds normally.
  {
    const p = planStandardBinding({
      ...base,
      found: [{ ...iso, tenantId: 't1', code: 'POLICY-01' }],
      requested: ['s1'],
    });
    ok(p.ok === true, 'an organisation may run an engagement against its own framework');
  }

  {
    const p = planStandardBinding({ ...base, requested: ['nope'] });
    ok(p.ok === false && p.code === 'STANDARD_NOT_FOUND', 'an unknown id is refused');
  }

  {
    const many = Array.from({ length: MAX_STANDARDS + 1 }, (_, i) => `x${i}`);
    const p = planStandardBinding({ ...base, requested: many });
    ok(p.ok === false && p.code === 'TOO_MANY_STANDARDS', 'the cap holds');
  }

  // Unbinding a framework whose clauses the plan still points at.
  {
    const p = planStandardBinding({
      ...base, requested: ['s1'], bound: ['s1', 's2'], inUse: ['s2'],
    });
    ok(
      p.ok === false && p.code === 'STANDARD_IN_USE',
      'a framework cannot be unbound while tasks are still mapped to its clauses — the links '
      + 'would survive outside the declared scope and the report would count them',
    );
    ok(/SOC2/.test(p.message), 'and the refusal names it');
  }

  // Unbinding one nothing points at is fine.
  {
    const p = planStandardBinding({
      ...base, requested: ['s1'], bound: ['s1', 's2'], inUse: [],
    });
    ok(p.ok === true, 'an unused framework can be unbound');
    assert.deepStrictEqual(p.remove, ['s2']);
    assert.deepStrictEqual(p.keep, ['s1']);
    checks += 2;
  }

  // ── What the report may state ──────────────────────────────────────────
  {
    const bound = readinessScope({ boundStandardIds: ['s1'], legacyFrameworks: [] });
    ok(bound.stated === true && bound.caveat === null, 'a bound engagement can be measured');
    assert.deepStrictEqual(bound.standardIds, ['s1']);
    checks += 1;

    const legacy = readinessScope({ boundStandardIds: [], legacyFrameworks: ['ISO27001'] });
    ok(
      legacy.stated === false,
      'free text is not a framework. An engagement whose only scope is a typed string cannot '
      + 'be measured, and saying "0 gaps" for it is the defect this whole packet exists for.',
    );
    ok(/ISO27001/.test(legacy.caveat), 'the caveat quotes what was typed, so it can be fixed');

    const nothing = readinessScope({ boundStandardIds: [], legacyFrameworks: [] });
    ok(nothing.stated === false, 'an engagement bound to nothing states no readiness');
    ok(
      /gap count of zero would mean nothing has been looked at/.test(nothing.caveat),
      'and says so in words a reader of a certification paper will not misread',
    );
  }

  // ── Which clauses a task may be mapped to ──────────────────────────────
  {
    const clauses = [
      { id: 'c1', standardId: 's1', code: 'ISO27001', ref: 'A.5.1' },
      { id: 'c2', standardId: 's9', code: 'PCIDSS', ref: '1.1' },
    ];
    const r = clausesInScope({ boundStandardIds: ['s1'], clauses });
    assert.deepStrictEqual(r.allowed, ['c1']);
    assert.deepStrictEqual(r.rejected, [{ code: 'PCIDSS', ref: '1.1' }]);
    checks += 2;

    const none = clausesInScope({ boundStandardIds: [], clauses });
    assert.deepStrictEqual(none.allowed, []);
    ok(none.rejected.length === 2, 'an engagement bound to nothing can map nothing');
  }
}

// ── Deleting a standard cannot rewrite an engagement's scope ─────────────
// ProjectStandard cascades from Standard, so a delete that did not count the
// bindings would change what a live engagement says it is being run against
// with no record that anything happened — and would do so even for a standard
// nothing had been mapped to yet, which the existing link count does not see.
{
  const authoring = read(API, 'controllers', 'standardsAuthoringController.ts');
  checks += 1;
  assert.ok(
    /prisma\.projectStandard\.count\(\{ where: \{ standardId: id \} \}\)/.test(authoring),
    'deleting a standard must count the engagements bound to it',
  );
  ok(
    /bound > 0 \? `\$\{bound\} engagement\(s\) are being run against it`/.test(authoring),
    'and the refusal must say so, rather than reporting only the clause links',
  );
}

// ── The binding is audited ───────────────────────────────────────────────
{
  ok(
    /PROJECT_STANDARDS_SET/.test(stdCtrl),
    'changing what an engagement is run against must be audited — it is the scope statement',
  );
  const at = stdCtrl.indexOf('await prisma.$transaction');
  ok(at > 0, 'the change must be transactional');
  const body = stdCtrl.slice(at);
  checks += 1;
  assert.ok(
    /writeAudit\(tx,/.test(body),
    'the audit entry must be written inside the transaction that makes the change, or a '
    + 'rolled-back change leaves an entry saying it happened',
  );
  ok(
    /added:/.test(body) && /removed:/.test(body),
    'and must record both directions — "what were we running against in March" is the question '
    + 'this entry exists to answer',
  );
}

console.log(`project-standards: ${checks} assertions passed (rules pure, no database)`);
