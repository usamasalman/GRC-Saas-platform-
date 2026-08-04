

const Sidebar = () => {
  return (
    <aside className="sidebar" id="sidebar">
      <div className="side-brand">
        <div className="brand">
          <div className="brand-mark"><span>GW</span></div>
          <div><span className="brand-text">GRC Wisdom</span></div>
        </div>
      </div>
      
      <div className="side-context">
        <div className="context-label">Active workspace</div>
        <div className="context-name" id="contextName">GRC Demo</div>
        <div className="context-scope" id="contextScope">Global</div>
        <span className="context-pill" id="contextRole">Admin</span>
      </div>

      <nav className="nav" id="nav">
        {/* Navigation items will go here dynamically based on role */}
        <a href="/dashboard" className="nav-item active">Dashboard</a>
      </nav>

      <div className="side-footer">
        <button className="nav-item" id="helpBtn">
          <span className="nav-ico">?</span>
          <span>Help Center</span>
        </button>
        <button className="nav-item" id="switchBtn">
          <span className="nav-ico">⇄</span>
          <span>Switch login portal</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
