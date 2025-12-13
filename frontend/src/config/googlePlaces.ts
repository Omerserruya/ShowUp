// Google Places API Configuration
// @ts-ignore - Type definitions may not be available immediately after install
import { Loader } from '@googlemaps/js-api-loader';

export const GOOGLE_PLACES_API_KEY = process.env.REACT_APP_GOOGLE_PLACES_API_KEY || '';

let loaderInstance: Loader | null = null;
let isLoaded = false;

// Function to load Google Places API script dynamically using the new API loader
export const loadGooglePlacesScript = async (callback: () => void) => {
  // Check if script is already loaded
  if (window.google && window.google.maps && window.google.maps.places) {
    callback();
    return;
  }

  if (isLoaded) {
    callback();
    return;
  }

  if (!GOOGLE_PLACES_API_KEY) {
    console.warn('Google Places API key is not configured. Please set REACT_APP_GOOGLE_PLACES_API_KEY in your .env file');
    return;
  }

  try {
    if (!loaderInstance) {
      loaderInstance = new Loader({
        apiKey: GOOGLE_PLACES_API_KEY,
        version: 'weekly',
        libraries: ['places'],
        language: 'he',
      });
    }

    await loaderInstance.load();
    isLoaded = true;
    callback();
  } catch (error) {
    console.error('Failed to load Google Places API:', error);
  }
};

