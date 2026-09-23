import React from 'react';
import { pill } from '../../iam/iamStyles';
import BulkImportPanel from '../shared/BulkImportPanel';
import type { ImportConfig } from '../shared/BulkImportPanel';

/**
 * Bulk supplier import — the shared staged panel, configured for the register.
 *
 * Assets, risks and frameworks all had this pipeline already and suppliers did
 * not, which is the whole reason this was a small packet. The one thing that
 * needed saying differently: a supplier's tier drives the assessment cadence,
 * so it is computed on commit and never read from the file.
 */

const ACCESS: Record<string, React.CSSProperties> = {
  SensitivePersonalData: pill('#7F1D1A', '#E09A94'),
  PersonalData: pill('#8A3312', '#E9B49C'),
  Confidential: pill('#6B4A08', '#E8CE94'),
  Metadata: pill('var(--ink-muted)', 'var(--line)'),
  None: pill('#14532D', '#A8D5BA'),
};

const CONFIG: ImportConfig = {
  resource: 'vendors',
  candidateResource: 'vendor-candidates',
  templateFileName: 'Supplier_import_template.xlsx',
  noun: 'supplier',
  nounPlural: 'suppliers',
  intro: (
    <>
      Upload the supplier list procurement already keeps — a contract schedule, a payments
      export, anything with one row per supplier. Column names are matched by meaning, so
      "Vendor", "Supplier name" and "Company" all work, and a title block above the table is
      skipped rather than parsed as data.
    </>
  ),
  commitCaveat:
    'The tier is computed on commit from data access, system access, service criticality and '
    + 'substitutability, so the file cannot assert one — a spreadsheet saying "Tier 3" would '
    + 'otherwise decide how often its own supplier gets reviewed. A row whose owner email does '
    + 'not match an active user is skipped and named, because a supplier cannot exist without '
    + 'somebody accountable for the relationship.',
  columns: [
    {
      header: 'Supplier',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {p.name || <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(no name)</span>}
          </div>
          {p.legalName && p.legalName !== p.name && (
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{p.legalName}</div>
          )}
        </>
      ),
    },
    {
      header: 'Category / country',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink-body)' }}>{p.category}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {p.country || 'country not stated'}
            {p.dataLocation && p.dataLocation !== p.country ? ` · data in ${p.dataLocation}` : ''}
          </div>
        </>
      ),
    },
    {
      header: 'Data access',
      render: (p) => (
        <>
          <span style={ACCESS[p.dataAccess] || ACCESS.None}>{p.dataAccess}</span>
          {p.hasSystemAccess && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 3 }}>system access</div>
          )}
        </>
      ),
    },
    {
      header: 'Crit / subst',
      numeric: true,
      render: (p) => `${p.serviceCriticality} / ${p.substitutability}`,
    },
    {
      header: 'Relationship owner',
      render: (p) => (
        p.ownerEmail
          ? <span style={{ color: 'var(--ink-body)' }}>{p.ownerEmail}</span>
          : <span style={{ color: 'var(--danger)' }}>none — will be skipped</span>
      ),
    },
  ],
  correctionFields: [
    { key: 'name', label: 'Supplier name', kind: 'text' },
    { key: 'legalName', label: 'Legal name', kind: 'text' },
    {
      key: 'category',
      label: 'Category',
      kind: 'select',
      options: [
        'CloudHosting', 'Software', 'ProfessionalServices', 'Outsourcing',
        'Logistics', 'Facilities', 'Staffing', 'Financial', 'Other',
      ],
    },
    {
      key: 'dataAccess',
      label: 'Data access',
      kind: 'select',
      options: ['None', 'Metadata', 'Confidential', 'PersonalData', 'SensitivePersonalData'],
    },
    { key: 'country', label: 'Country', kind: 'text' },
    { key: 'dataLocation', label: 'Data held in', kind: 'text' },
    { key: 'serviceCriticality', label: 'Service criticality', kind: 'scale' },
    { key: 'substitutability', label: 'Substitutability', kind: 'scale' },
    { key: 'ownerEmail', label: 'Relationship owner email', kind: 'text' },
  ],
  renderSignal: (c) => {
    const row = c.row || {};
    if (!row.ownerEmail) {
      return (
        <span style={{ color: 'var(--danger)', fontSize: 11 }}>
          No relationship owner — this row will be skipped on commit.
        </span>
      );
    }
    return null;
  },
};

const VendorImport: React.FC<{ onCommitted?: () => void }> = ({ onCommitted }) => (
  <BulkImportPanel config={CONFIG} onCommitted={onCommitted} />
);

export default VendorImport;
