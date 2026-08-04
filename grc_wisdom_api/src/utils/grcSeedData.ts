/**
 * GRC Core seed: standards, clauses, and a library of controls mapped to them.
 * Deliberately a representative subset — enough to exercise mapping, coverage
 * and validation without shipping a full framework text.
 */

export interface ClauseSeed { ref: string; title: string; text?: string }
export interface StandardSeed {
  code: string; title: string; authority: string; version: string;
  description: string; clauses: ClauseSeed[];
}
export interface ControlSeed {
  code: string; title: string; objective: string; domain: string;
  /** "STANDARD_CODE:CLAUSE_REF" pairs. */
  mappings: string[];
}

export const STANDARDS: StandardSeed[] = [
  {
    code: 'ISO27001',
    title: 'ISO/IEC 27001 — Information Security Management',
    authority: 'International Organization for Standardization',
    version: '2022',
    description: 'Requirements for establishing, implementing, maintaining and continually improving an ISMS.',
    clauses: [
      { ref: 'A.5.15', title: 'Access control', text: 'Rules to control physical and logical access to information shall be established.' },
      { ref: 'A.5.16', title: 'Identity management', text: 'The full lifecycle of identities shall be managed.' },
      { ref: 'A.5.17', title: 'Authentication information', text: 'Allocation and management of authentication information shall be controlled.' },
      { ref: 'A.5.23', title: 'Cloud services security', text: 'Processes for acquisition, use and exit of cloud services shall be established.' },
      { ref: 'A.5.30', title: 'ICT readiness for continuity', text: 'ICT readiness shall be planned and tested against continuity objectives.' },
      { ref: 'A.8.7', title: 'Protection against malware', text: 'Protection against malware shall be implemented and supported by user awareness.' },
      { ref: 'A.8.12', title: 'Data leakage prevention', text: 'Data leakage prevention measures shall be applied to systems handling sensitive information.' },
      { ref: 'A.8.15', title: 'Logging', text: 'Logs recording activities, exceptions and events shall be produced, stored and reviewed.' },
      { ref: 'A.8.16', title: 'Monitoring activities', text: 'Networks and systems shall be monitored for anomalous behaviour.' },
      { ref: 'A.8.24', title: 'Use of cryptography', text: 'Rules for effective use of cryptography, including key management, shall be defined.' },
    ],
  },
  {
    code: 'NCA-ECC',
    title: 'NCA Essential Cybersecurity Controls',
    authority: 'National Cybersecurity Authority (Saudi Arabia)',
    version: '2:2024',
    description: 'Minimum cybersecurity requirements for national organizations in the Kingdom.',
    clauses: [
      { ref: '1-2-3', title: 'Cybersecurity roles and responsibilities', text: 'Roles shall be defined, documented and assigned.' },
      { ref: '2-2-1', title: 'Identity and access management', text: 'Access shall be granted on least privilege and need-to-know.' },
      { ref: '2-3-1', title: 'Information system protection', text: 'Systems shall be protected from malware and unauthorized change.' },
      { ref: '2-5-1', title: 'Network security management', text: 'Networks shall be segmented and protected at the perimeter.' },
      { ref: '2-10-1', title: 'Cryptography', text: 'Approved cryptographic standards shall be applied to data at rest and in transit.' },
      { ref: '2-12-1', title: 'Event logs and monitoring', text: 'Security event logs shall be collected, retained and monitored.' },
      { ref: '2-13-1', title: 'Incident and threat management', text: 'A cybersecurity incident response capability shall be established.' },
    ],
  },
  {
    code: 'PDPL',
    title: 'Saudi Personal Data Protection Law',
    authority: 'SDAIA',
    version: '2023 amendment',
    description: 'Obligations for controllers and processors handling personal data of individuals in Saudi Arabia.',
    clauses: [
      { ref: 'Art.4', title: 'Data subject rights', text: 'Data subjects have rights of access, correction and destruction.' },
      { ref: 'Art.11', title: 'Lawful basis and consent', text: 'Personal data shall only be processed on a lawful basis.' },
      { ref: 'Art.19', title: 'Data minimisation and retention', text: 'Data shall be limited to purpose and destroyed when no longer required.' },
      { ref: 'Art.20', title: 'Security of personal data', text: 'Appropriate organisational and technical measures shall protect personal data.' },
      { ref: 'Art.24', title: 'Breach notification', text: 'Breaches shall be notified to the competent authority without undue delay.' },
      { ref: 'Art.29', title: 'Cross-border transfer', text: 'Transfers outside the Kingdom are restricted and conditional.' },
    ],
  },
  {
    code: 'SOC2',
    title: 'SOC 2 Trust Services Criteria',
    authority: 'AICPA',
    version: '2017 (rev. 2022)',
    description: 'Criteria for security, availability, processing integrity, confidentiality and privacy.',
    clauses: [
      { ref: 'CC6.1', title: 'Logical access — provisioning', text: 'Logical access security measures restrict access to protected assets.' },
      { ref: 'CC6.6', title: 'Logical access — external threats', text: 'The entity implements measures against threats from outside its boundaries.' },
      { ref: 'CC7.2', title: 'System monitoring', text: 'The entity monitors components for anomalies indicative of malicious acts.' },
      { ref: 'CC7.3', title: 'Incident evaluation', text: 'The entity evaluates security events to determine whether they are incidents.' },
      { ref: 'CC8.1', title: 'Change management', text: 'The entity authorises, designs, tests and approves changes before implementation.' },
    ],
  },
];

