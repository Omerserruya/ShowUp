import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop component that will reset the scroll position when
 * the route changes. This helps ensure that when navigating between 
 * pages, the user always starts at the top of the new page.
 */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // Reset scroll position to top whenever the path changes
    window.scrollTo(0, 0);
  }, [pathname]);

  return null; // This component doesn't render anything
}

export default ScrollToTop; 