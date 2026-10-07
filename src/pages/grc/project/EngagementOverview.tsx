import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, pill, apiError } from '../../iam/iamStyles';
import { calendarDate } from '../../../utils/calendarDate';
import { STYLE_LABEL } from './EngagementPanel';

/**
 * A consulting engagement at a glance (consulting engagement, sprint 6): the
 * objective, the two parties, the dates, progress as reported and as
 * verified, what the binding scope shares and who is on the engagement with
 * their access. Read by both sides; everything here comes from the
 * engagement's own routes, so the firm sees nothing the guard would refuse.
 */

const fmt = (d: string | null | undefined) => calendarDate(d, { day: '2-digit', month: 'short', year: 'numeric' });

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div style={{ ...S.card, padding: 16 }}>
    <div style={{ fontSize: 11.5, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);

const EngagementOverview: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [project, setProject] = useState<any>(null);
  const [engagement, setEngagement] = useState<any>(null);
  const [binding, setBinding] = useState<any>(null);
  // Sprint 8: the requests' counts and the readiness figure from accepted evidence.
  const [requests, setRequests] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiClient.get(`/api/projects/${projectId}`),
      apiClient.get(`/api/engagements/${projectId}`),
      apiClient.get(`/api/engagements/${projectId}/scope`).catch(() => null),
      apiClient.get(`/api/engagements/${projectId}/requests`, { params: { pageSize: 1 } }).catch(() => null),
    ])
      .then(([p, e, s, r]) => {
        setRequests(r?.data?.summary || null);
        setProject(p.data?.project || null);
        setEngagement(e.data || null);
        setBinding((s?.data?.versions || []).find((v: any) => v.status === 'Binding') || null);
      })
      .catch((err) => setError(apiError(err, 'Could not load the engagement.')));
  }, [projectId]);

  if (error) return <div style={S.error}>{error}</div>;
  if (!project || !engagement) return <div style={{ color: 'var(--ink-muted)', padding: 20 }}>Loading…</div>;
  const e = engagement.engagement;
  const people = (engagement.members || []).filter((m: any) => m.active && m.memberStatus === 'Approved');
  const lead = people.find((m: any) => m.engagementRole === 'Lead');
  const mine = engagement.me ? (engagement.members || []).find((m: any) => m.id === engagement.me.memberId) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
      <Card title="Objective">
        <div style={{ fontSize: 13, color: 'var(--ink-body)', lineHeight: 1.6 }}>
          {project.objectives || project.description || <span style={{ color: 'var(--ink-muted)' }}>No objective written yet.</span>}
        </div>
      </Card>
      <Card title="Parties">
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>Organisation: <strong>{e.client}</strong></div>
          <div>Firm: <strong>{e.firm || '—'}</strong>{lead ? ` · Lead ${lead.user.name}` : ''}</div>
          <div>
            Delivery style:{' '}
            <span style={pill('var(--brand)', 'var(--brand-line)')}>{STYLE_LABEL[e.deliveryStyle] || 'Named the old way'}</span>
          </div>
        </div>
      </Card>
      <Card title="Dates and progress">
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>{fmt(project.startDate)} → {fmt(project.targetEndDate)} · {project.status === 'OnHold' ? 'On hold' : project.status}</div>
          <div>Reported {project.reportedProgress}% · verified {project.verifiedProgress}%</div>
          {mine && (
            <div style={{ color: 'var(--ink-muted)' }}>Your access: {fmt(mine.accessFrom)} → {fmt(mine.accessTo)}</div>
          )}
        </div>
      </Card>
      <Card title="What is shared">
        {binding ? (
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>Scope version {binding.version}: {binding.services.length > 0 ? binding.services.join(', ') : 'the engagement only, no registers'}</div>
            <div>Up to {binding.classificationCeiling} · {binding.entities.map((x: any) => x.name).join(', ')}</div>
            <div style={{ color: 'var(--ink-muted)' }}>Documents are {e.documentAccess === 'Download' ? 'downloadable' : 'view only'}.</div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>No scope yet: the firm sees the engagement itself and none of the registers.</div>
        )}
      </Card>
      {requests && (
        <Card title="Requests">
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>
              Open {requests.Open ?? 0} · answered {requests.Answered ?? 0} · returned {requests.Returned ?? 0} · accepted {requests.Accepted ?? 0}
              {requests.overdue > 0 && <span style={{ color: 'var(--danger)' }}> · {requests.overdue} overdue</span>}
            </div>
            <div>Clauses with evidence the firm accepted: {requests.acceptedClauses ?? 0}</div>
            <div style={{ color: 'var(--ink-muted)' }}>Counts toward readiness only; verifying stays with the organisation.</div>
          </div>
        </Card>
      )}
      <Card title="People from the firm">
        {people.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--ink-muted)' }}>Nobody approved yet.</div>
        ) : people.map((m: any) => (
          <div key={m.id} style={{ fontSize: 12.5, padding: '2px 0' }}>
            {m.user.name} · {m.engagementRole} <span style={{ color: 'var(--ink-muted)' }}>to {fmt(m.accessTo)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
};

export default EngagementOverview;