export const CONTROLS: ControlSeed[] = [
  {
    code: 'AC-01', title: 'Least-privilege access provisioning',
    objective: 'Access is granted only on documented business need and approved before provisioning.',
    domain: 'Access Control',
    mappings: ['ISO27001:A.5.15', 'NCA-ECC:2-2-1', 'SOC2:CC6.1'],
  },
  {
    code: 'AC-02', title: 'Joiner-mover-leaver lifecycle',
    objective: 'Identities are created, changed and revoked in step with HR events.',
    domain: 'Access Control',
    mappings: ['ISO27001:A.5.16', 'NCA-ECC:2-2-1'],
  },
  {
    code: 'AC-03', title: 'Multi-factor authentication for privileged access',
    objective: 'All administrative and remote access requires a second factor.',
    domain: 'Access Control',
    mappings: ['ISO27001:A.5.17', 'NCA-ECC:2-2-1', 'SOC2:CC6.1'],
  },
  {
    code: 'AC-04', title: 'Quarterly access recertification',
    objective: 'Entitlements are reviewed by owners at least quarterly and revoked where unjustified.',
    domain: 'Access Control',
    mappings: ['ISO27001:A.5.15', 'SOC2:CC6.1'],
  },
  {
    code: 'LOG-01', title: 'Centralized security event logging',
    objective: 'Security-relevant events from critical systems are collected centrally and retained.',
    domain: 'Logging & Monitoring',
    mappings: ['ISO27001:A.8.15', 'NCA-ECC:2-12-1', 'SOC2:CC7.2'],
  },
  {
    code: 'LOG-02', title: 'Anomaly detection and alerting',
    objective: 'Anomalous activity is detected and raised to the security team for triage.',
    domain: 'Logging & Monitoring',
    mappings: ['ISO27001:A.8.16', 'NCA-ECC:2-12-1', 'SOC2:CC7.2'],
  },
  {
    code: 'CRY-01', title: 'Encryption of data at rest and in transit',
    objective: 'Approved algorithms protect sensitive data wherever it is stored or transmitted.',
    domain: 'Cryptography',
    mappings: ['ISO27001:A.8.24', 'NCA-ECC:2-10-1', 'PDPL:Art.20'],
  },
  {
    code: 'CRY-02', title: 'Cryptographic key management',
    objective: 'Keys are generated, stored, rotated and destroyed under documented procedure.',
    domain: 'Cryptography',
    mappings: ['ISO27001:A.8.24', 'NCA-ECC:2-10-1'],
  },
  {
    code: 'PDP-01', title: 'Lawful basis register for personal data',
    objective: 'Every processing activity records its lawful basis and retention trigger.',
    domain: 'Privacy',
    mappings: ['PDPL:Art.11', 'PDPL:Art.19'],
  },
  {
    code: 'PDP-02', title: 'Data subject rights fulfilment',
    objective: 'Access, correction and destruction requests are fulfilled within statutory time.',
    domain: 'Privacy',
    mappings: ['PDPL:Art.4'],
  },
  {
    code: 'PDP-03', title: 'Cross-border transfer assessment',
    objective: 'Transfers outside the Kingdom are assessed and approved before they occur.',
    domain: 'Privacy',
    mappings: ['PDPL:Art.29'],
  },
  {
    code: 'IR-01', title: 'Security incident response procedure',
    objective: 'Incidents are detected, classified, contained and reviewed under a tested procedure.',
    domain: 'Incident Management',
    mappings: ['NCA-ECC:2-13-1', 'SOC2:CC7.3'],
  },
  {
    code: 'IR-02', title: 'Personal data breach notification',
    objective: 'Qualifying breaches are notified to the regulator without undue delay.',
    domain: 'Incident Management',
    mappings: ['PDPL:Art.24', 'NCA-ECC:2-13-1'],
  },
  {
    code: 'CHG-01', title: 'Authorized production change management',
    objective: 'Production changes are tested, approved and reversible before release.',
    domain: 'Change Management',
    mappings: ['SOC2:CC8.1'],
  },
  {
    code: 'MAL-01', title: 'Endpoint malware protection',
    objective: 'Endpoints run supported anti-malware with current signatures.',
    domain: 'Threat Protection',
    mappings: ['ISO27001:A.8.7', 'NCA-ECC:2-3-1'],
  },
  {
    code: 'DLP-01', title: 'Data leakage prevention on egress channels',
    objective: 'Sensitive data is prevented from leaving via mail, web and removable media.',
    domain: 'Threat Protection',
    mappings: ['ISO27001:A.8.12', 'SOC2:CC6.6'],
  },
  {
    code: 'NET-01', title: 'Network segmentation and perimeter control',
    objective: 'Trust zones are separated and perimeter traffic is filtered and logged.',
    domain: 'Network Security',
    mappings: ['NCA-ECC:2-5-1', 'SOC2:CC6.6'],
  },
  {
    code: 'BCP-01', title: 'ICT continuity testing',
    objective: 'Recovery of critical services is tested against documented RTO and RPO.',
    domain: 'Resilience',
    mappings: ['ISO27001:A.5.30'],
  },
  {
    code: 'TPR-01', title: 'Cloud and third-party security assessment',
    objective: 'Providers are assessed before onboarding and reassessed on a defined cycle.',
    domain: 'Third-Party Risk',
    mappings: ['ISO27001:A.5.23'],
  },
  {
    code: 'GOV-01', title: 'Documented cybersecurity roles and responsibilities',
    objective: 'Security roles are defined, assigned and reviewed by management.',
    domain: 'Governance',
    mappings: ['NCA-ECC:1-2-3'],
  },
];
