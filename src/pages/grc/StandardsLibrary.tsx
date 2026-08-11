import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

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

  const enable = async (s: Standard) => {
    const applicability = window.prompt(`Applicability for ${s.code} (Full / Partial / Not applicable):`, 'Full');
    if (!applicability) return;
    setBusy(s.id);
    try {
      const res = await apiClient.post('/api/grc/standards/enable', { standardId: s.id, applicability });
      setNotice(res.data?.message || `${s.code} enabled`);
      await load();
    } catch (err) { window.alert(apiError(err, 'Could not enable standard')); }
    finally { setBusy(null); }
  };

  const enabledCount = standards.filter((s) => s.isEnabledHere).length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Standards &amp; frameworks</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Enable a framework to bring its clauses into scope. Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Frameworks', standards.length],
        ['Enabled here', <span style={{ color: enabledCount > 0 ? 'var(--success)' : 'var(--warning)' }}>{enabledCount}</span>],
        ['Clauses in library', standards.reduce((a, s) => a + s.clauseCount, 0)],
        ['Entity enablements', standards.reduce((a, s) => a + s.enabledFor.length, 0)],
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

              {!s.isEnabledHere && (
                <button onClick={() => enable(s)} disabled={busy === s.id} style={{ ...primaryBtn(busy === s.id), width: '100%' }}>
                  {busy === s.id ? 'Enabling…' : 'Enable for my entity'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StandardsLibrary;
