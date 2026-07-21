import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { UserProvider } from './contexts/UserContext';
import { EventProvider } from './contexts/EventContext';
import { AccountProvider } from './contexts/AccountContext';
import ThemeProvider from './theme/ThemeProvider';
import Layout from './components/Layout';
import InactiveEventBanner from './components/InactiveEventBanner';
import { BannerProvider } from './contexts/BannerContext';
import Overview from './pages/Overview';
import Guests from './pages/Guests';
import Messages from './pages/Messages';
import Recap from './pages/Recap';
import Seating from './pages/Seating';
import Settings from './pages/Settings';
import { ImportedGuestsReviewScreen } from './components/ImportedGuestsReviewScreen';
import Login from './pages/Login';
import Register from './pages/Register';
import MarketingPage from './pages/MarketingPage';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import AccessibilityStatement from './pages/AccessibilityStatement';
import EventWizard from './pages/EventWizard';
import Payment from './pages/Payment';
import Invitation from './pages/Invitation';
import PublicInvitation from './pages/PublicInvitation';
import DemoInvite from './pages/DemoInvite';
import Redeem from './pages/Redeem';
import WhatsAppRedirect from './pages/WhatsAppRedirect';
import AdminRoute from './components/AdminRoute';
import AdminUsers from './pages/admin/Users';
import AdminEvents from './pages/admin/Events';
import AdminSystemDashboard from './pages/admin/SystemDashboard';
import AdminVenues from './pages/admin/Venues';
import AdminSubscriptions from './pages/admin/Subscriptions';
import AdminCoupons from './pages/admin/Coupons';
import AdminPlans from './pages/admin/Plans';
import AdminEntitlements from './pages/admin/Entitlements';
import AdminFeatureFlags from './pages/admin/FeatureFlags';
import AdminMonitoring from './pages/admin/Monitoring';
import AdminOperations from './pages/admin/Operations';
import AdminAuditLog from './pages/admin/AuditLog';
import VenueRoute from './components/VenueRoute';
import VenueDashboard from './pages/venue/VenueDashboard';
import VenueSettings from './pages/venue/VenueSettings';

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  return (
    <ThemeProvider>
        <Routes>
                <Route path="/" element={<MarketingPage />} />
        {/* Public web invitation + open-form RSVP (no auth, no Layout) */}
        <Route path="/i/:slug" element={<PublicInvitation />} />
        {/* Public no-auth demo invitation (landing-page demo CTA target) */}
        <Route path="/demo/invite" element={<DemoInvite />} />
        {/* Public entitlement redemption link (works logged-out) */}
        <Route
          path="/redeem/:code"
          element={
            <UserProvider>
              <Redeem />
            </UserProvider>
          }
        />
        <Route path="/go/whatsapp" element={<WhatsAppRedirect />} />
        <Route 
          path="/wizard" 
          element={
            <UserProvider>
              <EventWizard />
            </UserProvider>
          } 
        />
        <Route
          path="/payment"
          element={
            <UserProvider>
              <Payment />
            </UserProvider>
          }
        />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/accessibility" element={<AccessibilityStatement />} />
        <Route 
          path="/login" 
          element={
            <UserProvider>
              <Login />
            </UserProvider>
          } 
        />
        <Route 
          path="/register" 
          element={
            <UserProvider>
              <Register />
            </UserProvider>
          } 
        />
        {/* Protected routes with Layout */}
        <Route 
          element={
            <UserProvider>
              <AccountProvider>
                <EventProvider>
                  <BannerProvider>
                    {/* Inactive Event Banner - Full width, above everything (fixed position) */}
                    <InactiveEventBanner />
                    <Layout />
                  </BannerProvider>
                </EventProvider>
              </AccountProvider>
            </UserProvider>
          } 
        >
          <Route path="/overview" element={<Overview />} />
          <Route path="/invitation" element={<Invitation />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/guests/imported" element={<ImportedGuestsReviewScreen />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/recap" element={<Recap />} />
          <Route path="/seating" element={<Seating />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/venue" element={<VenueRoute><VenueDashboard /></VenueRoute>} />
          <Route path="/venue/settings" element={<VenueRoute><VenueSettings /></VenueRoute>} />
          {/* Unified into /settings - keep old paths working as redirects */}
          <Route path="/profile" element={<Navigate to="/settings?tab=profile" replace />} />
          <Route path="/team" element={<Navigate to="/settings?tab=team" replace />} />
          <Route path="/billing" element={<Navigate to="/settings?tab=billing" replace />} />
          <Route path="/admin" element={<AdminRoute><AdminSystemDashboard /></AdminRoute>} />
          <Route path="/admin/venues" element={<AdminRoute><AdminVenues /></AdminRoute>} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
          <Route path="/admin/events" element={<AdminRoute><AdminEvents /></AdminRoute>} />
          <Route path="/admin/subscriptions" element={<AdminRoute><AdminSubscriptions /></AdminRoute>} />
          <Route path="/admin/plans" element={<AdminRoute><AdminPlans /></AdminRoute>} />
          <Route path="/admin/entitlements" element={<AdminRoute><AdminEntitlements /></AdminRoute>} />
          <Route path="/admin/coupons" element={<AdminRoute><AdminCoupons /></AdminRoute>} />
          <Route path="/admin/feature-flags" element={<AdminRoute><AdminFeatureFlags /></AdminRoute>} />
          <Route path="/admin/monitoring" element={<AdminRoute><AdminMonitoring /></AdminRoute>} />
          <Route path="/admin/operations" element={<AdminRoute><AdminOperations /></AdminRoute>} />
          <Route path="/admin/audit-log" element={<AdminRoute><AdminAuditLog /></AdminRoute>} />
        </Route>
        </Routes>
    </ThemeProvider>
  );
}

export default App;