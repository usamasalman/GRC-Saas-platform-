import React, { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { S, ghostBtn } from '../../iam/iamStyles';

/**
 * Challenges to the scores of risks and assets you own, across engagements
 * (consulting engagement, sprint 11), in My Work. Decided from the
 * engagement's Challenges tab. Shows nothing when there is nothing to decide.
 */
const scores = (kind: string, s: any) => (!s ? '—' : kind === 'Risk' ? `L${s.likelihood} × I${s.impact}` : `C${s.confidentiality} I${s.integrity} A${s.availability}`);

const ChallengesToDecide: React.FC<{ onOpenProject?: (projectId: string) => void }> = ({ onOpenProject }) => {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    apiClient.get('/api/engagements/challenges/mine').then((r) => setRows(r.data?.challenges || [])).catch(() => setRows([]));
  }, []);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...S.card, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', fontSize: 13, fontWeight: 600 }}>
        Challenges to decide
        <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-muted)', marginLeft: 8 }}>A firm challenges the scores of something you own; decide from the engagement's Challenges tab.</span>
      </div>
      {rows.map((c) => (
        <div key={c.id} style={{ padding: '8px 16px', borderTop: '1px solid var(--line-soft)', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>{c.ref}</strong> {c.target}
          <span style={{ color: 'var(--ink-muted)' }}>{scores(c.kind, c.scoresBefore)} → {scores(c.kind, c.scoresProposed)}</span>
          <span style={{ color: 'var(--ink-muted)' }}>{c.project.ref} · {c.raisedBy?.name}</span>
          {onOpenProject && <button style={{ ...ghostBtn, padding: '3px 10px', fontSize: 11.5, marginLeft: 'auto' }} onClick={() => onOpenProject(c.project.id)}>Open</button>}
        </div>
      ))}
    </div>
  );
};

export default ChallengesToDecide;
