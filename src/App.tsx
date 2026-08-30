import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Setup from './pages/Setup';
import AppShell from './pages/AppShell';
import DbConsole from './pages/DbConsole';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import AdminPasswordResets from './pages/AdminPasswordResets';
import RequireAuth from './components/RequireAuth';

/**
 * The former landing page was a directory of eight demo portals ("35 demo
 * identities", "working prototype"). There is now one way in: / redirects to
 * /login, and which workspace you get is decided by your account.
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />

        {/* Old per-portal login URLs still exist in bookmarks and links. */}
        <Route path="/login/:portalId" element={<Navigate to="/login" replace />} />

        <Route
          path="/app/*"
          element={<RequireAuth><AppShell /></RequireAuth>}
        />

        {/* Raw table access. The API also enforces platform tenancy plus the
            monitor-security capability; this only stops the page rendering. */}
        <Route
          path="/db-console"
          element={<RequireAuth platformOnly><DbConsole /></RequireAuth>}
        />

        {/* Password lifecycle — reachable while signed out by design. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/change-password" element={<ChangePassword />} />

        <Route
          path="/admin/password-resets"
          element={<RequireAuth><AdminPasswordResets /></RequireAuth>}
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
