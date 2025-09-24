import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import { EventProvider } from './contexts/EventContext';
import ThemeProvider from './theme/ThemeProvider';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import OAuthCallback from './components/OAuthCallback';
import ScrollToTop from './components/ScrollToTop';
import { SearchProvider } from './contexts/SearchContext';
import MarketingPage from './pages/MarketingPage';
import Overview from './pages/Overview';
import Guests from './pages/Guests';
import Messages from './pages/Messages';
import Seating from './pages/Seating';
import Profile from './pages/Profile';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import AccessibilityStatement from './pages/AccessibilityStatement';
import Users from './pages/admin/Users';
import Events from './pages/admin/Events';
import Purchases from './pages/admin/Purchases';
import AdminSettings from './pages/admin/AdminSettings';
import { AccountProvider } from './contexts/AccountContext';
import AccessibilityMenu from './components/AccessibilityMenu';
import CookieConsent from './components/CookieConsent';

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  return (
    <ThemeProvider>
        <Routes>
                <Route path="/" element={<MarketingPage />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/accessibility" element={<AccessibilityStatement />} />
        </Routes>
    </ThemeProvider>
  );
}

export default App;