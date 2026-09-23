import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, ghostBtn, pill , apiError } from '../iam/iamStyles';

interface ServiceStatus {
  name: string;
  /** "Mounted" — that this router is in this build. Nothing measures uptime. */
  status: string;
}

interface BackgroundJob {
  id: string;
  name: string;
  description: string;
  schedule: string;
  measures: string[];
  /** Null until the worker has run in the process currently serving. */
  lastRun: string | null;
  nextRun: string | null;
  durationMs: number | null;
  counts: Record<string, number> | null;
  status: 'Idle' | 'NeverRun' | 'Failed';
  error: string | null;
  lastRunWasManual: boolean;
}

interface HealthData {
  systemStatus: string;
  uptimeSeconds: number;
  dbLatencyMs: number;
  activeUsersCount: number;
  memory: { rssMb: number; heapTotalMb: number; heapUsedMb: number };
  services: ServiceStatus[];
  jobs: BackgroundJob[];
  jobsNote?: string;
}

/**
 * System health, as the server reports it.
 *
 * This page used to invert its own purpose. When the API could not be reached
 * -- the one condition it exists to surface -- the catch block substituted a
 * fabricated payload: systemStatus "Operational", nine services all Healthy
 * with uptimes between 99.95% and 100%, and five background jobs idle and
 * recently run. An operator checking whether the platform was up was told it
 * was, *because* it was not.
 *
 * Several of those jobs were never built either, including a "ZATCA E-Invoice
 * XML Signer" for an integration that does not exist.
 *
 * Running a job had the same shape: a refusal was reported as "executed in
 * simulation mode", which reads as success.
 *
 * The server now reports only the two workers it genuinely starts, from what
 * they actually did, so this page shows a blank last run rather than filling
 * one in. The availability and response-time columns are gone with the numbers
 * that filled them: nothing here measures uptime, and printing 99.99% is what
 * made the absent monitoring look like present monitoring.
 */
const fmtDate = (d: string | null) => {
  if (!d) return null;
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' + dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return d; }
};

/** An em dash with the reason beside it, never a plausible-looking value. */
const notYet = (why: string) => (
  <span style={{ color: 'var(--ink-faint)' }}>— {why}</span>
);

const JOB_PILL: Record<string, [string, string]> = {
  Idle: ['var(--success)', 'var(--success-line)'],
  Failed: ['var(--danger)', 'var(--danger)'],
  NeverRun: ['var(--ink-muted)', 'var(--line)'],
};

