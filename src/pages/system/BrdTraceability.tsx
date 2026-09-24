import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill , apiError } from '../iam/iamStyles';

interface TraceItem {
  id: string;
  trdRef: string;
  section: string;
  title: string;
  requirement: string;
  implementation: string;
  /** Verified only while no open defect names this requirement. */
  status: string;
  /** What the requirement was declared as, before the checks were applied. */
  claimedStatus?: string;
  /** Open defects the build's checks hold against this requirement. */
  openDefects?: { id: string; severity: string; title: string }[];
}

interface BrdData {
  totalRequirements: number;
  verifiedCount: number;
  compliancePercentage: number;
  matrix: TraceItem[];
}

/**
 * Requirement traceability, as the server reports it.
 *
 * On any failure this page substituted a hardcoded matrix and declared
 * compliancePercentage 100 with every requirement verified. A traceability
 * matrix exists to show what is and is not covered; one that reports full
 * coverage when it cannot read anything is worse than a blank screen, because
 * a blank screen is not evidence of anything.
 */
const BrdTraceability: React.FC = () => {
  const [data, setData] = useState<BrdData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSection, setSelectedSection] = useState('All');
  const [detailItem, setDetailItem] = useState<TraceItem | null>(null);

  const loadBrd = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/system/brd');
      setData(res.data?.status === 'success' ? res.data : null);
      if (res.data?.status !== 'success') {
        setError('The traceability endpoint answered without a matrix.');
      }
    } catch (err) {
      setError(apiError(err, 'Could not load the traceability matrix.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBrd(); }, [loadBrd]);

  const matrix = data?.matrix || [];
  const openDefectIds = new Set(matrix.flatMap((m) => (m.openDefects || []).map((d) => d.id)));
  const saudiRows = matrix.filter((m) => m.section === 'Saudi Compliance');
  const saudi = { total: saudiRows.length, verified: saudiRows.filter((m) => m.status === 'Verified').length };
  const sections = ['All', ...new Set(matrix.map(m => m.section))];

  const filtered = matrix.filter(m => {
    const matchesSec = selectedSection === 'All' || m.section === selectedSection;
    const matchesSearch = !search.trim() ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.requirement.toLowerCase().includes(search.toLowerCase()) ||
      m.trdRef.toLowerCase().includes(search.toLowerCase());
    return matchesSec && matchesSearch;
  });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>BRD & TRD Requirement Traceability Matrix</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>Traceability mapping of Business Requirements & Technical Specifications to codebase implementations</div>
        </div>
        <button style={ghostBtn} onClick={loadBrd} disabled={loading}>↻ Refresh</button>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {/* Every card from the server's matrix. These read "100% (42/42)" and
          "PASSED & AUDITED" as fixed text, above rows the checks marked Not
          verified -- the headline contradicting the table under it. */}
      <StatStrip items={[
        ['Requirements verified', data
          ? <span style={{ color: data.verifiedCount === data.totalRequirements ? 'var(--success)' : 'var(--danger)' }}>
              {data.compliancePercentage}% ({data.verifiedCount}/{data.totalRequirements})
            </span>
          : '—'],
        ['Core Requirements', matrix.length],
        ['Open defects against them', data
          ? <span style={{ color: openDefectIds.size ? 'var(--danger)' : 'var(--success)' }}>{openDefectIds.size}</span>
          : '—'],
        ['Saudi compliance verified', data
          ? <span style={{ color: saudi.verified === saudi.total ? 'var(--success)' : 'var(--danger)' }}>{saudi.verified} of {saudi.total}</span>
          : '—'],
      ]} />

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search requirement, TRD section, title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 300 }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sections.map(sec => (
            <button
              key={sec}
              onClick={() => setSelectedSection(sec)}
              style={{
                ...ghostBtn,
                padding: '5px 12px',
                fontSize: 11,
                ...(selectedSection === sec ? { background: 'var(--surface-sunk)', color: 'var(--ink-body)', borderColor: 'var(--info-line)' } : {})
              }}
            >
              {sec}
            </button>
          ))}
        </div>
      </div>

      {/* Traceability Table */}
      <div style={{ ...S.card, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={S.headRow}>
              <th style={S.th}>Req ID & Ref</th>
              <th style={S.th}>Section</th>
              <th style={S.th}>Requirement Title</th>
              <th style={S.th}>Code Implementation Path</th>
              <th style={S.th}>Status</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr key={m.id} style={S.bodyRow}>
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{m.id}</div>
                  <div style={{ fontSize: 10, color: 'var(--info)', fontFamily: "'JetBrains Mono',monospace" }}>{m.trdRef}</div>
                </td>
                <td style={S.td}><span style={pill('var(--info)', 'var(--info-line)')}>{m.section}</span></td>
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{m.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.requirement}</div>
                </td>
                <td style={{ ...S.td, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--success)' }}>{m.implementation}</td>
                <td style={S.td}>
                  {/* Green only when the checks agree: the server withholds
                      Verified while an open defect names the requirement. */}
                  <span style={m.status === 'Verified' ? pill('var(--success)', 'var(--success-line)') : pill('var(--danger)', 'var(--danger-line)')}>{m.status}</span>
                  {!!m.openDefects?.length && (
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 4 }}>
                      Open: {m.openDefects.map((d) => d.id).join(', ')}
                    </div>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: 'right' }}>
                  <button style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }} onClick={() => setDetailItem(m)}>
                    View Clause
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ ...S.td, textAlign: 'center', color: 'var(--ink-muted)', padding: 32 }}>No requirements match your filter query.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Clause Detail Modal */}
      {detailItem && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }} onClick={() => setDetailItem(null)}>
          <div onClick={e => e.stopPropagation()} style={{ ...S.card, padding: 28, width: 500, maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, color: 'var(--ink)' }}>{detailItem.id}: {detailItem.title}</h3>
            <div style={{ fontSize: 12, color: 'var(--info)', fontFamily: "'JetBrains Mono',monospace", marginBottom: 14 }}>{detailItem.trdRef} — {detailItem.section}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Requirement Description</div>
              <div style={{ color: 'var(--ink-body)', fontSize: 13, lineHeight: 1.5 }}>{detailItem.requirement}</div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 4 }}>Implementation Code Reference</div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', padding: 10, borderRadius: 6, fontSize: 12, color: 'var(--success)', fontFamily: "'JetBrains Mono',monospace" }}>
                {detailItem.implementation}
              </div>
            </div>
            {!!detailItem.openDefects?.length && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--danger)', marginBottom: 6 }}>
                  Not verified: {detailItem.openDefects.length === 1 ? 'an open defect contradicts' : `${detailItem.openDefects.length} open defects contradict`} this requirement
                </div>
                {detailItem.openDefects.map((d) => (
                  <div key={d.id} style={{ fontSize: 12.5, color: 'var(--ink-body)', lineHeight: 1.5 }}>
                    <strong>{d.id}</strong> ({d.severity}): {d.title}
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button style={ghostBtn} onClick={() => setDetailItem(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrdTraceability;
