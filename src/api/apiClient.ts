import axios from 'axios';

const getBaseURL = () => {
  if (import.meta.env.VITE_API_BASE_URL) return import.meta.env.VITE_API_BASE_URL;
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return '';
  }
  return 'http://localhost:3000';
};

// Create a centralized Axios client
const apiClient = axios.create({
  baseURL: getBaseURL(),
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request Interceptor: attach the active JWT.
// An impersonation token takes precedence so the whole app renders the
// customer's view; callers that must act as the real operator (e.g. ending a
// session) pass an explicit Authorization header, which is respected.
apiClient.interceptors.request.use((config) => {
  if (config.headers.Authorization) return config;
  const token = localStorage.getItem('grc_imp_token') || localStorage.getItem('grc_jwt_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

/** Axios config that forces the operator's own token, ignoring impersonation. */
export const asOperator = () => {
  const token = localStorage.getItem('grc_jwt_token');
  return { headers: { Authorization: `Bearer ${token}` } };
};

/**
 * Renew a 15-minute access token using the refresh token stored at login.
 *
 * The endpoint has existed the whole time and nothing ever called it, so a
 * session simply died after fifteen minutes: the next request 401ed, the
 * interceptor deleted the token and left the user on a page that could no
 * longer talk to anything. Every subsequent click reported "invalid or expired
 * token", which reads as a fault rather than as having been signed out.
 *
 * A single in-flight promise is shared, because a screen that fires four
 * requests at once would otherwise start four refreshes, and each new refresh
 * token invalidates the last — three of the four would fail and sign the user
 * out for having too much on screen.
 */
let refreshing: Promise<string | null> | null = null;

const renewAccessToken = (): Promise<string | null> => {
  if (refreshing) return refreshing;

  const refreshToken = localStorage.getItem('grc_refresh_token');
  if (!refreshToken) return Promise.resolve(null);

  refreshing = axios
    .post(`${getBaseURL()}/api/auth/refresh`, { refreshToken })
    .then((res) => {
      const next = res.data?.token;
      if (!next) return null;
      localStorage.setItem('grc_jwt_token', next);
      // The server rotates both, and keeping the old one would fail the next
      // renewal — the whole point of rotation is that it is single-use.
      if (res.data?.refreshToken) {
        localStorage.setItem('grc_refresh_token', res.data.refreshToken);
      }
      return next as string;
    })
    .catch(() => null)
    .finally(() => { refreshing = null; });

  return refreshing;
};

/** Clear the session and send the user somewhere they can do something about it. */
const endSession = () => {
  localStorage.removeItem('grc_jwt_token');
  localStorage.removeItem('grc_refresh_token');
  localStorage.removeItem('grc_imp_token');
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login?expired=1';
  }
};

// Response Interceptor: renew a merely-expired session once, then replay.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const original = error.config;
    const url: string = original?.url || '';

    if (status !== 401 || url.includes('/api/auth/login') || url.includes('/api/auth/refresh')) {
      return Promise.reject(error);
    }

    // The tenant is gone, not the token. Renewing would mint another token
    // naming the same dead organisation, so this one goes straight to sign-in.
    if (error.response?.data?.code === 'STALE_TENANT') {
      endSession();
      return Promise.reject(error);
    }

    // Impersonation failures are their own thing and must not be papered over
    // by renewing the operator's token underneath them.
    const impCode = String(error.response?.data?.code || '');
    if (impCode.startsWith('IMPERSONATION_')) return Promise.reject(error);

    // Once only. A request that 401s again after a fresh token is not an
    // expiry problem, and retrying it forever would hide whatever it is.
    if (original?._retried) {
      endSession();
      return Promise.reject(error);
    }

    const renewed = await renewAccessToken();
    if (!renewed) {
      endSession();
      return Promise.reject(error);
    }

    original._retried = true;
    original.headers = { ...(original.headers || {}), Authorization: `Bearer ${renewed}` };
    return apiClient(original);
  }
);

export default apiClient;
