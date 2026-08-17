export interface GuideStep {
  step: number;
  title: string;
  instruction: string;
  tip?: string;
}

export interface TabGuideItem {
  id: string;
  title: string;
  category: string;
  icon: string;
  badge: string;
  summary: string;
  roles: string[];
  capabilities: string[];
  keyActions: string[];
  howToUse: GuideStep[];
  proTips: string[];
  relatedTabs: { id: string; title: string }[];
}

export interface PlatformWorkflow {
  id: string;
  title: string;
  category: string;
  icon: string;
  summary: string;
  estimatedTime: string;
  targetRoles: string[];
  prerequisites: string[];
  steps: {
    phase: string;
    tabId: string;
    tabTitle: string;
    action: string;
    details: string;
  }[];
}

export const USER_GUIDE_DATA: Record<string, TabGuideItem> = {
  dashboard: {
    id: 'dashboard',
    title: 'Realtime Executive Dashboard',
    category: 'Assurance & Governance',
    icon: 'dashboard',
    badge: 'Executive Oversight',
    summary: 'Centralized posture cockpit aggregating real-time risk scores, compliance coverage, open issues, audit progress, and system health across the active tenant hierarchy.',
    roles: ['SaaS Admin', 'Group Admin', 'Organization Admin', 'Branch Admin', 'Auditor'],
    capabilities: ['VIEW_DASHBOARD', 'EXPORT_POSTURE', 'DRILLDOWN_METRICS'],
    keyActions: [
      'Filter posture by subsidiary or branch scope in the tenant selector',
      'Click on any risk or audit metric card to drill down into the underlying records',
      'Monitor real-time SLA breach warnings and open corrective action plans (CAPs)',
      'Export executive posture summaries for board and committee packs'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Select Tenant & Hierarchy Scope',
        instruction: 'Use the tenant switcher at the top to toggle between Group-wide consolidated view, Organization scope, or specific Branch level.',
        tip: 'Holding and Franchise views aggregate child entity data in real-time.'
      },
      {
        step: 2,
        title: 'Review Core Assurance KPIs',
        instruction: 'Inspect the top KPI cards: Inherent vs Residual Risk, Effective Controls Percentage, Open Findings, and Audit Milestones.',
        tip: 'Scores above 15 in the Residual Heatmap indicate high risk requiring immediate treatment.'
      },
      {
        step: 3,
        title: 'Track Live Security & ITSM Feeds',
        instruction: 'Review active Wisdom Eye ASM exposures, Eye Phish training failure rates, and open P1/P2 service desk tickets.',
        tip: 'Click on any incident ID to navigate directly to ticket triage.'
      }
    ],
    proTips: [
      'Residual score is dynamically calculated from verified control effectiveness, never manually typed.',
      'Check the "Action Required" section daily for pending document sign-offs and overdue risk reviews.'
    ],
    relatedTabs: [
      { id: 'risk', title: 'Risk Register' },
      { id: 'audits', title: 'Audit Programme' },
      { id: 'implementations', title: 'Implementations & Evidence' }
    ]
  },

  library: {
    id: 'library',
    title: 'Document Library (DMS)',
    category: 'Document Lifecycle & Governance',
    icon: 'documents',
    badge: 'Cryptographic DMS',
    summary: 'Enterprise document lifecycle repository featuring version control, SHA-256 integrity hashing, checkout/checkin concurrency locks, and mandatory approval workflows.',
    roles: ['Document Owner', 'Compliance Manager', 'Approver', 'All Staff'],
    capabilities: ['DOC_CREATE', 'DOC_CHECKOUT', 'DOC_APPROVE', 'DOC_READ'],
    keyActions: [
      'Upload and draft new policies, standards, procedures, and reports',
      'Check out documents to lock editing and prevent version conflicts',
      'Submit controlled drafts for multi-stage management approval',
      'Verify SHA-256 cryptographic hashes against the immutable ledger'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Create or Upload Document',
        instruction: 'Click "+ New Document", assign a controlled reference code (e.g. POL-SEC-001), category, department, and classification level.',
        tip: 'Use standard classification: Public, Internal, Confidential, or Restricted.'
      },
      {
        step: 2,
        title: 'Edit & Lock via Checkout',
        instruction: 'Click "Check Out" on any draft document to take exclusive editing rights. Update content and click "Check In" with a version summary.',
        tip: 'Version numbers auto-increment (e.g. 1.0 -> 1.1 for minor, 2.0 for major).'
      },
      {
        step: 3,
        title: 'Submit for Sign-Off',
        instruction: 'Click "Submit for Approval" to route the document to the designated Compliance Approver.',
        tip: 'Once approved, the document is sealed with a cryptographic SHA-256 hash in the audit log.'
      }
    ],
    proTips: [
      'Always include framework mappings (e.g. ISO 27001, NCA ECC) in the document metadata to streamline audit evidence.',
      'Published documents can be assigned for mandatory employee acknowledgement in one click.'
    ],
    relatedTabs: [
      { id: 'tasks', title: 'To Do & Approvals' },
      { id: 'acknowledgements', title: 'My Acknowledgements' },
      { id: 'logs', title: 'Immutable Audit Log' }
    ]
  },

  tasks: {
    id: 'tasks',
    title: 'To Do & Approvals Queue',
    category: 'Document Lifecycle & Governance',
    icon: 'approvals',
    badge: 'Segregation of Duties',
    summary: 'Governance inbox for designated approvers to review pending documents, risk acceptance requests, audit plans, and tool requests with enforced Segregation of Duties (SOD).',
    roles: ['Compliance Approver', 'Group Approver', 'Executive Sponsor'],
    capabilities: ['APPROVE_DOCUMENTS', 'APPROVE_RISK_ACCEPTANCE', 'APPROVE_AUDIT_PLAN'],
    keyActions: [
      'Inspect version diffs and document summaries before approval',
      'Approve with electronic signature and recorded IP/session hash',
      'Reject back to draft with mandatory remediation feedback',
      'Review pending Risk Acceptance and Appetite exception proposals'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Filter Pending Approvals',
        instruction: 'Review the approval queue filtered by priority, submission date, or document type.',
        tip: 'Items are sorted chronologically with SLA due dates.'
      },
      {
        step: 2,
        title: 'Perform Content & Diff Inspection',
        instruction: 'Click "Review" on any item to view side-by-side content changes, compliance clause coverage, and author notes.',
        tip: 'SOD engine prevents authors from approving their own submissions.'
      },
      {
        step: 3,
        title: 'Record Formal Decision',
        instruction: 'Click "Approve Document" to publish and seal with cryptographic timestamp, or "Reject" with specific rejection notes.',
        tip: 'Approved documents immediately update their status across the platform.'
      }
    ],
    proTips: [
      'Every approval action records actor ID, timestamp, client IP, and hash in the tamper-evident audit ledger.',
      'For high-impact risk acceptance, verify that the residual score is within approved board tolerance.'
    ],
    relatedTabs: [
      { id: 'library', title: 'Document Library' },
      { id: 'risk', title: 'Risk Register' },
      { id: 'logs', title: 'Immutable Audit Log' }
    ]
  },

  acknowledgements: {
    id: 'acknowledgements',
    title: 'My Acknowledgements & Staff Compliance',
    category: 'Document Lifecycle & Governance',
    icon: '☑',
    badge: 'Compliance Tracking',
    summary: 'Employee compliance tracker for reading, acknowledging, and certifying adherence to mandatory organizational policies and code of conduct.',
    roles: ['All Staff', 'Branch User', 'Contractor', 'HR Manager'],
    capabilities: ['ACKNOWLEDGE_POLICY', 'TRACK_COMPLIANCE_RATE'],
    keyActions: [
      'Read newly published policies and revisions assigned to your role/department',
      'Sign digital acknowledgement with full legal timestamp and user signature',
      'Track individual and departmental compliance completion rates',
      'Export compliance certificates for regulatory inspections'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Pending Reading List',
        instruction: 'Review the list of assigned policies highlighted with pending status and target completion dates.',
        tip: 'Mandatory items display an amber urgency badge.'
      },
      {
        step: 2,
        title: 'Read the Controlled Policy',
        instruction: 'Click on the document to open the full reader view and review all governance clauses.',
        tip: 'Ensure you understand employee responsibilities before signing.'
      },
      {
        step: 3,
        title: 'Submit Digital Acknowledgement',
        instruction: 'Type your full legal name in the signature field and click "Acknowledge & Sign".',
        tip: 'The signed record is sealed into the audit log and cannot be altered.'
      }
    ],
    proTips: [
      'Managers can view team-wide completion percentages in the Team Directory.',
      'Automated reminders are sent 7 days before compliance acknowledgement deadlines.'
    ],
    relatedTabs: [
      { id: 'library', title: 'Document Library' },
      { id: 'team-directory', title: 'Teams & Departments' }
    ]
  },

  tenants: {
    id: 'tenants',
    title: 'Manage Tenants & Organization Hierarchy',
    category: 'Multi-Tenant Governance',
    icon: 'building',
    badge: 'TRD §3 Hierarchical Tree',
    summary: 'Multi-entity governance plane supporting Materialized Path trees for Holding Groups, Subsidiaries, Regional Branches, Franchise Networks, and Partner Workspaces.',
    roles: ['Platform Super Admin', 'Group Admin', 'Franchisor Admin'],
    capabilities: ['MANAGE_TENANT', 'PROVISION_SUBSIDIARY', 'SET_HIERARCHY'],
    keyActions: [
      'Provision new organizations, subsidiaries, branches, and partner tenants',
      'Configure hierarchical path relationships (e.g. /GROUP/ORG/BRANCH/)',
      'Set tenant status, quota limits, and regional sovereign data residency',
      'Inspect consolidated risk and compliance rollup across child nodes'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Explore the Hierarchy Tree',
        instruction: 'View the interactive organizational tree showing parent-child node structures and tier classifications.',
        tip: 'Materialized path ensures O(1) ancestor and descendant lookup.'
      },
      {
        step: 2,
        title: 'Provision a New Node',
        instruction: 'Click "+ Add Tenant / Branch", select parent tenant, define entity name, type (Holding, Subsidiary, Branch), and primary admin.',
        tip: 'Child entities inherit mandated group baseline standards automatically.'
      },
      {
        step: 3,
        title: 'Configure Entitlements & Storage',
        instruction: 'Assign subscription tier, feature flag overrides, and storage quotas.',
        tip: 'Changes take effect immediately without requiring service restarts.'
      }
    ],
    proTips: [
      'Cross-tenant data reads are strictly controlled by the Scope Resolver engine with mandatory audit logging.',
      'Deleting a parent node requires either deleting or reassigning all active child entities first.'
    ],
    relatedTabs: [
      { id: 'impersonation', title: 'Impersonation Sessions' },
      { id: 'quotas', title: 'Resource Usage & Quotas' },
      { id: 'subscriptions', title: 'Subscriptions' }
    ]
  },

  impersonation: {
    id: 'impersonation',
    title: 'Operator Impersonation Sessions',
    category: 'Security & Access Control',
    icon: 'user',
    badge: 'TRD §3.5 Read-Only Sandbox',
    summary: 'Secure, time-bound operator impersonation system allowing platform administrators to troubleshoot customer issues in a strictly read-only, audited mode.',
    roles: ['Platform Super Admin'],
    capabilities: ['IMPERSONATE_USER', 'AUDIT_IMPERSONATION'],
    keyActions: [
      'Start time-bound read-only session (max 60 minutes) for any tenant user',
      'Provide mandatory business justification and support ticket reference',
      'Inspect customer perspective without modifying any production data',
      'End session manually or automatically on expiry with full audit trace'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Initiate Session',
        instruction: 'Select target tenant and user email. Enter ticket number (e.g. INC-2026-0142) and detailed reason.',
        tip: 'Impersonation is strictly blocked for password changes and financial transactions.'
      },
      {
        step: 2,
        title: 'Work in Read-Only Mode',
        instruction: 'The top red Impersonation Banner confirms active read-only status and remaining time. All write API requests are rejected with 403.',
        tip: 'You can navigate all screens that the target user has permissions to see.'
      },
      {
        step: 3,
        title: 'Terminate Session',
        instruction: 'Click "End session & exit" on the persistent red banner to immediately return to your operator profile.',
        tip: 'The session end timestamp and all viewed endpoints are archived in the audit log.'
      }
    ],
    proTips: [
      'The API server enforces read-only guards at the middleware layer (`rejectIfImpersonatingWrite`).',
      'Customers can audit when and why platform operators impersonated their accounts.'
    ],
    relatedTabs: [
      { id: 'tenants', title: 'Manage Tenants' },
      { id: 'logs', title: 'Immutable Audit Log' },
      { id: 'itsm', title: 'ITSM Service Desk' }
    ]
  },

  'role-matrix': {
    id: 'role-matrix',
    title: 'Roles & RBAC Capability Matrix',
    category: 'Access & Identity Management',
    icon: 'roles',
    badge: 'Capability-Based RBAC',
    summary: 'Granular Role-Based Access Control matrix governing platform capabilities, custom role definitions, and automated Segregation of Duties (SOD) violation detection.',
    roles: ['Platform Super Admin', 'Group Admin', 'Org Admin'],
    capabilities: ['MAINTAIN_ROLES', 'ASSIGN_CAPABILITIES', 'AUDIT_SOD'],
    keyActions: [
      'View granular capability mappings across all platform user roles',
      'Audit Segregation of Duties (SOD) conflicts (e.g. Author + Approver)',
      'Assign capabilities to custom enterprise roles',
      'Inspect effective permissions for any user in the tenant'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Capability Matrix',
        instruction: 'Browse the grid showing roles on the Y-axis and granular capabilities (CAP.ASSESS_RISK, CAP.APPROVE_PLAN, etc.) on the X-axis.',
        tip: 'Hover over any cell to see exact API routes protected by that capability.'
      },
      {
        step: 2,
        title: 'Audit SOD Violations',
        instruction: 'Click "Run SOD Conflict Scan" to check if any user holds conflicting toxic combinations (e.g., creating and paying invoices).',
        tip: 'Any detected violations display remediation recommendations.'
      },
      {
        step: 3,
        title: 'Adjust Role Assignments',
        instruction: 'Update role capabilities or assign auxiliary roles with explicit scoping.',
        tip: 'Changes propagate to user sessions on their next token refresh.'
      }
    ],
    proTips: [
      'The backend evaluates `requireCapability()` and `requireAnyCapability()` at every route handler.',
      'Never grant both `ENABLE_STANDARD` and `AUDIT_ENGAGEMENT` to the same operational user.'
    ],
    relatedTabs: [
      { id: 'saas-users', title: 'User Directory' },
      { id: 'user-admin', title: 'User Lifecycle' }
    ]
  },

  'saas-users': {
    id: 'saas-users',
    title: 'User Directory & Access Control',
    category: 'Access & Identity Management',
    icon: 'users',
    badge: 'Identity Management',
    summary: 'Comprehensive user administration directory for provisioning accounts, managing MFA enforcement, assigning tenant roles, and monitoring active sessions.',
    roles: ['Platform Super Admin', 'Org Admin', 'Branch Admin'],
    capabilities: ['MANAGE_USERS', 'RESET_CREDENTIALS', 'ENFORCE_MFA'],
    keyActions: [
      'Invite and provision new users with role and department assignment',
      'Enforce Multi-Factor Authentication (MFA) and password expiration policies',
      'Deactivate or suspend compromised accounts immediately',
      'Trigger administrative password resets with approval workflows'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Provision New User',
        instruction: 'Click "+ Add User", enter full name, work email, tenant/branch assignment, and primary role.',
        tip: 'The user receives an invitation with a temporary one-time password.'
      },
      {
        step: 2,
        title: 'Manage User Status',
        instruction: 'Filter users by Active, Suspended, or Pending Password Change. Click "Edit" to modify role or branch scope.',
        tip: 'Suspending a user invalidates all existing JWT tokens within 60 seconds.'
      },
      {
        step: 3,
        title: 'Trigger Security Actions',
        instruction: 'Use the action menu to reset MFA tokens, revoke active sessions, or unlock locked accounts.',
        tip: 'All administrative security actions generate immutable audit logs.'
      }
    ],
    proTips: [
      'Users with `mustChangePassword=true` are restricted until they set a compliant 12+ character password.',
      'Always assign users to the lowest necessary branch scope in the hierarchy.'
    ],
    relatedTabs: [
      { id: 'team-directory', title: 'Teams & Departments' },
      { id: 'role-matrix', title: 'Roles & Permissions' },
      { id: 'user-admin', title: 'User Lifecycle & Transfers' }
    ]
  },

  'team-directory': {
    id: 'team-directory',
    title: 'Teams & Departmental Structure',
    category: 'Access & Identity Management',
    icon: 'teams',
    badge: 'Org Chart',
    summary: 'Organizational department and team roster management linking employees, designated team leads, reporting hierarchies, and control ownership.',
    roles: ['Org Admin', 'HR Manager', 'Compliance Lead'],
    capabilities: ['MANAGE_TEAMS', 'ASSIGN_LEADS'],
    keyActions: [
      'Create and structure organizational departments (IT, Finance, Legal, etc.)',
      'Designate team leads and escalation managers for ITSM routing',
      'Map teams to specific control domains and risk categories',
      'Track headcount and departmental compliance completion'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Create Department / Team',
        instruction: 'Click "+ New Team", specify team name, department head, email distribution alias, and branch location.',
        tip: 'Teams can be linked directly to ITSM ticket queues for auto-assignment.'
      },
      {
        step: 2,
        title: 'Assign Team Members',
        instruction: 'Select team and click "Add Member". Choose users from the directory with their specific team designation.',
        tip: 'A user can belong to multiple cross-functional governance teams.'
      }
    ],
    proTips: [
      'Assigning a team as a Control Owner ensures evidence collection reminders are distributed to all members.',
      'Department heads receive automated weekly reports of pending team approvals.'
    ],
    relatedTabs: [
      { id: 'saas-users', title: 'User Directory' },
      { id: 'ticket-queues', title: 'Ticket Queues' }
    ]
  },

  'user-admin': {
    id: 'user-admin',
    title: 'User Lifecycle & Entity Transfers',
    category: 'Access & Identity Management',
    icon: 'lifecycle',
    badge: 'Cross-Entity Transfers',
    summary: 'Lifecycle transition management handling employee onboarding, entity branch transfers, leave of absence, and secure offboarding workflows.',
    roles: ['Group Admin', 'Org Admin', 'HR Manager'],
    capabilities: ['TRANSFER_USER', 'OFFBOARD_USER'],
    keyActions: [
      'Initiate seamless entity transfers (e.g. moving a user from Branch A to Branch B)',
      'Reassign orphaned risk ownership, control implementations, and audit workpapers',
      'Execute automated offboarding checklists and credential revokation',
      'Maintain historical audit trace of user tenure across subsidiaries'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Initiate Transfer',
        instruction: 'Click "Transfer User", choose employee, select destination branch/tenant, and specify effective date.',
        tip: 'The wizard detects all active risks, controls, and tasks assigned to the user.'
      },
      {
        step: 2,
        title: 'Reassign Owned Assets',
        instruction: 'Select replacement owners for all open risk items, evidence tasks, and document ownerships.',
        tip: 'No risk or control is left without an accountable owner.'
      },
      {
        step: 3,
        title: 'Confirm & Apply',
        instruction: 'Review the transition summary and submit. User access tokens are refreshed with new tenant context.',
        tip: 'The transfer is documented with historical audit logging.'
      }
    ],
    proTips: [
      'Offboarding immediately invalidates all active sessions and reassigns unresolved approval tasks.',
      'Historical audit logs preserve the user identity at the time of each original event.'
    ],
    relatedTabs: [
      { id: 'saas-users', title: 'User Directory' },
      { id: 'tenants', title: 'Manage Tenants' }
    ]
  },

  itsm: {
    id: 'itsm',
    title: 'ITSM Service Desk & Incident Management',
    category: 'Service Management (ITSM)',
    icon: 'servicedesk',
    badge: 'Workflow-Engine Backed',
    summary: 'Full-featured IT Service Management desk for logging incidents, service requests, security events, and compliance queries with SLA tracking and comments thread.',
    roles: ['All Users', 'Service Desk Agent', 'Support Manager'],
    capabilities: ['CREATE_TICKET', 'UPDATE_TICKET', 'ASSIGN_TICKET'],
    keyActions: [
      'Raise tickets with category classification, priority (P1-P4), and attachments',
      'Triage, assign, and re-route tickets to specialized support teams',
      'Collaborate via internal notes and customer-facing response threads',
      'Track SLA resolution timers with automated breach warnings'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Raise a Service Ticket',
        instruction: 'Click "+ New Ticket", select service category (Access, GRC, Security, Bug), choose priority level, and describe issue.',
        tip: 'P1 Critical incidents immediately trigger on-call notification alerts.'
      },
      {
        step: 2,
        title: 'Triage & Assign',
        instruction: 'Agents select tickets from the queue, assign to themselves or their team, and transition status to "In Progress".',
        tip: 'Status transitions (New -> In Progress -> Pending Customer -> Resolved -> Closed) are tracked in real-time.'
      },
      {
        step: 3,
        title: 'Resolve & Close',
        instruction: 'Add resolution summary notes and click "Mark Resolved". Requester can confirm resolution or reopen within 5 days.',
        tip: 'Closing a ticket records first-contact resolution metrics.'
      }
    ],
    proTips: [
      'P1 tickets have a strict 1-hour SLA response target.',
      'Link recurring incidents to Problem records or Risk items to eliminate root causes.'
    ],
    relatedTabs: [
      { id: 'ticket-queues', title: 'Ticket Queues' },
      { id: 'service-catalog', title: 'Service Catalog' },
      { id: 'sla', title: 'SLA & Escalations' }
    ]
  },

  'ticket-queues': {
    id: 'ticket-queues',
    title: 'ITSM Ticket Queues & Workload Distribution',
    category: 'Service Management (ITSM)',
    icon: 'scorecard',
    badge: 'Queue Management',
    summary: 'Queue triage management for routing tickets across support teams, monitoring unassigned backlogs, and balancing agent caseloads.',
    roles: ['Support Manager', 'Queue Coordinator', 'Service Desk Agent'],
    capabilities: ['MANAGE_QUEUES', 'DISPATCH_TICKETS'],
    keyActions: [
      'Inspect unassigned backlog and assign tickets by skill and workload',
      'Filter queues by priority (P1/P2/P3/P4), department, and SLA status',
      'Bulk update tickets for common widespread outage notifications',
      'Monitor agent response metrics and queue velocity'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Select Active Queue',
        instruction: 'Choose queue (e.g. Identity Engineering, Application Support, Security Ops) from the left sidebar.',
        tip: 'Badges show count of tickets nearing SLA breach.'
      },
      {
        step: 2,
        title: 'Dispatch & Prioritize',
        instruction: 'Select unassigned tickets and click "Assign Agent" or update priority based on business impact.',
        tip: 'Use bulk actions to reassign multiple tickets during shift handovers.'
      }
    ],
    proTips: [
      'Unassigned P1/P2 tickets alert the queue manager after 15 minutes of inactivity.',
      'Keep the "Unassigned" queue under 5 items at all times.'
    ],
    relatedTabs: [
      { id: 'itsm', title: 'Service Desk' },
      { id: 'sla', title: 'SLA & Escalations' }
    ]
  },

  'service-catalog': {
    id: 'service-catalog',
    title: 'Service Catalog & Request Templates',
    category: 'Service Management (ITSM)',
    icon: 'marketplace',
    badge: 'Self-Service Portal',
    summary: 'Self-service request catalogue offering standardized templates for access requests, framework imports, hardware provisioning, and security scans.',
    roles: ['All Users', 'Service Catalog Manager'],
    capabilities: ['REQUEST_SERVICE', 'MANAGE_CATALOG'],
    keyActions: [
      'Browse categorized service request offerings with transparent SLAs',
      'Submit structured request forms with automated approval routing',
      'Create and update catalog templates with predefined fields',
      'Link catalog items to automated execution workflows'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Browse Catalog Items',
        instruction: 'Explore categories (Identity & Access, GRC Services, Infrastructure, Security Services).',
        tip: 'Each item displays expected delivery time (e.g., 2 business days).'
      },
      {
        step: 2,
        title: 'Submit Standardized Request',
        instruction: 'Click "Request Service", fill out specific form fields (e.g., target framework, justification), and submit.',
        tip: 'Requests with required approvals automatically route to your manager.'
      }
    ],
    proTips: [
      'Standard requests bypass level-1 triage and go directly to specialized fulfillment teams.',
      'Use catalog templates to eliminate back-and-forth clarification emails.'
    ],
    relatedTabs: [
      { id: 'itsm', title: 'Service Desk' },
      { id: 'knowledge', title: 'Knowledge Base' }
    ]
  },

  sla: {
    id: 'sla',
    title: 'SLA Tracking & Automated Escalations',
    category: 'Service Management (ITSM)',
    icon: 'clock',
    badge: 'Automated SLA Engine',
    summary: 'SLA monitoring and escalation engine running automated 5-minute background scans to trigger tier escalations, manager alerts, and breach logs.',
    roles: ['Support Manager', 'Platform Super Admin'],
    capabilities: ['MANAGE_SLA', 'CONFIGURE_ESCALATIONS'],
    keyActions: [
      'Configure SLA resolution targets per priority (P1: 1h, P2: 8h, P3: 3d, P4: 5d)',
      'Define automated escalation rules (Tier 1 -> Tier 2 -> Executive Alert)',
      'Monitor real-time breach countdown timers across all open tickets',
      'Inspect historical SLA compliance and breach reports'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Review Active SLA Status',
        instruction: 'View the SLA dashboard showing tickets categorized as: Within SLA, Approaching Breach (<2h), or Breached.',
        tip: 'Breached tickets are highlighted in bold red with elapsed duration.'
      },
      {
        step: 2,
        title: 'Configure Escalation Rules',
        instruction: 'Define trigger threshold (e.g. 75% elapsed) and automated action (reassign to Senior Engineer + email notification).',
        tip: 'Escalation scanner executes automatically in the background.'
      }
    ],
    proTips: [
      'Paused tickets (e.g. "Pending Customer") stop the SLA countdown clock.',
      'SLA performance metrics are included in executive monthly service reports.'
    ],
    relatedTabs: [
      { id: 'itsm', title: 'Service Desk' },
      { id: 'ticket-queues', title: 'Ticket Queues' }
    ]
  },

  knowledge: {
    id: 'knowledge',
    title: 'Knowledge Base & SOP Library',
    category: 'Service Management (ITSM)',
    icon: 'knowledge',
    badge: 'Self-Service KM',
    summary: 'Searchable knowledge repository containing standard operating procedures (SOPs), troubleshooting guides, policy FAQs, and resolution runbooks.',
    roles: ['All Users', 'Knowledge Author', 'Support Lead'],
    capabilities: ['READ_KB', 'AUTHOR_KB'],
    keyActions: [
      'Search articles by keyword, category, or associated compliance standard',
      'Publish verified solutions directly from resolved ITSM tickets',
      'Rate article helpfulness to surface high-value troubleshooting guides',
      'Maintain bilingual (English / Arabic) governance FAQs'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Search Solutions',
        instruction: 'Type your query into the knowledge search bar (e.g. "SAML configuration", "Evidence upload").',
        tip: 'Fuzzy search matches article titles, tags, and content.'
      },
      {
        step: 2,
        title: 'Author Knowledge Article',
        instruction: 'Click "+ New Article", define title, category, target audience, and step-by-step instructions.',
        tip: 'Include code blocks, screenshots, and related policy links.'
      }
    ],
    proTips: [
      'Linking knowledge articles to service desk tickets reduces average resolution time by over 40%.',
      'Review articles quarterly to ensure instructions match the latest platform version.'
    ],
    relatedTabs: [
      { id: 'itsm', title: 'Service Desk' },
      { id: 'service-catalog', title: 'Service Catalog' }
    ]
  },

  standards: {
    id: 'standards',
    title: 'Standards Library & Regulatory Enablement',
    category: 'Assurance & GRC Core',
    icon: 'standards',
    badge: 'Multi-Standard Catalogue',
    summary: 'Regulatory frameworks library containing pre-loaded standards (ISO 27001:2022, NIST CSF 2.0, PCI-DSS v4.0, NCA ECC-1:2018, Saudi PDPL) with clause breakdown and tenant enablement.',
    roles: ['Compliance Manager', 'CISO', 'Internal Auditor'],
    capabilities: ['ENABLE_STANDARD', 'VIEW_CLAUSES'],
    keyActions: [
      'Enable regulatory standards for the active tenant with 1 click',
      'Inspect domain and clause hierarchies (e.g. A.5 Organizational Controls)',
      'Track clause-to-control implementation coverage percentages',
      'Compare standard requirements across overlapping frameworks'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Browse Pre-Loaded Standards',
        instruction: 'Review the list of global and regional standards with clause counts and published versions.',
        tip: 'Standards include Saudi NCA ECC, SAMA CSF, ISO 27001, and NIST.'
      },
      {
        step: 2,
        title: 'Enable for Active Tenant',
        instruction: 'Click "Enable Standard" to activate the framework. All clauses become available for control mapping.',
        tip: 'Enabling a standard populates the compliance gap analysis dashboard.'
      },
      {
        step: 3,
        title: 'Inspect Clause Requirements',
        instruction: 'Click on any standard to expand domains, sub-domains, and specific mandatory clause text.',
        tip: 'Green checkmarks indicate clauses with verified control coverage.'
      }
    ],
    proTips: [
      'Enabling multiple frameworks allows single controls to satisfy multiple standards simultaneously.',
      'Export the Framework Coverage Report from the Reports tab for auditor submissions.'
    ],
    relatedTabs: [
      { id: 'framework-authoring', title: 'Framework Authoring' },
      { id: 'controls', title: 'Control Library' },
      { id: 'implementations', title: 'Implementations & Evidence' }
    ]
  },

  'framework-authoring': {
    id: 'framework-authoring',
    title: 'Custom Framework Authoring & File Import',
    category: 'Assurance & GRC Core',
    icon: 'authoring',
    badge: 'TRD §7.1 Framework Engine',
    summary: 'Author proprietary organizational standards, customize clause hierarchies, and import external frameworks from Excel/CSV/JSON files with staging review.',
    roles: ['Compliance Architect', 'Consultant', 'Group Admin'],
    capabilities: ['ENABLE_STANDARD', 'MANAGE_IMPLEMENTATION'],
    keyActions: [
      'Create custom organizational policies and frameworks with custom codes',
      'Add multi-level clause hierarchies (Domain -> Sub-clause -> Requirement)',
      'Upload and stage external framework files with AI extraction review',
      'Map organizational controls to standard clauses with validation checks'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Create Custom Framework',
        instruction: 'Click "+ Create Standard", enter code (e.g. CORP-SEC-2026), full title, version, and authority.',
        tip: 'You can choose whether child subsidiaries inherit this framework.'
      },
      {
        step: 2,
        title: 'Define Clauses',
        instruction: 'Click "+ Add Clauses", enter clause numbers, titles, and exact compliance requirement narratives.',
        tip: 'You can batch paste clauses or import via structured JSON/CSV.'
      },
      {
        step: 3,
        title: 'Map Controls to Clauses',
        instruction: 'Select clause and click "Map Control". Choose existing controls from the library or create new ones.',
        tip: 'Mapping is what makes the framework auditable during audit engagements.'
      }
    ],
    proTips: [
      'File imports stage candidates in review mode before committing to the live library to prevent dirty data.',
      'Maintain standard versioning when regulatory bodies release amendments.'
    ],
    relatedTabs: [
      { id: 'standards', title: 'Standards Library' },
      { id: 'controls', title: 'Control Library' },
      { id: 'imports', title: 'Imports & Migration' }
    ]
  },

  controls: {
    id: 'controls',
    title: 'Control Library & Mandated Baselines',
    category: 'Assurance & GRC Core',
    icon: 'controls',
    badge: 'ISO 27002 / NIST Controls',
    summary: 'Central repository of organizational and technical controls specifying control objectives, testing guidance, baseline frequencies, and adaptation cloning.',
    roles: ['Compliance Lead', 'Control Owner', 'Security Architect'],
    capabilities: ['ENABLE_STANDARD', 'MANAGE_IMPLEMENTATION'],
    keyActions: [
      'Browse unified control catalogue with unique codes (e.g. SEC-01, IAM-04)',
      'Clone and adapt library controls for local subsidiary requirements',
      'Define control parameters: Type (Preventive/Detective), Frequency, and Automation',
      'Inspect cross-standard mappings for each control'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Explore Library Controls',
        instruction: 'Search controls by keyword, domain (Access Control, Cryptography, Operations), or standard.',
        tip: 'Each control shows its implementation status across branches.'
      },
      {
        step: 2,
        title: 'Create / Clone Control',
        instruction: 'Click "+ Create Control" or click "Clone & Adapt" on an existing template to tailor for your environment.',
        tip: 'Specify implementation guidelines and expected evidence artifacts.'
      },
      {
        step: 3,
        title: 'Assign Control Owner',
        instruction: 'Designate responsible user or team accountable for maintaining operational effectiveness.',
        tip: 'Control owners receive periodic evidence collection tasks.'
      }
    ],
    proTips: [
      'Preventive controls reduce inherent likelihood; Detective controls accelerate incident discovery and reduce impact.',
      'Linking controls to Risks automatically drives the residual risk scoring calculation.'
    ],
    relatedTabs: [
      { id: 'implementations', title: 'Implementations & Evidence' },
      { id: 'risk', title: 'Risk Register' },
      { id: 'standards', title: 'Standards Library' }
    ]
  },

  implementations: {
    id: 'implementations',
    title: 'Control Implementations & Evidence Management',
    category: 'Assurance & GRC Core',
    icon: 'implementations',
    badge: 'Continuous Control Monitoring',
    summary: 'Operational control management tracking live implementation status, evidence artifact uploads, effectiveness testing, and validator review workflows.',
    roles: ['Control Owner', 'Compliance Validator', 'Auditor'],
    capabilities: ['MANAGE_IMPLEMENTATION', 'VALIDATE_CONTROL'],
    keyActions: [
      'Track implementation state: Not Started, In Progress, Implemented, Verified',
      'Upload and attach evidence documents (screenshots, configs, export logs)',
      'Record effectiveness rating: Effective, Partially Effective, Ineffective',
      'Validate implementations with independent second-line sign-off'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Select Implementation Record',
        instruction: 'Filter implementations by status, control domain, or effectiveness rating.',
        tip: 'Implementations needing evidence display an amber indicator.'
      },
      {
        step: 2,
        title: 'Upload Fresh Evidence',
        instruction: 'Click "+ Add Evidence", upload document or link system log, specify valid period, and add notes.',
        tip: 'Evidence items are timestamped and tied to the control verification cycle.'
      },
      {
        step: 3,
        title: 'Validate & Rate Effectiveness',
        instruction: 'A validator reviews the evidence and rates effectiveness (Effective, Partially Effective, Ineffective).',
        tip: 'Only Verified & Effective controls provide full residual risk score reduction.'
      }
    ],
    proTips: [
      'When control effectiveness drops to "Ineffective", all linked risks in the Risk Register automatically rescore upwards in real-time!',
      'Set evidence validity expiration dates to receive re-testing reminders automatically.'
    ],
    relatedTabs: [
      { id: 'controls', title: 'Control Library' },
      { id: 'risk', title: 'Risk Register' },
      { id: 'audits', title: 'Audit Programme' }
    ]
  },

  assets: {
    id: 'assets',
    title: 'Asset Register (ISO 27001 A.5.9 / ISO 27005)',
    category: 'Assurance & GRC Core',
    icon: 'assets',
    badge: 'Inventory & Valuation',
    summary: 'Everything the organisation depends on and therefore has to protect: physical and non-physical, held internally or by a supplier. Criticality is derived from the Confidentiality, Integrity and Availability ratings an owner sets, and risk impact is then derived from criticality - so an impact score can always be traced back to an asset somebody valued rather than to a number that felt about right.',
    roles: ['Asset Owner', 'Risk Manager', 'Compliance Manager', 'Organization GRC Manager', 'Control Owner'],
    capabilities: ['MAINTAIN_ASSET', 'MANAGE_IMPLEMENTATION', 'ASSESS_RISK'],
    keyActions: [
      'Register physical, information, software, service, personnel and intangible assets',
      'Record whether an asset is held internally, by a third party, or shared with a supplier',
      'Value each asset on Confidentiality, Integrity and Availability (1-5); criticality derives as the maximum',
      'Raise a risk directly from an asset by naming the threat and the vulnerability it would exploit',
      'Link the controls that actually protect each asset and see its protection posture',
      'Record replacement value and exposure factor to obtain Single and Annualised Loss Expectancy',
      'Place an asset in the audit universe so an engagement covering that area picks up its risks'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Register the asset',
        instruction: 'Click "Register asset". Give it a name, choose the type (Information, Software, Physical, Service, Personnel or Intangible) and say whether the organisation holds it, a third party does, or it is shared. A third-party or shared asset must name the supplier - the platform refuses to save one without.',
        tip: 'Tangibility is derived from the type, so a server is physical while the data on it is not. You never set it separately and the two can never disagree.'
      },
      {
        step: 2,
        title: 'Value it on C, I and A',
        instruction: 'Rate 1-5 what the loss of each dimension would cost: unauthorised disclosure (Confidentiality), unauthorised change (Integrity), and loss of access (Availability). The form shows the resulting criticality and which dimension drove it before you save.',
        tip: 'Criticality is the maximum of the three, not the average. A banking licence rated 2/5/3 is Critical because integrity alone is catastrophic - averaging would have given 3.3 and buried exactly the case that matters.'
      },
      {
        step: 3,
        title: 'Raise the risks the asset carries',
        instruction: 'Click "raise risk" on any asset row. Name the threat (what could act against it) and the vulnerability (the weakness it would exploit), then rate each 1-5. The platform derives impact from the asset criticality and likelihood from the threat and vulnerability, and shows you the arithmetic before you commit.',
        tip: 'You can override either axis. Both the suggestion and what you actually recorded go into the audit trail, so a reviewer can see where judgement was applied.'
      },
      {
        step: 4,
        title: 'Link the protecting controls',
        instruction: 'Click "controls" to attach the control implementations that defend this asset. The posture column then reads Protected, Partial, Unproven, Failing or Unprotected.',
        tip: 'Only an independently verified control counts as effective. An asset showing Unproven has controls linked that nobody has validated - which is a finding waiting to be written.'
      },
      {
        step: 5,
        title: 'Quantify where the numbers exist',
        instruction: 'Add a replacement value on the asset and an exposure factor on the risk link. The register then computes Single Loss Expectancy and Annualised Loss Expectancy.',
        tip: 'Leave them blank and the register stays purely qualitative. A monetary figure invented from a 1-5 score would be false precision, so the platform only computes one where you supplied real inputs.'
      },
      {
        step: 6,
        title: 'Keep the inventory current',
        instruction: 'Each asset carries a review cadence and a next-review date. Use "review" to confirm you have looked at it without changing the ratings.',
        tip: 'ISO 27001 A.5.9 expects the inventory to be maintained, not created once. Overdue assets are flagged in the list and counted on the header.'
      }
    ],
    proTips: [
      'The "Criticality vs protection" tab plots every asset on criticality against how well it is defended. The top-left corner is the register\'s worst quarter: assets whose loss would hurt most, with nothing verified protecting them.',
      '"Exposed, unprotected" on the header counts assets carrying open risk with no control linked at all. It is the single most actionable number on the screen.',
      'The "How the numbers are derived" tab publishes every formula the platform uses with the standard it comes from. When an assessor asks how a score was reached, the product answers rather than a consultant.',
      'Placing an asset in the audit universe means an engagement covering that entity automatically sees the risks the asset carries - the inventory and the audit plan stop drifting apart.'
    ],
    relatedTabs: [
      { id: 'risk', title: 'Enterprise Risk Register' },
      { id: 'implementations', title: 'Implementations & Evidence' },
      { id: 'vendors', title: 'Vendor Master' },
      { id: 'audits', title: 'Audit Programme' }
    ]
  },

  risk: {
    id: 'risk',
    title: 'Enterprise Risk Register (ISO 31000)',
    category: 'Assurance & GRC Core',
    icon: 'risk',
    badge: 'ISO 31000 Dynamic Scoring',
    summary: 'ISO 31000 compliant risk register supporting Threats and Opportunities, dynamic residual scoring computed from verified controls, treatment plans, board appetite tolerance ceilings, and causal network graphs.',
    roles: ['Risk Manager', 'CRO', 'Risk Owner', 'Executive Approver'],
    capabilities: ['ASSESS_RISK', 'ACCEPT_RISK', 'SET_APPETITE'],
    keyActions: [
      'Log risks with mandatory duplicate search (TRD §7.2) and causal narrative',
      'Compute residual score automatically from linked control effectiveness',
      'Create and track time-bound risk treatment action plans',
      'Execute formal time-bound risk acceptance subject to board appetite ceilings',
      'Map risk causal networks (Causes, Amplifies, SharesControl)'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Create Risk (Duplicate Checked)',
        instruction: 'Click "+ Add Risk", enter title, category (Operational, Financial, Cyber, etc.), direction (Threat/Opportunity), and Inherent Likelihood x Impact (1-5).',
        tip: 'Duplicate check algorithm warns if similar risks already exist to prevent register bloat.'
      },
      {
        step: 2,
        title: 'Link Mitigating Controls',
        instruction: 'Click "Link Controls" on the risk card and select implemented controls.',
        tip: 'Residual score recomputes automatically: Effective verified controls reduce residual score downwards.'
      },
      {
        step: 3,
        title: 'Assign Treatment Actions',
        instruction: 'Click "+ Add Treatment Action", assign owner and due date. Status transitions to "Under Treatment".',
        tip: 'Treatments differ by direction: Threats are Mitigated/Avoided; Opportunities are Exploited/Enhanced.'
      },
      {
        step: 4,
        title: 'Acceptance & Review Cadence',
        instruction: 'Accepting a risk requires time-bound expiry date and cannot exceed the approved Board Appetite tolerance.',
        tip: 'Risk owners cannot accept their own risk (SOD enforced).'
      }
    ],
    proTips: [
      'Measurement criteria and board appetite both live on the Risk Appetite tab, and both are versioned. Revising either drafts a new version while the current one keeps binding, so there is never a window with no ceiling — and the superseded version is retained as the basis for every decision taken while it applied.',
      'Use "What was in force on a given date?" to answer the question an assessor actually asks: an acceptance taken last March was judged against the tolerance that applied then, not against today’s. Every acceptance also stores the exact appetite version and score it was judged at.',
      'Approving new criteria re-bands the whole register, so the platform tells you how many risks change rating before you commit and records that in the audit trail. It is a governance event, not a settings change.',
      'Risks with score > Board Tolerance cannot be accepted and MUST be treated down. That gate reads the live residual score, which now recomputes whenever a control\'s effectiveness changes - so a stale number can no longer defeat it.',
      'Residual risk follows the control environment in both directions. Downgrade a control to Ineffective, self-assess it as failing in an RCSA, or record an Unsatisfactory audit test against it, and every risk relying on that control is re-rated in the same transaction.',
      'Use the 5x5 heatmap and the Matrices & Network tab to spot risks sharing common single points of failure. The network score weights a risk by how many others it touches, so concentration surfaces even when the individual score does not stand out.',
      'Every risk carries a review cadence and a next-review date. A background scanner reopens acceptances that have lapsed and surfaces risks past their review date, so the register cannot go stale in silence.',
      'Risks raised from the Asset Register arrive with impact already derived from the asset\'s criticality, which makes two risks on the same asset consistent with each other by construction.'
    ],
    relatedTabs: [
      { id: 'assets', title: 'Asset Register' },
      { id: 'controls', title: 'Control Library' },
      { id: 'implementations', title: 'Implementations & Evidence' },
      { id: 'audits', title: 'Audit Programme' }
    ]
  },

  audits: {
    id: 'audits',
    title: 'Audit Programme & Engagements (TRD §7.3)',
    category: 'Assurance & GRC Core',
    icon: 'audit',
    badge: 'Annual Plan & Fieldwork',
    summary: 'The internal audit workspace, laid out in the order the work happens: Universe & Plan, Engagements, RCM & Testing, Workpapers, and Issues & CAP. An engagement is instantiated from an approved plan item so it stays traceable to the board-approved plan; a special engagement outside the plan is possible but must carry a written reason and is badged as unplanned wherever it appears.',
    roles: ['Chief Audit Executive (CAE)', 'Lead Auditor', 'Auditee'],
    capabilities: ['AUDIT_ENGAGEMENT', 'APPROVE_PLAN', 'RAISE_FINDING'],
    keyActions: [
      'Score the Auditable Universe entities to prioritize high-exposure processes',
      'Assemble, submit, and formally approve the Annual Audit Plan',
      'Instantiate fieldwork engagements with Risk & Control Matrices (RCM)',
      'Execute test procedures, attach workpapers, and record review notes',
      'Raise audit findings and transition them to tracked corrective issues'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Plan & Prioritize Engagements',
        instruction: 'In the Audit Planning tab, score auditable universe entities and add high-risk items to the Annual Plan. Submit for Board approval.',
        tip: 'Approved plans lock scope and allow engagement instantiation.'
      },
      {
        step: 2,
        title: 'Execute Fieldwork & Workpapers',
        instruction: 'Open the engagement RCM, execute testing procedures for each control, upload workpaper evidence, and record Pass/Fail results.',
        tip: 'Reviewers can add review notes that must be cleared before closing.'
      },
      {
        step: 3,
        title: 'Raise Findings & Export Reports',
        instruction: 'Failures automatically prompt for finding details (Condition, Criteria, Cause, Consequence, Recommendation). Click "Export Audit Report" for the board pack.',
        tip: 'Findings link directly to the Issue Register for post-audit corrective action tracking.'
      }
    ],
    proTips: [
      'Export the full Risk & Control Matrix (RCM) as an Excel, Word or PDF document in one click.',
      'Auditors operate in an isolated scope with independent workpaper verification.',
      'An engagement can only reach Reporting once every workpaper is reviewed and signed off, and once an overall conclusion is recorded. IIA Standard 15.1 treats a list of findings without a judgement as not being a report.',
      'Recording an Unsatisfactory test result now re-rates the control and every register risk relying on it, in the same transaction. Audit\'s verdict outranks management\'s self-assessment, which is what the third line is for.',
      'Closing an engagement stamps coverage on the auditable entity, clearing its overdue uplift and completing the plan item. Nobody has to remember to edit the universe by hand.',
      'Prior finding density in the annual risk assessment is derived from the findings actually on record, weighted by severity and whether they are still open - not typed in from memory.',
      'Segregation of duties runs through the whole flow: the preparer cannot review their own workpaper, the auditor cannot write management\'s response, and closing an issue needs someone who is neither the raiser, the responder, nor the corrective-action owner.'
    ],
    relatedTabs: [
      { id: 'risk', title: 'Risk Register' },
      { id: 'assets', title: 'Asset Register' },
      { id: 'controls', title: 'Control Library' },
      { id: 'library', title: 'Document Library' }
    ]
  },

  marketplace: {
    id: 'marketplace',
    title: 'GRC Module Marketplace',
    category: 'Modules & Entitlements',
    icon: 'marketplace',
    badge: 'Modular Add-Ons',
    summary: 'Enterprise module marketplace enabling organizations to activate specialized GRC extensions including Vendor Risk Management, BCM, ESG, and Compliance AI.',
    roles: ['Platform Super Admin', 'Tenant Owner', 'Commercial Lead'],
    capabilities: ['MANAGE_MODULES', 'PURCHASE_MODULE'],
    keyActions: [
      'Explore available add-on modules with pricing and feature specifications',
      'Activate module trials or purchase licenses for specific tenant tiers',
      'Manage active module subscriptions and seat allocations',
      'Configure module integration endpoints and automated sync'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Browse Module Offerings',
        instruction: 'Inspect module cards (e.g. Third-Party Vendor Master, ESG Compliance, Automated Threat Feeds).',
        tip: 'Each module lists prerequisites and compatibility.'
      },
      {
        step: 2,
        title: 'Activate for Tenant',
        instruction: 'Click "Enable Module", review subscription terms, and confirm activation.',
        tip: 'The new navigation tabs appear immediately for entitled users.'
      }
    ],
    proTips: [
      'Module activations respect tenant hierarchy: parent holdings can bundle modules for all subsidiaries.',
      'Deactivating a module safely archives data without deleting historical records.'
    ],
    relatedTabs: [
      { id: 'tool-marketplace', title: 'Open Source Tools' },
      { id: 'subscriptions', title: 'Subscriptions' }
    ]
  },

  'tool-marketplace': {
    id: 'tool-marketplace',
    title: 'Open Source Security Tool Marketplace',
    category: 'Modules & Entitlements',
    icon: 'tools',
    badge: 'Curated Open Source',
    summary: 'Curated open-source security tool catalogue (Wazuh, OWASP ZAP, DefectDojo, Keycloak, Trivy, Dependency-Track) evaluated for enterprise compliance and security.',
    roles: ['Security Architect', 'Platform Curator', 'Tenant Admin'],
    capabilities: ['BROWSE_TOOLS', 'REQUEST_TOOL_INSTALLATION'],
    keyActions: [
      'Browse security-evaluated open source tools across SIEM, SAST, DAST, and SBOM',
      'Review license compatibility (Apache-2.0, MIT, BSD, GPL)',
      'Submit deployment installation requests for customer tenants',
      'Monitor tool vulnerability status and upstream release tracks'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Select Tool',
        instruction: 'Filter tools by category (SIEM/XDR, AppSec, Vulnerability Management, Cloud-Native).',
        tip: 'Check the review badge (e.g., "Security Review Passed").'
      },
      {
        step: 2,
        title: 'Request Installation',
        instruction: 'Click "Install / Connect", choose tenant branch, select deployment mode, and submit.',
        tip: 'Requests route to the Tool Review & Approval queue.'
      }
    ],
    proTips: [
      'Installed tools feed telemetry and scan findings directly into the Wisdom Eye ASM dashboard.',
      'GPL/AGPL tools are strictly isolated to avoid proprietary code contamination.'
    ],
    relatedTabs: [
      { id: 'tool-review', title: 'Tool Review & Approval' },
      { id: 'tool-installations', title: 'Tenant Tool Installations' },
      { id: 'wisdom-eye', title: 'Wisdom Eye ASM' }
    ]
  },

  'tool-review': {
    id: 'tool-review',
    title: 'Tool Review & Security Approval',
    category: 'Modules & Entitlements',
    icon: 'check',
    badge: 'AppSec Evaluation',
    summary: 'Platform security sandbox review portal where security analysts assess requested open-source tools for licensing, architectural safety, and container isolation.',
    roles: ['Platform Security Admin', 'Marketplace Curator'],
    capabilities: ['REVIEW_TOOLS', 'APPROVE_TOOL_DEPLOYMENT'],
    keyActions: [
      'Audit container images, SBOMs, and license risks of requested tools',
      'Approve tools for catalogue listing or reject with security feedback',
      'Set deployment parameters: Managed connector vs isolated worker',
      'Maintain annual re-certification records for approved packages'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Pending Review',
        instruction: 'Open tool evaluation card and review CVE scan reports, license terms, and tenant requester.',
        tip: 'High-risk licenses (e.g. AGPL in embedded contexts) require legal clearance.'
      },
      {
        step: 2,
        title: 'Record Approval Decision',
        instruction: 'Assign maturity status (Approved, Pilot, Rejected) and sign off with security review timestamp.',
        tip: 'Approved tools become installable across customer tenants.'
      }
    ],
    proTips: [
      'Approved tools must support TLS 1.3 encryption and API token rotation.',
      'Tools in "Pilot" status are restricted to non-production customer sandboxes.'
    ],
    relatedTabs: [
      { id: 'tool-marketplace', title: 'Tool Marketplace' },
      { id: 'tool-installations', title: 'Tenant Tool Installations' }
    ]
  },

  'tool-installations': {
    id: 'tool-installations',
    title: 'Tenant Tool Installations & Connectors',
    category: 'Modules & Entitlements',
    icon: 'install',
    badge: 'Active Deployments',
    summary: 'Tenant deployment manager showing active security tool integrations, health telemetry, scheduled scan connectors, and sync logs.',
    roles: ['Tenant Admin', 'Security Operations', 'Platform Super Admin'],
    capabilities: ['MANAGE_INSTALLATIONS', 'TRIGGER_SCANS'],
    keyActions: [
      'Monitor health status of active tool integrations (e.g. Wazuh SIEM, DefectDojo)',
      'Trigger manual vulnerability scans or telemetry sync',
      'Configure API credentials and Webhook ingestion endpoints',
      'Uninstall or rotate credentials for inactive connectors'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Check Deployment Health',
        instruction: 'Review active connector status: Connected (Green), Syncing (Blue), or Error (Red).',
        tip: 'Click "Test Connection" to verify API reachability.'
      },
      {
        step: 2,
        title: 'Configure Scan Schedules',
        instruction: 'Set automated sync frequencies (Hourly, Daily, Weekly) and select target subnets.',
        tip: 'Scan outputs automatically generate findings in Wisdom Eye.'
      }
    ],
    proTips: [
      'API keys for third-party tools are stored using AES-256 vault encryption.',
      'Failed scan alerts trigger automatic P2 incidents in the ITSM Service Desk.'
    ],
    relatedTabs: [
      { id: 'tool-marketplace', title: 'Tool Marketplace' },
      { id: 'wisdom-eye', title: 'Wisdom Eye ASM' }
    ]
  },

  'feature-flags': {
    id: 'feature-flags',
    title: 'Feature Flags & Capability Toggles',
    category: 'Platform & Infrastructure',
    icon: 'flag',
    badge: 'Canary Deployment',
    summary: 'Centralized feature toggle management allowing platform administrators to control progressive rollouts, beta features, and tenant-specific capability overrides.',
    roles: ['Platform Super Admin', 'Product Lead'],
    capabilities: ['MANAGE_FLAGS', 'OVERRIDE_TENANT_FLAGS'],
    keyActions: [
      'Toggle global features on/off instantly without redeploying code',
      'Configure percentage rollouts and canary testing groups',
      'Set specific tenant overrides for pilot programs',
      'Audit all toggle modifications with actor attribution'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Active Flags',
        instruction: 'Browse the list of platform feature flags with their current global status and rollout percentage.',
        tip: 'Flags include AI_FRAMEWORK_ASSIST, REALTIME_HEATMAP_V2, and NEW_BILLING_PORTAL.'
      },
      {
        step: 2,
        title: 'Toggle or Override',
        instruction: 'Switch toggle or click "Tenant Overrides" to enable specifically for a beta customer tenant.',
        tip: 'Overrides take effect instantly via WebSocket/SSE stream.'
      }
    ],
    proTips: [
      'Always retire feature flags once a feature reaches 100% stable general availability.',
      'Emergency kill-switches can disable heavy export jobs during database spikes.'
    ],
    relatedTabs: [
      { id: 'health', title: 'System Health' },
      { id: 'tenants', title: 'Manage Tenants' }
    ]
  },

  subscriptions: {
    id: 'subscriptions',
    title: 'Tenant Subscription Management',
    category: 'Billing & Subscriptions',
    icon: 'subscriptions',
    badge: 'Tier Entitlements',
    summary: 'Commercial subscription management governing tenant edition tiers (Enterprise Intelligence, Assurance, Professional, Partner), billing cycles, and seat quotas.',
    roles: ['Platform Billing Admin', 'Tenant Owner', 'CFO'],
    capabilities: ['MANAGE_SUBSCRIPTIONS', 'UPGRADE_TIER'],
    keyActions: [
      'Review current subscription tier, renewal dates, and contracted user seats',
      'Upgrade or downgrade plan editions with automatic prorated billing',
      'Add capacity add-on packs (Additional Branches, Advanced DMS, 24/7 Support)',
      'Download master service agreements and subscription certificates'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Review Active Plan',
        instruction: 'Check your current plan details, contracted user count, and days remaining until annual renewal.',
        tip: 'Usage bars indicate consumed vs allocated storage and seats.'
      },
      {
        step: 2,
        title: 'Upgrade Plan / Add Seats',
        instruction: 'Click "Change Plan" or "Add Seat Pack", choose desired capacity, and submit order.',
        tip: 'Invoices generate automatically with VAT breakdown.'
      }
    ],
    proTips: [
      'Subscribers receive automatic renewal notifications 60 and 30 days prior to expiry.',
      'Partner portals receive wholesale multi-workspace discount rates.'
    ],
    relatedTabs: [
      { id: 'plans', title: 'Plans & Catalogue' },
      { id: 'invoices', title: 'Invoices' },
      { id: 'payments', title: 'Payments' }
    ]
  },

  plans: {
    id: 'plans',
    title: 'Commercial Plans & Feature Catalogue',
    category: 'Billing & Subscriptions',
    icon: 'plans',
    badge: 'Pricing & Tiers',
    summary: 'Product catalog configuring pricing tiers, currency rates (SAR, USD, EUR), user seat limits, storage allocations, and module inclusions.',
    roles: ['Platform Billing Admin', 'Commercial Director'],
    capabilities: ['CONFIGURE_PLANS', 'UPDATE_PRICING'],
    keyActions: [
      'Create and maintain standard and custom enterprise pricing tiers',
      'Define quota limits: User accounts, branch count, storage, and API calls',
      'Configure multi-currency rate cards (SAR, USD, AED, EUR)',
      'Publish special seasonal or wholesale partner rate packages'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Explore Plan Grid',
        instruction: 'Compare feature matrices across Starter, Professional, Enterprise Assurance, and Holding Group tiers.',
        tip: 'Hover over features to see exact capability entitlements.'
      },
      {
        step: 2,
        title: 'Edit Plan Configuration',
        instruction: 'Click "Edit Plan", update annual/monthly price, storage gigabytes, and bundled modules.',
        tip: 'Existing active subscribers retain their grandfathered contracted pricing.'
      }
    ],
    proTips: [
      'Holding edition plans include unlimited subsidiary provisioning by default.',
      'All Saudi Arabian prices default to SAR with explicit 15% Zakat/VAT line items.'
    ],
    relatedTabs: [
      { id: 'subscriptions', title: 'Subscriptions' },
      { id: 'invoices', title: 'Invoices' }
    ]
  },

  invoices: {
    id: 'invoices',
    title: 'Invoice Management & ZATCA Compliance',
    category: 'Billing & Subscriptions',
    icon: 'invoices',
    badge: 'VAT & Zakat Compliant',
    summary: 'Tax invoicing center managing bill generation, payment tracking, overdue aging, PDF downloads, and Saudi ZATCA Phase-2 QR code electronic tax compliance.',
    roles: ['Billing Admin', 'Finance Manager', 'Tenant Admin'],
    capabilities: ['VIEW_INVOICES', 'PAY_INVOICE', 'EXPORT_INVOICE_PDF'],
    keyActions: [
      'View issued tax invoices with PO numbers, line items, and 15% VAT calculation',
      'Download official PDF invoices with embedded cryptographic QR codes',
      'Track payment status: Paid, Pending, Overdue, or Refunded',
      'Record manual wire transfer references or initiate online gateway checkout'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Filter Invoices',
        instruction: 'Filter by tenant name, status (Paid/Pending/Overdue), or fiscal quarter.',
        tip: 'Overdue invoices display days past due.'
      },
      {
        step: 2,
        title: 'View & Download PDF',
        instruction: 'Click on invoice reference (e.g. INV-2026-0081) to view full breakdown and click "Download Tax Invoice PDF".',
        tip: 'Contains compliant ZATCA Phase-2 QR code and tax registration numbers.'
      },
      {
        step: 3,
        title: 'Settle Payment',
        instruction: 'Click "Pay Now" to complete via payment gateway or upload bank transfer receipt for verification.',
        tip: 'Receipts automatically mark the invoice as Paid upon admin confirmation.'
      }
    ],
    proTips: [
      'Invoices generate automatically on annual subscription anniversary dates.',
      'Finance teams can export quarterly CSV ledger sheets for ERP accounting ingestion.'
    ],
    relatedTabs: [
      { id: 'payments', title: 'Payments' },
      { id: 'payment-gateway', title: 'Payment Gateway & Tax' },
      { id: 'subscriptions', title: 'Subscriptions' }
    ]
  },

  payments: {
    id: 'payments',
    title: 'Payments & Financial Reconciliation',
    category: 'Billing & Subscriptions',
    icon: 'payments',
    badge: 'Reconciliation Ledger',
    summary: 'Payment reconciliation hub matching credit card transactions, Mada/Moyasar gateway charges, and wire transfers against open invoice balances.',
    roles: ['Billing Admin', 'Finance Accountant'],
    capabilities: ['RECONCILE_PAYMENTS', 'ISSUE_REFUNDS'],
    keyActions: [
      'Inspect real-time payment transactions and gateway settlement batches',
      'Reconcile bank wire transfer references against customer invoice IDs',
      'Issue partial or full customer refunds with audit justifications',
      'Export accounting general ledger payment reports'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Review Transaction Feed',
        instruction: 'Browse incoming payments showing transaction ID, amount, method (Mada, Visa, Wire), and timestamp.',
        tip: 'Green status indicates successful bank settlement.'
      },
      {
        step: 2,
        title: 'Match Unreconciled Wires',
        instruction: 'Click "Match Wire", select matching customer invoice, and click "Confirm Reconciliation".',
        tip: 'Invoice updates immediately to "Paid".'
      }
    ],
    proTips: [
      'Mada and credit card transactions settle automatically via webhook callbacks in real-time.',
      'Reconciliation reports can be scheduled for automatic monthly CFO dispatch.'
    ],
    relatedTabs: [
      { id: 'invoices', title: 'Invoices' },
      { id: 'payment-gateway', title: 'Payment Gateway & Tax' }
    ]
  },

  'payment-gateway': {
    id: 'payment-gateway',
    title: 'Payment Gateway & Regional Tax Configuration',
    category: 'Billing & Subscriptions',
    icon: 'gateway',
    badge: 'Moyasar / Stripe / VAT',
    summary: 'Payment processor and regional tax configuration managing gateway credentials (Moyasar, Mada, Apple Pay, Stripe), webhook endpoints, and Zakat/VAT tax rules.',
    roles: ['Platform Super Admin', 'Platform Billing Admin'],
    capabilities: ['CONFIGURE_GATEWAY', 'SET_TAX_RATES'],
    keyActions: [
      'Configure payment provider API keys for sandbox and production environments',
      'Enable regional payment methods: Mada, Apple Pay, STC Pay, Credit Card',
      'Set VAT/Tax percentage rules (Default 15% for Saudi Arabia)',
      'Inspect webhook delivery logs and retry failed notifications'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Configure Provider Keys',
        instruction: 'Enter Publishable Key, Secret Key, and Webhook Secret for Moyasar or Stripe.',
        tip: 'Always test keys in Sandbox mode first before switching to Live.'
      },
      {
        step: 2,
        title: 'Set Tax & Currency Defaults',
        instruction: 'Set standard VAT percentage (15%) and company Tax Identification Number (TIN).',
        tip: 'TIN appears on all customer tax invoices.'
      }
    ],
    proTips: [
      'Webhook signatures are validated using HMAC-SHA256 to prevent payment tampering.',
      'Gateway credentials are encrypted at rest with AES-256 keys.'
    ],
    relatedTabs: [
      { id: 'invoices', title: 'Invoices' },
      { id: 'payments', title: 'Payments' }
    ]
  },

  quotas: {
    id: 'quotas',
    title: 'Resource Usage, Storage & Quotas',
    category: 'Platform & Infrastructure',
    icon: '◒',
    badge: 'Resource Metering',
    summary: 'Real-time usage metering dashboard tracking tenant disk storage, API request rates, active user seats, and background compute against contractual quota limits.',
    roles: ['Platform Super Admin', 'Tenant Admin'],
    capabilities: ['MONITOR_USAGE', 'ADJUST_QUOTAS'],
    keyActions: [
      'Monitor live storage consumption (DMS attachments, evidence files, DB records)',
      'Track API rate limits (requests per minute) and identify burst spikes',
      'Set soft warning thresholds (80%) and hard enforcement limits (100%)',
      'Request temporary quota increases during audit evidence upload periods'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Quota Meters',
        instruction: 'View visual meters for Storage, API Calls, Active Seats, and Background Jobs.',
        tip: 'Meters change color: Green (<70%), Amber (70-90%), Red (>90%).'
      },
      {
        step: 2,
        title: 'Audit Heavy Consumers',
        instruction: 'Click "Top Storage Consumers" to see which departments or document folders consume the most space.',
        tip: 'Archive or compress older historical audit attachments to reclaim quota.'
      }
    ],
    proTips: [
      'Automated email alerts notify administrators when storage reaches 85% of tier limit.',
      'Hard limits reject file uploads gracefully with a 429/413 quota exceeded message.'
    ],
    relatedTabs: [
      { id: 'tenants', title: 'Manage Tenants' },
      { id: 'subscriptions', title: 'Subscriptions' }
    ]
  },

  automation: {
    id: 'automation',
    title: 'Automation Rules & Scheduled Job Execution',
    category: 'Platform & Infrastructure',
    icon: '⎇',
    badge: 'Cron & Event Engine',
    summary: 'Background job scheduler and automation engine managing SLA breach scanners, evidence expiry monitors, risk review reminders, and webhook event dispatches.',
    roles: ['Platform Super Admin', 'Operations Engineer'],
    capabilities: ['MANAGE_JOBS', 'TRIGGER_CRON'],
    keyActions: [
      'Inspect status of active background daemons (SLA scanner, Risk review scanner, Backup sync)',
      'Trigger immediate manual execution of batch jobs without waiting for cron',
      'Inspect job execution history, run durations, and error stack traces',
      'Configure custom automated trigger rules (If Event X -> Execute Action Y)'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Check Running Daemons',
        instruction: 'Review active workers: SLA Scanner (every 5m), Risk Review Scanner (every 15m), Audit Log Integrity Check (daily).',
        tip: 'Green pulse indicates healthy daemon heartbeat.'
      },
      {
        step: 2,
        title: 'Trigger Manual Run',
        instruction: 'Click "Run Now" next to any job to immediately process pending queues.',
        tip: 'Execution logs update in real-time.'
      }
    ],
    proTips: [
      'Job failures automatically retry up to 3 times before logging an operational incident.',
      'Long-running report export jobs are queued on dedicated background worker threads.'
    ],
    relatedTabs: [
      { id: 'health', title: 'System Health' },
      { id: 'sla', title: 'SLA & Escalations' }
    ]
  },

  imports: {
    id: 'imports',
    title: 'Data Imports, Extraction & Migration',
    category: 'Platform & Infrastructure',
    icon: 'upload',
    badge: 'Bulk Ingestion',
    summary: 'Data migration and import workbench for parsing CSV/Excel/JSON files containing risks, controls, users, or frameworks with validation staging and error rollback.',
    roles: ['Compliance Architect', 'Platform Admin', 'Consultant'],
    capabilities: ['IMPORT_DATA', 'MIGRATE_TENANT'],
    keyActions: [
      'Download standardized Excel/CSV import templates for risks, controls, and users',
      'Upload and parse bulk data files with real-time schema validation',
      'Review staged records in the candidate table and fix validation errors inline',
      'Commit clean records to the live database with transactional rollback safety'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Download Template',
        instruction: 'Click "Download CSV Template" for the desired entity type (e.g. Risk Register, Control Library).',
        tip: 'Ensure required columns (Title, Category, Likelihood, Impact) are populated.'
      },
      {
        step: 2,
        title: 'Upload & Stage',
        instruction: 'Drag and drop your populated spreadsheet. The parser stages all rows and flags duplicate or invalid fields.',
        tip: 'Fix any invalid cells directly in the preview table.'
      },
      {
        step: 3,
        title: 'Commit to Database',
        instruction: 'Click "Commit Clean Records". All valid items are batch-inserted into your tenant workspace.',
        tip: 'If any fatal error occurs, the entire batch rolls back automatically.'
      }
    ],
    proTips: [
      'Always test large imports (>500 rows) with a 5-row sample file first.',
      'Imports record the actor ID and source filename in the audit trail for data provenance.'
    ],
    relatedTabs: [
      { id: 'framework-authoring', title: 'Framework Authoring' },
      { id: 'risk', title: 'Risk Register' },
      { id: 'controls', title: 'Control Library' }
    ]
  },

  health: {
    id: 'health',
    title: 'System Health, Workers & API Telemetry',
    category: 'Platform & Infrastructure',
    icon: 'gauge',
    badge: 'Real-Time Telemetry',
    summary: 'Operational health status dashboard reporting database latency, API response times, active WebSocket connections, worker memory, and uptime metrics.',
    roles: ['Platform Super Admin', 'DevOps / SRE'],
    capabilities: ['VIEW_HEALTH', 'VIEW_METRICS'],
    keyActions: [
      'Inspect uptime SLA (Target: 99.95%) and service availability status',
      'Monitor SQLite/PostgreSQL query latency and connection pool saturation',
      'Review API endpoint latency percentiles (p50, p95, p99)',
      'Inspect active node memory usage and garbage collection metrics'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Check Component Status',
        instruction: 'Review health indicators: API Server, Database Engine, Storage Volume, Background Workers.',
        tip: 'All systems green indicates nominal operational health.'
      },
      {
        step: 2,
        title: 'Investigate Latency Spikes',
        instruction: 'Inspect the p95 latency graph to identify slow endpoints or database locks.',
        tip: 'Endpoints exceeding 500ms trigger auto-profiling traces.'
      }
    ],
    proTips: [
      'A dedicated health check endpoint (`/api/system/health`) is available for external uptime pingers.',
      'Memory leaks are prevented by automatic worker process recycling.'
    ],
    relatedTabs: [
      { id: 'security', title: 'Platform Security' },
      { id: 'architecture', title: 'OCI Riyadh Architecture' }
    ]
  },

  security: {
    id: 'security',
    title: 'Platform Security, Encryption & Hardening',
    category: 'Platform & Infrastructure',
    icon: 'lock',
    badge: 'Defense in Depth',
    summary: 'Security hardening center auditing AES-256 encryption at rest, TLS 1.3 in transit, Content Security Policy (CSP), IP allowlists, and brute-force protection.',
    roles: ['Platform Security Admin', 'CISO'],
    capabilities: ['MONITOR_SECURITY', 'CONFIGURE_SECURITY'],
    keyActions: [
      'Verify encryption key rotation status for database and file vault',
      'Configure corporate IP allowlisting for administrative access',
      'Inspect failed authentication attempts and rate-limit lockouts',
      'Audit Content Security Policy (CSP) and HTTP security header grades (A+)'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Security Scorecard',
        instruction: 'Review security posture gauges covering TLS, Encryption, MFA Enforcement, and Session Timeouts.',
        tip: 'Ensure all tenant administrators have MFA enforced.'
      },
      {
        step: 2,
        title: 'Configure IP Allowlists',
        instruction: 'Add company corporate VPN subnets (e.g. 10.42.0.0/16) to restrict administrative endpoints.',
        tip: 'IP restrictions block unauthorized off-network logins.'
      }
    ],
    proTips: [
      'JWT tokens use 32+ character secrets with mandatory 24-hour expiration.',
      'Cross-Site Scripting (XSS) and Clickjacking are mitigated via strict Helmet HTTP headers.'
    ],
    relatedTabs: [
      { id: 'logs', title: 'Immutable Audit Log' },
      { id: 'wisdom-eye', title: 'Wisdom Eye ASM' }
    ]
  },

  architecture: {
    id: 'architecture',
    title: 'OCI Riyadh Sovereign Cloud Architecture',
    category: 'Platform & Infrastructure',
    icon: 'network',
    badge: 'Saudi Sovereign Cloud',
    summary: 'High-availability infrastructure topology documenting Oracle Cloud Infrastructure (OCI) Riyadh Region deployment, data residency sovereignty, and disaster recovery.',
    roles: ['Security Architect', 'Compliance Officer', 'Auditor'],
    capabilities: ['VIEW_ARCHITECTURE'],
    keyActions: [
      'Inspect high-availability multi-fault domain cluster diagrams in OCI Riyadh',
      'Review Saudi data residency compliance certifications (NCA, SAMA, PDPL)',
      'Inspect Recovery Time Objective (RTO < 1h) and Recovery Point Objective (RPO < 15m)',
      'Export infrastructure whitepaper for regulatory submission'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Explore Architecture Topology',
        instruction: 'Browse the interactive network topology showing Web Layer, Application Cluster, and Database Vault.',
        tip: 'All customer data resides strictly within Saudi Arabian borders.'
      },
      {
        step: 2,
        title: 'Verify Disaster Recovery Specs',
        instruction: 'Inspect automated backup replication to secondary sovereign data centers.',
        tip: 'Backups are encrypted using customer-specific KMS keys.'
      }
    ],
    proTips: [
      'Guarantees 100% in-kingdom data residency required by Saudi NCA regulations.',
      'Meets Tier-4 data center physical security and redundancy standards.'
    ],
    relatedTabs: [
      { id: 'security', title: 'Platform Security' },
      { id: 'brd', title: 'BRD Traceability' }
    ]
  },

  brd: {
    id: 'brd',
    title: 'BRD Traceability & Regulatory Verification',
    category: 'Platform & Infrastructure',
    icon: '◷',
    badge: 'Requirements Matrix',
    summary: 'Technical Requirements Document (TRD) & Business Requirements Document (BRD) matrix mapping every platform feature to its specific architectural clause and test suite.',
    roles: ['Lead Architect', 'Auditor', 'Product Manager'],
    capabilities: ['VIEW_TRACEABILITY'],
    keyActions: [
      'Trace functional modules to exact TRD specification sections (§3, §7, §11)',
      'Inspect automated unit and integration test coverage per requirement',
      'Verify regulatory compliance mappings (ISO 27001, NCA ECC, NIST)',
      'Export traceability matrix for independent certification audits'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Inspect Traceability Table',
        instruction: 'Filter requirements by module (Multi-Tenancy, DMS, GRC Core, ITSM, Billing, Security).',
        tip: 'Click on any TRD section code to view exact specification details.'
      },
      {
        step: 2,
        title: 'Verify Test Status',
        instruction: 'Confirm green checkmarks indicating passing automated test suites.',
        tip: 'Ensures zero regression across continuous integration releases.'
      }
    ],
    proTips: [
      'Every GRC Wisdom feature is built strictly to comply with formal ISO/IEC standards.',
      'Use this matrix as audit evidence when undergoing ISO 27001 certification.'
    ],
    relatedTabs: [
      { id: 'standards', title: 'Standards Library' },
      { id: 'audits', title: 'Audit Programme' }
    ]
  },

  'wisdom-eye': {
    id: 'wisdom-eye',
    title: 'Wisdom Eye Attack Surface Management (ASM)',
    category: 'Security Services',
    icon: 'exposure',
    badge: 'Continuous ASM Scanning',
    summary: 'External Attack Surface Management platform discovering internet-facing assets, open ports, expiring SSL certificates, and vulnerability exposures.',
    roles: ['Security Analyst', 'CISO', 'IT Operations'],
    capabilities: ['MANAGE_ASM', 'SCAN_ASSETS'],
    keyActions: [
      'Discover and inventory external domains, subdomains, web apps, and IP ranges',
      'Scan for critical vulnerabilities (CVEs), weak SSL ciphers, and DNS misconfigurations',
      'Assign asset owners and track vulnerability remediation lifecycles',
      'Auto-generate Risk Register items from high-severity external exposures'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Add External Assets',
        instruction: 'Click "+ Add Asset", enter root domain (e.g. company.com) or IP range. Confirm asset authorization.',
        tip: 'Wisdom Eye automatically discovers subdomains and web applications.'
      },
      {
        step: 2,
        title: 'Review Scan Findings',
        instruction: 'Inspect findings categorized by Critical, High, Medium, and Low severity with CVSS scores.',
        tip: 'Click on any finding to view remediation guidance.'
      },
      {
        step: 3,
        title: 'Convert to GRC Issue / Risk',
        instruction: 'Click "Convert to Risk" to push critical exposures directly into the Enterprise Risk Register.',
        tip: 'Bridges technical vulnerabilities directly to executive risk management.'
      }
    ],
    proTips: [
      'Schedule weekly automated asset discovery scans to catch shadow IT before attackers do.',
      'SSL certificate expiry warnings alert your team 30 days prior to expiration.'
    ],
    relatedTabs: [
      { id: 'risk', title: 'Risk Register' },
      { id: 'eye-phish', title: 'Eye Phish' },
      { id: 'tool-marketplace', title: 'Tool Marketplace' }
    ]
  },

  'eye-phish': {
    id: 'eye-phish',
    title: 'Eye Phish Security Awareness & Phishing Simulation',
    category: 'Security Services',
    icon: 'phishing',
    badge: 'Human Risk Management',
    summary: 'Simulated phishing and employee security awareness campaign manager supporting localized Arabic/English email, QR code, and SMS attack scenarios.',
    roles: ['Security Awareness Lead', 'CISO', 'HR Manager'],
    capabilities: ['MANAGE_PHISHING', 'LAUNCH_CAMPAIGN'],
    keyActions: [
      'Launch simulated phishing campaigns across departments and branches',
      'Choose attack templates (M365 Storage Alert, HR Benefits, QR Code Phish, CEO Fraud)',
      'Track real-time employee click rates, credential submissions, and reporting rates',
      'Automatically assign micro-learning training to employees who fail simulations'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Create Phishing Campaign',
        instruction: 'Click "+ New Campaign", choose target population (e.g., Finance team), select template and language.',
        tip: 'Arabic QR code and executive invoice scenarios mirror real-world attacks.'
      },
      {
        step: 2,
        title: 'Launch & Monitor Live Metrics',
        instruction: 'Launch campaign and monitor real-time dashboards: Emails Sent, Opened, Clicked, Reported.',
        tip: 'Employees who report simulations using the Phish Alarm button boost organizational resilience score.'
      },
      {
        step: 3,
        title: 'Trigger Automated Remediation',
        instruction: 'Employees who submit credentials automatically receive a 3-minute interactive training module.',
        tip: 'Completion records update in the HR training registry.'
      }
    ],
    proTips: [
      'Maintain an organizational reporting rate above 60% and failure rate below 5%.',
      'Run quarterly simulations to satisfy ISO 27001 Clause 7.2 awareness requirements.'
    ],
    relatedTabs: [
      { id: 'wisdom-eye', title: 'Wisdom Eye ASM' },
      { id: 'team-directory', title: 'Teams & Departments' }
    ]
  },

  logs: {
    id: 'logs',
    title: 'Immutable Cryptographic Audit Log',
    category: 'Governance & Verification',
    icon: '▤',
    badge: 'SHA-256 Tamper Evident',
    summary: 'Cryptographically sealed audit log recording every platform action, login, approval, configuration change, and export with SHA-256 hash chaining.',
    roles: ['Auditor', 'Compliance Officer', 'Platform Super Admin'],
    capabilities: ['VIEW_AUDIT_LOGS', 'VERIFY_HASHES'],
    keyActions: [
      'Inspect immutable event log with Actor, Action, Subject, IP, and SHA-256 hash',
      'Run cryptographic verification to prove that no log entries have been modified or deleted',
      'Filter audit trail by tenant, user email, date range, or subject type',
      'Export certified audit logs with digital verification signatures'
    ],
    howToUse: [
      {
        step: 1,
        title: 'Search Audit Records',
        instruction: 'Filter logs by event type (CREATE, UPDATE, DELETE, APPROVE, IMPERSONATE, LOGIN).',
        tip: 'Logs capture exact JSON payloads of changes before and after.'
      },
      {
        step: 2,
        title: 'Verify Cryptographic Integrity',
        instruction: 'Click "Run Cryptographic Hash Check". The verifier recalculates all SHA-256 hashes sequentially.',
        tip: 'Green confirmation badge proves zero tampering since inception.'
      }
    ],
    proTips: [
      'Audit logs cannot be deleted or modified, even by database administrators.',
      'External auditors can download the hash chain to perform offline independent verification.'
    ],
    relatedTabs: [
      { id: 'library', title: 'Document Library' },
      { id: 'tasks', title: 'To Do & Approvals' },
      { id: 'security', title: 'Platform Security' }
    ]
  }
};

