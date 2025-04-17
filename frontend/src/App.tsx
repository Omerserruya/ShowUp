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
import About from './pages/About';
import Settings from './pages/Settings';
import Terms from './pages/Terms';
import Privacy from './pages/Privacy';
import Users from './pages/admin/Users';
import Events from './pages/admin/Events';
import Purchases from './pages/admin/Purchases';
import AdminSettings from './pages/admin/AdminSettings';
import { AccountProvider } from './contexts/AccountContext';

function App() {
  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl');
  }, []);

  return (
    <ThemeProvider>
      <AccountProvider>
        <UserProvider>
          <EventProvider>
            <SearchProvider>
              <ScrollToTop />
              <Routes>
                {/* Auth routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/oauth/callback" element={<OAuthCallback />} />
                <Route path="/" element={<MarketingPage />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy" element={<Privacy />} />
                
                {/* Main routes */}
                <Route element={<Layout />}>
                  <Route path="/overview" element={<Overview />} />
                  <Route path="/guests" element={<Guests />} />
                  <Route path="/messages" element={<Messages />} />
                  <Route path="/seating" element={<Seating />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/settings" element={<Settings />} />
                  
                  {/* Admin routes */}
                  <Route path="/admin/users" element={<Users />} />
                  <Route path="/admin/events" element={<Events />} />
                  <Route path="/admin/purchases" element={<Purchases />} />
                  <Route path="/admin/settings" element={<AdminSettings />} />
                </Route>
              </Routes>
            </SearchProvider>
          </EventProvider>
        </UserProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}

export default App;