import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, ghostBtn, primaryBtn, apiError } from '../../iam/iamStyles';

/**
 * The five delivery reports, and the register of what has already left.
 *
 * Two things this screen is deliberate about.
 *
 * The register is shown beside the buttons rather than on a page of its own,
 * because the useful moment to see who already has a copy is just before making
 * another one.
 *
 * And issuing is a separate, heavier action from exporting — not a checkbox
 * tucked beside the format. An issue is numbered, keeps its figures, and is
 * what somebody will cite in six months; an export is a working copy. Making
 * them look alike is how a working copy ends up quoted as the issued position.
 */

interface Phase { id: string; sequence: number; name: string }

interface RegisterRow {
  id: string;
  reportKey: string;
  reportName: string;
  documentRef: string;
  issueNumber: number;
  format: string;
  marking: string;
  fileName: string;
  fileBytes: number | null;
  documentHash: string;
  issued: boolean;
  snapshot: string;
  issuedAt: string;
  issuedBy: { id: string; name: string; email: string } | null;
}

const REPORTS: { kind: string; name: string; reader: string }[] = [
  {
    kind: 'status',
    name: 'Engagement status',
    reader: 'For a steering committee. What is landing, what is in the way, and what '
      + 'they are being asked to decide.',
  },
  {
    kind: 'phase',
    name: 'Phase delivery',
    reader: 'For a phase owner, weekly. Who owes what, split by whether it is the '
      + 'assignee or a reviewer holding it up.',
  },
  {
    kind: 'audit',
    name: 'Delivery audit',
    reader: 'For an external auditor. Lets them test the confirmed figure rather '
      + 'than take it, line by line.',
  },
  {
    kind: 'delay',
    name: 'Delay and impediment',
    reader: 'For a contract review. Days lost, attributed to the side that owed '
      + 'them, defensible line by line.',
  },
  {
    kind: 'evidence',
    name: 'Evidence and traceability',
    reader: 'For certification readiness. What each clause is addressed by, and '
      + 'which clauses nothing addresses at all.',
  },
];

const FORMATS = ['pdf', 'docx', 'xlsx'];

