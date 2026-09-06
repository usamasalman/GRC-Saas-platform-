import React, { useEffect, useState, useCallback } from 'react';
import apiClient from '../../../api/apiClient';
import { S, primaryBtn, ghostBtn, pill, StatStrip } from '../../iam/iamStyles';

/**
 * The delivery portfolio — every engagement this organisation can see, with the
 * schedule and status figures the server derives.
 *
 * Rows open the plan. The two progress bars are fed by projectRollup, so they
 * move as tasks are completed without this file computing anything.
 */

interface Schedule {
  totalDays: number;
  elapsedDays: number;
  remainingDays: number;
  elapsedPercent: number;
  overdue: boolean;
  daysOverdue: number;
}

interface Project {
  id: string;
  ref: string;
  name: string;
  projectType: string;
  priority: string;
  status: string;
  health: string;
  reportedProgress: number;
  verifiedProgress: number;
  startDate: string;
  targetEndDate: string;
  frameworks: string[];
  schedule: Schedule;
  derivedStatus: 'OnTrack' | 'AtRisk' | 'Delayed' | 'Completed' | 'NotStarted';
  side: 'Client' | 'Provider' | null;
  memberCount: number;
  owner: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  tenant: { id: string; name: string } | null;
  providerTenant: { id: string; name: string } | null;
}

/** Schedule health, which is not the same thing as the manager's health flag. */
const DERIVED: Record<string, { label: string; fg: string; line: string }> = {
  OnTrack: { label: 'On track', fg: 'var(--success)', line: 'var(--success-line)' },
  AtRisk: { label: 'At risk', fg: 'var(--warning)', line: 'var(--warning-line)' },
  Delayed: { label: 'Delayed', fg: 'var(--danger)', line: 'var(--danger-line)' },
  Completed: { label: 'Completed', fg: 'var(--info)', line: 'var(--info-line)' },
  NotStarted: { label: 'Not started', fg: 'var(--ink-muted)', line: 'var(--line)' },
};

const PRIORITY_FG: Record<string, string> = {
  Critical: 'var(--danger)',
  High: 'var(--warning)',
  Medium: 'var(--ink-muted)',
  Low: 'var(--ink-faint)',
};

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

const apiError = (err: any): string =>
  err?.response?.data?.message || 'Something went wrong. Please try again.';

/**
 * Two bars, not one. Reported is what owners say; verified is what a reviewer
 * confirmed. Showing only the first is how a programme reports 100% while
 * nothing has been checked — which is the problem this module exists to solve.
 */
