import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

/**
 * Framework authoring — where a compliance manager or consultant builds the
 * thing an organisation is assessed against: the standard, its clauses, the
 * controls that satisfy them, and the mapping between the two.
 *
 * Published content (ISO 27001, the shared control library) is read-only for
 * tenants; anything this organisation authored is fully editable here.
 */

type Standard = {
  id: string; code: string; title: string; authority: string; version: string;
  description: string | null; clauseCount: number; isSystem: boolean;
  isOwnedHere: boolean; publishedPlatformWide: boolean; isEnabledHere: boolean;
};
type Clause = {
  id: string; ref: string; title: string; text: string | null;
  standardId: string; standardCode: string; mappedControlCount: number;
};
type Control = {
  id: string; code: string; title: string; objective: string; domain: string;
  isLibrary: boolean; mappedTo: { standardCode: string; clauseRef: string }[];
  implementationCount: number;
};

const ORIGIN_PILL = (s: Standard) =>
  s.publishedPlatformWide ? pill('var(--info)', 'var(--info-line)') : pill('var(--success)', 'var(--success-line)');

const FrameworkAuthoring: React.FC = () => {
  const [standards, setStandards] = useState<Standard[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'standards' | 'controls' | 'import'>('standards');

  const [imports, setImports] = useState<any[]>([]);
  const [openImport, setOpenImport] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const [impForm, setImpForm] = useState({
    kind: 'Clause', targetStandardId: '',
    newStandardCode: '', newStandardTitle: '', newStandardAuthority: '', newStandardVersion: '',
  });

  const [openStd, setOpenStd] = useState<string | null>(null);
  const [showStdForm, setShowStdForm] = useState(false);
  const [stdForm, setStdForm] = useState({ code: '', title: '', authority: '', version: '', description: '' });
  const [clauseText, setClauseText] = useState('');
  const [formErr, setFormErr] = useState('');

  const [showCtrlForm, setShowCtrlForm] = useState(false);
  const [ctrlForm, setCtrlForm] = useState({ code: '', title: '', objective: '', domain: '' });
  const [ctrlClauses, setCtrlClauses] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, c, cl] = await Promise.all([
        apiClient.get('/api/grc/standards'),
        apiClient.get('/api/grc/controls'),
        apiClient.get('/api/grc/clauses'),
      ]);
      setStandards(s.data?.standards || []);
      setControls(c.data?.controls || []);
      setClauses(cl.data?.clauses || []);
    } catch (err) { setError(apiError(err, 'Failed to load the framework library')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Clauses are pasted one per line as `ref | title | text`. A real standard
   * has dozens of them, so a row-by-row form would be the wrong shape.
   */
  const loadImports = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/grc/imports');
      setImports(res.data?.imports || []);
    } catch { /* the panel simply stays empty */ }
  }, []);

  useEffect(() => { if (tab === 'import') loadImports(); }, [tab, loadImports]);

  const openImportDetail = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/grc/imports/${id}`);
      setOpenImport(res.data || null);
    } catch (err) { window.alert(apiError(err)); }
  };

  /** Reads the chosen file as base64 — the same shape the API already takes. */
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });

  const uploadFile = async (file: File) => {
    setUploading(true); setNotice(''); setError('');
    try {
      const fileData = await fileToBase64(file);
      const body: any = { kind: impForm.kind, fileName: file.name, fileData };
      if (impForm.kind === 'Clause') {
        if (impForm.targetStandardId) body.targetStandardId = impForm.targetStandardId;
        else {
          body.newStandardCode = impForm.newStandardCode;
          body.newStandardTitle = impForm.newStandardTitle;
          body.newStandardAuthority = impForm.newStandardAuthority;
          body.newStandardVersion = impForm.newStandardVersion;
        }
      }
      const res = await apiClient.post('/api/grc/imports', body);
      setNotice(res.data?.message || 'File read');
      await loadImports();
      if (res.data?.import?.id) await openImportDetail(res.data.import.id);
    } catch (err) { setError(apiError(err, 'Could not read that file')); }
    finally { setUploading(false); }
  };

  const decide = async (candidateId: string, decision: string, edits?: any) => {
    try {
      await apiClient.patch(`/api/grc/import-candidates/${candidateId}`, { decision, ...(edits || {}) });
      if (openImport?.import?.id) await openImportDetail(openImport.import.id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const fixAndAccept = async (c: any) => {
    const ref = window.prompt('Reference:', c.ref || '');
    if (ref === null) return;
    const title = window.prompt('Title:', c.title || '');
    if (title === null) return;
    await decide(c.id, 'Accepted', { ref, title });
  };

  const acceptClean = async (id: string) => {
    try {
      const res = await apiClient.post(`/api/grc/imports/${id}/accept-clean`, {});
      setNotice(res.data?.message || '');
      await openImportDetail(id);
    } catch (err) { window.alert(apiError(err)); }
  };

  const commitImport = async (id: string) => {
    try {
      const res = await apiClient.post(`/api/grc/imports/${id}/commit`, {});
      setNotice(res.data?.message || 'Committed');
      setOpenImport(null);
      await Promise.all([load(), loadImports()]);
    } catch (err) { window.alert(apiError(err)); }
  };

  const discardImport = async (id: string) => {
    if (!window.confirm('Discard this import? Nothing will be added to the library.')) return;
    try {
      const res = await apiClient.post(`/api/grc/imports/${id}/discard`, {});
      setNotice(res.data?.message || 'Discarded');
      setOpenImport(null);
      await loadImports();
    } catch (err) { window.alert(apiError(err)); }
  };

  const parseClauses = (raw: string) =>
    raw.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [ref, title, ...rest] = line.split('|').map((p) => p.trim());
      return { ref, title, text: rest.join('|').trim() || undefined };
    });

  const createStandard = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const parsed = clauseText.trim() ? parseClauses(clauseText) : undefined;
      const res = await apiClient.post('/api/grc/standards', { ...stdForm, clauses: parsed });
      setNotice(res.data?.message || 'Standard created');
      setShowStdForm(false);
      setStdForm({ code: '', title: '', authority: '', version: '', description: '' });
      setClauseText('');
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create the standard')); }
    finally { setBusy(false); }
  };

  const addClauses = async (std: Standard) => {
    const raw = window.prompt(
      `Add clauses to ${std.code} — one per line as:  ref | title | text`,
      'A.5.1 | Policies for information security | Management direction is defined.',
    );
    if (!raw) return;
    try {
      const res = await apiClient.post(`/api/grc/standards/${std.id}/clauses`, { clauses: parseClauses(raw) });
      setNotice(res.data?.message || 'Clauses added');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const enableStandard = async (std: Standard) => {
    try {
      const res = await apiClient.post('/api/grc/standards/enable', { standardId: std.id, applicability: 'Full' });
      setNotice(res.data?.message || `${std.code} enabled`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const removeStandard = async (std: Standard) => {
    if (!window.confirm(`Delete ${std.code}? This cannot be undone.`)) return;
    try {
      const res = await apiClient.delete(`/api/grc/standards/${std.id}`);
      setNotice(res.data?.message || `${std.code} deleted`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const createControl = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      const res = await apiClient.post('/api/grc/controls', { ...ctrlForm, clauseIds: ctrlClauses });
      setNotice(res.data?.message || 'Control created');
      setShowCtrlForm(false);
      setCtrlForm({ code: '', title: '', objective: '', domain: '' });
      setCtrlClauses([]);
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not create the control')); }
    finally { setBusy(false); }
  };

  const cloneControl = async (c: Control) => {
    const code = window.prompt(`Copy ${c.code} into your own control set as:`, `${c.code}-LOCAL`);
    if (!code) return;
    try {
      const res = await apiClient.post(`/api/grc/controls/${c.id}/clone`, { code });
      setNotice(res.data?.message || 'Control copied');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const remapControl = async (c: Control) => {
    const picked = window.prompt(
      `Clause refs for ${c.code}, comma separated.\nAvailable: ${[...new Set(clauses.map((x) => x.standardCode))].join(', ')}`,
      c.mappedTo.map((m) => `${m.standardCode}:${m.clauseRef}`).join(', '),
    );
    if (picked === null) return;
    const wanted = picked.split(',').map((p) => p.trim()).filter(Boolean);
    const ids = wanted.map((w) => {
      const [code, ref] = w.includes(':') ? w.split(':') : [null, w];
      const hit = clauses.find((x) => x.ref === ref?.trim() && (!code || x.standardCode === code.trim()));
      return hit?.id;
    }).filter(Boolean) as string[];
    if (ids.length !== wanted.length) {
      window.alert('Some clause references were not recognised. Nothing was changed.');
      return;
    }
    try {
      const res = await apiClient.post(`/api/grc/controls/${c.id}/clauses`, { clauseIds: ids });
      setNotice(res.data?.message || 'Mapping updated');
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const removeControl = async (c: Control) => {
    if (!window.confirm(`Delete ${c.code}?`)) return;
    try {
      const res = await apiClient.delete(`/api/grc/controls/${c.id}`);
      setNotice(res.data?.message || `${c.code} deleted`);
      await load();
    } catch (err) { window.alert(apiError(err)); }
  };

  const ownStandards = standards.filter((s) => s.isOwnedHere).length;
  const ownControls = controls.filter((c) => !c.isLibrary).length;
  const unmapped = controls.filter((c) => c.mappedTo.length === 0).length;

  const tabBtn = (key: 'standards' | 'controls' | 'import'): React.CSSProperties => ({
    ...ghostBtn,
    background: tab === key ? 'var(--brand-tint)' : 'var(--surface)',
    borderColor: tab === key ? 'var(--brand)' : 'var(--field-line)',
    color: tab === key ? 'var(--brand-strong)' : 'var(--ink-body)',
    fontWeight: tab === key ? 600 : 500,
  });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Framework authoring</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)', maxWidth: '70ch' }}>
            Build the standards and controls this organisation is assessed against. Published content is
            read-only; anything authored here is yours to change.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={tabBtn('standards')} onClick={() => setTab('standards')}>Standards</button>
          <button style={tabBtn('controls')} onClick={() => setTab('controls')}>Controls</button>
          <button style={tabBtn('import')} onClick={() => setTab('import')}>Import from file</button>
        </div>
      </div>

      <StatStrip items={[
        ['Standards available', standards.length],
        ['Authored here', <span style={{ color: ownStandards > 0 ? 'var(--success)' : 'var(--ink)' }}>{ownStandards}</span>],
        ['Clauses', clauses.length],
        ['Controls', controls.length],
        ['Your controls', ownControls],
        ['Unmapped controls', <span style={{ color: unmapped > 0 ? 'var(--warning)' : 'var(--ink)' }}>{unmapped}</span>],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', color: 'var(--success)', padding: 12, borderRadius: 'var(--radius)', marginBottom: 14, fontSize: 13 }}>
          {notice} <button onClick={() => setNotice('')} style={{ ...linkBtn('var(--success)'), float: 'right' }}>dismiss</button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 30, color: 'var(--ink-muted)' }}>Loading…</div>
      ) : tab === 'standards' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button style={primaryBtn()} onClick={() => { setShowStdForm(!showStdForm); setFormErr(''); }}>
              {showStdForm ? 'Cancel' : '+ New standard'}
            </button>
          </div>

          {showStdForm && (
            <form onSubmit={createStandard} style={{ ...S.card, padding: 18, marginBottom: 16 }}>
              {formErr && <div style={S.error}>{formErr}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
                {([
                  ['code', 'Code, e.g. PCI-DSS'],
                  ['title', 'Title'],
                  ['authority', 'Issuing authority'],
                  ['version', 'Version'],
                ] as const).map(([k, label]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{label}</label>
                    <input required value={(stdForm as any)[k]} onChange={(e) => setStdForm({ ...stdForm, [k]: e.target.value })} style={S.input} />
                  </div>
                ))}
              </div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>Description</label>
              <input value={stdForm.description} onChange={(e) => setStdForm({ ...stdForm, description: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>
                Clauses — one per line as <code>ref | title | text</code>
              </label>
              <textarea
                value={clauseText}
                onChange={(e) => setClauseText(e.target.value)}
                rows={6}
                placeholder={'1.2.1 | Restrict inbound traffic | Configuration standards are defined.\n3.5.1 | Render PAN unreadable | Stored card numbers are unreadable.'}
                style={{ ...S.input, fontFamily: 'ui-monospace, monospace', fontSize: 12, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy} style={primaryBtn(busy)}>{busy ? 'Creating…' : 'Create standard'}</button>
              </div>
            </form>
          )}

          <div style={{ ...S.card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th style={S.th}>Standard</th><th style={S.th}>Authority</th>
                <th style={S.th}>Clauses</th><th style={S.th}>Origin</th><th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {standards.map((s) => (
                  <React.Fragment key={s.id}>
                    <tr style={{ borderBottom: '1px solid var(--line-soft)' }}>
                      <td style={S.td}>
                        <strong style={{ color: 'var(--ink)' }}>{s.code}</strong>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{s.title}</div>
                      </td>
                      <td style={S.td}>{s.authority} · v{s.version}</td>
                      <td style={S.td}>
                        <button onClick={() => setOpenStd(openStd === s.id ? null : s.id)} style={linkBtn('var(--info)')}>
                          {s.clauseCount} {openStd === s.id ? '▴' : '▾'}
                        </button>
                      </td>
                      <td style={S.td}>
                        <span style={ORIGIN_PILL(s)}>{s.publishedPlatformWide ? 'Published' : 'Yours'}</span>
                        {s.isEnabledHere && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--success)' }}>enabled</span>}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        {!s.isEnabledHere && <button onClick={() => enableStandard(s)} style={linkBtn('var(--brand)')}>enable</button>}
                        {s.isOwnedHere && <button onClick={() => addClauses(s)} style={linkBtn('var(--info)')}>add clauses</button>}
                        {s.isOwnedHere && <button onClick={() => removeStandard(s)} style={linkBtn('var(--danger)')}>delete</button>}
                        {!s.isOwnedHere && <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>read-only</span>}
                      </td>
                    </tr>
                    {openStd === s.id && (
                      <tr><td colSpan={5} style={{ padding: 0, background: 'var(--surface-sunk)' }}>
                        <div style={{ padding: '10px 16px' }}>
                          {clauses.filter((c) => c.standardId === s.id).map((c) => (
                            <div key={c.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line-soft)', fontSize: 12.5 }}>
                              <strong style={{ color: 'var(--ink)', fontFamily: 'ui-monospace, monospace' }}>{c.ref}</strong>
                              <span style={{ color: 'var(--ink-body)' }}> — {c.title}</span>
                              <span style={{ float: 'right', fontSize: 11, color: c.mappedControlCount ? 'var(--success)' : 'var(--warning)' }}>
                                {c.mappedControlCount} control{c.mappedControlCount === 1 ? '' : 's'}
                              </span>
                              {c.text && <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 2 }}>{c.text}</div>}
                            </div>
                          ))}
                          {clauses.filter((c) => c.standardId === s.id).length === 0 && (
                            <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>No clauses yet.</div>
                          )}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : tab === 'controls' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button style={primaryBtn()} onClick={() => { setShowCtrlForm(!showCtrlForm); setFormErr(''); }}>
              {showCtrlForm ? 'Cancel' : '+ New control'}
            </button>
          </div>

          {showCtrlForm && (
            <form onSubmit={createControl} style={{ ...S.card, padding: 18, marginBottom: 16 }}>
              {formErr && <div style={S.error}>{formErr}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 12 }}>
                {([['code', 'Code, e.g. AC-09'], ['title', 'Title'], ['domain', 'Domain']] as const).map(([k, label]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>{label}</label>
                    <input required value={(ctrlForm as any)[k]} onChange={(e) => setCtrlForm({ ...ctrlForm, [k]: e.target.value })} style={S.input} />
                  </div>
                ))}
              </div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 4 }}>Objective — what this control is meant to achieve</label>
              <input required value={ctrlForm.objective} onChange={(e) => setCtrlForm({ ...ctrlForm, objective: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />
              <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 6 }}>
                Clauses it satisfies — one control may answer several frameworks at once
              </label>
              <div style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: 8 }}>
                {clauses.map((c) => (
                  <label key={c.id} style={{ display: 'block', fontSize: 12, padding: '3px 0', cursor: 'pointer', color: 'var(--ink-body)' }}>
                    <input
                      type="checkbox"
                      checked={ctrlClauses.includes(c.id)}
                      onChange={(e) => setCtrlClauses(e.target.checked ? [...ctrlClauses, c.id] : ctrlClauses.filter((x) => x !== c.id))}
                      style={{ marginRight: 8 }}
                    />
                    <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{c.standardCode} {c.ref}</strong> — {c.title}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="submit" disabled={busy} style={primaryBtn(busy)}>{busy ? 'Creating…' : 'Create control'}</button>
                <span style={{ fontSize: 12, color: 'var(--ink-faint)', alignSelf: 'center' }}>{ctrlClauses.length} clause(s) selected</span>
              </div>
            </form>
          )}

          <div style={{ ...S.card, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th style={S.th}>Control</th><th style={S.th}>Domain</th>
                <th style={S.th}>Satisfies</th><th style={S.th}>Origin</th><th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
              </tr></thead>
              <tbody>
                {controls.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                    <td style={S.td}>
                      <strong style={{ color: 'var(--ink)' }}>{c.code}</strong>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>{c.title}</div>
                    </td>
                    <td style={S.td}>{c.domain}</td>
                    <td style={S.td}>
                      {c.mappedTo.length === 0
                        ? <span style={{ color: 'var(--warning)', fontSize: 11.5 }}>not mapped</span>
                        : <span style={{ fontSize: 11.5, color: 'var(--ink-body)' }}>
                            {c.mappedTo.map((m) => `${m.standardCode} ${m.clauseRef}`).join(' · ')}
                          </span>}
                    </td>
                    <td style={S.td}>
                      <span style={c.isLibrary ? pill('var(--info)', 'var(--info-line)') : pill('var(--success)', 'var(--success-line)')}>
                        {c.isLibrary ? 'Library' : 'Yours'}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      {c.isLibrary
                        ? <button onClick={() => cloneControl(c)} style={linkBtn('var(--brand)')}>copy to my set</button>
                        : <>
                            <button onClick={() => remapControl(c)} style={linkBtn('var(--info)')}>remap</button>
                            <button onClick={() => removeControl(c)} style={linkBtn('var(--danger)')}>delete</button>
                          </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* ── Upload ─────────────────────────────────────────────── */}
          <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)', marginBottom: 4 }}>
              Import a framework from a file
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-muted)', maxWidth: '76ch' }}>
              Spreadsheets (.xlsx, .csv), PDF and Word are read here. Nothing is added to the library
              on upload — what the file contains is staged for you to check first, because a misread
              clause becomes the criterion an audit tests against.
            </p>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Contains</label>
                <select
                  value={impForm.kind}
                  onChange={(e) => setImpForm({ ...impForm, kind: e.target.value })}
                  style={{ ...S.input, width: 190 }}
                >
                  <option value="Clause">Clauses of a standard</option>
                  <option value="Control">Controls (spreadsheet only)</option>
                </select>
              </div>

              {impForm.kind === 'Clause' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>Add to</label>
                  <select
                    value={impForm.targetStandardId}
                    onChange={(e) => setImpForm({ ...impForm, targetStandardId: e.target.value })}
                    style={{ ...S.input, width: 260 }}
                  >
                    <option value="">— create a new standard —</option>
                    {standards.filter((x: any) => x.isOwnedHere).map((x: any) => (
                      <option key={x.id} value={x.id}>{x.code} — {x.title}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {impForm.kind === 'Clause' && !impForm.targetStandardId && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                {([
                  ['newStandardCode', 'Code', 'ISO22301', 140],
                  ['newStandardTitle', 'Title', 'Business Continuity Management', 280],
                  ['newStandardAuthority', 'Authority', 'ISO', 150],
                  ['newStandardVersion', 'Version', '2019', 110],
                ] as [string, string, string, number][]).map(([key, label, ph, w]) => (
                  <div key={key}>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-faint)', marginBottom: 3 }}>{label}</label>
                    <input
                      value={(impForm as any)[key]}
                      placeholder={ph}
                      onChange={(e) => setImpForm({ ...impForm, [key]: e.target.value })}
                      style={{ ...S.input, width: w }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <input
                type="file"
                accept=".xlsx,.csv,.pdf,.docx"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f);
                  e.target.value = '';
                }}
                style={{ fontSize: 13 }}
              />
              {uploading && <span style={{ marginLeft: 10, fontSize: 12.5, color: 'var(--ink-muted)' }}>Reading…</span>}
            </div>
          </div>

          {/* ── Review ─────────────────────────────────────────────── */}
          {openImport && (
            <div style={{ ...S.card, padding: 18, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>
                    {openImport.import.fileName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
                    {openImport.totals.extracted} read · {openImport.totals.accepted} accepted ·{' '}
                    {openImport.totals.rejected} rejected ·{' '}
                    <span style={{ color: openImport.totals.needsAttention > 0 ? 'var(--warning)' : 'var(--success)' }}>
                      {openImport.totals.needsAttention} need attention
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {openImport.import.status === 'Extracted' && (
                    <>
                      <button style={ghostBtn} onClick={() => acceptClean(openImport.import.id)}>Accept clean rows</button>
                      <button style={primaryBtn()} onClick={() => commitImport(openImport.import.id)}>
                        Commit {openImport.totals.accepted} accepted
                      </button>
                      <button style={{ ...ghostBtn, color: 'var(--danger)' }} onClick={() => discardImport(openImport.import.id)}>Discard</button>
                    </>
                  )}
                  <button style={ghostBtn} onClick={() => setOpenImport(null)}>Close</button>
                </div>
              </div>

              <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={S.th}>Row</th>
                      <th style={S.th}>Confidence</th>
                      <th style={S.th}>Reference</th>
                      <th style={S.th}>Title</th>
                      <th style={S.th}>Status</th>
                      <th style={{ ...S.th, textAlign: 'right' }}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openImport.candidates.map((c: any) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                        <td style={{ ...S.td, color: 'var(--ink-faint)' }}>{c.rowNumber}</td>
                        <td style={S.td}>
                          <span style={pill(
                            c.confidence === 'High' ? 'var(--success)' : c.confidence === 'Medium' ? 'var(--warning)' : 'var(--danger)',
                            c.confidence === 'High' ? 'var(--success-line)' : c.confidence === 'Medium' ? 'var(--warning-line)' : 'var(--danger-line)',
                          )}>{c.confidence}</span>
                        </td>
                        <td style={{ ...S.td, fontWeight: 600, color: 'var(--ink)' }}>{c.ref || <em style={{ color: 'var(--danger)' }}>none</em>}</td>
                        <td style={S.td}>
                          {c.title || <em style={{ color: 'var(--danger)' }}>no title</em>}
                          {c.issue && (
                            <div style={{ fontSize: 11.5, color: 'var(--warning)', marginTop: 3 }}>{c.issue}</div>
                          )}
                        </td>
                        <td style={S.td}>
                          <span style={{ color: c.status === 'Accepted' ? 'var(--success)' : c.status === 'Rejected' ? 'var(--danger)' : 'var(--ink-muted)' }}>
                            {c.status}
                          </span>
                        </td>
                        <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {openImport.import.status === 'Extracted' && (
                            <>
                              {c.issue && <button onClick={() => fixAndAccept(c)} style={linkBtn('var(--info)')}>correct</button>}
                              {c.status !== 'Accepted' && !c.issue && <button onClick={() => decide(c.id, 'Accepted')} style={linkBtn('var(--success)')}>accept</button>}
                              {c.status !== 'Rejected' && <button onClick={() => decide(c.id, 'Rejected')} style={linkBtn('var(--danger)')}>reject</button>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── History ────────────────────────────────────────────── */}
          <div style={{ ...S.card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={S.th}>File</th>
                  <th style={S.th}>Contains</th>
                  <th style={S.th}>Rows</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Uploaded by</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
                    <td style={{ ...S.td, fontWeight: 600, color: 'var(--ink)' }}>
                      {i.fileName}
                      <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{i.fileType}</div>
                    </td>
                    <td style={S.td}>{i.kind === 'Clause' ? 'Clauses' : 'Controls'}</td>
                    <td style={S.td}>
                      {i.extractedCount}
                      {i.committedCount > 0 && <span style={{ color: 'var(--success)' }}> · {i.committedCount} committed</span>}
                    </td>
                    <td style={S.td}>
                      <span style={pill(
                        i.status === 'Committed' ? 'var(--success)' : i.status === 'Discarded' ? 'var(--ink-muted)' : 'var(--warning)',
                        i.status === 'Committed' ? 'var(--success-line)' : i.status === 'Discarded' ? 'var(--line)' : 'var(--warning-line)',
                      )}>{i.status}</span>
                    </td>
                    <td style={{ ...S.td, color: 'var(--ink-muted)' }}>{i.uploadedBy?.name || ''}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      <button onClick={() => openImportDetail(i.id)} style={linkBtn('var(--info)')}>
                        {i.status === 'Extracted' ? 'review' : 'view'}
                      </button>
                    </td>
                  </tr>
                ))}
                {imports.length === 0 && (
                  <tr><td colSpan={6} style={{ ...S.td, color: 'var(--ink-faint)', padding: 24, textAlign: 'center' }}>
                    Nothing imported yet.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default FrameworkAuthoring;
