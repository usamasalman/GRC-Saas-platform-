import React, { useEffect, useState } from 'react';
import { S, ghostBtn } from '../iam/iamStyles';
import ProjectPortfolio from './project/ProjectPortfolio';
import ProjectPlan from './project/ProjectPlan';
import ProjectVerification from './project/ProjectVerification';
import ProjectImpediments from './project/ProjectImpediments';
import ProjectEvidence from './project/ProjectEvidence';
import ProjectReports from './project/ProjectReports';
import ProjectTimeline from './project/ProjectTimeline';
import NewProject from './project/NewProject';
import ProjectTeam from './project/ProjectTeam';
import ProjectLifecycle from './project/ProjectLifecycle';
import ProjectGantt from './project/ProjectGantt';
import TemplateLibrary from './project/TemplateLibrary';
import InvitationsInbox from './project/InvitationsInbox';
import EngagementOverview from './project/EngagementOverview';
import EngagementScope from './project/EngagementScope';
import EngagementDocuments from './project/EngagementDocuments';
import EngagementRisksAssets from './project/EngagementRisksAssets';
import ClientEngagements from './project/ClientEngagements';
import PartnerHome from './project/PartnerHome';
import ExternalAccess from './project/ExternalAccess';
import CompletedEngagements from './project/CompletedEngagements';
import FirmTeam from './project/FirmTeam';
import EngagementRequests from './project/EngagementRequests';
import { STYLE_LABEL } from './project/EngagementPanel';
import { MAY, can } from '../../components/Can';
import { calendarDate } from '../../utils/calendarDate';
import apiClient from '../../api/apiClient';

/**
 * The delivery workspace, laid out in the order the work happens: the portfolio
 * of engagements, then the plan for whichever one you opened.
 *
 * The selected project is the only state this host owns — each tab loads its own
 * data — which is the same arrangement AuditProgramme uses for its engagements.
 *
 * Later slices add tabs beside these: deliverables, reports. None of them
 * change this file beyond one more entry.
 */

type TabKey = 'home' | 'engagements' | 'completed' | 'firmteam' | 'access' | 'portfolio' | 'templates' | 'invitations'
  | 'overview' | 'scope' | 'documents' | 'registers' | 'requests'
  | 'plan' | 'gantt' | 'team' | 'verification' | 'impediments' | 'evidence' | 'reports' | 'timeline' | 'new';

/** The signed-in person's portal, as the shell stored it; unknown reads as the organisation's. */
function portalOf(): string {
  try { return String(JSON.parse(localStorage.getItem('grc_user_json') || '{}')?.portal || ''); } catch { return ''; }
}
/** Portals of organisations that deliver for others (the delivery firm types). */
const FIRM_PORTALS = ['partner', 'franchise'];
/** Tabs that are not one engagement's workspace. */
const OUTSIDE_WORKSPACE: TabKey[] = ['home', 'engagements', 'completed', 'firmteam', 'access', 'portfolio', 'new', 'templates', 'invitations'];

interface Selected { id: string; ref: string; name: string; }