const ProgressBars: React.FC<{ reported: number; verified: number }> = ({ reported, verified }) => (
  <div style={{ minWidth: 150 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
      <span style={{ color: 'var(--ink-muted)' }}>Reported</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{reported}%</span>
    </div>
    <div style={{ height: 6, background: 'var(--surface-sunk)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${reported}%`, height: '100%', background: 'var(--info)' }} />
    </div>

    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, margin: '6px 0 3px' }}>
      <span style={{ color: 'var(--ink-muted)' }}>Verified</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{verified}%</span>
    </div>
    <div style={{ height: 6, background: 'var(--surface-sunk)', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${verified}%`, height: '100%', background: 'var(--success)' }} />
    </div>
  </div>
);

interface Props {
  /** Opens a project's plan. Supplied by the workspace host. */
  onOpen?: (p: { id: string; ref: string; name: string }) => void;
}

const ProjectPortfolio: React.FC<Props> = ({ onOpen }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [totals, setTotals] = useState({ active: 0, atRisk: 0, delayed: 0, completed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await apiClient.get(`/api/projects?${params.toString()}`);
      setProjects(res.data?.projects || []);
      setTotals(res.data?.totals || { active: 0, atRisk: 0, delayed: 0, completed: 0 });
    } catch (err: any) {
      setError(apiError(err));
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  if (loading && projects.length === 0) {
    return <div style={{ padding: 24, color: 'var(--ink-muted)' }}>Loading projects…</div>;
  }

  return (
    <div style={{ padding: 0 }}>
      <StatStrip items={[
        ['Active', totals.active],
        ['At risk', totals.atRisk],
        ['Delayed', totals.delayed],
        ['Completed', totals.completed],
      ]} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...S.input, maxWidth: 260 }}
          placeholder="Search by name or reference"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
        />
        <select
          style={{ ...S.input, maxWidth: 170 }}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {['Draft', 'Active', 'OnHold', 'Closed', 'Cancelled'].map((s) => (
            <option key={s} value={s}>{s === 'OnHold' ? 'On hold' : s}</option>
          ))}
        </select>
        <button style={ghostBtn} onClick={load}>Refresh</button>
      </div>

      {error && (
        <div style={{
          ...S.card, padding: '12px 16px', marginBottom: 16,
          borderLeft: '3px solid var(--danger)', color: 'var(--danger)', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {projects.length === 0 && !error ? (
        // An empty portfolio is the normal first experience. Say what to do
        // rather than showing an empty table and four zeroes.
        <div style={{ ...S.card, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>
            No delivery projects yet
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 460, margin: '0 auto 18px' }}>
            A delivery project tracks a compliance programme end to end — an ISO 27001 readiness
            effort, a SOC 2 preparation, a remediation plan — with its phases, owners and dates.
          </div>
          <button style={primaryBtn(true)} disabled title="Project creation arrives with the planning screen">
            Create a project
          </button>
        </div>
      ) : (
        <div style={{ ...S.card, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Project', 'Owner', 'Timeline', 'Progress', 'Status', 'Team'].map((h) => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const d = DERIVED[p.derivedStatus] || DERIVED.NotStarted;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => onOpen?.({ id: p.id, ref: p.ref, name: p.name })}
                      style={onOpen ? { cursor: 'pointer' } : undefined}
                      // Keyboard reachable: the row is the primary action here,
                      // and a table of unreachable rows is a table nobody can use
                      // without a mouse.
                      tabIndex={onOpen ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (onOpen && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onOpen({ id: p.id, ref: p.ref, name: p.name });
                        }
                      }}
                    >
                      <td style={S.td}>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 2 }}>
                          {p.ref} · {p.projectType}
                          {p.frameworks.length > 0 && ` · ${p.frameworks.join(', ')}`}
                        </div>
                        {/* Only meaningful on consultant-led work; hidden otherwise. */}
                        {p.side === 'Provider' && p.tenant && (
                          <div style={{ fontSize: 11, color: 'var(--info)', marginTop: 3 }}>
                            Delivering for {p.tenant.name}
                          </div>
                        )}
                      </td>

                      <td style={S.td}>
                        <div style={{ color: 'var(--ink-body)' }}>{p.owner?.name || '—'}</div>
                        {p.manager && p.manager.id !== p.owner?.id && (
                          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>PM: {p.manager.name}</div>
                        )}
                      </td>

                      <td style={S.td}>
                        <div style={{ fontSize: 12, color: 'var(--ink-body)' }}>
                          {fmtDate(p.startDate)} → {fmtDate(p.targetEndDate)}
                        </div>
                        <div style={{
                          fontSize: 11, marginTop: 2,
                          color: p.schedule.overdue ? 'var(--danger)' : 'var(--ink-faint)',
                        }}>
                          {p.schedule.overdue
                            ? `${p.schedule.daysOverdue} days overdue`
                            : `${p.schedule.remainingDays} of ${p.schedule.totalDays} days remaining`}
                        </div>
                      </td>

                      <td style={S.td}>
                        <ProgressBars reported={p.reportedProgress} verified={p.verifiedProgress} />
                      </td>

                      <td style={S.td}>
                        <span style={pill(d.fg, d.line)}>{d.label}</span>
                        <div style={{ fontSize: 11, color: PRIORITY_FG[p.priority], marginTop: 4 }}>
                          {p.priority} priority
                        </div>
                        {p.health !== 'Green' && (
                          <div style={{
                            fontSize: 11, marginTop: 2,
                            color: p.health === 'Red' ? 'var(--danger)' : 'var(--warning)',
                          }}>
                            Manager flag: {p.health}
                          </div>
                        )}
                      </td>

                      <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {p.memberCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectPortfolio;
