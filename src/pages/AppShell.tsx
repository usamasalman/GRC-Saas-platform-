import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
// @ts-ignore
import { renderMockView } from '../utils/appMockEngine.js';

// Real Document Components
import DocumentDashboard from './documents/DocumentDashboard';
import DocumentLibrary from './documents/DocumentLibrary';
import ApprovalQueue from './documents/ApprovalQueue';
import AcknowledgementTracker from './documents/AcknowledgementTracker';
import AuditLogViewer from './documents/AuditLogViewer';

// Real Tenant Components
import TenantManager from './tenants/TenantManager';
import ImpersonationSessions from './impersonation/ImpersonationSessions';

// Real IAM Components
import RoleMatrix from './iam/RoleMatrix';
import UserDirectory from './iam/UserDirectory';
import TeamDirectory from './iam/TeamDirectory';
import UserLifecycle from './iam/UserLifecycle';

// Real ITSM Components (workflow-engine backed)
import ServiceDesk from './itsm/ServiceDesk';
import TicketQueues from './itsm/TicketQueues';
import ServiceCatalog from './itsm/ServiceCatalog';
import SlaEscalations from './itsm/SlaEscalations';
import KnowledgeBase from './itsm/KnowledgeBase';

// Real GRC Core Components
import StandardsLibrary from './grc/StandardsLibrary';
import ControlLibrary from './grc/ControlLibrary';
import Implementations from './grc/Implementations';
import RiskRegister from './grc/RiskRegister';
import AuditProgramme from './grc/AuditProgramme';

// Real Modules & Entitlements Components
import GrcModuleMarketplace from './marketplace/GrcModuleMarketplace';
import OpenSourceToolMarketplace from './marketplace/OpenSourceToolMarketplace';
import ToolReviewApproval from './marketplace/ToolReviewApproval';
import TenantToolInstallations from './marketplace/TenantToolInstallations';
import FeatureFlagsManager from './marketplace/FeatureFlagsManager';

// Real Subscriptions & Billing Components
import SubscriptionManagement from './billing/SubscriptionManagement';
import PlansCatalogue from './billing/PlansCatalogue';
import InvoiceManagement from './billing/InvoiceManagement';
import PaymentsReconciliation from './billing/PaymentsReconciliation';
import PaymentGatewayTax from './billing/PaymentGatewayTax';

/**
 * Persistent warning bar shown whenever a read-only impersonation session is
 * active. Exiting clears the impersonation token and reloads as the operator.
 */
const ImpersonationBanner = () => {
  const [meta, setMeta] = useState<any>(null);

  useEffect(() => {
    if (!localStorage.getItem('grc_imp_token')) return;
    apiClient.get('/api/impersonation/current')
      .then((res) => { if (res.data?.impersonating) setMeta(res.data); else exit(); })
      .catch(() => exit());
  }, []);

  const exit = () => {
    localStorage.removeItem('grc_imp_token');
    localStorage.removeItem('grc_imp_meta');
    window.location.reload();
  };

  const endAndExit = async () => {
    try {
      const admin = localStorage.getItem('grc_jwt_token');
      await apiClient.post(`/api/impersonation/${meta.sessionId}/end`, { reason: 'Exited by operator' },
        { headers: { Authorization: `Bearer ${admin}` } });
    } catch { /* still exit locally */ }
    exit();
  };

  if (!meta) return null;

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 800,
      background: '#7f1d1d', color: '#fff', padding: '10px 18px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 14, flexWrap: 'wrap',
      fontFamily: "'JetBrains Mono','Fira Code',monospace", fontSize: 12,
    }}>
      <span>
        <strong>READ-ONLY IMPERSONATION</strong> — you are {meta.actorEmail}, viewing as{' '}
        <strong>{meta.subject?.email}</strong> at <strong>{meta.tenantName}</strong>.
        {meta.minutesRemaining !== null && ` Expires in ${meta.minutesRemaining} min.`} All writes are blocked.
      </span>
      <button onClick={endAndExit} style={{
        background: '#fff', color: '#7f1d1d', border: 'none', padding: '6px 14px',
        borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, whiteSpace: 'nowrap',
      }}>
        End session &amp; exit
      </button>
    </div>
  );
};

