import React from 'react';
import { pill } from '../../iam/iamStyles';
import BulkImportPanel from '../shared/BulkImportPanel';
import type { ImportConfig } from '../shared/BulkImportPanel';

/**
 * Bulk asset import — the shared staged panel, configured for the inventory.
 *
 * Criticality becomes the impact of every risk raised against an asset, so a
 * mis-read rating does not stay a spreadsheet problem. It is recomputed on
 * commit from the CIA ratings, never taken from the file.
 */

const TIER: Record<string, React.CSSProperties> = {
  Critical: pill('#7F1D1A', '#E09A94'),
  High: pill('#8A3312', '#E9B49C'),
  Medium: pill('#6B4A08', '#E8CE94'),
  Low: pill('#14532D', '#A8D5BA'),
};

const CONFIG: ImportConfig = {
  resource: 'assets',
  candidateResource: 'asset-candidates',
  templateFileName: 'Asset_import_template.xlsx',
  noun: 'asset',
  nounPlural: 'assets',
  intro: (
    <>
      Upload the spreadsheet your IT or facilities team already keeps — a CMDB export, an asset
      schedule, anything with one row per asset. Column names are matched by meaning, so "System",
      "Application" and "Asset name" all work, and a title block above the table is skipped rather
      than parsed as data.
    </>
  ),
  commitCaveat:
    'Criticality is recomputed on commit from the CIA ratings, so the file cannot assert a tier. '
    + 'This cannot be undone as a batch — assets would have to be retired individually.',
  columns: [
    {
      header: 'Asset',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {p.name || <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(no name)</span>}
          </div>
          {p.location && <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{p.location}</div>}
        </>
      ),
    },
    {
      header: 'Type / held by',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink-body)' }}>{p.type}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            {p.ownership === 'ThirdParty'
              ? `Third party${p.vendorName ? ` — ${p.vendorName}` : ''}`
              : p.ownership}
          </div>
        </>
      ),
    },
    {
      header: 'C / I / A',
      numeric: true,
      render: (p) => `${p.confidentiality} / ${p.integrity} / ${p.availability}`,
    },
    {
      header: 'Criticality',
      render: (p) => (
        <span style={TIER[p.criticalityTier] || TIER.Medium}>
          {p.criticalityTier} {p.criticality}
        </span>
      ),
    },
  ],
  correctionFields: [
    { key: 'name', label: 'Asset name', kind: 'text' },
    {
      key: 'type', label: 'Type', kind: 'select',
      options: ['Information', 'Software', 'Physical', 'Service', 'Personnel', 'Intangible'],
    },
    {
      key: 'ownership', label: 'Held by', kind: 'select',
      options: ['Internal', 'ThirdParty', 'Shared'],
      optionLabel: (v) => (v === 'ThirdParty' ? 'Third party' : v),
    },
    { key: 'vendorName', label: 'Supplier', kind: 'text', placeholder: 'required for third party' },
    { key: 'confidentiality', label: 'Confidentiality', kind: 'scale' },
    { key: 'integrity', label: 'Integrity', kind: 'scale' },
    { key: 'availability', label: 'Availability', kind: 'scale' },
    { key: 'ownerEmail', label: 'Owner (email)', kind: 'text', placeholder: 'falls back to you' },
  ],
};

const AssetImport: React.FC<{ onCommitted?: () => void }> = ({ onCommitted }) => (
  <BulkImportPanel config={CONFIG} onCommitted={onCommitted} />
);

export default AssetImport;
