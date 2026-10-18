import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, useAuth } from './auth/AuthContext.jsx';
import { AppShell } from './components/AppShell.jsx';
import { FullPageSpinner } from './components/ui.jsx';

// Route-level code splitting keeps the initial bundle small.
const LoginPage = lazy(() => import('./pages/Login.jsx'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPassword.jsx'));
const OnboardingPage = lazy(() => import('./pages/Onboarding.jsx'));
const DashboardPage = lazy(() => import('./pages/Dashboard.jsx'));
const OpportunitiesPage = lazy(() => import('./pages/Opportunities.jsx'));
const OpportunityDetailPage = lazy(() => import('./pages/OpportunityDetail.jsx'));
const InboxPage = lazy(() => import('./pages/Inbox.jsx'));
const NegotiationsPage = lazy(() => import('./pages/Negotiations.jsx'));
const NegotiationPage = lazy(() => import('./pages/Negotiation.jsx'));
const ApprovalsPage = lazy(() => import('./pages/Approvals.jsx'));
const CampaignsPage = lazy(() => import('./pages/Campaigns.jsx'));
const CampaignDetailPage = lazy(() => import('./pages/CampaignDetail.jsx'));
const SettingsPage = lazy(() => import('./pages/Settings.jsx'));
const ActivityPage = lazy(() => import('./pages/Activity.jsx'));

function PublicOnly({ children }) {
  const { user, loading, redirectTo } = useAuth();
  if (loading) return <FullPageSpinner />;
  return user ? <Navigate to={redirectTo() || '/dashboard'} replace /> : children;
}

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/onboarding" element={<RequireAuth><OnboardingPage /></RequireAuth>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/opportunities/:id" element={<OpportunityDetailPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/negotiations" element={<NegotiationsPage />} />
          <Route path="/negotiations/:id" element={<NegotiationPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
