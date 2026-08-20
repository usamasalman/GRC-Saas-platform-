import React, { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, primaryBtn, ghostBtn, linkBtn, pill, apiError } from '../iam/iamStyles';
import RiskHeatmaps, { Matrix, Legend } from './risk/RiskHeatmaps';
import RiskCriteriaPanel from './risk/RiskCriteriaPanel';
import type { Grid } from './risk/RiskHeatmaps';
import Icon from '../../components/Icon';
import RiskImport from './risk/RiskImport';

// ── Color & Styling Tokens ──────────────────────────────────────────────────
const RATING_COLOR: Record<string, string> = {
  High: 'var(--danger)',
  Medium: 'var(--warning)',
  Low: 'var(--success)',
};

const RATING_BG: Record<string, string> = {
  High: 'var(--danger-bg)',
  Medium: 'var(--warning-bg)',
  Low: 'var(--success-bg)',
};

const STATUS_PILL: Record<string, React.CSSProperties> = {
  Open: pill('var(--warning)', 'var(--warning-line)'),
  UnderTreatment: pill('var(--info)', 'var(--info-line)'),
  Accepted: pill('var(--violet)', 'var(--violet)'),
  Closed: pill('var(--success)', 'var(--success-line)'),
};

const APPETITE_BAND_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  WithinAppetite: { bg: 'var(--success-bg)', color: 'var(--success)', border: 'var(--success-line)', label: 'Within Appetite' },
  WithinTolerance: { bg: 'var(--warning-bg)', color: 'var(--warning)', border: 'var(--warning-line)', label: 'Within Tolerance' },
  BeyondTolerance: { bg: 'var(--danger-bg)', color: 'var(--danger)', border: 'var(--danger-line)', label: 'Beyond Tolerance' },
  NoAppetiteSet: { bg: 'var(--surface-sunk)', color: 'var(--ink-muted)', border: 'var(--line)', label: 'No Target Set' },
};

function ratingOf(score: number): 'High' | 'Medium' | 'Low' {
  return score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low';
}


type TabMode = 'cockpit' | 'register' | 'treatments' | 'appetite' | 'network' | 'import';

