import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import Can, { MAY } from '../../components/Can';
import FormDialog from '../../components/FormDialog';
import { S, primaryBtn, ghostBtn, pill, apiError, StatStrip } from '../iam/iamStyles';

/**
 * Workflow definitions.
 *
 * A run could be decided, cancelled and listed, but a definition could only
 * arrive through the seed. `create-an-approval-or-automation-workflow` was
 * granted to five roles and guarded no route: it was enforced only as a step's
 * requiredCapability inside the engine, which decides who may ACT on a step,
 * never who may author the thing the step belongs to. So the one grant named
 * after creating a workflow could not create one.
 */

const SUB: React.CSSProperties = {
  margin: '6px 0 0', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: 720,
};
const H2: React.CSSProperties = {
  margin: '26px 0 10px', fontSize: 14, fontWeight: 600, color: 'var(--ink)',
};
const EMPTY: React.CSSProperties = {
  padding: '30px 20px', textAlign: 'center', border: '1px dashed var(--line)',
  borderRadius: 8, fontSize: 12.5, color: 'var(--ink-muted)',
};

const WorkflowDefinitions: React.FC = () => {
  const [definitions, setDefinitions] = useState<any[]>([]);
  const [options, setOptions] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [defs, opts] = await Promise.all([
        apiClient.get('/api/itsm/workflows'),
        apiClient.get('/api/itsm/workflows/options').catch(() => null),
      ]);
      setDefinitions(defs.data?.definitions || []);
      setOptions(opts?.data || null);
    } catch (e: any) {
      setError(apiError(e, 'Failed to load workflows'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (values: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      const body = {
        key: values.key,
        name: values.name,
        description: values.description,
        subjectType: values.subjectType,
        steps: values.steps,
      };
      const res = editing
        ? await apiClient.put(`/api/itsm/workflows/${editing.id}`, body)
        : await apiClient.post('/api/itsm/workflows', body);
      if (res.data?.note) setNotice(res.data.note);
      setEditing(null);
      setCreating(false);
      await load();
    } catch (e: any) {
      // The server names the step and what is wrong with it. That message is
      // the useful part, so it goes in the page banner rather than being
      // replaced with something generic.
      setError(apiError(e, 'The workflow could not be saved'));
      setEditing(null);
      setCreating(false);
    } finally {
      setBusy(false);
    }
  };

  const STARTER = JSON.stringify([
    { key: 'submit', type: 'submit', name: 'Raise the request' },
    {
      key: 'approve',
      type: 'approve',
      name: 'Line approval',
      requiredCapability: 'manage-and-resolve-support-tickets',
      dueInHours: 48,
    },
  ], null, 2);

  const fields = (d: any) => [
    {
      name: 'key',
      label: 'Key',
      type: 'text' as const,
      required: true,
      initial: d?.key || '',
      placeholder: 'access-request-approval',
      help: 'Lowercase letters, numbers and hyphens. Runs point at the key, so it does not change lightly.',
    },
    { name: 'name', label: 'Name', type: 'text' as const, required: true, initial: d?.name || '' },
    { name: 'description', label: 'Description', type: 'textarea' as const, initial: d?.description || '' },
    {
      name: 'subjectType',
      label: 'About',
      type: 'select' as const,
      required: true,
      initial: d?.subjectType || 'Ticket',
      options: (options?.subjectTypes || ['Ticket']) as readonly string[],
    },
    {
      name: 'steps',
      label: 'Steps (JSON)',
      type: 'textarea' as const,
      required: true,
      initial: d ? JSON.stringify(d.steps, null, 2) : STARTER,
      help: 'Each step needs a key, a type and a name. A review, approve or task step also '
        + 'needs a required capability or an assignee, or it lands in nobody\'s inbox.',
    },
  ];

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
            Approval workflows
          </h1>
          <p style={SUB}>
            The routes a request follows and who has to act at each step. A step names a
            capability rather than a person, so the workflow keeps working when somebody
            leaves and their successor picks it up.
          </p>
        </div>
        <Can do={MAY.AUTHOR_WORKFLOW}>
          <button onClick={() => { setError(''); setCreating(true); }} style={primaryBtn(busy)} disabled={busy}>
            New workflow
          </button>
        </Can>
      </div>

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ padding: '10px 12px', marginBottom: 12, borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', color: 'var(--warning)', fontSize: 12.5 }}>
          {notice}
        </div>
      )}

      <StatStrip
        items={[
          ['Workflows', definitions.length],
          ['Active', definitions.filter((d) => d.isActive).length],
          ['Platform', definitions.filter((d) => d.isSystem).length],
        ]}
      />

      <h2 style={H2}>Definitions</h2>
      {loading ? (
        <div style={EMPTY}>Loading…</div>
      ) : definitions.length === 0 ? (
        <div style={EMPTY}>
          <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 5 }}>
            No workflow has been defined
          </div>
          <div style={{ maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>
            Requests that would have followed an approval route are decided ad hoc until one
            exists.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {definitions.map((d) => (
            <div
              key={d.id}
              style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5 }}
            >
              <span style={{ fontWeight: 600, color: 'var(--ink)', minWidth: 190 }}>{d.key}</span>
              <span style={{ color: 'var(--ink)', flex: 1 }}>{d.name}</span>
              <span style={pill('var(--ink-muted)', 'var(--line)')}>{d.subjectType}</span>
              {d.isSystem && <span style={pill('var(--info)', 'rgba(59,130,246,0.3)')}>platform</span>}
              {!d.isActive && <span style={pill('var(--ink-faint)', 'var(--line)')}>inactive</span>}
              <span style={{ color: 'var(--ink-muted)', minWidth: 130, textAlign: 'right' }}>
                {(d.steps || []).length} step{(d.steps || []).length === 1 ? '' : 's'} · {d.runCount} run
                {d.runCount === 1 ? '' : 's'}
              </span>
              <Can do={MAY.AUTHOR_WORKFLOW}>
                <button
                  onClick={() => { setError(''); setEditing(d); }}
                  style={ghostBtn}
                  disabled={busy || d.isSystem}
                  title={d.isSystem ? 'Platform workflows are copied, not edited' : undefined}
                >
                  Edit
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <FormDialog
          title={editing ? `Edit ${editing.key}` : 'New workflow'}
          intro={
            editing
              ? 'Runs already started keep the steps they began with. Only new runs follow this version.'
              : 'A step names a capability rather than a person, so the route survives somebody leaving.'
          }
          fields={fields(editing)}
          submitLabel={busy ? 'Saving…' : 'Save'}
          busy={busy}
          onSubmit={save}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
};

export default WorkflowDefinitions;
