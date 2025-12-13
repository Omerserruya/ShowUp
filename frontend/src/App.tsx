import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { UserProvider } from './contexts/UserContext';
import { EventProvider } from './contexts/EventContext';
import ThemeProvider from './theme/ThemeProvider';
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
        </Routes>
    </ThemeProvider>
  );
}

export default App;