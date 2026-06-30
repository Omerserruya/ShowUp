import * as React from 'react';
import AppAppBar from '../components/AppAppBar';
import Hero from '../components/Hero';
import HowItWorks from '../components/HowItWorks';
import Assistant from '../components/Assistant';
import WhatYouGet from '../components/WhatYouGet';
import Pricing from '../components/Pricing';
import FAQ from '../components/FAQ';
import ClosingCTA from '../components/ClosingCTA';
import Footer from '../components/Footer';

/**
 * Landing page. Funnel order tells a story: hook (Hero) → the modern way
 * (HowItWorks feature scenes) → the differentiator (Assistant - manage the event
 * by talking) → decision (Pricing) → objections (FAQ) → final ask (ClosingCTA).
 * No dividers between sections - backgrounds flow so it reads as one long page.
 * The page inherits the global unified theme (color-mode toggle too).
 */
export default function MarketingPage() {
  return (
    <>
      <AppAppBar />
      <Hero />
      <div>
        <WhatYouGet />
        <HowItWorks />
        <Assistant />
        <Pricing />
        <FAQ />
        <ClosingCTA />
        <Footer />
      </div>
    </>
  );
}
