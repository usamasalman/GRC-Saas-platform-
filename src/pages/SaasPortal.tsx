
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import StatCard from '../components/StatCard';

const SaasPortal = () => {
  return (
    <div className="app-shell">
      <Sidebar />
      
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Navbar />
        
        <main className="main" style={{ padding: '24px', background: 'var(--surface-sunk)', flex: 1 }}>
          <div className="content">
            <h2 style={{color: '#fff', marginBottom: '16px'}}>SaaS Admin Control Plane</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
              <StatCard label="Total Tenants" value="1,204" sub="14 new this week" trend="up" variant="good" />
              <StatCard label="Active Subscriptions" value="$84.5k" sub="MRR (USD)" trend="up" variant="good" />
              <StatCard label="System API Keys" value="8,401" sub="Across all partners" />
              <StatCard label="Critical Errors" value="3" sub="Needs attention" trend="down" variant="danger" />
            </div>

            <div style={{ background: 'var(--surface-sunk)', padding: '24px', borderRadius: '12px', color: '#fff' }}>
              <h3>Global Tenants Directory</h3>
              <p style={{color: 'var(--ink-muted)', marginTop: '8px'}}>Manage all provisioned organizations and their billing plans.</p>
              {/* Data table would go here */}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default SaasPortal;
