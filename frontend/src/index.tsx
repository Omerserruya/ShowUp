import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@fontsource/roboto';
import { BrowserRouter } from 'react-router-dom';
import { initObservability, Sentry } from './observability';

// Arm Sentry before anything renders so early errors are captured.
initObservability();

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