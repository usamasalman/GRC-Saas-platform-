import { Link } from 'react-router-dom';

const PortalDirectory = () => {
  return (
    <div className="login-directory">
      <div className="directory-shell">
        <div className="directory-head">
          <div>
            <div className="brand">
              <div className="brand-mark">
                <span>GW</span>
              </div>
              <div>
                <span className="brand-text">GRC Wisdom</span>
                <span className="brand-sub">
                  Multi-Layer SaaS, ITSM, Security Services, Marketplace,
                  Billing & GRC Mock
                </span>
              </div>
            </div>
            <h1>Choose a portal and test the complete GRC operating model.</h1>
            <p>
              This working prototype provides separate login experiences and
              role-aware dashboards for platform administration, holding groups,
              multi-branch organizations, branch operations, consulting partners,
              franchise networks, document owners, approvers, staff and external
              auditors.
            </p>
            <div className="tag-row">
              <span className="tag">35 demo identities</span>
              <span className="tag">8 login portals</span>
              <span className="tag">156 BRD requirements</span>
              <span className="tag">Document approval workflow</span>
              <span className="tag">ITSM Service Management</span>
              <span className="tag">Wisdom Eye + Eye Phish</span>
              <span className="tag">Open-source marketplace</span>
              <span className="tag">Billing & payments</span>
              <span className="tag">OCI Riyadh target architecture</span>
            </div>
          </div>
          <div className="directory-meta">
            <span>Prototype scope</span>
            <strong>360°</strong>
            <span>
              Role-based navigation, dashboards, DMS lifecycle, ITSM, teams,
              user transfers, security services, plug-and-play marketplace,
              billing, audit evidence and entity isolation visualization.
            </span>
          </div>
        </div>

        <div className="portal-grid">
          <Link className="portal-card" to="/login/saas">
            <div className="portal-icon">S</div>
            <h3>SaaS Administration Portal</h3>
            <p>Platform owner, security and billing administration.</p>
            <ul>
              <li>Tenants, users and impersonation</li>
              <li>Marketplace, standards and entitlements</li>
              <li>Plans, subscriptions, invoices and quotas</li>
              <li>Automation, security and service health</li>
              <li>ITSM, Wisdom Eye, Eye Phish and tool marketplace</li>
              <li>Invoice, payment gateway and reconciliation</li>
            </ul>
            <div className="portal-link">
              <span>Open SaaS login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/holding">
            <div className="portal-icon">H</div>
            <h3>Holding / Group Portal</h3>
            <p>Parent governance across subsidiaries, regions and shared services.</p>
            <ul>
              <li>Group control plane and entity tree</li>
              <li>Subsidiary scorecards and consolidated risk</li>
              <li>Shared controls, policies and evidence</li>
              <li>Regional administration and group reporting</li>
              <li>Group teams, user transfers and central ITSM</li>
              <li>Central Wisdom Eye and Eye Phish services</li>
            </ul>
            <div className="portal-link">
              <span>Open group login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/multibranch">
            <div className="portal-icon">M</div>
            <h3>Multi-Branch Organization Portal</h3>
            <p>Corporate oversight with controlled branch autonomy.</p>
            <ul>
              <li>Branch lifecycle and user governance</li>
              <li>Central or branch-specific standards</li>
              <li>Organization-wide GRC dashboards</li>
              <li>Consolidated documents and reports</li>
              <li>Teams, roles, branch transfers and ITSM</li>
              <li>Billing, marketplace and security services</li>
            </ul>
            <div className="portal-link">
              <span>Open organization login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/branch">
            <div className="portal-icon">B</div>
            <h3>Branch Operations Portal</h3>
            <p>Local GRC execution with enterprise visibility and restrictions.</p>
            <ul>
              <li>Local risks, controls and evidence</li>
              <li>Assets, vendors and audits</li>
              <li>Tasks, documents and acknowledgements</li>
              <li>No peer-branch access</li>
              <li>Branch support, team and user administration</li>
              <li>Local marketplace and security-service views</li>
            </ul>
            <div className="portal-link">
              <span>Open branch login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/document">
            <div className="portal-icon">D</div>
            <h3>Document Governance Portal</h3>
            <p>Document owner, compliance approver and staff acknowledgement personas.</p>
            <ul>
              <li>Manual authoring and batch import</li>
              <li>Check-out, check-in and version comparison</li>
              <li>Sequential approval and e-signature</li>
              <li>Retention, legal hold and immutable logs</li>
              <li>Document support desk and governance teams</li>
            </ul>
            <div className="portal-link">
              <span>Open document login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/auditor">
            <div className="portal-icon">A</div>
            <h3>External Auditor Portal</h3>
            <p>Temporary, read-only assurance room with complete traceability.</p>
            <ul>
              <li>Selected evidence and documents</li>
              <li>Signature and hash verification</li>
              <li>Immutable activity logs</li>
              <li>Time-limited audit exports</li>
              <li>Auditor support and engagement contacts</li>
            </ul>
            <div className="portal-link">
              <span>Open auditor login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/partner">
            <div className="portal-icon">P</div>
            <h3>Consulting Partner / MSP Portal</h3>
            <p>Isolated client workspaces and portfolio delivery management.</p>
            <ul>
              <li>Client portfolio and engagement tracking</li>
              <li>Private content libraries</li>
              <li>Consultant capacity and workload</li>
              <li>Wholesale billing and workspace transfer</li>
              <li>Pre-sales, post-sales, ITSM and security services</li>
              <li>Open-source tool offers and client installations</li>
            </ul>
            <div className="portal-link">
              <span>Open partner login</span>
              <span>→</span>
            </div>
          </Link>

          <Link className="portal-card" to="/login/franchise">
            <div className="portal-icon">F</div>
            <h3>Franchise Governance Portal</h3>
            <p>Franchisor oversight with franchisee data separation.</p>
            <ul>
              <li>Mandatory control catalogue</li>
              <li>Location scorecards and rankings</li>
              <li>Local exceptions and remediation</li>
              <li>Mixed billing and policy distribution</li>
              <li>Network teams, service desk and user transfers</li>
              <li>Wisdom Eye, Eye Phish and tool entitlements</li>
            </ul>
            <div className="portal-link">
              <span>Open franchise login</span>
              <span>→</span>
            </div>
          </Link>
        </div>

        <div className="footer-strip">
          <span>
            <strong>Demo password:</strong> <span className="mono">Demo@2026</span> for all
            listed identities.
          </span>
          <span>
            Self-contained offline prototype · No real authentication or customer
            data.
          </span>
          <button
            className="btn red"
            onClick={(e) => {
              localStorage.clear();
              (e.target as HTMLButtonElement).textContent = 'Demo data reset';
            }}
          >
            Reset Prototype Data
          </button>
        </div>
      </div>
    </div>
  );
};

export default PortalDirectory;
