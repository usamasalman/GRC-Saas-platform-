import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';

interface Article {
  id: string; title: string; body: string; category: string;
  tags: string[]; linkedTicketTypes: string[]; status: string;
  viewCount: number; updatedAt: string;
  author: { name: string; email: string } | null;
}

const KnowledgeBase: React.FC = () => {
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [reading, setReading] = useState<Article | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ title: '', category: '', body: '', tags: '', publish: true });
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await apiClient.get('/api/itsm/knowledge');
      setArticles(res.data?.articles || []);
      setCategories(res.data?.categories || []);
    } catch (err) { setError(apiError(err, 'Failed to load the knowledge base')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = async (a: Article) => {
    setReading(a);
    try {
      const res = await apiClient.get(`/api/itsm/knowledge/${a.id}`);
      if (res.data?.article) setReading({ ...a, ...res.data.article, tags: a.tags, linkedTicketTypes: a.linkedTicketTypes });
    } catch { /* the list copy is enough to read */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormErr('');
    try {
      await apiClient.post('/api/itsm/knowledge', {
        title: form.title, category: form.category, body: form.body,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        status: form.publish ? 'PUBLISHED' : 'DRAFT',
      });
      setShowNew(false);
      setForm({ title: '', category: '', body: '', tags: '', publish: true });
      await load();
    } catch (err) { setFormErr(apiError(err, 'Could not save the article')); }
    finally { setBusy(false); }
  };

  const q = search.toLowerCase();
  const visible = articles.filter((a) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (q && !a.title.toLowerCase().includes(q) && !a.body.toLowerCase().includes(q)
        && !a.tags.some((t) => t.toLowerCase().includes(q))) return false;
    return true;
  });

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Knowledge base</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Self-service answers. Recurring resolutions should become articles here.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={ghostBtn}>↻ Refresh</button>
          <button onClick={() => { setFormErr(''); setShowNew(true); }} style={primaryBtn()}>+ New article</button>
        </div>
      </div>

      <StatStrip items={[
        ['Articles', articles.length],
        ['Categories', categories.length],
        ['Total views', articles.reduce((a, x) => a + x.viewCount, 0)],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input placeholder="Search title, body or tag…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...S.input, maxWidth: 320 }} />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ ...S.input, maxWidth: 200 }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading articles…</div>
      ) : visible.length === 0 ? (
        <div style={{ ...S.card, padding: 40, textAlign: 'center', color: 'var(--ink-muted)', borderStyle: 'dashed' }}>
          {search || categoryFilter ? 'No articles match.' : 'No articles yet.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 }}>
          {visible.map((a) => (
            <button key={a.id} onClick={() => open(a)} style={{
              ...S.card, padding: 16, textAlign: 'left', cursor: 'pointer',
              fontFamily: 'inherit', color: 'inherit',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <strong style={{ fontSize: 13, color: 'var(--ink-body)' }}>{a.title}</strong>
                <span style={pill('var(--info)', 'var(--info-line)')}>{a.category}</span>
              </div>
              <div style={{
                fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 10,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {a.body}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {a.tags.slice(0, 4).map((t) => (
                  <span key={t} style={{ ...pill('var(--ink-muted)', 'var(--line)'), fontSize: 10 }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-body)' }}>{a.viewCount} views</div>
            </button>
          ))}
        </div>
      )}

      {reading && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 640, padding: 26, borderRadius: 12, maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: 'var(--ink)' }}>{reading.title}</h3>
              <button onClick={() => { setReading(null); load(); }} style={linkBtn('var(--ink-muted)')}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginBottom: 16 }}>
              {reading.category}
              {reading.author && ` · ${reading.author.name}`}
              {` · ${reading.viewCount} views`}
            </div>
            <div style={{
              fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.8, whiteSpace: 'pre-wrap',
              background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: 16, marginBottom: 14,
            }}>
              {reading.body}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {reading.tags.map((t) => <span key={t} style={pill('var(--ink-muted)', 'var(--line)')}>{t}</span>)}
              {reading.linkedTicketTypes.map((t) => <span key={t} style={pill('var(--info)', 'var(--info-line)')}>{t}</span>)}
            </div>
          </div>
        </div>
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 560, padding: 26, borderRadius: 12, maxHeight: '88vh', overflowY: 'auto' }}>
            <h3 style={{ margin: '0 0 18px', fontSize: 17, color: 'var(--ink)' }}>New knowledge article</h3>
            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            <form onSubmit={submit}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Title</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Category</label>
              <input required list="kb-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={{ ...S.input, marginBottom: 12 }} />
              <datalist id="kb-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Body</label>
              <textarea required rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ ...S.input, marginBottom: 12, resize: 'vertical' }} />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 5, color: 'var(--ink-muted)' }}>Tags (comma-separated)</label>
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vpn, access, mfa" style={{ ...S.input, marginBottom: 14 }} />

              <label style={{ fontSize: 12, color: 'var(--ink-muted)', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.checked })} />
                publish immediately
              </label>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1, padding: 11 }}>
                  {busy ? 'Saving…' : 'Save article'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={{ ...ghostBtn, padding: 11 }}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBase;
