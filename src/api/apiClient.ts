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

// Response Interceptor: Handle global errors without breaking application state
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/api/auth/login')) {
      console.warn('[ApiClient]: 401 Unauthorized encountered for URL:', error.config?.url);
      localStorage.removeItem('grc_jwt_token');
    }
    return Promise.reject(error);
  }
);

export default apiClient;