const SystemHealthStatus: React.FC = () => {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [triggeringJobId, setTriggeringJobId] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/system/health');
      setData(res.data?.status === 'success' ? res.data : null);
      if (res.data?.status !== 'success') {
        setError('The health endpoint answered, but not with a healthy status.');
      }
    } catch (err) {
      // Unreachable is the finding, not a reason to invent one.
      setError(apiError(err, 'Could not reach the platform health endpoint.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHealth(); }, [loadHealth]);

  const handleRunJob = async (job: BackgroundJob) => {
    setTriggeringJobId(job.id);
    setError('');
    try {
      const res = await apiClient.post('/api/system/jobs/run', { jobId: job.id });
      const counts = res.data?.result?.counts as Record<string, number> | undefined;
      // What it changed, not that it was "triggered". A scan that found
      // nothing is a useful answer; "triggered successfully" is not an answer
      // at all, and was the wording used when nothing ran.
      const did = counts && Object.keys(counts).length
        ? Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')
        : 'nothing to action';
      setNotice(`${job.name}: ${did} (${res.data?.result?.durationMs ?? '?'} ms).`);
      await loadHealth();
    } catch (err) {
      setError(apiError(err, `Could not run "${job.name}".`));
    } finally {
      setTriggeringJobId(null);
    }
  };

  const services = data?.services || [];
  const jobs = data?.jobs || [];
  const dbLatency = data?.dbLatencyMs;
  const heapUsed = data?.memory?.heapUsedMb;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--ink)' }}>Health, Jobs & API Status</h2>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', marginTop: 4 }}>Real-time telemetry, API service health, background workers & database latency</div>
        </div>
        <button style={ghostBtn} onClick={loadHealth} disabled={loading}>↻ Refresh Status</button>
      </div>

      {notice && (
        <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success-line)', padding: 12, borderRadius: 6, color: 'var(--success)', marginBottom: 14, fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11 }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}

      {/* Every figure comes from the response, and shows an em dash when there
          is none. The previous version printed a literal "Operational (99.99%)"
          in the health slot, so the page asserted the platform was up even while
          failing to reach it. */}
      <StatStrip items={[
        ['System health', data
          ? <span style={{ color: data.systemStatus === 'Operational' ? 'var(--success)' : 'var(--warning)' }}>{data.systemStatus}</span>
          : <span style={{ color: 'var(--danger)' }}>Unreachable</span>],
        ['API services reporting', services.length],
        ['Database latency', dbLatency == null
          ? '—'
          : <span style={{ color: dbLatency < 5 ? 'var(--success)' : 'var(--warning)' }}>{dbLatency} ms</span>],
        ['Memory heap', heapUsed == null ? '—' : `${heapUsed} MB`],
      ]} />

      {/* Services Table */}
      <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>API surfaces in this build</h3>
      <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 8px' }}>
        That these routers are mounted is all the running process can tell you about
        them. Per-service response times and availability need a monitor watching from
        outside; this table used to print both as fixed numbers, unchanged even when
        the database was unreachable.
      </div>
      <div style={{ ...S.card, overflow: 'auto', marginBottom: 24 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={S.headRow}>
              <th style={S.th}>Service</th>
              <th style={S.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s, idx) => (
              <tr key={idx} style={S.bodyRow}>
                <td style={S.td}>
                  <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{s.name}</div>
                </td>
                <td style={S.td}>
                  <span style={pill('var(--ink-muted)', 'var(--line)')}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Background Jobs Table */}
      <h3 style={{ margin: '20px 0 10px', fontSize: 15, color: 'var(--ink)' }}>Background workers</h3>
      {data?.jobsNote && (
        <div style={{ fontSize: 12, color: 'var(--ink-muted)', margin: '0 0 8px' }}>{data.jobsNote}</div>
      )}
      <div style={{ ...S.card, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={S.headRow}>
              <th style={S.th}>Worker</th>
              <th style={S.th}>Schedule</th>
              <th style={S.th}>Last run</th>
              <th style={S.th}>Next run</th>
              <th style={S.th}>What it did</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Duration</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => {
              const [fg, line] = JOB_PILL[j.status] || JOB_PILL.NeverRun;
              return (
                <tr key={j.id} style={S.bodyRow}>
                  <td style={S.td}>
                    <div style={{ fontWeight: 500, color: 'var(--ink-body)' }}>{j.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{j.description}</div>
                    <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 2 }}>{j.id}</div>
                  </td>
                  <td style={S.td}>
                    <span style={pill(fg, line)}>{j.status === 'NeverRun' ? 'Not run yet' : j.status}</span>
                    <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{j.schedule}</div>
                  </td>
                  <td style={S.td}>
                    {fmtDate(j.lastRun) || notYet('not since restart')}
                    {j.lastRunWasManual && (
                      <div style={{ fontSize: 10, color: 'var(--ink-faint)' }}>run by hand</div>
                    )}
                  </td>
                  <td style={S.td}>{fmtDate(j.nextRun) || notYet('after its first run')}</td>
                  <td style={S.td}>
                    {j.error
                      ? <span style={{ color: 'var(--danger)' }}>{j.error}</span>
                      : j.counts
                        ? Object.entries(j.counts).map(([k, v]) => `${v} ${k}`).join(', ')
                        : notYet(j.measures.join(', '))}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {j.durationMs == null ? <span style={{ color: 'var(--ink-faint)' }}>—</span> : `${j.durationMs} ms`}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right' }}>
                    <button
                      style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }}
                      onClick={() => handleRunJob(j)}
                      disabled={triggeringJobId === j.id}
                    >
                      {triggeringJobId === j.id ? 'Running…' : '▶ Run now'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default SystemHealthStatus;
