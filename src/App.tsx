import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import PortalDirectory from './pages/PortalDirectory';
import PortalLogin from './pages/PortalLogin';
import AppShell from './pages/AppShell';
import DbConsole from './pages/DbConsole';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import AdminPasswordResets from './pages/AdminPasswordResets';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PortalDirectory />} />
        <Route path="/login/:portalId" element={<PortalLogin />} />
        <Route path="/app/*" element={<AppShell />} />
        <Route path="/db-console" element={<DbConsole />} />

        {/* Password lifecycle */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/change-password" element={<ChangePassword />} />

        {/* Admin approval inbox */}
        <Route path="/admin/password-resets" element={<AdminPasswordResets />} />

        {/* Fallback routing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
