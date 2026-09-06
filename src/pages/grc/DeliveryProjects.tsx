import React, { useState } from 'react';
import { S, ghostBtn } from '../iam/iamStyles';
import ProjectPortfolio from './project/ProjectPortfolio';
import ProjectPlan from './project/ProjectPlan';
import ProjectVerification from './project/ProjectVerification';
import ProjectImpediments from './project/ProjectImpediments';

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

type TabKey = 'portfolio' | 'plan' | 'verification' | 'impediments';

interface Selected { id: string; ref: string; name: string; }

const DeliveryProjects: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('portfolio');
  const [selected, setSelected] = useState<Selected | null>(null);

  const open = (project: Selected) => {
    setSelected(project);
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
      <div style={{ borderBottom: '1px solid var(--line)', marginBottom: 20, display: 'flex', alignItems: 'center' }}>
        <button style={tabStyle(tab === 'portfolio')} onClick={() => setTab('portfolio')}>
          Portfolio
        </button>
        <button
          style={{ ...tabStyle(tab === 'plan'), opacity: selected ? 1 : 0.45 }}
          onClick={() => selected && setTab('plan')}
          disabled={!selected}
          title={selected ? undefined : 'Open a project from the portfolio first'}
        >
          Plan
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

        {tab !== 'portfolio' && selected && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
              <span style={{ color: 'var(--ink-faint)' }}>{selected.ref}</span> · {selected.name}
            </span>
            <button style={ghostBtn} onClick={() => setTab('portfolio')}>Back to portfolio</button>
          </div>
        )}
      </div>

      {tab === 'portfolio' && <ProjectPortfolio onOpen={open} />}
      {tab === 'plan' && selected && <ProjectPlan key={selected.id} projectId={selected.id} />}
      {tab === 'verification' && selected && (
        <ProjectVerification key={selected.id} projectId={selected.id} />
      )}
      {tab === 'impediments' && selected && (
        <ProjectImpediments key={selected.id} projectId={selected.id} />
      )}
    </div>
  );
};

export default DeliveryProjects;
