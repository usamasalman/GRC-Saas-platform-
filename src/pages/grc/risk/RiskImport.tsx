import React from 'react';
import { pill } from '../../iam/iamStyles';
import BulkImportPanel from '../shared/BulkImportPanel';
import type { ImportConfig } from '../shared/BulkImportPanel';

/**
 * Bulk risk import — the shared staged panel, configured for the register.
 *
 * The one thing this adds beyond the asset importer is the duplicate signal.
 * Creating a single risk enforces a duplicate search, and a bulk path that
 * skipped it would be the fastest way to fill a register with three spellings
 * of the same risk, so a row resembling something already on the register is
 * surfaced for a person to judge rather than accepted quietly.
 */

const CATEGORIES = ['Strategic', 'Operational', 'Financial', 'Compliance',
  'Technology', 'Third-Party', 'People'];

const DIRECTION_PILL: Record<string, React.CSSProperties> = {
  Threat: pill('var(--danger)', 'var(--danger-line)'),
  Opportunity: pill('var(--success)', 'var(--success-line)'),
};

const band = (score: number) =>
  score >= 15 ? { fg: '#7F1D1A', line: '#E09A94' }
    : score >= 8 ? { fg: '#6B4A08', line: '#E8CE94' }
      : { fg: '#14532D', line: '#A8D5BA' };

const CONFIG: ImportConfig = {
  resource: 'risks',
  candidateResource: 'risk-candidates',
  templateFileName: 'Risk_import_template.xlsx',
  noun: 'risk',
  nounPlural: 'risks',
  intro: (
    <>
      Upload the register you already keep in Excel. Column names are matched by meaning, so
      "Risk event", "Scenario" and "Risk title" all work, and scores written as words —
      <em> Likely</em>, <em>Severe</em> — are read as numbers. A title block above the table is
      skipped rather than parsed as data.
    </>
  ),
  commitCaveat:
    'Inherent score is recomputed from likelihood and impact. Residual opens equal to inherent '
    + 'because no control is linked yet — link controls afterwards and residual recomputes from '
    + 'their verified effectiveness. This cannot be undone as a batch.',
  columns: [
    {
      header: 'Risk',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink)', fontWeight: 600 }}>
            {p.title || <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(no title)</span>}
          </div>
          {p.assetKey && (
            <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>on {p.assetKey}</div>
          )}
        </>
      ),
    },
    {
      header: 'Category',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink-body)' }}>{p.category}</div>
          <div style={{ marginTop: 3 }}>
            <span style={DIRECTION_PILL[p.direction] || DIRECTION_PILL.Threat}>{p.direction}</span>
          </div>
        </>
      ),
    },
    {
      header: 'L × I',
      numeric: true,
      render: (p) => `${p.likelihood} × ${p.impact}`,
    },
    {
      header: 'Inherent',
      numeric: true,
      render: (p) => {
        const b = band(p.inherentScore);
        return <span style={{ ...pill(b.fg, b.line), fontWeight: 700 }}>{p.inherentScore}</span>;
      },
    },
    {
      header: 'Treatment',
      render: (p) => (
        <>
          <div style={{ color: 'var(--ink-body)' }}>{p.treatmentType}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>via {p.identifiedVia}</div>
        </>
      ),
    },
  ],
  correctionFields: [
    { key: 'title', label: 'Risk title', kind: 'text' },
    { key: 'category', label: 'Category', kind: 'select', options: CATEGORIES },
    { key: 'direction', label: 'Direction', kind: 'select', options: ['Threat', 'Opportunity'] },
    {
      key: 'treatmentType', label: 'Treatment', kind: 'select',
      // Both vocabularies are offered; the server refuses a mismatch, which is
      // clearer than a form that silently narrows the list as you change
      // direction and leaves you wondering where an option went.
      options: ['Mitigate', 'Accept', 'Transfer', 'Avoid', 'Exploit', 'Enhance', 'Share', 'Ignore'],
    },
    { key: 'likelihood', label: 'Likelihood', kind: 'scale' },
    { key: 'impact', label: 'Impact', kind: 'scale' },
    { key: 'ownerEmail', label: 'Risk owner (email)', kind: 'text', placeholder: 'falls back to you' },
    { key: 'assetKey', label: 'Related asset', kind: 'text', placeholder: 'AST-0001 or its name' },
  ],
  renderSignal: (c) =>
    (c.possibleDuplicates || []).length > 0 ? (
      <div style={{
        marginTop: 5, padding: '6px 9px', background: 'var(--warning-bg)',
        border: '1px solid var(--warning-line)', borderRadius: 'var(--radius-sm)',
        fontSize: 11.5, color: 'var(--warning)', maxWidth: 270,
      }}>
        <strong>Already on the register?</strong> Resembles “{c.possibleDuplicates[0]}”
        {c.possibleDuplicates.length > 1 && ` and ${c.possibleDuplicates.length - 1} other`}.
        Accept only if it is genuinely a different risk.
      </div>
    ) : null,
};

const RiskImport: React.FC<{ onCommitted?: () => void }> = ({ onCommitted }) => (
  <BulkImportPanel config={CONFIG} onCommitted={onCommitted} />
);

export default RiskImport;
