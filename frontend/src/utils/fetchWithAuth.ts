/**
 * Helper function to make authenticated fetch requests
 * Automatically includes the JWT token from localStorage
 */
export const fetchWithAuth = async (
  url: string,
  options: RequestInit = {}
): Promise<Response> => {
  const token = localStorage.getItem('access_token') || localStorage.getItem('token');
  
  const headers = new Headers(options.headers || {});
  
  // Set Content-Type if not already set
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  
  // Add Authorization header if token exists
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  
  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
};

