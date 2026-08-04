import { useState } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from '../context/AuthContext';

const LoginGateway = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const response = await apiClient.post('/api/auth/login', { email, password });
      
      if (response.data.status === 'success') {
        const { token, user } = response.data;
        
        login(token, user);
        
        if (user.role === 'SAAS_ADMIN' || user.role === 'Platform Super Admin') window.location.href = '/saas';
        else if (user.role === 'HOLDING_ADMIN' || user.role === 'Group Admin') window.location.href = '/holding';
        else if (user.role === 'BRANCH_MANAGER' || user.role === 'Branch Admin') window.location.href = '/branch';
        else if (user.role === 'PARTNER_ADMIN' || user.role === 'Partner Owner') window.location.href = '/partner';
        else window.location.href = '/document';
      }
    } catch (error: any) {
      setErrorMsg(error.response?.data?.message || 'Login failed. Please check your credentials.');
    }
  };

  return (
    <div className="login-directory">
      <div className="directory-shell">
        <header className="dir-header">
          <div className="brand">
            <div className="brand-mark"><span>GW</span></div>
            <div>
              <span className="brand-text" style={{color: '#fff'}}>GRC Wisdom</span>
              <span className="brand-sub">Multi-Layer Login Directory</span>
            </div>
          </div>
        </header>

        <main className="dir-grid">
          <form className="login-form" style={{background: '#1a1a2e', padding: '24px', borderRadius: '12px'}} onSubmit={handleLogin}>
            <h2 style={{color: '#fff', marginBottom: '16px'}}>Gateway Login</h2>
            {errorMsg && <div style={{color: '#ef4444', marginBottom: '12px', fontSize: '14px'}}>{errorMsg}</div>}
            <div className="field">
              <label style={{color: '#94a3b8'}}>Email address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label style={{color: '#94a3b8'}}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <button className="login-submit" type="submit" style={{width: '100%', marginTop: '12px'}}>
              Secure Login
            </button>
          </form>
        </main>
      </div>
    </div>
  );
};

export default LoginGateway;
