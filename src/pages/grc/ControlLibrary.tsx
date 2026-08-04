import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

interface Mapping { standardCode: string; clauseRef: string; clauseTitle: string }
interface Control {
  id: string; code: string; title: string; objective: string; domain: string;
  isLibrary: boolean; mappedTo: Mapping[];
  implementationCount: number; implemented: number; verified: number;
}

const ControlLibrary: React.FC = () => {
  const [controls, setControls] = useState<Control[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [standardFilter, setStandardFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/grc/controls');
      setControls(res.data?.controls || []);
      setDomains(res.data?.domains || []);
      setScope(res.data?.scope || '');
    } catch (err) { setError(apiError(err, 'Failed to load the control library')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const allStandards = [...new Set(controls.flatMap((c) => c.mappedTo.map((m) => m.standardCode)))].sort();

  const q = search.toLowerCase();
  const visible = controls.filter((c) => {
    if (domainFilter && c.domain !== domainFilter) return false;
    if (standardFilter && !c.mappedTo.some((m) => m.standardCode === standardFilter)) return false;
    if (q && !c.title.toLowerCase().includes(q) && !c.code.toLowerCase().includes(q)
        && !c.objective.toLowerCase().includes(q)) return false;
    return true;
  });

  const totalImpl = controls.reduce((a, c) => a + c.implementationCount, 0);
  const totalVerified = controls.reduce((a, c) => a + c.verified, 0);
  const covered = controls.filter((c) => c.implementationCount > 0).length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>Mandated controls</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Library controls mapped to framework clauses. Scope: <strong style={{ color: '#93c5fd' }}>{scope || '—'}</strong>
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Controls', controls.length],
        ['Covered by an implementation', <span style={{ color: covered === controls.length ? '#86efac' : '#fbbf24' }}>{covered}</span>],
        ['Implementations', totalImpl],
        ['Verified', <span style={{ color: '#86efac' }}>{totalVerified}</span>],
        ['Clause mappings', controls.reduce((a, c) => a + c.mappedTo.length, 0)],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Search code, title or objective…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 280 }} />
        <select value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} style={{ ...S.input, maxWidth: 200 }}>
          <option value="">All domains</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={standardFilter} onChange={(e) => setStandardFilter(e.target.value)} style={{ ...S.input, maxWidth: 180 }}>
          <option value="">All frameworks</option>
          {allStandards.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading controls…</div>
      ) : (
        <div style={{ ...S.card, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={S.headRow}>
                {['Control', 'Domain', 'Mapped to', 'Implementations', 'Verified'].map((h) => <th key={h} style={S.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <React.Fragment key={c.id}>
                  <tr style={S.bodyRow}>
                    <td style={S.td}>
                      <button onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        style={{ ...linkBtn('#e2e8f0'), fontSize: 12, padding: 0, textAlign: 'left' }}>
                        {expanded === c.id ? '▾' : '▸'} <strong>{c.code}</strong> — {c.title}
                      </button>
                    </td>
                    <td style={{ ...S.td, color: '#94a3b8' }}>{c.domain}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {[...new Set(c.mappedTo.map((m) => m.standardCode))].map((s) => (
                          <span key={s} style={pill('#93c5fd', '#1e3a8a')}>{s}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...S.td, color: c.implementationCount === 0 ? '#fbbf24' : '#cbd5e1' }}>
                      {c.implementationCount}
                    </td>
                    <td style={{ ...S.td, color: c.verified > 0 ? '#86efac' : '#475569' }}>{c.verified}</td>
                  </tr>
                  {expanded === c.id && (
                    <tr style={{ background: '#0b1220' }}>
                      <td colSpan={5} style={{ padding: '12px 16px' }}>
                        <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 10, lineHeight: 1.6 }}>
                          {c.objective}
                        </div>
                        <div style={{ fontSize: 10, color: '#475569', marginBottom: 6 }}>CLAUSE MAPPINGS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 6 }}>
                          {c.mappedTo.map((m) => (
                            <div key={`${m.standardCode}-${m.clauseRef}`} style={{
                              background: '#0f172a', border: '1px solid #16202f', borderRadius: 6, padding: '6px 10px',
                            }}>
                              <span style={{ color: '#93c5fd', fontSize: 11 }}>{m.standardCode} {m.clauseRef}</span>
                              <div style={{ color: '#64748b', fontSize: 11 }}>{m.clauseTitle}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: '#64748b' }}>No controls match the filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ControlLibrary;
