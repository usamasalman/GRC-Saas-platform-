import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill, apiError } from '../iam/iamStyles';
import { PRIORITY_COLOR } from './ServiceDesk';

interface Item {
  id: string; key: string; name: string; description: string; category: string;
  ticketType: string; defaultImpact: string; defaultUrgency: string; derivedPriority: string;
  assignmentGroup: string | null; workflowName: string | null; workflowSteps: number;
  requestCount: number; isPlatform: boolean;
}
interface WorkflowDef {
  id: string; key: string; name: string; description: string | null;
  subjectType: string; steps: any[]; usedByCatalogItems: number; runCount: number; scopeLabel: string;
}

const ServiceCatalog: React.FC = () => {
  const [items, setItems] = useState<Item[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [cRes, wRes] = await Promise.all([
        apiClient.get('/api/itsm/catalog'),
        apiClient.get('/api/itsm/workflows').catch(() => null),
      ]);
      setItems(cRes.data?.items || []);
      setWorkflows(wRes?.data?.definitions || []);
    } catch (err) { setError(apiError(err, 'Failed to load the service catalog')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = [...new Set(items.map((i) => i.category))].sort();
  const visible = categoryFilter ? items.filter((i) => i.category === categoryFilter) : items;
  const routed = items.filter((i) => i.workflowName).length;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Service catalog</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            Each item declares its default impact, urgency and approval route. Routing is data, not code.
          </p>
        </div>
        <button onClick={load} style={ghostBtn}>↻ Refresh</button>
      </div>

      <StatStrip items={[
        ['Catalog items', items.length],
        ['Workflow-routed', <span style={{ color: 'var(--warning)' }}>{routed}</span>],
        ['Direct to queue', items.length - routed],
        ['Workflows defined', workflows.length],
        ['Requests raised', items.reduce((a, i) => a + i.requestCount, 0)],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ ...S.input, maxWidth: 220 }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error && <div style={S.error}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--ink-muted)', padding: 30 }}>Loading catalog…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 12, marginBottom: 24 }}>
          {visible.map((i) => (
            <div key={i.id} style={{ ...S.card, padding: 16, borderColor: i.workflowName ? 'var(--warning)' : 'var(--ink)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <strong style={{ fontSize: 14, color: 'var(--ink-body)' }}>{i.name}</strong>
                <span style={pill('var(--info)', 'var(--info-line)')}>{i.category}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-muted)', lineHeight: 1.6, marginBottom: 12 }}>{i.description}</div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 10 }}>
                <span style={{ color: 'var(--ink-muted)' }}>{i.ticketType}</span>
                <span style={{ color: 'var(--ink-body)' }}>·</span>
                <span style={{ color: 'var(--ink-muted)' }}>{i.defaultImpact}/{i.defaultUrgency} →</span>
                <span style={{ color: PRIORITY_COLOR[i.derivedPriority] || 'var(--ink-body)' }}>{i.derivedPriority}</span>
              </div>

              <div style={{
                borderTop: '1px solid var(--line)', paddingTop: 10, fontSize: 11,
                color: i.workflowName ? 'var(--warning)' : 'var(--ink-muted)',
              }}>
                {i.workflowName
                  ? <>⚑ {i.workflowName} · {i.workflowSteps} steps</>
                  : <>→ straight to {i.assignmentGroup || 'queue'}</>}
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ fontSize: 16, color: 'var(--ink)', margin: '0 0 6px' }}>Workflow definitions</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-muted)' }}>
        The same engine serves every module — a catalog item simply points at one of these.
      </p>

      <div style={{ display: 'grid', gap: 12 }}>
        {workflows.map((w) => {
          const isOpen = expanded === w.id;
          return (
            <div key={w.id} style={S.card}>
              <button onClick={() => setExpanded(isOpen ? null : w.id)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: 'transparent', border: 'none', padding: '14px 16px', cursor: 'pointer',
                  color: 'var(--ink-body)', fontFamily: 'inherit', fontSize: 13, textAlign: 'left', gap: 12, flexWrap: 'wrap',
                }}>
                <span>{isOpen ? '▾' : '▸'} {w.name}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                  {w.subjectType} · {w.steps.length} steps · {w.usedByCatalogItems} catalog item(s) · {w.runCount} run(s) · {w.scopeLabel}
                </span>
              </button>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--line)', padding: '14px 16px' }}>
                  {w.description && <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginBottom: 12 }}>{w.description}</div>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
                    {w.steps.map((s: any, idx: number) => (
                      <React.Fragment key={s.key}>
                        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6, padding: '8px 12px', minWidth: 150 }}>
                          <div style={{ fontSize: 12, color: 'var(--ink-body)' }}>{s.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>{s.type}</div>
                          {s.requiredCapability && (
                            <div style={{ fontSize: 10, color: 'var(--info)', marginTop: 3 }}>needs: {s.requiredCapability}</div>
                          )}
                          {s.sodGuardedAction && (
                            <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 2 }}>SoD: {s.sodGuardedAction}</div>
                          )}
                          {s.dueInHours && (
                            <div style={{ fontSize: 10, color: 'var(--ink-body)', marginTop: 2 }}>due in {s.dueInHours}h</div>
                          )}
                        </div>
                        {idx < w.steps.length - 1 && (
                          <div style={{ display: 'flex', alignItems: 'center', color: 'var(--ink-body)' }}>→</div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ServiceCatalog;