const NAV: Record<string, any[]> = {
  saas: [
    ['Platform Control', [['dashboard', '▦', 'SaaS Dashboard'], ['library', '≡', 'Document Library'], ['tenants', '▥', 'Manage Tenants'], ['impersonation', '♙', 'Impersonation Sessions']]],
    ['Users, Teams & Access', [['saas-users', '♟', 'SaaS Admin Users'], ['org-users', '♙', 'Organization Users'], ['branch-users', '⌘', 'Branch Users'], ['team-directory', '♣', 'Teams & Departments'], ['user-admin', '♙', 'User Lifecycle & Transfers'], ['role-matrix', '⊞', 'Roles & Permissions']]],
    ['Service Management', [['itsm', '?', 'ITSM Service Desk'], ['ticket-queues', '▥', 'Ticket Queues'], ['service-catalog', '▦', 'Service Catalog'], ['sla', '◷', 'SLA & Escalations'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish'], ['asm-tenants', '◫', 'Security Service Tenants']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Open Source Tool Marketplace'], ['tool-review', '✓', 'Tool Review & Approval'], ['tool-installations', '⇩', 'Tenant Tool Installations'], ['standard-repository', '§', 'Standard Repository'], ['tenant-standards', '◉', 'Tenant Standard Enablement'], ['feature-flags', '⚑', 'Feature Flags']]],
    ['Subscriptions & Billing', [['subscriptions', '¤', 'Subscriptions'], ['plans', '◇', 'Plans & Catalogue'], ['invoices', '▤', 'Invoices'], ['payments', '▣', 'Payments'], ['payment-gateway', '⛓', 'Payment Gateway & Tax']]],
    ['Usage & Automation', [['quotas', '◒', 'Resource Usage & Quotas'], ['automation', '⎇', 'Rules, Jobs & Execution'], ['imports', '⇩', 'Imports & Migration']]],
    ['System & Infrastructure', [['health', '▰', 'Health, Jobs & API Status'], ['security', '⊛', 'Platform Security'], ['architecture', '⬡', 'OCI Riyadh Architecture'], ['brd', '◷', 'BRD Traceability']]]
  ],
  holding: [
    ['Group Control Plane', [['dashboard', '▦', 'Group Dashboard'], ['hierarchy', '◫', 'Group Hierarchy'], ['subsidiaries', '▥', 'Subsidiary Scorecards'], ['shared-services', '⇄', 'Shared Services']]],
    ['Assurance', [['tasks', '✓', 'To Do & Approvals'], ['library', '≡', 'Document Library'], ['standards', '§', 'Group Standards'], ['controls', '⌘', 'Mandated Controls'], ['implementations', '⚙', 'Implementations & Evidence'], ['risk', '△', 'Group Risk'], ['audits', '◎', 'Group Audit Programme'], ['vendors', '◇', 'Group Vendor Master']]],
    ['People & Support', [['team-directory', '♣', 'Group Teams'], ['user-admin', '♙', 'Users & Entity Transfers'], ['role-matrix', '⊞', 'Roles & Permissions'], ['itsm', '?', 'ITSM Service Desk'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Open Source Tool Marketplace'], ['tool-installations', '⇩', 'Installed Tools'], ['standard-repository', '§', 'Standard Repository'], ['tenant-standards', '◉', 'Standard Enablement']]],
    ['Subscriptions & Billing', [['subscriptions', '¤', 'Subscriptions'], ['plans', '◇', 'Plans & Catalogue'], ['invoices', '▤', 'Invoices'], ['payments', '▣', 'Payments'], ['payment-gateway', '⛓', 'Payment Gateway & Tax']]]
  ],
  multibranch: [
    ['Organization Control', [['dashboard', '▦', 'Organization Dashboard'], ['branches', '▥', 'Branch Scorecards'], ['branch-lifecycle', '⇄', 'Branch Lifecycle']]],
    ['Assurance', [['tasks', '✓', 'To Do & Approvals'], ['library', '≡', 'Document Library'], ['standards', '§', 'Organization Standards'], ['controls', '⌘', 'Mandated Controls'], ['implementations', '⚙', 'Implementations & Evidence'], ['risk', '△', 'Consolidated Risk'], ['audits', '◎', 'Consolidated Audits'], ['vendors', '◇', 'Consolidated Vendors']]],
    ['People & Support', [['team-directory', '♣', 'Teams & Departments'], ['user-admin', '♙', 'Users & Branch Transfers'], ['role-matrix', '⊞', 'Roles & Permissions'], ['itsm', '?', 'ITSM Service Desk'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Open Source Tool Marketplace'], ['tool-installations', '⇩', 'Installed Tools'], ['standard-repository', '§', 'Standard Repository'], ['tenant-standards', '◉', 'Standard Enablement']]],
    ['Subscriptions & Billing', [['subscriptions', '¤', 'Subscriptions'], ['plans', '◇', 'Plans & Catalogue'], ['invoices', '▤', 'Invoices'], ['payments', '▣', 'Payments'], ['payment-gateway', '⛓', 'Payment Gateway & Tax']]]
  ],
  branch: [
    ['Branch Operations', [['dashboard', '▦', 'Branch Dashboard']]],
    ['Assurance', [['tasks', '✓', 'To Do & Approvals'], ['library', '≡', 'Document Library'], ['standards', '§', 'Local Standards'], ['controls', '⌘', 'Local Controls'], ['implementations', '⚙', 'Implementations & Evidence'], ['risk', '△', 'Local Risk'], ['audits', '◎', 'Local Audits'], ['vendors', '◇', 'Local Vendors']]],
    ['People & Support', [['team-directory', '♣', 'Local Teams'], ['user-admin', '♙', 'Local Users'], ['itsm', '?', 'ITSM Service Desk'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Approved Tool Marketplace'], ['tool-installations', '⇩', 'Branch Tool Entitlements']]],
    ['Subscriptions & Billing', [['invoices', '▤', 'Branch Invoices'], ['payments', '▣', 'Branch Payments'], ['payment-gateway', '⛓', 'Payment Gateway & Tax']]]
  ],
  document: [
    ['Document Lifecycle', [['dashboard', '▦', 'Document Dashboard'], ['library', '≡', 'Document Library'], ['tasks', '✓', 'To Do & Approvals'], ['acknowledgements', '☑', 'My Acknowledgements']]],
    ['Governance', [['retention', '◷', 'Retention Schedules'], ['legal-hold', '⊛', 'Legal Hold'], ['logs', '▤', 'Immutable Audit Log']]],
    ['People & Support', [['team-directory', '♣', 'Governance Teams'], ['itsm', '?', 'Document Service Desk'], ['knowledge', '◎', 'Knowledge Base']]]
  ],
  auditor: [
    ['Audit Engagement', [['dashboard', '▦', 'Engagement Dashboard'], ['library', '≡', 'Assurance Evidence']]],
    ['Verification', [['logs', '▤', 'Immutable Audit Log'], ['hash-check', '⊛', 'Cryptographic Verification'], ['exports', '⇩', 'Verified Exports']]],
    ['Support', [['itsm', '?', 'Auditor Support Desk'], ['contacts', '♣', 'Engagement Contacts']]]
  ],
  partner: [
    ['Partner Portfolio', [['dashboard', '▦', 'Portfolio Dashboard'], ['clients', '▥', 'Client Workspaces'], ['engagements', '◷', 'Engagement Tracking']]],
    ['IP & Content', [['library', '≡', 'Document Library'], ['partner-library', '≡', 'Partner Library'], ['standards', '§', 'Partner Standards']]],
    ['People & Support', [['team-directory', '♣', 'Partner Teams'], ['user-admin', '♙', 'Consultants & Access'], ['itsm', '?', 'Partner Service Desk'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Open Source Tool Marketplace'], ['tool-installations', '⇩', 'Client Tool Installations'], ['standard-repository', '§', 'Partner Standard Repository']]],
    ['Subscriptions & Billing', [['subscriptions', '¤', 'Client Subscriptions'], ['plans', '◇', 'Wholesale Rate Cards & Plans'], ['wholesale-billing', '▤', 'Wholesale Invoices'], ['payments', '▣', 'Payments & Receipts'], ['workspace-transfer', '⇄', 'Workspace Transfer']]]
  ],
  franchise: [
    ['Network Control Plane', [['dashboard', '▦', 'Network Dashboard'], ['hierarchy', '◫', 'Franchise Hierarchy'], ['locations', '▥', 'Location Scorecards'], ['exceptions', '⇄', 'Exception Workflows']]],
    ['Assurance', [['tasks', '✓', 'To Do & Approvals'], ['library', '≡', 'Document Library'], ['standards', '§', 'Mandatory Baseline'], ['controls', '⌘', 'Mandated Controls'], ['implementations', '⚙', 'Implementations & Evidence'], ['risk', '△', 'Network Risk'], ['audits', '◎', 'Network Audit Programme'], ['vendors', '◇', 'Network Vendors']]],
    ['People & Support', [['team-directory', '♣', 'Network Teams'], ['user-admin', '♙', 'Users & Location Transfers'], ['role-matrix', '⊞', 'Roles & Permissions'], ['itsm', '?', 'ITSM Service Desk'], ['knowledge', '◎', 'Knowledge Base']]],
    ['Security Services', [['wisdom-eye', '◉', 'Wisdom Eye ASM'], ['eye-phish', '↗', 'Eye Phish']]],
    ['Modules & Entitlements', [['marketplace', '▦', 'GRC Module Marketplace'], ['tool-marketplace', '⬢', 'Open Source Tool Marketplace'], ['tool-installations', '⇩', 'Location Tool Entitlements'], ['standard-repository', '§', 'Standard Repository'], ['tenant-standards', '◉', 'Location Standard Enablement']]],
    ['Subscriptions & Billing', [['subscriptions', '¤', 'Franchise Subscriptions'], ['plans', '◇', 'Plans & Catalogue'], ['invoices', '▤', 'Invoices'], ['payments', '▣', 'Payments'], ['payment-gateway', '⛓', 'Payment Gateway & Tax']]]
  ]
};

const AppShell = () => {
  const navigate = useNavigate();
  const [account, setAccount] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [apiData, setApiData] = useState<any>(null);
  const [isRtl, setIsRtl] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);

  // Restore the session established at login. The JWT and the user object are
  // written to localStorage by PortalLogin; there is no separate /api/data feed.
  useEffect(() => {
    const token = localStorage.getItem('grc_jwt_token');
    const storedUser = localStorage.getItem('grc_user_json');
    if (!token || !storedUser) {
      navigate('/');
      return;
    }

    let user: any;
    try {
      user = JSON.parse(storedUser);
    } catch {
      navigate('/');
      return;
    }
    if (!user?.id || !user?.portal) {
      navigate('/');
      return;
    }
    if (user.mustChangePassword) {
      navigate('/change-password');
      return;
    }

    setAccount({ ...user, color: user.color || '#2563eb' });
    setTokenReady(true);
  }, [navigate]);

  // Load supporting records for the mock dashboard views. These are optional —
  // renderMockView falls back to its own seed data when apiData is null.
  useEffect(() => {
    if (!tokenReady) return;
    Promise.all([
      apiClient.get('/api/auth/demo-identities').catch(() => null),
      apiClient.get('/api/tickets').catch(() => null),
      apiClient.get('/api/marketplace/tools').catch(() => null),
      apiClient.get('/api/asm/assets').catch(() => null),
      apiClient.get('/api/phish/campaigns').catch(() => null),
    ]).then(([users, tickets, tools, assets, campaigns]) => {
      setApiData({
        accounts: users?.data?.users || [],
        platformUsers: users?.data?.users || [],
        tickets: tickets?.data?.tickets || [],
        openTools: tools?.data?.tools || [],
        asmAssets: assets?.data?.assets || [],
        phishCampaigns: campaigns?.data?.campaigns || [],
      });
    });
  }, [tokenReady]);

  const toggleLanguage = () => {
    const newRtl = !isRtl;
    setIsRtl(newRtl);
    document.documentElement.dir = newRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = newRtl ? 'ar' : 'en';
  };

  if (!account) return null;

  const navGroups = NAV[account.portal] || [];

  const handleLogout = () => {
    localStorage.removeItem('authPersonaId');
    localStorage.removeItem('grc_jwt_token');
    localStorage.removeItem('grc_user_json');
    navigate('/');
  };

  // Render Real Document Components for DMS routes across ALL portals
  const renderRealComponent = () => {
    if (!tokenReady) {
      return <div style={{ padding: '24px', color: '#94a3b8' }}>Authenticating session...</div>;
    }

    // Tenant provisioning + hierarchy (SaaS control plane, holding, franchise)
    if (currentPage === 'tenants' || currentPage === 'hierarchy' || currentPage === 'branches' || currentPage === 'locations') {
      return <TenantManager key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'impersonation') {
      return <ImpersonationSessions key={`${account.id}-${currentPage}`} />;
    }
    // Users, Teams & Access
    if (currentPage === 'role-matrix') {
      return <RoleMatrix key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'saas-users') {
      return <UserDirectory key={`${account.id}-${currentPage}`} tier="saas" />;
    }
    if (currentPage === 'org-users') {
      return <UserDirectory key={`${account.id}-${currentPage}`} tier="org" />;
    }
    if (currentPage === 'branch-users') {
      return <UserDirectory key={`${account.id}-${currentPage}`} tier="branch" />;
    }
    if (currentPage === 'team-directory') {
      return <TeamDirectory key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'user-admin') {
      return <UserLifecycle key={`${account.id}-${currentPage}`} />;
    }
    // Service Management — present in every portal's nav.
    if (currentPage === 'itsm') {
      return <ServiceDesk key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'ticket-queues') {
      return <TicketQueues key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'service-catalog') {
      return <ServiceCatalog key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'sla') {
      return <SlaEscalations key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'knowledge') {
      return <KnowledgeBase key={`${account.id}-${currentPage}`} />;
    }
    // GRC Core — Holding, Multibranch, Branch, Franchise, Partner
    if (currentPage === 'standards' || currentPage === 'standard-repository' || currentPage === 'tenant-standards') {
      return <StandardsLibrary key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'controls') {
      return <ControlLibrary key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'implementations') {
      return <Implementations key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'risk') {
      return <RiskRegister key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'audits') {
      return <AuditProgramme key={`${account.id}-${currentPage}`} />;
    }

    // Modules & Entitlements — present across entitled portals
    if (currentPage === 'marketplace') {
      return <GrcModuleMarketplace key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'tool-marketplace') {
      return <OpenSourceToolMarketplace key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'tool-review') {
      return <ToolReviewApproval key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'tool-installations') {
      return <TenantToolInstallations key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'feature-flags') {
      return <FeatureFlagsManager key={`${account.id}-${currentPage}`} />;
    }

    // Subscriptions & Billing — real functional components across all portals
    if (currentPage === 'subscriptions') {
      return <SubscriptionManagement key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'plans') {
      return <PlansCatalogue key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'invoices' || currentPage === 'wholesale-billing' || currentPage === 'billing-center') {
      return <InvoiceManagement key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'payments') {
      return <PaymentsReconciliation key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'payment-gateway') {
      return <PaymentGatewayTax key={`${account.id}-${currentPage}`} />;
    }

    if (currentPage === 'library' || currentPage === 'partner-library' || currentPage === 'doc-library') {
      return <DocumentLibrary key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'tasks') {
      return <ApprovalQueue key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'acknowledgements') {
      return <AcknowledgementTracker key={`${account.id}-${currentPage}`} />;
    }
    if (currentPage === 'logs' || currentPage === 'hash-check' || currentPage === 'retention' || currentPage === 'legal-hold') {
      return <AuditLogViewer key={`${account.id}-${currentPage}`} />;
    }
    if (account.portal === 'document' && currentPage === 'dashboard') {
      return <DocumentDashboard key={`${account.id}-${currentPage}`} />;
    }
    return null;
  };

  const realComp = renderRealComponent();

  return (
    <div className="app-shell">
      <ImpersonationBanner />
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} id="sidebar">
        <div className="side-brand">
          <div className="brand">
            <div className="brand-mark">
              <span>GW</span>
            </div>
            <div>
              <span className="brand-text">GRC Wisdom</span>
            </div>
          </div>
        </div>
        <div className="side-context">
          <div className="context-label">Active workspace</div>
          <div className="context-name" id="contextName">
            {account.context}
          </div>
          <div className="context-scope" id="contextScope">
            {account.branch}
          </div>
          <span className="context-pill" id="contextRole">
            {account.role}
          </span>
        </div>
        <nav className="nav" id="nav">
          {navGroups.map((group, idx) => (
            <div className="nav-group" key={idx}>
              <div className="nav-group-title">{group[0]}</div>
              {group[1].map((item: any) => (
                <button
                  key={item[0]}
                  className={`nav-item ${currentPage === item[0] ? 'active' : ''}`}
                  onClick={() => setCurrentPage(item[0])}
                >
                  <span className="nav-ico">{item[1]}</span>
                  <span>{item[2]}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-footer">
          <button className="nav-item" id="helpBtn">
            <span className="nav-ico">?</span>
            <span>Help Center</span>
          </button>
          <button className="nav-item" id="switchBtn" onClick={() => navigate('/')}>
            <span className="nav-ico">⇄</span>
            <span>Switch login portal</span>
          </button>
        </div>
      </aside>

      <header className="topbar">
        <button
          className="menu-btn"
          id="menuBtn"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ☰
        </button>
        <div className="page-title" id="pageTitle">
          {currentPage.charAt(0).toUpperCase() + currentPage.slice(1).replace('-', ' ')}
        </div>
        <div className="top-search">
          <span>⌕</span>
          <input
            id="globalSearch"
            placeholder="Search records, documents, controls and users…"
          />
        </div>
        <div className="top-actions">
          <button className="icon-btn" id="langBtn" onClick={toggleLanguage} title="English / العربية">
            {isRtl ? 'AR' : 'EN'}
          </button>
          <button className="icon-btn" id="notifyBtn" title="Notifications">
            ♢<i className="notification-dot"></i>
          </button>
          <div className="persona">
            <div
              className="persona-avatar"
              id="personaAvatar"
              style={{ '--account-color': account.color } as any}
            >
              {account.name
                .split(' ')
                .map((x: string) => x[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div>
              <strong id="personaName">{account.name}</strong>
              <small id="personaRole">{account.role}</small>
            </div>
          </div>
          <button className="logout-btn" id="logoutBtn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>

      <main className="main">
        {realComp ? (
          realComp
        ) : (
          <div 
            className="content" 
            id="content"
            dangerouslySetInnerHTML={{ __html: renderMockView(currentPage, account, apiData) }}
          />
        )}
      </main>
    </div>
  );
};

export default AppShell;
