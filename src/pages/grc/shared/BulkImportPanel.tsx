import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import Icon from '../../../components/Icon';

/**
 * Staged bulk import, shared by the asset and risk registers.
 *
 * The two differ in what a row means and which columns a reviewer needs to see,
 * and in nothing else — so the upload, review, correct and commit flow lives
 * here once. Both registers stage rather than import directly: a mis-read value
 * in either propagates into scores that end up in a board pack, so a person
 * confirms what the parser understood before anything is written.
 */

export type ImportColumn = {
  header: string;
  /** Cell content for a parsed row. Return a string or a node. */
  render: (parsed: any) => React.ReactNode;
  /** Right-align and use tabular figures. */
  numeric?: boolean;
};

export type CorrectionField =
  | { key: string; label: string; kind: 'text'; placeholder?: string }
  | { key: string; label: string; kind: 'select'; options: string[]; optionLabel?: (v: string) => string }
  | { key: string; label: string; kind: 'scale' };

export type ImportConfig = {
  /** Path segment, e.g. "assets" or "risks". */
  resource: string;
  /** Candidate PATCH path segment, e.g. "asset-candidates". */
  candidateResource: string;
  templateFileName: string;
  /** Singular noun as a user would say it: "asset", "risk". */
  noun: string;
  nounPlural: string;
  intro: React.ReactNode;
  /** What commit will do, shown in the confirmation. */
  commitCaveat: string;
  columns: ImportColumn[];
  correctionFields: CorrectionField[];
  /** Extra signal beside the parser verdict, e.g. possible duplicates. */
  renderSignal?: (candidate: any) => React.ReactNode;
};

const CONFIDENCE: Record<string, { fg: string; line: string; help: string }> = {
  High: { fg: 'var(--success)', line: 'var(--success-line)', help: 'Every value was read from the file; nothing was assumed.' },
  Medium: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Something was assumed, or this resembles a record already on the register.' },
  Low: { fg: 'var(--danger)', line: 'var(--danger-line)', help: 'Cannot be imported as it stands.' },
};

const STATUS_PILL: Record<string, React.CSSProperties> = {
  Pending: pill('var(--ink-muted)', 'var(--line)'),
  Accepted: pill('var(--success)', 'var(--success-line)'),
  Rejected: pill('var(--ink-faint)', 'var(--line)'),
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4,
  letterSpacing: '0.03em', fontWeight: 600,
};

