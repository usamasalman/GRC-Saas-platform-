import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn, primaryBtn, apiError } from '../../iam/iamStyles';
import PickManyDialog from '../../../components/PickManyDialog';

/**
 * Starting an engagement.
 *
 * Five things are required and the rest can wait: a name, the two dates, and
 * the two people who answer for it. Everything else — type, priority,
 * frameworks, sponsor — is editable afterwards, and asking for all of it before
 * anyone can begin is how a form stops being filled in.
 *
 * Frameworks are CHOSEN, not typed. This field used to be a text box with the
 * placeholder "ISO27001, SOC2" whose contents were stored as a JSON array of
 * strings, so "ISO27001", "ISO 27001" and a typo were three different values
 * and none of them resolved to a framework in the library. Nothing downstream
 * could follow one to a clause — which is why the readiness report worked out
 * an engagement's scope from the clause links its own tasks held, and reported
 * no gaps for a project that had mapped nothing.
 *
 * Two choices here are worth understanding before you make them, so both carry
 * a line of explanation rather than a tooltip nobody opens:
 *
 *   the dates      become the agreed plan the moment the engagement is
 *                  activated, and every later slip is measured against them
 *   the policy     decides what the second progress figure will mean, and it is
 *                  the setting people regret leaving on the default
 */

interface Person { id: string; name: string; email: string }

interface Props {
  onCreated: (project: { id: string; ref: string; name: string }) => void;
  onCancel: () => void;
}

const TYPES = ['Readiness', 'Certification', 'Remediation', 'Implementation', 'Assessment'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

const POLICIES: { value: string; label: string; help: string }[] = [
  {
    value: 'SelectedTasks',
    label: 'Only tasks marked for review',
    help: 'The default. Someone marks the deliverables that matter — the scope '
      + 'statement, the SoA — and only those go to a reviewer.',
  },
  {
    value: 'EvidenceTasks',
    label: 'Any task that produces a deliverable',
    help: 'Verification follows the work. Attach a file to a task and it needs an '
      + 'independent reviewer; tasks producing nothing do not. Usually what a '
      + 'consulting engagement wants.',
  },
  {
    value: 'EveryTask',
    label: 'Every task',
    help: 'Nothing counts as confirmed until a second person has accepted it. '
      + 'Thorough, and heavy on reviewer time.',
  },
  {
    value: 'None',
    label: 'No independent verification',
    help: 'The confirmed figure will equal the claimed figure and carry no '
      + 'assurance of its own. Reports say so on their face.',
  },
];

/** Sensible defaults: starting today, ending in three months. */
const today = () => new Date().toISOString().slice(0, 10);
const inMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
};

