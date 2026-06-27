import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import { UserProvider } from './contexts/UserContext';
import { EventProvider } from './contexts/EventContext';
import { AccountProvider } from './contexts/AccountContext';
import { SearchProvider } from './contexts/SearchContext';
import ThemeProvider from './theme/ThemeProvider';
import Layout from './components/Layout';
import InactiveEventBanner from './components/InactiveEventBanner';
import { BannerProvider } from './contexts/BannerContext';
import Home from './pages/Home';
import Overview from './pages/Overview';
import Guests from './pages/Guests';
import Messages from './pages/Messages';
import Templates from './pages/Templates';
import Team from './pages/Team';
import Billing from './pages/Billing';
import Recap from './pages/Recap';
import Seating from './pages/Seating';
import Profile from './pages/Profile';
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
import AdminRoute from './components/AdminRoute';
import AdminUsers from './pages/admin/Users';
import AdminEvents from './pages/admin/Events';

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
                  <SearchProvider>
                      {/* Inactive Event Banner - Full width, above everything (fixed position) */}
                      <InactiveEventBanner />
                    <Layout />
                  </SearchProvider>
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
          <Route path="/templates" element={<Templates />} />
          <Route path="/team" element={<Team />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/recap" element={<Recap />} />
          <Route path="/seating" element={<Seating />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin/users" element={<AdminRoute><AdminUsers /></AdminRoute>} />
          <Route path="/admin/events" element={<AdminRoute><AdminEvents /></AdminRoute>} />
          <Route path="/admin/purchases" element={<AdminRoute><Box sx={{ p: 4 }}><Typography variant="h5">רכישות ובילינג - בקרוב</Typography></Box></AdminRoute>} />
          <Route path="/admin/settings" element={<AdminRoute><Box sx={{ p: 4 }}><Typography variant="h5">הגדרות מערכת - בקרוב</Typography></Box></AdminRoute>} />
        </Route>
        </Routes>
    </ThemeProvider>
  );
}

export default App;