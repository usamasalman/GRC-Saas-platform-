import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface PortalGuardProps {
  allowedRoles: string[];
}

const PortalGuard: React.FC<PortalGuardProps> = ({ allowedRoles }) => {
  const { isAuthenticated, role } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // If the user's role is not in the allowed list for this route, kick them out
  if (!allowedRoles.includes(role || '') && !allowedRoles.includes('ALL')) {
    return <Navigate to="/unauthorized" replace />;
  }

  // If authorized, render the child routes (the actual Dashboard)
  return <Outlet />;
};

export default PortalGuard;