const BulkImportPanel: React.FC<{ config: ImportConfig; onCommitted?: () => void }> = ({ config, onCommitted }) => {
  const [imports, setImports] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [uploadInfo, setUploadInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = `/api/grc/${config.resource}`;

  const loadList = useCallback(async () => {
    try {
      const r = await apiClient.get(`${base}/imports`);
      setImports(r.data?.imports || []);
    } catch (err) { setError(apiError(err, 'Failed to load imports')); }
  }, [base]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await apiClient.get(`${base}/imports/${id}`);
      setDetail(r.data || null);
      setOpenId(id);
    } catch (err) { setError(apiError(err, 'Failed to load the import')); }
  }, [base]);

  useEffect(() => { loadList(); }, [loadList]);

  const downloadTemplate = async () => {
    try {
      const res = await apiClient.get(`${base}/import/template`, { responseType: 'blob' });
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href; a.download = config.templateFileName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (err) { window.alert(apiError(err)); }
  };

  const upload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'csv'].includes(ext)) {
      setError('A register is imported from a spreadsheet — .xlsx or .csv. A PDF has no columns to map.');
      return;
    }
    setBusy(true); setError(''); setUploadInfo(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await apiClient.post(`${base}/import`, {
        fileName: file.name, fileType: ext, contentBase64: base64,
      });
      setUploadInfo(res.data);
      setNotice(res.data?.message || 'File read');
      await loadList();
      if (res.data?.import?.id) await loadDetail(res.data.import.id);
    } catch (err) { setError(apiError(err, 'Could not read that file')); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const act = async (url: string, fallback: string) => {
    try {
      const res = await apiClient.post(url, {});
      setNotice(res.data?.message || fallback);
      if (openId) await loadDetail(openId);
      await loadList();
    } catch (err) { window.alert(apiError(err)); }
  };

  const setRowStatus = async (candidateId: string, status: string) => {
    try {
      const res = await apiClient.patch(`/api/grc/${config.candidateResource}/${candidateId}`, { status });
      setNotice(res.data?.message || 'Row updated');
      if (openId) await loadDetail(openId);
    } catch (err) { window.alert(apiError(err)); }
  };

  const saveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.patch(`/api/grc/${config.candidateResource}/${editing.id}`, {
        corrections: editing.corrections,
        // Correcting a row and accepting it is one action, not two.
        status: 'Accepted',
      });
      setEditing(null);
      setNotice(res.data?.message || 'Row corrected and accepted');
      if (openId) await loadDetail(openId);
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!detail) return;
    const n = detail.totals?.accepted ?? 0;
    if (!window.confirm(
      `Add ${n} ${n === 1 ? config.noun : config.nounPlural} to the register?\n\n${config.commitCaveat}`,
    )) return;
    setBusy(true);
    try {
      const res = await apiClient.post(`${base}/imports/${openId}/commit`, {});
      setNotice(res.data?.message || 'Committed');
      await loadDetail(openId!);
      await loadList();
      onCommitted?.();
    } catch (err) { window.alert(apiError(err)); }
    finally { setBusy(false); }
  };

  const t = detail?.totals || {};
  const imp = detail?.import;
  const live = imp?.status === 'Extracted';

  return (
    <div>
      {error && (
        <div style={S.error}>
          <Icon name="warning" size={15} /><span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError('')} style={linkBtn('var(--danger)')}>dismiss</button>
        </div>
      )}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} /><span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {/* ── Upload ────────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 380px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--ink)' }}>
              Import {config.nounPlural} from a spreadsheet
            </h3>
            <div style={{ fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: '42rem' }}>
              {config.intro}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--ink-body)' }}>
              <strong>Nothing enters the register on upload.</strong> You review what the parser
              understood, correct what it got wrong, then commit.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={downloadTemplate} style={{ ...ghostBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="download" size={15} /> Template
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ ...primaryBtn(busy), display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="upload" size={15} /> {busy ? 'Reading…' : 'Choose file'}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          </div>
        </div>

        {uploadInfo && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink-body)' }}>
              {uploadInfo.headerRow && (
                <span><span style={label}>Header found</span>row {uploadInfo.headerRow}</span>
              )}
              <span style={{ flex: '1 1 340px' }}>
                <span style={label}>Columns mapped</span>
                {Object.entries(uploadInfo.columnsUsed || {}).map(([k, v]) => `${k} ← "${v}"`).join(' · ') || 'none'}
              </span>
            </div>
            {(uploadInfo.unmappedColumns || []).length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-muted)' }}>
                <strong style={{ color: 'var(--ink-body)' }}>Ignored:</strong>{' '}
                {uploadInfo.unmappedColumns.join(', ')} — listed so nothing is dropped silently.
              </div>
            )}
            {(uploadInfo.warnings || []).map((w: string, i: number) => (
              <div key={i} style={{ marginTop: 10, padding: '9px 12px', background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, color: 'var(--warning)' }}>
                {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Review ────────────────────────────────────────────────────── */}
      {detail && (
        <>
          <div style={{ ...S.card, padding: '16px 20px', marginBottom: 14, display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>{imp?.fileName}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 3 }}>
                {t.total} row(s) · {t.accepted} accepted · {t.blocked} blocked
                {t.duplicates > 0 && <> · {t.duplicates} resembling an existing record</>}
                {' '}· {t.pending} still to review
                {imp?.status !== 'Extracted' && <> · <strong style={{ color: 'var(--ink-body)' }}>{imp?.status}</strong></>}
              </div>
            </div>
            {live && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={ghostBtn} onClick={() => act(`${base}/imports/${openId}/accept-clean`, 'Clean rows accepted')}>
                  Accept the {t.high ?? 0} clean row(s)
                </button>
                <button style={primaryBtn(busy || (t.accepted ?? 0) === 0)} disabled={busy || (t.accepted ?? 0) === 0} onClick={commit}>
                  Commit {t.accepted ?? 0} to the register
                </button>
                <button style={linkBtn('var(--ink-faint)')}
                  onClick={() => {
                    if (window.confirm('Discard this import? Nothing has been written to the register.')) {
                      act(`${base}/imports/${openId}/discard`, 'Discarded');
                    }
                  }}>
                  discard
                </button>
              </div>
            )}
          </div>

          <div style={{ ...S.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
              <thead>
                <tr style={S.headRow}>
                  <th style={S.th}>Row</th>
                  {config.columns.map((c) => <th key={c.header} style={S.th}>{c.header}</th>)}
                  <th style={S.th}>Parser</th>
                  <th style={S.th}>State</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(detail.candidates || []).map((c: any) => {
                  const p = c.parsed || {};
                  const conf = CONFIDENCE[c.confidence] || CONFIDENCE.Medium;
                  return (
                    <tr key={c.id} style={{ ...S.bodyRow, background: c.issue ? 'var(--danger-bg)' : undefined }}>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-faint)' }}>{c.rowNumber}</td>
                      {config.columns.map((col) => (
                        <td key={col.header} style={{
                          ...S.td,
                          fontVariantNumeric: col.numeric ? 'tabular-nums' : undefined,
                        }}>
                          {col.render(p)}
                        </td>
                      ))}
                      <td style={S.td}>
                        <span style={pill(conf.fg, conf.line)} title={conf.help}>{c.confidence}</span>
                        {c.body && (
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3, maxWidth: 250 }}>{c.body}</div>
                        )}
                        {config.renderSignal?.(c)}
                        {c.issue && (
                          <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3, maxWidth: 270, fontWeight: 600 }}>
                            {c.issue}
                          </div>
                        )}
                      </td>
                      <td style={S.td}><span style={STATUS_PILL[c.status] || STATUS_PILL.Pending}>{c.status}</span></td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        {live && (
                          <>
                            {c.issue ? (
                              <button style={linkBtn('var(--info)')}
                                onClick={() => setEditing({ id: c.id, parsed: p, issue: c.issue, corrections: {} })}>
                                fix
                              </button>
                            ) : c.status !== 'Accepted' ? (
                              <button style={linkBtn('var(--success)')} onClick={() => setRowStatus(c.id, 'Accepted')}>accept</button>
                            ) : (
                              <button style={linkBtn('var(--ink-faint)')} onClick={() => setRowStatus(c.id, 'Pending')}>undo</button>
                            )}
                            {!c.issue && c.status !== 'Rejected' && (
                              <button style={linkBtn('var(--ink-faint)')} onClick={() => setRowStatus(c.id, 'Rejected')}>skip</button>
                            )}
                            {!c.issue && (
                              <button style={linkBtn('var(--info)')}
                                onClick={() => setEditing({ id: c.id, parsed: p, issue: null, corrections: {} })}>
                                edit
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(detail.candidates || []).length === 0 && (
                  <tr><td colSpan={config.columns.length + 4} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>
                    Nothing was read from this file.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Previous imports ──────────────────────────────────────────── */}
      {imports.length > 0 && (
        <>
          <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-muted)', margin: '26px 0 10px' }}>
            Import history
          </h3>
          <div style={{ ...S.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={S.headRow}>
                  {['File', 'Uploaded by', 'Rows read', 'Committed', 'State', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} style={S.bodyRow}>
                    <td style={{ ...S.td, color: 'var(--ink)' }}>{i.fileName}</td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{i.uploadedBy?.name}</td>
                    <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{i.extractedCount}</td>
                    <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>{i.committedCount || '—'}</td>
                    <td style={S.td}>
                      <span style={i.status === 'Committed' ? pill('var(--success)', 'var(--success-line)')
                        : i.status === 'Discarded' ? pill('var(--ink-faint)', 'var(--line)')
                          : pill('var(--warning)', 'var(--warning-line)')}>
                        {i.status}
                      </span>
                    </td>
                    <td style={S.td}>
                      <button style={linkBtn('var(--info)')} onClick={() => loadDetail(i.id)}>open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Correct a row ─────────────────────────────────────────────── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 910, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 560, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>
                {editing.issue ? 'Fix this row' : 'Edit this row'}
              </h3>
              <button onClick={() => setEditing(null)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            {editing.issue && (
              <div style={{ ...S.error, marginBottom: 16 }}>
                <Icon name="warning" size={15} /><span>{editing.issue}</span>
              </div>
            )}

            <form onSubmit={saveCorrection}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                {config.correctionFields.map((f) => {
                  const value = editing.corrections[f.key] ?? editing.parsed[f.key] ?? '';
                  const set = (v: any) => setEditing({
                    ...editing, corrections: { ...editing.corrections, [f.key]: v },
                  });
                  return (
                    <div key={f.key} style={{ gridColumn: f.kind === 'text' && f.key === 'title' ? '1 / -1' : undefined }}>
                      <label style={label}>{f.label}</label>
                      {f.kind === 'text' && (
                        <input value={value} placeholder={f.placeholder}
                          onChange={(e) => set(e.target.value)} style={S.input} />
                      )}
                      {f.kind === 'select' && (
                        <select value={value} onChange={(e) => set(e.target.value)} style={S.input}>
                          {f.options.map((o) => (
                            <option key={o} value={o}>{f.optionLabel ? f.optionLabel(o) : o}</option>
                          ))}
                        </select>
                      )}
                      {f.kind === 'scale' && (
                        <select value={value} onChange={(e) => set(Number(e.target.value))} style={S.input}>
                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', margin: '14px 0 18px' }}>
                Derived values are recomputed when you save — they are never taken from the file or
                from this form.
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Saving…' : editing.issue ? 'Fix and accept' : 'Save and accept'}
                </button>
                <button type="button" onClick={() => setEditing(null)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default BulkImportPanel;
