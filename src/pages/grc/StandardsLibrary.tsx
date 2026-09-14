import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import FormDialog from '../../components/FormDialog';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { MAY, can } from '../../components/Can';

interface Enablement { tenantId: string; tenantName: string; applicability: string; owner: any; enabledAt: string }
interface Standard {
  id: string; code: string; title: string; authority: string; version: string;
  description: string | null; clauseCount: number; enabledFor: Enablement[]; isEnabledHere: boolean;
}

const StandardsLibrary: React.FC = () => {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/grc/standards');
      setStandards(res.data?.standards || []);
      setScope(res.data?.scope || '');
    } catch (err) { setError(apiError(err, 'Failed to load standards')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Applicability was typed into a prompt as one of three words and checked by
  // the server afterwards, so "Partial " or "full" came back as a 400.
  const [enabling, setEnabling] = useState<any | null>(null);

  const enable = async (s: Standard, applicability: string) => {
    setEnabling(null);
    setBusy(s.id);
    try {
      const res = await apiClient.post('/api/grc/standards/enable', {
        standardId: s.id,
        applicability,
      });
      setNotice(res.data?.message || `${s.code} enabled`);
      await load();
    } catch (err) { setError(apiError(err, 'Could not enable standard')); }
    finally { setBusy(null); }
  };

  const enabledCount = standards.filter((s) => s.isEnabledHere).length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Standards &amp; frameworks</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Enable a framework to record that an entity is assessed against it. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Frameworks', standards.length],
        ['Enabled here', <span style={{ color: enabledCount > 0 ? 'var(--success)' : 'var(--warning)' }}>{enabledCount}</span>],
        ['Clauses in library', standards.reduce((a, s) => a + s.clauseCount, 0)],
        [scope === 'PLATFORM' ? 'Enablements platform-wide' : 'Enablements in scope', standards.reduce((a, s) => a + (s.enabledFor?.length || 0), 0)],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 10, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 12 }}>{notice}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading standards…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 12 }}>
          {standards.map((s) => (
            <div key={s.id} style={{ ...S.card, padding: 16, borderColor: s.isEnabledHere ? 'var(--success)' : 'var(--ink)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: 14, color: 'var(--ink-body)' }}>{s.code}</strong>
                {s.isEnabledHere
                  ? <span style={pill('var(--success)', 'var(--success-line)')}>enabled</span>
                  : <span style={pill('var(--ink-muted)', 'var(--line)')}>not enabled</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-body)', marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 10 }}>
                {s.authority} · v{s.version} · {s.clauseCount} clauses
              </div>
              {s.description && (
                <div style={{ fontSize: 11, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 12 }}>{s.description}</div>
              )}

              {s.enabledFor.length > 0 && (
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-body)', marginBottom: 5 }}>ENABLED FOR</div>
                  {s.enabledFor.map((e) => (
                    <div key={e.tenantId} style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 3 }}>
                      {e.tenantName} <span style={{ color: 'var(--ink-body)' }}>· {e.applicability}</span>
                      {e.owner && <span style={{ color: 'var(--ink-body)' }}> · {e.owner.name}</span>}
                    </div>
                  ))}
                </div>
              )}

              {can(MAY.AUTHOR_STANDARD) && !s.isEnabledHere && (
                <button onClick={() => setEnabling(s)} disabled={busy === s.id} style={{ ...primaryBtn(busy === s.id), width: '100%' }}>
                  {busy === s.id ? 'Enabling…' : 'Enable for my entity'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {enabling && (
        <FormDialog
          title={`Enable ${enabling.code}`}
          intro={(
            <>
              <div>{enabling.title}</div>
              {/* This said enabling brings the clauses into scope, so they
                  appear in the coverage report and in what controls can be
                  mapped against. None of the three is true today: listClauses
                  filters on who OWNS the standard, exportFrameworkCoverage
                  spans every standard in scope, and clause mapping checks
                  ownership as well. Enablement is recorded and displayed and
                  read by nothing else.

                  Saying so is not a retreat. A compliance product that
                  describes a control it does not implement is the same defect
                  as one that invents data, and it is acted on the same way. */}
              <div style={{ marginTop: 8, color: 'var(--ink-muted)' }}>
                Enabling records that this entity is assessed against the framework. It appears
                in the entity's standards library and in its framework inventory. It does not
                yet change which clauses or controls the entity can see.
              </div>
            </>
          )}
          submitLabel="Enable standard"
          fields={[{
            name: 'applicability',
            label: 'Applicability',
            type: 'select',
            options: ['Full', 'Partial', 'Not applicable'],
            // This said the coverage report reads applicability when deciding
            // what counts as a gap. Nothing reads it: the value is stored on the
            // enablement row and echoed back on this screen, and the coverage
            // report spans every standard in scope regardless. Describing a
            // control that does not exist is worse than offering none, because
            // it is acted on.
            help: 'Recorded against this entity for reference. It does not yet change what the '
              + 'coverage report counts as a gap.',
          }]}
          onSubmit={(v) => enable(enabling, v.applicability)}
          onCancel={() => setEnabling(null)}
        />
      )}
    </div>
  );
};

export default StandardsLibrary;
