import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/roboto';
import './design/global.css';
import { BrowserRouter } from 'react-router-dom';
import { initObservability, Sentry } from './observability';
import { armPushTaps, armSessionRenewal } from './native/app';

// Arm Sentry before anything renders so early errors are captured.
initObservability();
// Inside the mobile app, a tap on a notification opens its page.
armPushTaps();
// Inside the mobile app, stay signed in (the token renews on every open).
armSessionRenewal();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 24 }}>משהו השתבש. רעננו את הדף 🙏</div>}>
      <BrowserRouter basename="/">
        <App />
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
); 