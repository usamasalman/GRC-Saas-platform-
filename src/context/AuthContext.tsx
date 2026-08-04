import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export interface UserContext {
  id: string;
  email: string;
  name: string;
  role: string;
  profile?: string;
  context?: string;
  branch?: string;
  department?: string;
  status: string;
  tenantId: string;
  portal?: string;
  scope?: string;
  mfaEnabled?: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  role: string | null;
  tenantId: string | null;
  user: UserContext | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  login: (token: string, user: UserContext) => void;
  logout: () => void;
  verifySession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    token: null,
    role: null,
    tenantId: null,
    user: null,
    loading: true
  });

  const verifySession = async () => {
    const storedToken = localStorage.getItem('grc_jwt_token');
    const storedUser = localStorage.getItem('grc_user_json');

    if (!storedToken) {
      setAuthState(prev => ({ ...prev, isAuthenticated: false, loading: false }));
      return;
    }

    try {
      if (storedUser) {
        const parsedUser: UserContext = JSON.parse(storedUser);
        setAuthState({
          isAuthenticated: true,
          token: storedToken,
          role: parsedUser.role,
          tenantId: parsedUser.tenantId,
          user: parsedUser,
          loading: false
        });
      }

      const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
      const res = await fetch(`${apiBase}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${storedToken}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status === 'success' && data.user) {
          localStorage.setItem('grc_user_json', JSON.stringify(data.user));
          setAuthState({
            isAuthenticated: true,
            token: storedToken,
            role: data.user.role,
            tenantId: data.user.tenantId,
            user: data.user,
            loading: false
          });
        }
      } else {
        logout();
      }
    } catch (e) {
      if (storedUser) {
        const parsedUser: UserContext = JSON.parse(storedUser);
        setAuthState({
          isAuthenticated: true,
          token: storedToken,
          role: parsedUser.role,
          tenantId: parsedUser.tenantId,
          user: parsedUser,
          loading: false
        });
      } else {
        setAuthState(prev => ({ ...prev, loading: false }));
      }
    }
  };

  useEffect(() => {
    verifySession();
  }, []);

  const login = (token: string, user: UserContext) => {
    localStorage.setItem('grc_jwt_token', token);
    localStorage.setItem('grc_user_role', user.role);
    localStorage.setItem('grc_tenant_id', user.tenantId);
    localStorage.setItem('grc_user_json', JSON.stringify(user));
    
    setAuthState({
      isAuthenticated: true,
      token,
      role: user.role,
      tenantId: user.tenantId,
      user,
      loading: false
    });
  };

  const logout = () => {
    localStorage.removeItem('grc_jwt_token');
    localStorage.removeItem('grc_user_role');
    localStorage.removeItem('grc_tenant_id');
    localStorage.removeItem('grc_user_json');
    
    setAuthState({
      isAuthenticated: false,
      token: null,
      role: null,
      tenantId: null,
      user: null,
      loading: false
    });
  };

  return (
    <AuthContext.Provider value={{ ...authState, login, logout, verifySession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