const RiskRegister: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabMode>('cockpit');
  const [risks, setRisks] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [appetites, setAppetites] = useState<any[]>([]);
  const [impls, setImpls] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [scope, setScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Filters & Search
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [ratingFilter, setRatingFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [selectedHeatmapFilter, setSelectedHeatmapFilter] = useState<{ type: 'inherent' | 'residual'; lik: number; imp: number } | null>(null);

  // Modals & Drawers
  const [detail, setDetail] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState<'overview' | 'controls' | 'treatments' | 'acceptance' | 'review'>('overview');
  const [showNew, setShowNew] = useState(false);
  const [showAddTreatmentModal, setShowAddTreatmentModal] = useState<string | null>(null); // riskId
  const [treatmentForm, setTreatmentForm] = useState({ title: '', dueDate: '', ownerId: '' });

  // New Risk Form State
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Operational',
    direction: 'Threat',
    likelihood: 3,
    impact: 3,
    treatmentType: 'Mitigate',
    reviewCadenceMonths: 6,
  });
  const [dupes, setDupes] = useState<any[] | null>(null);
  const [formErr, setFormErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Formal Review Modal / State
  const [reviewForm, setReviewForm] = useState({ notes: '', reviewCadenceMonths: 6, likelihood: 0, impact: 0 });

  const me = (() => {
    try {
      return JSON.parse(localStorage.getItem('grc_user_json') || 'null');
    } catch {
      return null;
    }
  })();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rRes, iRes, aRes] = await Promise.all([
        apiClient.get('/api/grc/risks'),
        apiClient.get('/api/grc/implementations').catch(() => null),
        // Analytics drives the appetite overlay, coverage and network views.
        // A failure here must not blank the register.
        apiClient.get('/api/grc/risk-analytics').catch(() => null),
      ]);
      setRisks(rRes.data?.risks || []);
      setTotals(rRes.data?.totals || {});
      setCategories(rRes.data?.categories || []);
      setAppetites(rRes.data?.appetites || []);
      setImpls(iRes?.data?.implementations || []);
      setAnalytics(aRes?.data || null);
      setScope(rRes.data?.scope || '');
    } catch (err) {
      setError(apiError(err, 'Failed to load the risk management data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep active detail in sync with risks list
  useEffect(() => {
    if (detail) {
      const fresh = risks.find((r) => r.id === detail.id);
      if (fresh) setDetail(fresh);
    }
  }, [risks]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const submitNew = async (e: React.FormEvent, force = false) => {
    e.preventDefault();
    setBusy(true);
    setFormErr('');
    setDupes(null);
    try {
      await apiClient.post('/api/grc/risks', { ...form, force });
      setShowNew(false);
      setForm({
        title: '',
        description: '',
        category: 'Operational',
        direction: 'Threat',
        likelihood: 3,
        impact: 3,
        treatmentType: 'Mitigate',
        reviewCadenceMonths: 6,
      });
      setNotice('Risk logged successfully in register');
      await load();
    } catch (err: any) {
      if (err?.response?.data?.code === 'POSSIBLE_DUPLICATES') {
        setDupes(err.response.data.candidates || []);
      } else {
        setFormErr(apiError(err, 'Could not create risk'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCreateTreatmentAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showAddTreatmentModal || !treatmentForm.title || !treatmentForm.dueDate) return;
    setBusy(true);
    try {
      await apiClient.post(`/api/grc/risks/${showAddTreatmentModal}/treatments`, treatmentForm);
      setNotice('Treatment action plan assigned');
      setShowAddTreatmentModal(null);
      setTreatmentForm({ title: '', dueDate: '', ownerId: '' });
      await load();
    } catch (err) {
      window.alert(apiError(err, 'Failed to assign treatment action'));
    } finally {
      setBusy(false);
    }
  };

  const completeTreatment = async (treatmentId: string) => {
    try {
      await apiClient.post(`/api/grc/treatments/${treatmentId}/complete`);
      setNotice('Treatment action marked completed');
      await load();
    } catch (err) {
      window.alert(apiError(err));
    }
  };

  const accept = async (risk: any) => {
    if (risk.ownerId === me?.id) {
      window.alert('SoD Violation: The risk owner cannot approve acceptance of their own risk. An independent officer is required.');
      return;
    }
    const until = window.prompt('Accept until (YYYY-MM-DD):', new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10));
    if (!until) return;
    const reason = window.prompt('Formal acceptance justification & compensating factors:');
    if (!reason) return;
    try {
      const res = await apiClient.post(`/api/grc/risks/${risk.id}/accept`, { until, reason });
      setNotice(res.data?.message || 'Risk accepted successfully');
      await load();
    } catch (err) {
      window.alert(apiError(err));
    }
  };

  const linkControlsModal = async (risk: any, implementationIds: string[]) => {
    try {
      const res = await apiClient.post(`/api/grc/risks/${risk.id}/links`, { implementationIds });
      setNotice(res.data?.message || 'Controls updated and residual score recomputed');
      await load();
    } catch (err) {
      window.alert(apiError(err));
    }
  };

  const handlePerformReview = async (riskId: string) => {
    try {
      const res = await apiClient.post(`/api/grc/risks/${riskId}/review`, {
        notes: reviewForm.notes,
        reviewCadenceMonths: reviewForm.reviewCadenceMonths,
        ...(reviewForm.likelihood && reviewForm.impact ? { likelihood: reviewForm.likelihood, impact: reviewForm.impact } : {}),
      });
      setNotice(res.data?.message || 'Risk review recorded');
      await load();
    } catch (err) {
      window.alert(apiError(err));
    }
  };

  const exportRiskCsv = () => {
    const headers = ['Ref', 'Title', 'Category', 'Direction', 'Owner', 'Inherent Score', 'Residual Score', 'Status', 'Treatment Type', 'Appetite Band'];
    const rows = filteredRisks.map((r) => [
      r.ref,
      `"${r.title.replace(/"/g, '""')}"`,
      r.category,
      r.direction,
      `"${r.owner?.name || ''}"`,
      r.inherentScore,
      r.residualScore,
      r.status,
      r.treatmentType,
      r.appetiteBand,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Risk_Register_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Filter Calculations ───────────────────────────────────────────────────

  const q = search.toLowerCase().trim();
  const filteredRisks = useMemo(() => {
    return risks.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (categoryFilter && r.category !== categoryFilter) return false;
      if (ratingFilter && r.residualRating !== ratingFilter) return false;
      if (directionFilter && r.direction !== directionFilter) return false;
      if (selectedHeatmapFilter) {
        if (selectedHeatmapFilter.type === 'inherent') {
          if (r.inherentLikelihood !== selectedHeatmapFilter.lik || r.inherentImpact !== selectedHeatmapFilter.imp) return false;
        } else {
          if (r.residualLikelihood !== selectedHeatmapFilter.lik || r.residualImpact !== selectedHeatmapFilter.imp) return false;
        }
      }
      if (q) {
        const matchTitle = r.title.toLowerCase().includes(q);
        const matchRef = r.ref.toLowerCase().includes(q);
        const matchCat = r.category.toLowerCase().includes(q);
        const matchDesc = r.description?.toLowerCase().includes(q);
        const matchOwner = r.owner?.name?.toLowerCase().includes(q);
        if (!matchTitle && !matchRef && !matchCat && !matchDesc && !matchOwner) return false;
      }
      return true;
    });
  }, [risks, statusFilter, categoryFilter, ratingFilter, directionFilter, selectedHeatmapFilter, q]);

  // 5×5 matrices, indexed [likelihood-1][impact-1] to match the shared Matrix.
  const buildGrid = (pick: (r: any) => { l: number; i: number }): Grid => {
    const g: Grid = Array.from({ length: 5 }, () =>
      Array.from({ length: 5 }, () => ({ count: 0, refs: [] as string[] })));
    for (const r of risks) {
      const { l, i } = pick(r);
      const li = Math.min(5, Math.max(1, l)) - 1;
      const ii = Math.min(5, Math.max(1, i)) - 1;
      g[li][ii].count++;
      g[li][ii].refs.push(r.ref);
    }
    return g;
  };
  const inherentGrid = useMemo(
    () => buildGrid((r) => ({ l: r.inherentLikelihood, i: r.inherentImpact })), [risks]);
  const residualGrid = useMemo(
    () => buildGrid((r) => ({ l: r.residualLikelihood, i: r.residualImpact })), [risks]);

  // All Treatment actions extracted across all risks
  const allTreatmentActions = useMemo(() => {
    const actions: any[] = [];
    for (const r of risks) {
      if (r.treatments && r.treatments.length > 0) {
        for (const t of r.treatments) {
          actions.push({
            ...t,
            riskId: r.id,
            riskRef: r.ref,
            riskTitle: r.title,
            riskCategory: r.category,
            residualScore: r.residualScore,
            residualRating: r.residualRating,
          });
        }
      }
    }
    return actions.sort((a, b) => {
      if (a.status === 'Open' && b.status === 'Done') return -1;
      if (a.status === 'Done' && b.status === 'Open') return 1;
      return new Date(a.dueDate || 0).getTime() - new Date(b.dueDate || 0).getTime();
    });
  }, [risks]);

  const totalInherentExposure = useMemo(() => risks.reduce((acc, r) => acc + (r.inherentScore || 0), 0), [risks]);
  const totalResidualExposure = useMemo(() => risks.reduce((acc, r) => acc + (r.residualScore || 0), 0), [risks]);

  return (
    <div style={{ ...S.page, background: 'var(--surface-sunk)', minHeight: '100vh', padding: '24px 32px' }}>
      {/* ── Top Header ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>
              Enterprise Risk Management (ERM)
            </h1>
            <span
              style={{
                background: 'var(--brand-tint)',
                color: 'var(--brand)',
                border: '1px solid var(--brand-line)',
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              ISO 31000 / COSO ERM
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>
            Dynamic risk quantification, treatment workflow execution, and dual inherent/residual heatmaps. Scope:{' '}
            <strong style={{ color: 'var(--info)' }}>{scope || 'Organization'}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={exportRiskCsv} style={ghostBtn} title="Export current filtered view to CSV spreadsheet">
            <Icon name="download" size={15} /> Export CSV
          </button>
          <button onClick={load} style={ghostBtn} title="Reload fresh data from server">
            <Icon name="refresh" size={15} /> Refresh
          </button>
          <button
            onClick={() => {
              setFormErr('');
              setDupes(null);
              setShowNew(true);
            }}
            style={{
              ...primaryBtn(),
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <span>+</span>
            <span>New Risk</span>
          </button>
        </div>
      </div>

      {/* ── Top Stat Strip ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Total Risks</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>{totals.total ?? risks.length}</span>
            <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>
              {totals.mitigationRate ?? 0}% mitigated
            </span>
          </div>
        </div>

        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--danger)', textTransform: 'uppercase' }}>High / Critical Residual</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: (totals.highResidual ?? 0) > 0 ? 'var(--danger)' : 'var(--ink)' }}>
              {totals.highResidual ?? 0}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Score ≥ 15</span>
          </div>
        </div>

        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--info)', textTransform: 'uppercase' }}>Under Treatment</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--info)' }}>{totals.underTreatment ?? 0}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Active plans</span>
          </div>
        </div>

        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning)', textTransform: 'uppercase' }}>Overdue Actions</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: (totals.overdueTreatments ?? 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {totals.overdueTreatments ?? 0}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Action items</span>
          </div>
        </div>

        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--violet)', textTransform: 'uppercase' }}>Accepted Risks</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--violet)' }}>{totals.accepted ?? 0}</span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Time-bound</span>
          </div>
        </div>

        <div style={{ ...S.card, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>Beyond Tolerance</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, color: (totals.beyondTolerance ?? 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
              {totals.beyondTolerance ?? 0}
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-muted)' }}>Appetite breach</span>
          </div>
        </div>
      </div>

      {/* Notifications & Error Alerts */}
      {error && (
        <div style={{ ...S.error, marginBottom: 16 }}>
          <Icon name="warning" size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          style={{
            background: 'var(--success-bg)',
            border: '1px solid var(--success-line)',
            padding: '10px 16px',
            borderRadius: 8,
            color: 'var(--success)',
            marginBottom: 16,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Icon name="success" size={15} />{notice}</span>
          <button onClick={() => setNotice('')} style={linkBtn('var(--success)')}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* ── Sub-Navigation Tabs ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--line)',
          marginBottom: 20,
          gap: 6,
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => setActiveTab('cockpit')}
          style={{
            background: activeTab === 'cockpit' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'cockpit' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'cockpit' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'cockpit' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="matrix" size={16} />
          <span>Risk Cockpit &amp; Dual Heatmaps</span>
        </button>

        <button
          onClick={() => setActiveTab('register')}
          style={{
            background: activeTab === 'register' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'register' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'register' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'register' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="standards" size={16} />
          <span>Risk Register Inventory</span>
          <span style={{ fontSize: 11, background: 'var(--surface-sunk)', padding: '1px 6px', borderRadius: 10 }}>
            {filteredRisks.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('treatments')}
          style={{
            background: activeTab === 'treatments' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'treatments' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'treatments' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'treatments' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="shield" size={16} />
          <span>Risk Treatment &amp; Mitigation Hub</span>
          <span style={{ fontSize: 11, background: 'var(--brand-tint)', color: 'var(--brand)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
            {allTreatmentActions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('appetite')}
          style={{
            background: activeTab === 'appetite' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'appetite' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'appetite' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'appetite' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="target" size={16} />
          <span>Risk Appetite &amp; Tolerance</span>
          {totals.beyondTolerance > 0 && (
            <span style={{ fontSize: 11, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
              {totals.beyondTolerance} alert
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('network')}
          style={{
            background: activeTab === 'network' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'network' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'network' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'network' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="network" size={16} />
          <span>Matrices &amp; Network</span>
          {(analytics?.totals?.networked ?? 0) > 0 && (
            <span style={{ fontSize: 11, background: 'var(--brand-tint)', color: 'var(--brand-strong)', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>
              {analytics.totals.networked}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('import')}
          style={{
            background: activeTab === 'import' ? 'var(--surface)' : 'transparent',
            color: activeTab === 'import' ? 'var(--brand)' : 'var(--ink-muted)',
            border: '1px solid ' + (activeTab === 'import' ? 'var(--line)' : 'transparent'),
            borderBottom: activeTab === 'import' ? '2px solid var(--brand)' : 'none',
            padding: '10px 18px',
            borderRadius: '6px 6px 0 0',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="upload" size={16} />
          <span>Bulk import</span>
        </button>
      </div>

      {/* ── TAB 1: COCKPIT & DUAL HEATMAPS ─────────────────────────────────── */}
      {activeTab === 'cockpit' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Dual matrices — the accessible shared component. The previous
              inline grids used solid saturated fills with white text; the amber
              band measured 2.69:1, well under the 4.5:1 AA floor, and three
              bands could not distinguish a 15 from a 25. */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <Matrix
              grid={inherentGrid}
              title="Inherent — before controls"
              caption={`Total exposure ${totalInherentExposure} pts. Where the register would sit with no control environment at all. Click a cell to filter the register.`}
              selectedKey={selectedHeatmapFilter?.type === 'inherent'
                ? `${selectedHeatmapFilter.lik}-${selectedHeatmapFilter.imp}` : null}
              onSelect={(refs, _label, lik, imp) => {
                if (refs.length === 0) return;
                const same = selectedHeatmapFilter?.type === 'inherent'
                  && selectedHeatmapFilter.lik === lik && selectedHeatmapFilter.imp === imp;
                setSelectedHeatmapFilter(same ? null : { type: 'inherent', lik, imp });
                if (!same) setActiveTab('register');
              }}
            />
            <Matrix
              grid={residualGrid}
              title="Residual — after controls"
              caption={`Total exposure ${totalResidualExposure} pts. Derived from verified control effectiveness and recomputed whenever a control changes.`}
              selectedKey={selectedHeatmapFilter?.type === 'residual'
                ? `${selectedHeatmapFilter.lik}-${selectedHeatmapFilter.imp}` : null}
              onSelect={(refs, _label, lik, imp) => {
                if (refs.length === 0) return;
                const same = selectedHeatmapFilter?.type === 'residual'
                  && selectedHeatmapFilter.lik === lik && selectedHeatmapFilter.imp === imp;
                setSelectedHeatmapFilter(same ? null : { type: 'residual', lik, imp });
                if (!same) setActiveTab('register');
              }}
            />
          </div>
          <Legend />

          {/* Exposure Migration & Quick Action Strip */}
          <div
            style={{
              ...S.card,
              padding: '16px 22px',
              background: 'linear-gradient(135deg, #0B1524 0%, #17263C 100%)',
              color: '#FFFFFF',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: 'var(--on-dark-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                Control Environment Effectiveness Summary
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginTop: 4 }}>
                {totals.mitigationRate ?? 0}% of enterprise inherent risk exposure eliminated by linked verified controls.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setActiveTab('treatments')}
                style={{
                  background: 'var(--brand)',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Manage treatment plans <Icon name="arrowRight" size={14} style={{ display: 'inline-block', verticalAlign: '-2px' }} />
              </button>
              <button
                onClick={() => setActiveTab('register')}
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  padding: '8px 16px',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                View Register Grid
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: RISK REGISTER INVENTORY GRID ───────────────────────────── */}
      {(activeTab === 'register' || activeTab === 'cockpit') && (
        <div style={{ marginTop: activeTab === 'cockpit' ? 20 : 0 }}>
          {/* Active Filter Notice */}
          {selectedHeatmapFilter && (
            <div
              style={{
                background: 'var(--info-bg)',
                border: '1px solid var(--info-line)',
                borderRadius: 8,
                padding: '8px 14px',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                color: 'var(--info)',
              }}
            >
              <span>
                <Icon name="filter" size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Active filter: <strong>{selectedHeatmapFilter.type.toUpperCase()} Heatmap</strong> cell Likelihood:{' '}
                {selectedHeatmapFilter.lik} × Impact: {selectedHeatmapFilter.imp} (Score: {selectedHeatmapFilter.lik * selectedHeatmapFilter.imp})
              </span>
              <button
                onClick={() => setSelectedHeatmapFilter(null)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--info-line)',
                  borderRadius: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--info)',
                  cursor: 'pointer',
                }}
              >
                Clear cell filter <Icon name="close" size={13} style={{ display: 'inline-block', verticalAlign: '-2px' }} />
              </button>
            </div>
          )}

          {/* Search & Filters Bar */}
          <div
            style={{
              ...S.card,
              padding: '12px 18px',
              marginBottom: 16,
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1 }}>
              <input
                placeholder="Search risk ref, title, narrative, or owner…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...S.input, maxWidth: 300, padding: '7px 12px' }}
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ ...S.input, maxWidth: 150, padding: '7px 10px' }}
              >
                <option value="">All Statuses</option>
                <option value="Open">Open</option>
                <option value="UnderTreatment">Under Treatment</option>
                <option value="Accepted">Accepted</option>
                <option value="Closed">Closed</option>
              </select>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ ...S.input, maxWidth: 150, padding: '7px 10px' }}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              <select
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value)}
                style={{ ...S.input, maxWidth: 140, padding: '7px 10px' }}
              >
                <option value="">All Ratings</option>
                <option value="High">High / Critical</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>

              <select
                value={directionFilter}
                onChange={(e) => setDirectionFilter(e.target.value)}
                style={{ ...S.input, maxWidth: 150, padding: '7px 10px' }}
              >
                <option value="">All Directions</option>
                <option value="Threat">Threats</option>
                <option value="Opportunity">Opportunities</option>
              </select>
            </div>

            <span style={{ fontSize: 12, color: 'var(--ink-muted)', fontWeight: 500 }}>
              Showing <strong>{filteredRisks.length}</strong> of {risks.length} risks
            </span>
          </div>

          {/* Main Risk Table */}
          {loading ? (
            <div style={{ ...S.card, padding: 40, textAlign: 'center', color: 'var(--ink-muted)' }}>
              Loading enterprise risk register...
            </div>
          ) : (
            <div style={{ ...S.card, overflowX: 'auto', border: '1px solid var(--line)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={S.headRow}>
                    <th style={{ ...S.th, width: '30%' }}>Risk Narrative &amp; Category</th>
                    <th style={S.th}>Owner</th>
                    <th style={S.th}>Inherent</th>
                    <th style={S.th}>Residual</th>
                    <th style={S.th}>Appetite Band</th>
                    <th style={S.th}>Treatment Plan</th>
                    <th style={S.th}>Status</th>
                    <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRisks.map((r) => {
                    const appetiteStyle = APPETITE_BAND_STYLE[r.appetiteBand] || APPETITE_BAND_STYLE.NoAppetiteSet;
                    const isHigh = r.residualRating === 'High';

                    return (
                      <tr key={r.id} style={{ ...S.bodyRow, background: isHigh ? 'rgba(217, 56, 58, 0.02)' : 'transparent' }}>
                        {/* Risk Info */}
                        <td style={S.td}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                            <div>
                              <button
                                onClick={() => {
                                  setDetail(r);
                                  setDrawerTab('overview');
                                }}
                                style={{
                                  ...linkBtn('var(--ink)'),
                                  fontSize: 13,
                                  fontWeight: 700,
                                  padding: 0,
                                  textAlign: 'left',
                                  lineHeight: 1.4,
                                }}
                              >
                                {r.ref} — {r.title}
                              </button>

                              <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    background: 'var(--surface-sunk)',
                                    color: 'var(--ink-body)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    border: '1px solid var(--line)',
                                  }}
                                >
                                  {r.category}
                                </span>

                                <span
                                  style={{
                                    fontSize: 10.5,
                                    background: r.direction === 'Opportunity' ? 'var(--brand-tint)' : 'var(--surface-sunk)',
                                    color: r.direction === 'Opportunity' ? 'var(--brand)' : 'var(--ink-muted)',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    fontWeight: 600,
                                  }}
                                >
                                  {r.direction || 'Threat'}
                                </span>

                                {r.linkedControls && r.linkedControls.length > 0 && (
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      background: 'var(--info-bg)',
                                      color: 'var(--info)',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                    }}
                                  >
                                    <Icon name="controls" size={12} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> {r.linkedControls.length} control(s)
                                  </span>
                                )}

                                {r.acceptanceExpired && (
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      background: 'var(--danger-bg)',
                                      color: 'var(--danger)',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      fontWeight: 600,
                                    }}
                                  >
                                    Expired Acceptance
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Owner */}
                        <td style={{ ...S.td, color: 'var(--ink-body)', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="user" size={13} />{r.owner?.name || 'Unassigned'}</span>
                        </td>

                        {/* Inherent Score */}
                        <td style={S.td}>
                          <span
                            style={{
                              background: RATING_BG[r.inherentRating],
                              color: RATING_COLOR[r.inherentRating],
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            {r.inherentScore}
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                            {r.inherentLikelihood}L × {r.inherentImpact}I
                          </div>
                        </td>

                        {/* Residual Score */}
                        <td style={S.td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span
                              style={{
                                background: RATING_BG[r.residualRating],
                                color: RATING_COLOR[r.residualRating],
                                padding: '2px 8px',
                                borderRadius: 4,
                                fontWeight: 700,
                                fontSize: 12,
                              }}
                            >
                              {r.residualScore}
                            </span>
                            {r.residualScore < r.inherentScore && (
                              <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 11 }} title="Score reduced by controls">
                                <Icon name="caretDown" size={12} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> -{r.inherentScore - r.residualScore}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 2 }}>
                            {r.residualLikelihood}L × {r.residualImpact}I
                          </div>
                        </td>

                        {/* Appetite Band */}
                        <td style={S.td}>
                          <span
                            style={{
                              background: appetiteStyle.bg,
                              color: appetiteStyle.color,
                              border: `1px solid ${appetiteStyle.border}`,
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 4,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {appetiteStyle.label}
                          </span>
                        </td>

                        {/* Treatment */}
                        <td style={S.td}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-body)' }}>{r.treatmentType}</div>
                          {r.treatments && r.treatments.length > 0 ? (
                            <div style={{ fontSize: 11, color: r.overdueTreatments > 0 ? 'var(--danger)' : 'var(--ink-muted)' }}>
                              {r.treatments.filter((t: any) => t.status === 'Done').length}/{r.treatments.length} actions done
                              {r.overdueTreatments > 0 && <span> ({r.overdueTreatments} overdue)</span>}
                            </div>
                          ) : (
                            <div style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>No actions assigned</div>
                          )}
                        </td>

                        {/* Status */}
                        <td style={S.td}>
                          <span style={STATUS_PILL[r.status] || STATUS_PILL.Open}>{r.status}</span>
                        </td>

                        {/* Actions */}
                        <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => {
                                setDetail(r);
                                setDrawerTab('controls');
                              }}
                              style={{
                                background: 'var(--surface-sunk)',
                                border: '1px solid var(--line)',
                                color: 'var(--info)',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '4px 8px',
                                borderRadius: 4,
                                cursor: 'pointer',
                              }}
                              title="Link Mitigating Controls"
                            >
                              Controls
                            </button>

                            <button
                              onClick={() => {
                                setDetail(r);
                                setDrawerTab('treatments');
                              }}
                              style={{
                                background: 'var(--surface-sunk)',
                                border: '1px solid var(--line)',
                                color: 'var(--brand)',
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '4px 8px',
                                borderRadius: 4,
                                cursor: 'pointer',
                              }}
                              title="Manage Treatment Action Plans"
                            >
                              Treatments
                            </button>

                            {r.status !== 'Accepted' && r.status !== 'Closed' && (
                              <button
                                onClick={() => accept(r)}
                                style={{
                                  background: 'var(--surface-sunk)',
                                  border: '1px solid var(--line)',
                                  color: 'var(--violet)',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  padding: '4px 8px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                }}
                                title="Time-bound formal acceptance"
                              >
                                Accept
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredRisks.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-muted)' }}>
                        No risks match the active search and filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: RISK TREATMENT & MITIGATION HUB ────────────────────────── */}
      {activeTab === 'treatments' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Treatment Header Card */}
          <div
            style={{
              ...S.card,
              padding: '20px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
                Enterprise risk treatment plans &amp; corrective actions
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>
                Track treatment action items (Mitigate, Transfer, Avoid, Accept) with assigned owners, milestones, and due dates.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (risks.length > 0) setShowAddTreatmentModal(risks[0].id);
                }}
                style={primaryBtn()}
              >
                + Assign Treatment Action
              </button>
            </div>
          </div>

          {/* Treatment Actions Table */}
          <div style={{ ...S.card, overflowX: 'auto', border: '1px solid var(--line)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={S.headRow}>
                  <th style={S.th}>Action Title &amp; Scope</th>
                  <th style={S.th}>Associated Risk</th>
                  <th style={S.th}>Residual Risk</th>
                  <th style={S.th}>Due Date</th>
                  <th style={S.th}>Status</th>
                  <th style={{ ...S.th, textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {allTreatmentActions.map((t) => {
                  const isOverdue = t.status === 'Open' && t.dueDate && new Date(t.dueDate).getTime() < Date.now();

                  return (
                    <tr key={t.id} style={S.bodyRow}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: t.status === 'Done' ? 'line-through' : 'none' }}>
                          {t.title}
                        </div>
                      </td>

                      <td style={S.td}>
                        <button
                          onClick={() => {
                            const parent = risks.find((x) => x.id === t.riskId);
                            if (parent) {
                              setDetail(parent);
                              setDrawerTab('treatments');
                            }
                          }}
                          style={{ ...linkBtn('var(--brand)'), fontSize: 12.5 }}
                        >
                          <strong>{t.riskRef}</strong> — {t.riskTitle}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--ink-muted)' }}>{t.riskCategory}</div>
                      </td>

                      <td style={S.td}>
                        <span
                          style={{
                            background: RATING_BG[t.residualRating],
                            color: RATING_COLOR[t.residualRating],
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {t.residualScore} ({t.residualRating})
                        </span>
                      </td>

                      <td style={S.td}>
                        <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--ink-body)', fontWeight: isOverdue ? 700 : 500 }}>
                          {t.dueDate ? t.dueDate.slice(0, 10) : '—'}
                          {isOverdue && <span style={{ marginLeft: 4, fontWeight: 700 }}>OVERDUE</span>}
                        </span>
                      </td>

                      <td style={S.td}>
                        {t.status === 'Done' ? (
                          <span style={pill('var(--success)', 'var(--success-line)')}>Completed</span>
                        ) : (
                          <span style={pill('var(--warning)', 'var(--warning-line)')}>Open Action</span>
                        )}
                      </td>

                      <td style={{ ...S.td, textAlign: 'right' }}>
                        {t.status === 'Open' ? (
                          <button
                            onClick={() => completeTreatment(t.id)}
                            style={{
                              background: 'var(--success)',
                              color: '#FFFFFF',
                              border: 'none',
                              padding: '5px 12px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Mark done <Icon name="check" size={13} style={{ display: 'inline-block', verticalAlign: '-2px' }} />
                          </button>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>Signed Off</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {allTreatmentActions.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--ink-muted)' }}>
                      No treatment actions recorded yet. Assign treatment actions to mitigate high risks.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 4: APPETITE & TOLERANCE POSTURE ────────────────────────────── */}
      {activeTab === 'appetite' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Criteria first: a tolerance of 12 means nothing until "impact 4"
              has a definition behind it. */}
          <RiskCriteriaPanel onChanged={load} />

          <div style={{ ...S.card, padding: '20px 24px' }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
              Board-approved risk appetite &amp; tolerance framework
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--ink-muted)' }}>
              Risk Appetite is the target exposure level approved by governance. Tolerance is the hard ceiling beyond which risks MUST be treated down and cannot be accepted.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {categories.map((cat) => {
              const statement = appetites.find((a) => a.category === cat);
              const catRisks = risks.filter((r) => r.category === cat);
              const beyondCount = catRisks.filter((r) => r.appetiteBand === 'BeyondTolerance').length;
              const maxResidual = catRisks.length > 0 ? Math.max(...catRisks.map((r) => r.residualScore)) : 0;

              return (
                <div key={cat} style={{ ...S.card, padding: '18px', border: beyondCount > 0 ? '1px solid var(--danger-line)' : '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{cat} Risk</h4>
                    {beyondCount > 0 ? (
                      <span style={{ fontSize: 11, background: 'var(--danger-bg)', color: 'var(--danger)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                        {beyondCount} Breaches
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, background: 'var(--success-bg)', color: 'var(--success)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                        Healthy Posture
                      </span>
                    )}
                  </div>

                  <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
                    "{statement?.statement || `Board approved governance threshold for ${cat.toLowerCase()} risks.`}"
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, color: 'var(--ink-body)' }}>
                    <span>Target Appetite: <strong>≤ {statement?.appetiteThreshold ?? 8}</strong></span>
                    <span>Max Tolerance: <strong>≤ {statement?.toleranceThreshold ?? 15}</strong></span>
                    <span>Peak Residual: <strong style={{ color: maxResidual > (statement?.toleranceThreshold ?? 15) ? 'var(--danger)' : 'var(--ink)' }}>{maxResidual}</strong></span>
                  </div>

                  {/* Visual Tolerance Bar */}
                  <div style={{ height: 8, background: 'var(--surface-sunk)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${Math.min(100, ((statement?.appetiteThreshold ?? 8) / 25) * 100)}%`, background: 'var(--success)' }} />
                    <div style={{ width: `${Math.min(100, (((statement?.toleranceThreshold ?? 15) - (statement?.appetiteThreshold ?? 8)) / 25) * 100)}%`, background: 'var(--warning)' }} />
                    <div style={{ flex: 1, background: 'var(--danger)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The dead tab made real: the appetite overlay, control coverage and the
          risk network — the three views the register could not previously show. */}
      {activeTab === 'import' && <RiskImport onCommitted={load} />}

      {activeTab === 'network' && (
        <RiskHeatmaps analytics={analytics} />
      )}


      {/* ── DETAIL & TREATMENT DRAWER MODAL ───────────────────────────────── */}
      {detail && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(11, 21, 36, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            style={{
              ...S.card,
              width: '100%',
              maxWidth: 780,
              maxHeight: '92vh',
              overflowY: 'auto',
              borderRadius: 14,
              padding: 0,
              background: 'var(--surface)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              style={{
                background: 'linear-gradient(135deg, #0B1524 0%, #162438 100%)',
                color: '#fff',
                padding: '20px 24px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, background: 'var(--brand)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                    {detail.ref}
                  </span>
                  <span style={{ fontSize: 11, background: 'rgba(255, 255, 255, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
                    {detail.category}
                  </span>
                  <span style={{ fontSize: 11, background: 'rgba(255, 255, 255, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
                    {detail.direction || 'Threat'}
                  </span>
                </div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' }}>{detail.title}</h3>
              </div>

              <button
                onClick={() => setDetail(null)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  color: '#fff',
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', background: 'var(--surface-sunk)', padding: '0 24px' }}>
              {(['overview', 'controls', 'treatments', 'acceptance', 'review'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setDrawerTab(t)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: drawerTab === t ? '2px solid var(--brand)' : '2px solid transparent',
                    color: drawerTab === t ? 'var(--brand)' : 'var(--ink-muted)',
                    fontWeight: 600,
                    fontSize: 13,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {t === 'overview' ? 'Overview' : t === 'controls' ? `Linked Controls (${detail.linkedControls?.length || 0})` : t === 'treatments' ? `Treatments (${detail.treatments?.length || 0})` : t === 'acceptance' ? 'Acceptance' : 'Formal Review'}
                </button>
              ))}
            </div>

            {/* Drawer Tab Content */}
            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
              {drawerTab === 'overview' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {/* Cause -> Event -> Impact Narrative */}
                  <div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                      Structured Narrative (Cause → Event → Impact)
                    </span>
                    <div
                      style={{
                        background: 'var(--surface-sunk)',
                        border: '1px solid var(--line)',
                        borderRadius: 8,
                        padding: '14px',
                        marginTop: 6,
                        fontSize: 13,
                        lineHeight: 1.6,
                        color: 'var(--ink-body)',
                      }}
                    >
                      {detail.description}
                    </div>
                  </div>

                  {/* Inherent vs Residual Score Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div style={{ ...S.card, padding: '16px', background: 'var(--surface-sunk)' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-muted)', textTransform: 'uppercase' }}>
                        Inherent Risk Score
                      </span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 700, color: RATING_COLOR[detail.inherentRating] }}>
                          {detail.inherentScore}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                          ({detail.inherentLikelihood} Likelihood × {detail.inherentImpact} Impact)
                        </span>
                      </div>
                    </div>

                    <div style={{ ...S.card, padding: '16px', border: '1px solid var(--brand-line)' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand)', textTransform: 'uppercase' }}>
                        Residual Risk Score
                      </span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                        <span style={{ fontSize: 28, fontWeight: 700, color: RATING_COLOR[detail.residualRating] }}>
                          {detail.residualScore}
                        </span>
                        <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                          ({detail.residualLikelihood} Likelihood × {detail.residualImpact} Impact)
                        </span>
                        {detail.residualScore < detail.inherentScore && (
                          <span style={{ color: 'var(--success)', fontWeight: 700, fontSize: 12 }}>
                            <Icon name="caretDown" size={12} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> -{detail.inherentScore - detail.residualScore} saved
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {drawerTab === 'controls' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                      Select verified controls implemented in this entity to calculate residual reduction:
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {impls.map((impl) => {
                      const isLinked = detail.controlLinks?.some((l: any) => l.implementationId === impl.id);

                      return (
                        <div
                          key={impl.id}
                          style={{
                            background: isLinked ? 'var(--brand-tint)' : 'var(--surface)',
                            border: `1px solid ${isLinked ? 'var(--brand-line)' : 'var(--line)'}`,
                            borderRadius: 6,
                            padding: '10px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: 13, color: 'var(--ink)' }}>{impl.control.code}</strong> —{' '}
                            <span style={{ fontSize: 12.5, color: 'var(--ink-body)' }}>{impl.control.title || impl.control.name}</span>
                            <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                              Status: <strong>{impl.status}</strong> · Effectiveness: <strong>{impl.effectiveness}</strong>
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              const currentIds = detail.controlLinks?.map((l: any) => l.implementationId) || [];
                              const updated = isLinked ? currentIds.filter((id: string) => id !== impl.id) : [...currentIds, impl.id];
                              linkControlsModal(detail, updated);
                            }}
                            style={{
                              background: isLinked ? 'var(--danger)' : 'var(--brand)',
                              color: '#fff',
                              border: 'none',
                              padding: '5px 12px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {isLinked ? 'Unlink' : 'Link'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {drawerTab === 'treatments' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-muted)' }}>
                      Assigned treatment action items for <strong>{detail.ref}</strong>:
                    </span>
                    <button onClick={() => setShowAddTreatmentModal(detail.id)} style={primaryBtn()}>
                      + Add Action Item
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {detail.treatments?.map((t: any) => (
                      <div
                        key={t.id}
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 6,
                          padding: '12px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', textDecoration: t.status === 'Done' ? 'line-through' : 'none' }}>
                            {t.title}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>
                            Due: {t.dueDate?.slice(0, 10) || 'No date set'}
                          </div>
                        </div>

                        <div>
                          {t.status === 'Open' ? (
                            <button onClick={() => completeTreatment(t.id)} style={primaryBtn()}>
                              Mark completed <Icon name="check" size={13} style={{ display: 'inline-block', verticalAlign: '-2px' }} />
                            </button>
                          ) : (
                            <span style={pill('var(--success)', 'var(--success-line)')}>Done</span>
                          )}
                        </div>
                      </div>
                    ))}

                    {(!detail.treatments || detail.treatments.length === 0) && (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-muted)', background: 'var(--surface-sunk)', borderRadius: 6 }}>
                        No treatment actions assigned yet.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {drawerTab === 'acceptance' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {detail.acceptedBy ? (
                    <div style={{ background: 'var(--violet-soft)', border: '1px solid var(--violet)', borderRadius: 8, padding: '16px' }}>
                      <h4 style={{ margin: '0 0 6px', color: 'var(--violet)', fontSize: 14 }}>Formal Risk Acceptance Record</h4>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-body)' }}>
                        Accepted by <strong>{detail.acceptedBy.name}</strong> until{' '}
                        <strong>{detail.acceptedUntil?.slice(0, 10)}</strong>.
                      </p>
                      <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                        Justification: "{detail.acceptanceReason}"
                      </p>
                    </div>
                  ) : (
                    <div style={{ ...S.card, padding: 18 }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--ink)' }}>Authorize Time-Bound Acceptance</h4>
                      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                        Acceptance records an explicit risk exception subject to board appetite ceilings. The risk owner cannot approve their own acceptance.
                      </p>
                      <button onClick={() => accept(detail)} style={primaryBtn()}>
                        Proceed with Acceptance Approval
                      </button>
                    </div>
                  )}
                </div>
              )}

              {drawerTab === 'review' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ ...S.card, padding: 18 }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 14, color: 'var(--ink)' }}>Record Formal ISO 31000 Review</h4>
                    <p style={{ margin: '0 0 14px', fontSize: 12.5, color: 'var(--ink-muted)' }}>
                      Conducting a review updates the review timestamp and advances the next scheduled review date.
                    </p>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handlePerformReview(detail.id);
                      }}
                    >
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Review Notes / Observations</label>
                      <textarea
                        rows={3}
                        value={reviewForm.notes}
                        onChange={(e) => setReviewForm({ ...reviewForm, notes: e.target.value })}
                        style={{ ...S.input, marginBottom: 12 }}
                        placeholder="Document control effectiveness observations, changes in threat landscape..."
                      />

                      <button type="submit" style={primaryBtn()}>
                        Confirm &amp; Record Formal Review
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── NEW RISK MODAL ────────────────────────────────────────────────── */}
      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11, 21, 36, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 540, padding: 26, borderRadius: 12, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: 'var(--ink)', fontWeight: 700 }}>Log New Enterprise Risk</h3>
              <button onClick={() => setShowNew(false)} style={linkBtn('var(--ink-muted)')} aria-label="Close"><Icon name="close" size={15} label="Close" /></button>
            </div>

            {formErr && <div style={{ ...S.error, marginBottom: 14 }}>{formErr}</div>}
            {dupes && (
              <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', borderRadius: 6, padding: 12, marginBottom: 14, fontSize: 12 }}>
                <strong style={{ color: 'var(--warning)' }}>Potential Duplicates Found:</strong>
                {dupes.map((d) => (
                  <div key={d.id} style={{ color: 'var(--ink-muted)', marginTop: 4 }}>
                    {d.ref} — {d.title} ({d.status})
                  </div>
                ))}
                <button onClick={(e) => submitNew(e as any, true)} style={{ ...linkBtn('var(--danger)'), marginTop: 8 }}>
                  Create Anyway (Acknowledge Duplicates)
                </button>
              </div>
            )}

            <form onSubmit={(e) => submitNew(e)}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Risk Title</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ ...S.input, marginBottom: 12 }}
                placeholder="e.g. Unpatched externally-facing customer portal"
              />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
                Cause → Event → Impact Narrative
              </label>
              <textarea
                required
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ ...S.input, marginBottom: 12, resize: 'vertical' }}
                placeholder="Due to legacy middleware (cause), a remote exploit may execute (event), causing data breach (impact)."
              />

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={S.input}>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Direction</label>
                  <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={S.input}>
                    <option value="Threat">Threat (Negative)</option>
                    <option value="Opportunity">Opportunity (Positive)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Likelihood (1–5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.likelihood}
                    onChange={(e) => setForm({ ...form, likelihood: Number(e.target.value) })}
                    style={S.input}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Impact (1–5)</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={form.impact}
                    onChange={(e) => setForm({ ...form, impact: Number(e.target.value) })}
                    style={S.input}
                  />
                </div>
              </div>

              <div
                style={{
                  background: RATING_BG[ratingOf(form.likelihood * form.impact)],
                  color: RATING_COLOR[ratingOf(form.likelihood * form.impact)],
                  padding: '10px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 700,
                  marginBottom: 18,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>Calculated Inherent Score:</span>
                <span>{form.likelihood * form.impact} ({ratingOf(form.likelihood * form.impact)})</span>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1 }}>
                  {busy ? 'Validating…' : 'Create Risk'}
                </button>
                <button type="button" onClick={() => setShowNew(false)} style={ghostBtn}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── ASSIGN TREATMENT ACTION MODAL ─────────────────────────────────── */}
      {showAddTreatmentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11, 21, 36, 0.65)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 20 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 460, padding: 24, borderRadius: 12 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 16, color: 'var(--ink)' }}>Assign Risk Treatment Action</h3>
            <form onSubmit={handleCreateTreatmentAction}>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Action Title</label>
              <input
                required
                value={treatmentForm.title}
                onChange={(e) => setTreatmentForm({ ...treatmentForm, title: e.target.value })}
                style={{ ...S.input, marginBottom: 12 }}
                placeholder="e.g. Implement Web Application Firewall rule set"
              />

              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Due Date (Target Completion)</label>
              <input
                type="date"
                required
                value={treatmentForm.dueDate}
                onChange={(e) => setTreatmentForm({ ...treatmentForm, dueDate: e.target.value })}
                style={{ ...S.input, marginBottom: 16 }}
              />

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" disabled={busy} style={{ ...primaryBtn(busy), flex: 1 }}>
                  {busy ? 'Saving…' : 'Save Treatment Action'}
                </button>
                <button type="button" onClick={() => setShowAddTreatmentModal(null)} style={ghostBtn}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default RiskRegister;