const fmtBytes = (n: number | null): string =>
  n === null ? '—' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(0)} KB`;

const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

const ProjectReports: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [register, setRegister] = useState<RegisterRow[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [format, setFormat] = useState('pdf');
  const [phaseId, setPhaseId] = useState('');
  const [issuedOnly, setIssuedOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [reg, plan] = await Promise.all([
        apiClient.get(`/api/projects/${projectId}/reports${issuedOnly ? '?issued=true' : ''}`),
        apiClient.get(`/api/projects/${projectId}/plan`),
      ]);
      setRegister(reg.data?.register || []);
      setSummary(reg.data?.summary || null);
      const ph = (plan.data?.phases || []).map((p: any) => ({
        id: p.id, sequence: p.sequence, name: p.name,
      }));
      setPhases(ph);
      if (!phaseId && ph.length) setPhaseId(ph[0].id);
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, issuedOnly, phaseId]);

  useEffect(() => { load(); }, [load]);

  /**
   * Fetch through the authenticated endpoint and hand the bytes to the browser.
   *
   * Deliberately not an <a href>: the export is a POST-shaped act with an audit
   * entry behind it, and a plain link would produce a download the register
   * could not attribute to anyone.
   */
  const run = async (kind: string, issue: boolean) => {
    if (kind === 'phase' && !phaseId) {
      setError('Choose a phase first — a phase report needs to know which one.');
      return;
    }
    setBusy(`${kind}:${issue}`);
    setError('');
    try {
      const params = new URLSearchParams({ format });
      if (kind === 'phase') params.set('phaseId', phaseId);
      if (issue) params.set('issue', 'true');

      const res = await apiClient.get(
        `/api/projects/${projectId}/reports/${kind}?${params.toString()}`,
        { responseType: 'blob' },
      );

      const disposition = String(res.headers?.['content-disposition'] || '');
      const named = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = named ? named[1] : `${kind}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      await load();
    } catch (err: any) {
      setError(apiError(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading reports…</div>;
  }

  return (
    <div>
      {error && <div style={S.error}>{error}</div>}

      {/* ── Format, and the phase a phase report is about ──────────────── */}
      <div style={{
        ...S.card, padding: '14px 18px', marginBottom: 16,
        display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <label style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
          Format
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            style={{ ...S.input, marginLeft: 8, width: 110, padding: '5px 8px' }}
          >
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>

        {phases.length > 0 && (
          <label style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
            Phase
            <select
              value={phaseId}
              onChange={(e) => setPhaseId(e.target.value)}
              style={{ ...S.input, marginLeft: 8, width: 240, padding: '5px 8px' }}
            >
              {phases.map((p) => (
                <option key={p.id} value={p.id}>{p.sequence}. {p.name}</option>
              ))}
            </select>
          </label>
        )}

        {summary && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)' }}>
            {summary.issued} issued · {summary.exports} working {summary.exports === 1 ? 'copy' : 'copies'}
          </span>
        )}
      </div>

      {/* ── The five ───────────────────────────────────────────────────── */}
      {REPORTS.map((r) => (
        <div key={r.kind} style={{ ...S.card, padding: '16px 18px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3, maxWidth: 620 }}>
                {r.reader}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={ghostBtn}
                disabled={!!busy}
                onClick={() => run(r.kind, false)}
                title="A working copy. Recorded, but not numbered and not kept."
              >
                {busy === `${r.kind}:false` ? 'Building…' : 'Export'}
              </button>
              <button
                style={primaryBtn(!!busy)}
                disabled={!!busy}
                onClick={() => run(r.kind, true)}
                title="Numbered, and its figures are kept. This is the copy people cite."
              >
                {busy === `${r.kind}:true` ? 'Issuing…' : 'Issue'}
              </button>
            </div>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '14px 2px 18px', lineHeight: 1.6 }}>
        An <strong>export</strong> is a working copy — recorded, so the register can say who
        took one, but not numbered. An <strong>issue</strong> is numbered and keeps the figures
        as they stood, so what changed between issue 2 and issue 3 stays answerable without
        opening either file. A report on an engagement that is not closed carries a DRAFT
        banner on every page either way.
      </div>

      {/* ── Who already has a copy ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 13.5 }}>
          What has left this engagement
        </div>
        <label style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={issuedOnly}
            onChange={(e) => setIssuedOnly(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Issued only
        </label>
      </div>

      {register.length === 0 ? (
        <div style={{ ...S.card, padding: '34px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
            {issuedOnly
              ? 'Nothing has been formally issued yet.'
              : 'No report has been produced from this engagement yet.'}
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr>
                  {['Report', 'Reference', 'By', 'When', 'Marking', ''].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {register.map((row) => (
                  <tr key={row.id}>
                    <td style={S.td}>
                      <div style={{ color: 'var(--ink)', fontWeight: 500 }}>
                        {row.reportName}
                        {row.issued && (
                          <span style={{ ...pill('var(--success)', 'var(--success-line)'), marginLeft: 8 }}>
                            Issue {row.issueNumber}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                        {row.format.toUpperCase()} · {fmtBytes(row.fileBytes)}
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 11.5, fontFamily: 'monospace' }}>
                      {row.documentRef}
                    </td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{row.issuedBy?.name ?? '—'}</td>
                    <td style={{ ...S.td, fontSize: 12.5 }}>{fmtWhen(row.issuedAt)}</td>
                    <td style={S.td}>
                      <span style={pill('var(--ink-muted)', 'var(--line)')}>{row.marking}</span>
                    </td>
                    <td style={{ ...S.td, fontSize: 10.5, color: 'var(--ink-faint)', fontFamily: 'monospace' }}
                        title={`Content hash: ${row.documentHash}`}>
                      {row.documentHash.slice(0, 12)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {register.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginTop: 10, lineHeight: 1.6 }}>
          The hash covers what a report <em>says</em>, not how it was drawn — two copies in
          different formats carrying the same figures hash alike, and a copy whose figures
          moved does not.
        </div>
      )}
    </div>
  );
};

export default ProjectReports;
