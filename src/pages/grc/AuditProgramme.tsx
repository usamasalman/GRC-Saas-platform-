import React, { useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, ghostBtn } from '../iam/iamStyles';
import AuditUniverse from './audit/AuditUniverse';
import Engagements from './audit/Engagements';
import RiskControlMatrix from './audit/RiskControlMatrix';
import Workpapers from './audit/Workpapers';
import IssueRegister from './audit/IssueRegister';

/**
 * The internal audit workspace, laid out in the order the work actually happens:
 * universe → plan → engagement → matrix → file → issues.
 *
 * The RCM and Workpapers tabs operate on one engagement at a time, so the
 * selection made on the Engagements tab is held here and passed down. That is
 * the only piece of state this host owns — each tab loads its own data.
 */

type TabKey = 'universe' | 'engagements' | 'matrix' | 'workpapers' | 'issues';

const TABS: { key: TabKey; label: string; hint: string }[] = [
  { key: 'universe', label: 'Universe & Plan', hint: 'What could be audited, and what will be' },
  { key: 'engagements', label: 'Engagements', hint: 'Audits in flight and their findings' },
  { key: 'matrix', label: 'RCM & Testing', hint: 'Risks, procedures and test results' },
  { key: 'workpapers', label: 'Workpapers', hint: 'The engagement file and sign-off' },
  { key: 'issues', label: 'Issues & CAP', hint: 'Every issue, whatever raised it' },
];

const AuditProgramme: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('universe');
  const [scope, setScope] = useState('');
  const [selected, setSelected] = useState<{ id: string; ref: string } | null>(null);

  useEffect(() => {
    apiClient.get('/api/grc/audits')
      .then((r) => setScope(r.data?.scope || ''))
      .catch(() => setScope(''));
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'transparent',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--brand)' : 'transparent'}`,
    color: active ? 'var(--ink)' : 'var(--ink-muted)',
    padding: '10px 2px',
    marginRight: 22,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: active ? 700 : 500,
    whiteSpace: 'nowrap',
    // Only the colour transitions — animating `all` on a sticky element is
    // what made this page judder on scroll.
    transition: 'color 0.15s ease, border-color 0.15s ease',
  });

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 6 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Internal audit &amp; assurance</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--ink-muted)' }}>
            {active.hint} · Scope: <strong style={{ color: 'var(--info)' }}>{scope || '—'}</strong>
          </p>
        </div>
        {selected && (
          <div style={{
            ...S.card, padding: '8px 12px', fontSize: 12, color: 'var(--ink-body)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ color: 'var(--ink-muted)' }}>Working on</span>
            <strong style={{ color: 'var(--brand)' }}>{selected.ref}</strong>
            <button onClick={() => setSelected(null)} style={{ ...ghostBtn, padding: '4px 9px', fontSize: 11 }}>clear</button>
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', overflowX: 'auto', borderBottom: '1px solid var(--line)',
        marginBottom: 20, scrollbarWidth: 'thin',
      }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={tabStyle(tab === t.key)}>
            {t.label}
            {(t.key === 'matrix' || t.key === 'workpapers') && selected && (
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>{selected.ref}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'universe' && <AuditUniverse />}
      {tab === 'engagements' && (
        <Engagements
          selectedId={selected?.id ?? null}
          onSelect={(id, ref) => setSelected({ id, ref })}
        />
      )}
      {tab === 'matrix' && <RiskControlMatrix auditId={selected?.id ?? null} />}
      {tab === 'workpapers' && <Workpapers auditId={selected?.id ?? null} />}
      {tab === 'issues' && <IssueRegister />}
    </div>
  );
};

export default AuditProgramme;