const NewProject: React.FC<Props> = ({ onCreated, onCancel }) => {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    description: '',
    projectType: 'Readiness',
    priority: 'Medium',
    startDate: today(),
    targetEndDate: inMonths(3),
    ownerId: '',
    managerId: '',
    sponsorId: '',
    verificationPolicy: 'SelectedTasks',
  });

  useEffect(() => {
    (async () => {
      try {
        // Both at once: the user list has no notion of who is asking, and
        // /auth/me is where that lives.
        const [usersRes, meRes] = await Promise.all([
          apiClient.get('/api/iam/users'),
          apiClient.get('/api/auth/me').catch(() => null),
        ]);
        const list: Person[] = (usersRes.data?.users || [])
          .map((u: any) => ({ id: u.id, name: u.name, email: u.email }))
          .filter((u: Person) => u.id && u.name);
        setPeople(list);

        // Whoever is setting this up is the likeliest owner and manager, and a
        // form that starts half-filled gets finished more often than one that
        // starts empty. Both stay editable.
        const me = meRes?.data?.user?.id || meRes?.data?.id;
        if (me && list.some((u) => u.id === me)) {
          setForm((f) => ({ ...f, ownerId: me, managerId: me }));
        } else if (list.length === 1) {
          setForm((f) => ({ ...f, ownerId: list[0].id, managerId: list[0].id }));
        }
      } catch (err: any) {
        setError(apiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // The organisation's enabled frameworks, which are the only ones an
  // engagement may be run against: adopting a framework is the organisation's
  // decision, recorded under Organization Standards, and a project should not
  // be the back door around it.
  const [standards, setStandards] = useState<
    { id: string; code: string; title: string; clauseCount: number }[]
  >([]);
  const [standardIds, setStandardIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    apiClient.get('/api/grc/standards')
      .then((res) => setStandards(
        (res.data?.standards || [])
          .filter((s: any) => s.isEnabledHere)
          .map((s: any) => ({
            id: s.id, code: s.code, title: s.title, clauseCount: s.clauseCount || 0,
          })),
      ))
      .catch(() => setStandards([]));
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { setError('Give the engagement a name.'); return; }
    if (!form.ownerId || !form.managerId) {
      setError('An engagement needs someone accountable for it and someone running it. '
        + 'They can be the same person.');
      return;
    }
    if (new Date(form.targetEndDate) < new Date(form.startDate)) {
      setError('The end date is before the start date.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await apiClient.post('/api/projects', {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        projectType: form.projectType,
        priority: form.priority,
        // Real framework rows, bound in the same transaction as the project.
        // The server refuses any the organisation has not enabled, and names it.
        standardIds: standardIds.length > 0 ? standardIds : undefined,
        startDate: form.startDate,
        targetEndDate: form.targetEndDate,
        ownerId: form.ownerId,
        managerId: form.managerId,
        sponsorId: form.sponsorId || undefined,
        verificationPolicy: form.verificationPolicy,
      });
      const p = res.data?.project;
      if (p?.id) onCreated({ id: p.id, ref: p.ref, name: p.name });
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading…</div>;
  }

  const field: React.CSSProperties = { ...S.input, width: '100%', marginTop: 4 };
  const label: React.CSSProperties = { fontSize: 11.5, color: 'var(--ink-muted)' };
  const help: React.CSSProperties = {
    fontSize: 11, color: 'var(--ink-faint)', marginTop: 4, lineHeight: 1.5,
  };

  const chosenPolicy = POLICIES.find((p) => p.value === form.verificationPolicy);

  return (
    <div style={{ maxWidth: 780 }}>
      {error && <div style={S.error}>{error}</div>}

      {people.length === 0 && (
        <div style={{
          ...S.card, padding: '12px 16px', marginBottom: 14,
          borderLeft: '3px solid var(--warning)', color: 'var(--warning)', fontSize: 13,
        }}>
          No users were found in this organisation, so there is nobody to make
          accountable. Add a user first under Users &amp; Permissions.
        </div>
      )}

      <div style={{ ...S.card, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>What is this engagement?</span>
            <input
              style={field}
              value={form.name}
              autoFocus
              placeholder="ISO 27001 readiness — Acme Group"
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>Objective, in a sentence (optional)</span>
            <input
              style={field}
              value={form.description}
              placeholder="Reach certification readiness across the two UK entities by Q3."
              onChange={(e) => set('description', e.target.value)}
            />
          </div>

          <div>
            <span style={label}>Type</span>
            <select style={field} value={form.projectType}
                    onChange={(e) => set('projectType', e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <span style={label}>Priority</span>
            <select style={field} value={form.priority}
                    onChange={(e) => set('priority', e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <span style={label}>Frameworks in scope</span>
            <button
              type="button"
              style={{ ...field, textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setPicking(true)}
              disabled={busy}
            >
              {standardIds.length === 0
                ? 'Choose frameworks…'
                : standards
                  .filter((s) => standardIds.includes(s.id))
                  .map((s) => s.code)
                  .join(', ')}
            </button>
            <div style={help}>
              {standards.length === 0
                ? 'This organisation has no frameworks enabled yet. One can be enabled under '
                  + 'Organization Standards and bound to the engagement afterwards.'
                : 'From the frameworks this organisation has enabled. These clauses are what '
                  + 'the readiness report measures the engagement against, and work is mapped '
                  + 'to them task by task.'}
            </div>
          </div>

          <div>
            <span style={label}>Starts</span>
            <input style={field} type="date" value={form.startDate}
                   onChange={(e) => set('startDate', e.target.value)} />
          </div>

          <div>
            <span style={label}>Target end</span>
            <input style={field} type="date" value={form.targetEndDate}
                   onChange={(e) => set('targetEndDate', e.target.value)} />
            <div style={help}>
              These two become the agreed plan when you activate the engagement. Every
              later slip is measured against them.
            </div>
          </div>

          <div>
            <span style={label}>Accountable for delivery</span>
            <select style={field} value={form.ownerId}
                    onChange={(e) => set('ownerId', e.target.value)}>
              <option value="">Choose someone…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <span style={label}>Runs it day to day</span>
            <select style={field} value={form.managerId}
                    onChange={(e) => set('managerId', e.target.value)}>
              <option value="">Choose someone…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={help}>Can be the same person as above.</div>
          </div>

          <div>
            <span style={label}>Executive sponsor (optional)</span>
            <select style={field} value={form.sponsorId}
                    onChange={(e) => set('sponsorId', e.target.value)}>
              <option value="">None</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>What has to be independently checked?</span>
            <select style={field} value={form.verificationPolicy}
                    onChange={(e) => set('verificationPolicy', e.target.value)}>
              {POLICIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {/* Explained inline rather than in a tooltip, because it decides what
                the second progress figure means and it is the setting people
                regret leaving on the default. */}
            <div style={help}>{chosenPolicy?.help}</div>
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={primaryBtn(busy || people.length === 0)}
                  disabled={busy || people.length === 0} onClick={submit}>
            {busy ? 'Creating…' : 'Create engagement'}
          </button>
          <button style={ghostBtn} disabled={busy} onClick={onCancel}>Cancel</button>
          <span style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginLeft: 'auto' }}>
            It starts as a draft. Nothing is baselined until you activate it.
          </span>
        </div>
      </div>

      {picking && (
        <PickManyDialog
          title="Frameworks this engagement is run against"
          intro={(
            <>
              Only frameworks this organisation has enabled appear here. They can be changed
              after the engagement exists, on its Evidence tab.
            </>
          )}
          items={standards.map((s) => ({
            id: s.id,
            label: s.code,
            sublabel: `${s.title} · ${s.clauseCount} clause${s.clauseCount === 1 ? '' : 's'}`,
          }))}
          initiallySelected={standardIds}
          confirmLabel="Choose"
          emptyMessage={(
            <>
              No frameworks are enabled for this organisation yet. Enable one under
              Organization Standards — an engagement cannot adopt a framework on the
              organisation&rsquo;s behalf.
            </>
          )}
          onSubmit={(ids) => { setStandardIds(ids); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  );
};

export default NewProject;