const DeliveryProjects: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('portfolio');
  const [selected, setSelected] = useState<Selected | null>(null);
  // Bumped when the lifecycle changes, so the open tab reloads and shows it.
  const [version, setVersion] = useState(0);
  // The engagement just created from "New engagement" with a template wanted.
  const [wizardFor, setWizardFor] = useState<string | null>(null);
  // Invitations appear only where consulting is switched on (sprint 4).
  const [consulting, setConsulting] = useState(false);
  useEffect(() => {
    apiClient.get('/api/engagements/feature').then((r) => setConsulting(Boolean(r.data?.enabled))).catch(() => setConsulting(false));
  }, []);
  // Sprint 6: the firm's Home and Client engagements, the organisation's
  // External access, and the workspace tabs of a consulting engagement.
  const portal = portalOf();
  const firmPortal = FIRM_PORTALS.includes(portal);
  const orgPortal = portal !== 'partner' && can(MAY.MANAGE_PROJECT);
  // Sprint 7: the firm's own records and its people, for the firm's managers.
  const firmManager = firmPortal && can(MAY.MANAGE_PROJECT);
  const [engagement, setEngagement] = useState<any>(null);
  useEffect(() => {
    setEngagement(null);
    if (!selected || !consulting) return;
    apiClient.get(`/api/engagements/${selected.id}`)
      .then((r) => setEngagement(r.data?.engagement?.deliveryStyle ? r.data : null))
      .catch(() => setEngagement(null));
  }, [selected, consulting, version]);
  const consultingTabs = Boolean(engagement);
  const mine = engagement?.me ? (engagement.members || []).find((m: any) => m.id === engagement.me.memberId) : null;
  // Firm-side people open a consulting engagement on its Overview.
  const openFromFirm = (p: Selected) => { setSelected(p); setWizardFor(null); setTab('overview'); };

  const open = (project: Selected, fromTemplate = false) => {
    setSelected(project);
    setWizardFor(fromTemplate ? project.id : null);
    setTab('plan');
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
    color: active ? 'var(--ink)' : 'var(--ink-muted)',
    padding: '10px 2px',
    marginRight: 24,
    fontSize: 13.5,
    fontWeight: active ? 600 : 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div style={{ ...S.page, background: 'transparent', padding: 0, minHeight: 0 }}>
      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 20, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {consulting && firmPortal && (
          <>
            <button style={tabStyle(tab === 'home')} onClick={() => setTab('home')}>Home</button>
            <button style={tabStyle(tab === 'engagements')} onClick={() => setTab('engagements')}>Client engagements</button>
          </>
        )}
        {consulting && firmManager && (
          <>
            <button style={tabStyle(tab === 'completed')} onClick={() => setTab('completed')}>Completed engagements</button>
            <button style={tabStyle(tab === 'firmteam')} onClick={() => setTab('firmteam')}>Firm team</button>
          </>
        )}
        <button style={tabStyle(tab === 'portfolio')} onClick={() => setTab('portfolio')}>
          Portfolio
        </button>
        <button style={tabStyle(tab === 'templates')} onClick={() => setTab('templates')}>
          Templates
        </button>
        {consulting && (
          <button style={tabStyle(tab === 'invitations')} onClick={() => setTab('invitations')}>
            Invitations
          </button>
        )}
        {consulting && orgPortal && (
          <button style={tabStyle(tab === 'access')} onClick={() => setTab('access')}>External access</button>
        )}
        {consultingTabs && (
          <>
            <button style={tabStyle(tab === 'overview')} onClick={() => setTab('overview')}>Overview</button>
            <button style={tabStyle(tab === 'scope')} onClick={() => setTab('scope')}>Scope</button>
          </>
        )}
        <button
          style={{ ...tabStyle(tab === 'plan'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('plan')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Plan
        </button>
        <button
          style={{ ...tabStyle(tab === 'gantt'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('gantt')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Gantt
        </button>
        {consultingTabs && (
          <>
            <button style={tabStyle(tab === 'documents')} onClick={() => setTab('documents')}>Documents</button>
            <button style={tabStyle(tab === 'registers')} onClick={() => setTab('registers')}>Risks and assets</button>
            <button style={tabStyle(tab === 'requests')} onClick={() => setTab('requests')}>Requests</button>
          </>
        )}
        <button
          style={{ ...tabStyle(tab === 'team'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('team')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Team
        </button>
        <button
          style={{ ...tabStyle(tab === 'verification'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('verification')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Verification
        </button>
        <button
          style={{ ...tabStyle(tab === 'impediments'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('impediments')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Delays
        </button>
        <button
          style={{ ...tabStyle(tab === 'evidence'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('evidence')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Evidence
        </button>
        <button
          style={{ ...tabStyle(tab === 'reports'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('reports')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Reports
        </button>
        <button
          style={{ ...tabStyle(tab === 'timeline'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('timeline')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Timeline
        </button>

      </div>

      {/* The open engagement and its lifecycle, on a row of its own so the
          status, the hold reason and the four decisions wrap on a narrow
          screen instead of running off the tab bar. */}
      {/* Inside a firm's workspace a bar names the client, the engagement, the
          delivery style and when access ends, so moving to another client is
          always a deliberate switch (sprint 6). */}
      {engagement?.side === 'Provider' && selected && !OUTSIDE_WORKSPACE.includes(tab) && (
        <div style={{ ...S.card, padding: '8px 14px', marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span>Client: <strong>{engagement.engagement.client}</strong></span>
          <span>Engagement: <strong>{engagement.engagement.ref}</strong> · {engagement.engagement.name}</span>
          <span>{STYLE_LABEL[engagement.engagement.deliveryStyle] || engagement.engagement.deliveryStyle}</span>
          <span style={{ marginLeft: 'auto' }}>
            {mine?.accessTo ? `Your access ends ${calendarDate(mine.accessTo, { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
          </span>
        </div>
      )}
      {!OUTSIDE_WORKSPACE.includes(tab) && selected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '-8px 0 18px' }}>
          <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
            <span style={{ color: 'var(--ink-faint)', fontWeight: 500 }}>{selected.ref}</span> · {selected.name}
          </span>
          <ProjectLifecycle key={`${selected.id}-${version}`} projectId={selected.id} onChanged={() => setVersion((v) => v + 1)} />
          <button style={{ ...ghostBtn, marginLeft: 'auto' }} onClick={() => setTab('portfolio')}>Back to portfolio</button>
        </div>
      )}

      {tab === 'portfolio' && (
        <ProjectPortfolio onOpen={open} onCreate={() => setTab('new')} />
      )}
      {tab === 'templates' && <TemplateLibrary />}
      {tab === 'home' && consulting && <PartnerHome onOpen={openFromFirm} onInvitations={() => setTab('invitations')} />}
      {tab === 'engagements' && consulting && <ClientEngagements onOpen={openFromFirm} />}
      {tab === 'completed' && consulting && firmManager && <CompletedEngagements onOpen={openFromFirm} />}
      {tab === 'firmteam' && consulting && firmManager && <FirmTeam />}
      {tab === 'access' && consulting && <ExternalAccess />}
      {tab === 'overview' && selected && consultingTabs && <EngagementOverview key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'scope' && selected && consultingTabs && <EngagementScope key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'documents' && selected && consultingTabs && <EngagementDocuments key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'registers' && selected && consultingTabs && <EngagementRisksAssets key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'requests' && selected && consultingTabs && <EngagementRequests key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'invitations' && consulting && <InvitationsInbox />}
      {tab === 'new' && (
        <NewProject
          onCreated={(p, fromTemplate) => open(p, fromTemplate)}
          onCancel={() => setTab('portfolio')}
        />
      )}
      {tab === 'plan' && selected && <ProjectPlan key={`${selected.id}-${version}`} projectId={selected.id} startWithWizard={wizardFor === selected.id} onActivated={() => setVersion((v) => v + 1)} />}
      {tab === 'gantt' && selected && <ProjectGantt key={`${selected.id}-${version}`} projectId={selected.id} />}
      {tab === 'team' && selected && <ProjectTeam key={`${selected.id}-${version}`} projectId={selected.id} onOpenProject={(p) => open(p)} />}
      {tab === 'verification' && selected && (
        <ProjectVerification key={`${selected.id}-${version}`} projectId={selected.id} />
      )}
      {tab === 'impediments' && selected && (
        <ProjectImpediments key={`${selected.id}-${version}`} projectId={selected.id} />
      )}
      {tab === 'evidence' && selected && (
        <ProjectEvidence key={`${selected.id}-${version}`} projectId={selected.id} />
      )}
      {tab === 'reports' && selected && (
        <ProjectReports key={`${selected.id}-${version}`} projectId={selected.id} />
      )}
      {tab === 'timeline' && selected && (
        <ProjectTimeline key={`${selected.id}-${version}`} projectId={selected.id} />
      )}
    </div>
  );
};

export default DeliveryProjects;