export const MASTER_WORKFLOWS: PlatformWorkflow[] = [
  {
    id: 'wf-risk-lifecycle',
    title: 'End-to-End Enterprise Risk Management Lifecycle',
    category: 'Assurance & Governance',
    icon: '△',
    summary: 'Standard operating procedure for identifying risks, mapping mitigating controls, computing dynamic residual scores, executing treatments, and securing board appetite approvals.',
    estimatedTime: '15 - 30 minutes',
    targetRoles: ['Risk Manager', 'Control Owner', 'CISO', 'Approver'],
    prerequisites: ['Standards enabled', 'Controls created in Control Library'],
    steps: [
      {
        phase: '1. Identification & Narrative',
        tabId: 'risk',
        tabTitle: 'Risk Register',
        action: 'Log Risk with Duplicate Check',
        details: 'Open the Risk Register and click "+ Add Risk". Input a structured Cause -> Event -> Impact narrative and score inherent Likelihood x Impact (1-5).'
      },
      {
        phase: '2. Control Linkage',
        tabId: 'controls',
        tabTitle: 'Control Library',
        action: 'Map Mitigating Controls',
        details: 'Link verified controls from the Control Library. The Risk Scoring engine automatically computes the Residual Score downwards based on control effectiveness.'
      },
      {
        phase: '3. Evidence Verification',
        tabId: 'implementations',
        tabTitle: 'Implementations & Evidence',
        action: 'Upload & Validate Control Evidence',
        details: 'Control owners attach fresh evidence files. A second-line compliance validator marks the implementation as Verified & Effective.'
      },
      {
        phase: '4. Action Planning',
        tabId: 'risk',
        tabTitle: 'Risk Register',
        action: 'Assign Treatment Actions',
        details: 'For residual scores exceeding target appetite, add time-bound treatment action items (Mitigate, Transfer, Avoid) with assigned owners.'
      },
      {
        phase: '5. Appetite Governance',
        tabId: 'risk',
        tabTitle: 'Risk Register',
        action: 'Time-Bound Acceptance Approval',
        details: 'If risk is accepted, an independent approver records formal acceptance before the expiry date, verified against Board Appetite tolerance.'
      }
    ]
  },

  {
    id: 'wf-audit-engagement',
    title: 'Internal Audit Engagement & Fieldwork Lifecycle',
    category: 'Internal Audit',
    icon: '◎',
    summary: 'Comprehensive audit lifecycle: scoring the universe, establishing the annual plan, instantiating engagements, executing test procedures, and reporting findings.',
    estimatedTime: '45 - 60 minutes',
    targetRoles: ['Chief Audit Executive (CAE)', 'Lead Auditor', 'Auditee'],
    prerequisites: ['Auditable universe defined', 'Control library populated'],
    steps: [
      {
        phase: '1. Universe Scoring',
        tabId: 'audits',
        tabTitle: 'Audit Programme',
        action: 'Score Universe Entities',
        details: 'Score auditable entities based on inherent risk, past audit results, and business criticality to establish annual audit frequency.'
      },
      {
        phase: '2. Plan Approval',
        tabId: 'audits',
        tabTitle: 'Audit Programme',
        action: 'Assemble & Approve Annual Plan',
        details: 'Assemble high-exposure entities into the Annual Plan and submit to the Audit Committee for formal electronic sign-off.'
      },
      {
        phase: '3. Fieldwork & RCM',
        tabId: 'audits',
        tabTitle: 'Audit Programme',
        action: 'Execute RCM Test Procedures',
        details: 'Instantiate the engagement, populate the Risk & Control Matrix (RCM), execute testing procedures, and attach workpapers with sample files.'
      },
      {
        phase: '4. Findings & CAPs',
        tabId: 'audits',
        tabTitle: 'Audit Programme',
        action: 'Raise Findings & Assign Corrective Actions',
        details: 'Document control test failures with 5Cs (Condition, Criteria, Cause, Consequence, Corrective Action) and assign management responses.'
      },
      {
        phase: '5. Board Reporting',
        tabId: 'audits',
        tabTitle: 'Audit Programme',
        action: 'Export Verified Audit Pack',
        details: 'Click "Export Audit Report" to generate the bilingual executive board pack with executive summary and finding severity matrix.'
      }
    ]
  },

  {
    id: 'wf-document-lifecycle',
    title: 'Cryptographic Document Governance Lifecycle',
    category: 'Document Management',
    icon: '≡',
    summary: 'Procedure for authoring policies, managing checkout locks, executing multi-stage approvals, sealing SHA-256 hashes, and tracking employee acknowledgements.',
    estimatedTime: '10 - 20 minutes',
    targetRoles: ['Document Owner', 'Compliance Manager', 'Approver', 'All Staff'],
    prerequisites: ['Document categories configured'],
    steps: [
      {
        phase: '1. Controlled Drafting',
        tabId: 'library',
        tabTitle: 'Document Library',
        action: 'Create Document with Reference Code',
        details: 'Create a new controlled draft with standardized code (e.g. POL-SEC-001) and map relevant regulatory standard clauses.'
      },
      {
        phase: '2. Concurrency Lock',
        tabId: 'library',
        tabTitle: 'Document Library',
        action: 'Check Out & Version Edit',
        details: 'Check out the document to prevent conflicts. Edit content, save revisions, and check back in with a concise version changelog.'
      },
      {
        phase: '3. Management Sign-Off',
        tabId: 'tasks',
        tabTitle: 'To Do & Approvals',
        action: 'Review & Cryptographically Approve',
        details: 'Designated approver reviews the side-by-side diff in their task inbox and signs off with recorded timestamp and IP.'
      },
      {
        phase: '4. Cryptographic Sealing',
        tabId: 'logs',
        tabTitle: 'Immutable Audit Log',
        action: 'Verify SHA-256 Ledger Hash',
        details: 'The platform automatically seals the published document with a SHA-256 hash in the tamper-evident audit ledger.'
      },
      {
        phase: '5. Staff Attestation',
        tabId: 'acknowledgements',
        tabTitle: 'My Acknowledgements',
        action: 'Track Employee Acknowledgements',
        details: 'Distribute policy to staff for digital signature and monitor completion rates in the departmental scorecard.'
      }
    ]
  },

  {
    id: 'wf-multi-tenant-setup',
    title: 'Multi-Tenant Entity Hierarchy & Impersonation',
    category: 'Tenant Administration',
    icon: '▥',
    summary: 'Hierarchy setup for parent groups, branch node provisioning, role capability assignment, and safe operator troubleshooting.',
    estimatedTime: '20 - 30 minutes',
    targetRoles: ['Platform Super Admin', 'Group Admin', 'Tenant Owner'],
    prerequisites: ['Platform Super Admin credentials'],
    steps: [
      {
        phase: '1. Tree Structure',
        tabId: 'tenants',
        tabTitle: 'Manage Tenants',
        action: 'Provision Hierarchy Tree',
        details: 'Define parent holding group and provision child organization and regional branch nodes with Materialized Path routing.'
      },
      {
        phase: '2. Tier Entitlements',
        tabId: 'subscriptions',
        tabTitle: 'Subscriptions',
        action: 'Assign Editions & Quotas',
        details: 'Assign subscription editions, seat limits, and storage quotas for each tenant node.'
      },
      {
        phase: '3. RBAC Scoping',
        tabId: 'role-matrix',
        tabTitle: 'Roles & Permissions',
        action: 'Configure Role Scopes',
        details: 'Assign scoped roles (Group Admin, Branch Compliance Officer) with enforced Segregation of Duties.'
      },
      {
        phase: '4. Audited Support',
        tabId: 'impersonation',
        tabTitle: 'Impersonation Sessions',
        action: 'Execute Read-Only Impersonation',
        details: 'For support requests, initiate a 30-minute read-only session with ticket justification to inspect customer view without write risks.'
      }
    ]
  }
];

export const CATEGORIES_LIST = [
  'All',
  'Assurance & GRC Core',
  'Document Lifecycle & Governance',
  'Access & Identity Management',
  'Service Management (ITSM)',
  'Security Services',
  'Billing & Subscriptions',
  'Platform & Infrastructure'
];
