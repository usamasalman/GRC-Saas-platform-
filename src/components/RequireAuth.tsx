import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Route guard.
 *
 * Every protected route previously rendered for anyone who typed the URL —
 * /app, /db-console and /admin/password-resets were all reachable while signed
 * out. The API refused the requests, so the pages came up empty rather than
 * leaking data, but an authenticated-looking shell full of failed requests is
 * indistinguishable from a broken product.
 *
 * This is a usability and clarity control, not the security boundary. The real
 * boundary is server-side: requireAuth verifies the JWT signature and expiry,
 * and requireCapability re-reads the user's role from the database on every
 * request. A forged localStorage entry gets you a shell and nothing in it.
 */

interface Props {
  children: React.ReactElement;
  /** Require the platform control plane (SaaS tenant), e.g. for operator tools. */
  platformOnly?: boolean;
}

function readUser(): { portal?: string; role?: string } | null {
  try {
    const raw = localStorage.getItem('grc_user_json');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const RequireAuth: React.FC<Props> = ({ children, platformOnly = false }) => {
  const location = useLocation();
  const token = localStorage.getItem('grc_jwt_token');

  if (!token) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (platformOnly) {
    const user = readUser();
    if (user?.portal !== 'saas') {
      return <Navigate to="/app" replace />;
    }
  }

  return children;
};

export default RequireAuth;
