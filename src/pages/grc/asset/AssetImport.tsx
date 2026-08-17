import React, { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../../iam/iamStyles';
import Icon from '../../../components/Icon';

/**
 * Bulk asset import.
 *
 * Staged, not direct. Criticality becomes the impact of every risk raised
 * against an asset, so a mis-read rating does not stay a spreadsheet problem —
 * it ends up in a board pack. The reviewer sees what the parser understood,
 * corrects it, and only then commits.
 */

const CONFIDENCE: Record<string, { fg: string; line: string; help: string }> = {
  High: { fg: 'var(--success)', line: 'var(--success-line)', help: 'Every field was read from the file; nothing defaulted.' },
  Medium: { fg: 'var(--warning)', line: 'var(--warning-line)', help: 'Something was defaulted or interpreted loosely — worth a look.' },
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

const AssetImport: React.FC<{ onCommitted?: () => void }> = ({ onCommitted }) => {
  const [imports, setImports] = useState<any[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [uploadInfo, setUploadInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await apiClient.get('/api/grc/assets/imports');
      setImports(r.data?.imports || []);
    } catch (err) { setError(apiError(err, 'Failed to load imports')); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await apiClient.get(`/api/grc/assets/imports/${id}`);
      setDetail(r.data || null);
      setOpenId(id);
    } catch (err) { setError(apiError(err, 'Failed to load the import')); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const downloadTemplate = async () => {
    try {
      const res = await apiClient.get('/api/grc/assets/import/template', { responseType: 'blob' });
      const href = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = href; a.download = 'Asset_import_template.xlsx';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(href);
    } catch (err) { window.alert(apiError(err)); }
  };

  const upload = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'csv'].includes(ext)) {
      setError('An inventory is imported from a spreadsheet — .xlsx or .csv. A PDF has no columns to map.');
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
      const res = await apiClient.post('/api/grc/assets/import', {
        fileName: file.name, fileType: ext, contentBase64: base64,
      });
      setUploadInfo(res.data);
      setNotice(res.data?.message || 'File read');
      await loadList();
      if (res.data?.import?.id) await loadDetail(res.data.import.id);
    } catch (err) { setError(apiError(err, 'Could not read that file')); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const act = async (url: string, body: any, fallback: string) => {
    try {
      const res = await apiClient.post(url, body);
      setNotice(res.data?.message || fallback);
      if (openId) await loadDetail(openId);
      await loadList();
    } catch (err) { window.alert(apiError(err)); }
  };

  const setRowStatus = async (candidateId: string, status: string) => {
    try {
      const res = await apiClient.patch(`/api/grc/asset-candidates/${candidateId}`, { status });
      setNotice(res.data?.message || 'Row updated');
      if (openId) await loadDetail(openId);
    } catch (err) { window.alert(apiError(err)); }
  };

  const saveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.patch(`/api/grc/asset-candidates/${editing.id}`, {
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
      `Add ${n} asset${n === 1 ? '' : 's'} to the register?\n\n`
      + `Criticality is recomputed on commit from the CIA ratings, so the file cannot assert a tier. `
      + `This cannot be undone as a batch — assets would have to be retired individually.`,
    )) return;
    setBusy(true);
    try {
      const res = await apiClient.post(`/api/grc/assets/imports/${openId}/commit`, {});
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
      {error && <div style={S.error}><Icon name="warning" size={15} /><span style={{ flex: 1 }}>{error}</span>
        <button onClick={() => setError('')} style={linkBtn('var(--danger)')}>dismiss</button></div>}
      {notice && (
        <div style={{ ...S.error, background: 'var(--success-bg)', borderColor: 'var(--success-line)', color: 'var(--success)' }}>
          <Icon name="success" size={15} />
          <span style={{ flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>dismiss</button>
        </div>
      )}

      {/* ── Upload ────────────────────────────────────────────────────── */}
      <div style={{ ...S.card, padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 380px' }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--ink)' }}>Import an inventory</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.6, maxWidth: '42rem' }}>
              Upload the spreadsheet your IT or facilities team already keeps — a CMDB export, an asset
              schedule, anything with one row per asset. Column names are matched by meaning, so
              "System", "Application" and "Asset name" all work, and a title block above the table is
              skipped rather than parsed as data.
            </p>
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
              <span>
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
                {t.total} row(s) · {t.accepted} accepted · {t.blocked} blocked · {t.pending} still to review
                {imp?.status !== 'Extracted' && <> · <strong style={{ color: 'var(--ink-body)' }}>{imp?.status}</strong></>}
              </div>
            </div>
            {live && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={ghostBtn} onClick={() => act(`/api/grc/assets/imports/${openId}/accept-clean`, {}, 'Clean rows accepted')}>
                  Accept the {t.high ?? 0} clean row(s)
                </button>
                <button style={primaryBtn(busy || (t.accepted ?? 0) === 0)} disabled={busy || (t.accepted ?? 0) === 0} onClick={commit}>
                  Commit {t.accepted ?? 0} to the register
                </button>
                <button style={linkBtn('var(--ink-faint)')}
                  onClick={() => {
                    if (window.confirm('Discard this import? Nothing has been written to the register.')) {
                      act(`/api/grc/assets/imports/${openId}/discard`, {}, 'Discarded');
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
                  {['Row', 'Asset', 'Type / held by', 'C / I / A', 'Criticality', 'Parser', 'State', 'Actions']
                    .map((h) => <th key={h} style={S.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(detail.candidates || []).map((c: any) => {
                  const p = c.parsed || {};
                  const conf = CONFIDENCE[c.confidence] || CONFIDENCE.Medium;
                  return (
                    <tr key={c.id} style={{
                      ...S.bodyRow,
                      background: c.issue ? 'var(--danger-bg)' : undefined,
                    }}>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-faint)' }}>{c.rowNumber}</td>
                      <td style={{ ...S.td, color: 'var(--ink)', fontWeight: 600 }}>
                        {p.name || <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(no name)</span>}
                        {p.location && <div style={{ fontSize: 11, color: 'var(--ink-faint)', fontWeight: 400 }}>{p.location}</div>}
                      </td>
                      <td style={{ ...S.td, color: 'var(--ink-body)' }}>
                        {p.type}
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                          {p.ownership === 'ThirdParty' ? `Third party${p.vendorName ? ` — ${p.vendorName}` : ''}` : p.ownership}
                        </div>
                      </td>
                      <td style={{ ...S.td, fontVariantNumeric: 'tabular-nums' }}>
                        {p.confidentiality} / {p.integrity} / {p.availability}
                      </td>
                      <td style={S.td}>
                        <strong style={{ color: 'var(--ink)' }}>{p.criticalityTier} {p.criticality}</strong>
                      </td>
                      <td style={S.td}>
                        <span style={pill(conf.fg, conf.line)} title={conf.help}>{c.confidence}</span>
                        {c.body && (
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 3, maxWidth: 240 }}>{c.body}</div>
                        )}
                        {c.issue && (
                          <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3, maxWidth: 260, fontWeight: 600 }}>
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
                            {c.status !== 'Rejected' && !c.issue && (
                              <button style={linkBtn('var(--ink-faint)')} onClick={() => setRowStatus(c.id, 'Rejected')}>skip</button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(detail.candidates || []).length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--ink-muted)' }}>
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

      {/* ── Correct a blocked row ─────────────────────────────────────── */}
      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 910, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 26, maxHeight: '92vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--ink)' }}>Fix this row</h3>
              <button onClick={() => setEditing(null)} style={linkBtn('var(--ink-muted)')} aria-label="Close">
                <Icon name="close" size={15} label="Close" />
              </button>
            </div>
            <div style={{ ...S.error, marginBottom: 16 }}>
              <Icon name="warning" size={15} />
              <span>{editing.issue}</span>
            </div>

            <form onSubmit={saveCorrection}>
              <label style={label}>Asset name</label>
              <input value={editing.corrections.name ?? editing.parsed.name ?? ''}
                onChange={(e) => setEditing({ ...editing, corrections: { ...editing.corrections, name: e.target.value } })}
                style={{ ...S.input, marginBottom: 12 }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={label}>Held by</label>
                  <select value={editing.corrections.ownership ?? editing.parsed.ownership}
                    onChange={(e) => setEditing({ ...editing, corrections: { ...editing.corrections, ownership: e.target.value } })}
                    style={S.input}>
                    {['Internal', 'ThirdParty', 'Shared'].map((o) => (
                      <option key={o} value={o}>{o === 'ThirdParty' ? 'Third party' : o}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={label}>Supplier</label>
                  <input value={editing.corrections.vendorName ?? editing.parsed.vendorName ?? ''}
                    onChange={(e) => setEditing({ ...editing, corrections: { ...editing.corrections, vendorName: e.target.value } })}
                    style={S.input} placeholder="required for third party" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 8 }}>
                {(['confidentiality', 'integrity', 'availability'] as const).map((k) => (
                  <div key={k}>
                    <label style={label}>{k[0].toUpperCase() + k.slice(1)}</label>
                    <select value={editing.corrections[k] ?? editing.parsed[k]}
                      onChange={(e) => setEditing({ ...editing, corrections: { ...editing.corrections, [k]: Number(e.target.value) } })}
                      style={S.input}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', marginBottom: 18 }}>
                Criticality is recomputed as the highest of the three when you save — it is never taken
                from the file or from this form.
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Saving…' : 'Fix and accept'}
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

export default AssetImport;
