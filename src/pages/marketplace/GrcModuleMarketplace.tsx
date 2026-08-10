import React, { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api/apiClient';
import { S, StatStrip, primaryBtn, ghostBtn, pill, apiError } from '../iam/iamStyles';

interface GrcModule {
  id: string;
  name: string;
  category: string;
  maturity: string;
  readinessPhase: string;
  commercialModel: string;
  description: string;
  dependencies: string[];
  status: string;
  config: Record<string, any>;
}

const GrcModuleMarketplace: React.FC = () => {
  const [modules, setModules] = useState<GrcModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState<GrcModule | null>(null);
  
  // Add module form state
  const [newModName, setNewModName] = useState('');
  const [newModCat, setNewModCat] = useState('Core GRC');
  const [newModModel, setNewModModel] = useState('Entitled');
  const [newModDesc, setNewModDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiClient.get('/api/marketplace/modules', {
        params: { search, category: categoryFilter }
      });
      setModules(res.data?.modules || []);
    } catch (err: any) {
      setError(apiError(err, 'Failed to load GRC modules catalog'));
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newModName.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post('/api/marketplace/modules', {
        name: newModName.trim(),
        category: newModCat,
        commercialModel: newModModel,
        description: newModDesc.trim()
      });
      setNotice(res.data?.message || `Module "${newModName}" added successfully.`);
      setNewModName('');
      setNewModDesc('');
      setModalOpen(false);
      await loadModules();
    } catch (err: any) {
      alert(apiError(err, 'Failed to create module'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleMaturity = async (mod: GrcModule) => {
    const nextMaturity = mod.maturity === 'Released' ? 'Beta' : mod.maturity === 'Beta' ? 'Planned' : 'Released';
    try {
      const res = await apiClient.patch(`/api/marketplace/modules/${mod.id}`, { maturity: nextMaturity });
      setNotice(res.data?.message || `Updated ${mod.name} to ${nextMaturity}`);
      await loadModules();
    } catch (err: any) {
      alert(apiError(err, 'Failed to update module configuration'));
    }
  };

  const releasedCount = modules.filter(m => m.maturity === 'Released').length;
  const betaCount = modules.filter(m => m.maturity === 'Beta').length;
  const categories = Array.from(new Set(modules.map(m => m.category)));

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: '#f1f5f9' }}>GRC Module Marketplace</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#64748b' }}>
            Govern product modules, maturity status, dependencies, packaging and controlled add-on activation.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setModalOpen(true)} style={primaryBtn()}>+ Register Module</button>
          <button onClick={loadModules} style={ghostBtn}>↻ Refresh</button>
        </div>
      </div>

      <StatStrip items={[
        ['Total Modules', modules.length],
        ['General Availability', <span style={{ color: '#86efac' }}>{releasedCount}</span>],
        ['Beta / Controlled', <span style={{ color: '#fbbf24' }}>{betaCount}</span>],
        ['Commercial Entitled', modules.filter(m => m.commercialModel === 'Entitled').length],
      ]} />

      {error && <div style={S.error}>{error}</div>}
      {notice && (
        <div style={{ background: '#0e2a1e', border: '1px solid #14532d', padding: 10, borderRadius: 6, color: '#86efac', marginBottom: 14, fontSize: 12 }}>
          {notice}
        </div>
      )}

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search modules by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...S.input, maxWidth: 320 }}
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...S.input, maxWidth: 200 }}
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', padding: 30 }}>Loading module catalog...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 14 }}>
          {modules.map((m) => (
            <div key={m.id} style={{ ...S.card, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 10, color: '#38bdf8', background: '#0c4a6e', padding: '2px 6px', borderRadius: 4 }}>{m.category}</span>
                  {m.maturity === 'Released' && <span style={pill('#86efac', '#15803d')}>GA Released</span>}
                  {m.maturity === 'Beta' && <span style={pill('#fbbf24', '#b45309')}>Beta</span>}
                  {m.maturity === 'Planned' && <span style={pill('#94a3b8', '#334155')}>Planned</span>}
                </div>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, color: '#f8fafc' }}>{m.name}</h3>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{m.description}</p>
              </div>

              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <span style={{ fontSize: 11, background: '#1e293b', color: '#cbd5e1', padding: '2px 8px', borderRadius: 4 }}>
                    Model: {m.commercialModel}
                  </span>
                  <span style={{ fontSize: 11, background: '#1e293b', color: '#cbd5e1', padding: '2px 8px', borderRadius: 4 }}>
                    {m.readinessPhase}
                  </span>
                </div>

                {m.dependencies && m.dependencies.length > 0 && (
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
                    Dependencies: {m.dependencies.join(', ')}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  <button
                    onClick={() => setSelectedModule(m)}
                    style={{ ...ghostBtn, fontSize: 11, padding: '5px 10px', flex: 1 }}
                  >
                    View Config
                  </button>
                  <button
                    onClick={() => handleToggleMaturity(m)}
                    style={{ ...ghostBtn, fontSize: 11, padding: '5px 10px', color: '#38bdf8', borderColor: '#0284c7' }}
                  >
                    Maturity: {m.maturity}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for adding new module */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 480, padding: 24 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, color: '#f1f5f9' }}>Register New GRC Module</h3>
            <form onSubmit={handleAddModule}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Module Name</label>
                <input
                  type="text"
                  required
                  value={newModName}
                  onChange={(e) => setNewModName(e.target.value)}
                  placeholder="e.g. AI Regulatory Intelligence"
                  style={S.input}
                />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Category</label>
                <select value={newModCat} onChange={(e) => setNewModCat(e.target.value)} style={S.input}>
                  <option value="Core GRC">Core GRC</option>
                  <option value="Assurance">Assurance</option>
                  <option value="Security Services">Security Services</option>
                  <option value="Service Management">Service Management</option>
                  <option value="Intelligence">Intelligence</option>
                  <option value="Commercial">Commercial</option>
                </select>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Commercial Model</label>
                <select value={newModModel} onChange={(e) => setNewModModel(e.target.value)} style={S.input}>
                  <option value="Entitled">Entitled (Included in base plan)</option>
                  <option value="Add-on">Add-on (Optional subscription module)</option>
                  <option value="Enterprise">Enterprise Only</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Description</label>
                <textarea
                  rows={3}
                  value={newModDesc}
                  onChange={(e) => setNewModDesc(e.target.value)}
                  placeholder="Describe module business purpose and governed capability..."
                  style={{ ...S.input, height: 'auto' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setModalOpen(false)} style={ghostBtn}>Cancel</button>
                <button type="submit" disabled={submitting} style={primaryBtn(submitting)}>
                  {submitting ? 'Registering...' : 'Register Module'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal for viewing module configuration */}
      {selectedModule && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ ...S.card, width: '100%', maxWidth: 520, padding: 24 }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, color: '#f1f5f9' }}>{selectedModule.name}</h3>
            <div style={{ fontSize: 12, color: '#38bdf8', marginBottom: 12 }}>{selectedModule.id} · {selectedModule.category}</div>
            
            <div style={{ background: '#0b1220', padding: 12, borderRadius: 6, border: '1px solid #1e293b', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>Description:</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{selectedModule.description}</div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>Module Parameters:</div>
              <pre style={{ background: '#090d16', padding: 12, borderRadius: 6, color: '#a5f3fc', fontSize: 11, overflowX: 'auto' }}>
                {JSON.stringify(selectedModule.config, null, 2)}
              </pre>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedModule(null)} style={primaryBtn()}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GrcModuleMarketplace;
