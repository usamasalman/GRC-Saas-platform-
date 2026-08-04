

const Navbar = () => {
  return (
    <header className="topbar">
      <button className="menu-btn" id="menuBtn">☰</button>
      <div className="page-title" id="pageTitle">Dashboard</div>
      <div className="top-search">
        <span>⌕</span>
        <input id="globalSearch" placeholder="Search records, documents, controls and users…" />
      </div>
      <div className="top-actions">
        <button className="icon-btn" id="langBtn" title="English / العربية">EN</button>
        <button className="icon-btn" id="notifyBtn" title="Notifications">
          ♢<i className="notification-dot"></i>
        </button>
        <div className="persona">
          <div className="persona-avatar" id="personaAvatar">U</div>
          <div>
            <strong id="personaName">Admin User</strong>
            <small id="personaRole">SaaS Admin</small>
          </div>
        </div>
        <button className="logout-btn" id="logoutBtn">Logout</button>
      </div>
    </header>
  );
};

export default Navbar;
