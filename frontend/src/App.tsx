import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
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
import Seating from './pages/Seating';
import Profile from './pages/Profile';
import Login from './pages/Login';
import Register from './pages/Register';
import MarketingPage from './pages/MarketingPage';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import AccessibilityStatement from './pages/AccessibilityStatement';
import EventWizard from './pages/EventWizard';

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  return (
    <ThemeProvider>
        <Routes>
                <Route path="/" element={<MarketingPage />} />
        <Route 
          path="/wizard" 
          element={
            <UserProvider>
              <EventWizard />
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
          <Route path="/home" element={<Home />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/guests" element={<Guests />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/seating" element={<Seating />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        </Routes>
    </ThemeProvider>
  );
}

export default App;