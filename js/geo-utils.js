/**
 * Geolocation & geofencing helpers.
 * Requires HTTPS for the Geolocation API to work in production.
 */

/**
 * Get the current GPS position as { latitude, longitude, accuracy }.
 * Rejects with an Error if geolocation is unavailable or denied.
 */
function getCurrentLocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    // When offline, use a short timeout and allow a cached position (up to 5 min old)
    const isOffline = !navigator.onLine;
    const geoOptions = {
      enableHighAccuracy: !isOffline, // high accuracy needs network assist on mobile
      timeout:    isOffline ? 5000 : 10000,
      maximumAge: isOffline ? 300000 : 0  // accept up to 5-min cached position offline
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy
        });
      },
      () => {
        // GPS failed — resolve with null so attendance still proceeds
        resolve(null);
      },
      geoOptions
    );
  });
}

/**
 * Check whether the given position falls within the office geofence.
 * @returns { within, distanceMeters, officeLat, officeLng, radiusMeters }
 */
function checkGeofence(position, officeLat, officeLng, radiusMeters) {
  const distance = calculateDistance(
    position.latitude,
    position.longitude,
    officeLat,
    officeLng
  );
  return {
    within: distance <= radiusMeters,
    distanceMeters: distance,
    officeLat,
    officeLng,
    radiusMeters
  };
}

/**
 * Watch the device position continuously (for live distance display).
 * Returns a watch id that can be passed to navigator.geolocation.clearWatch.
 */
function watchPosition(onUpdate, onError) {
  if (!navigator.geolocation) {
    onError(new Error("Geolocation not supported."));
    return null;
  }
  return navigator.geolocation.watchPosition(
    (pos) => {
      onUpdate({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      });
    },
    (err) => onError(err),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  );
}

/** Stop watching the position. */
function stopWatching(watchId) {
  if (watchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Reverse geocode lat/lng to a human-readable location name
 * using the free OpenStreetMap Nominatim API.
 *
 * Returns a short address string like:
 *   "Barangay 123, Makati, Metro Manila"
 * Falls back to coordinate string if the API fails.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>}
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`;
    const res = await fetch(url, {
      headers: { "Accept-Language": "en" }
    });

    if (!res.ok) throw new Error("Nominatim error");

    const data = await res.json();
    const a = data.address || {};

    // Build a short readable address from most-specific to broadest
    const parts = [
      a.road || a.pedestrian || a.footway || a.street,
      a.village || a.suburb || a.neighbourhood || a.quarter,
      a.city || a.town || a.municipality || a.county,
      a.state || a.region
    ].filter(Boolean);

    return parts.length ? parts.slice(0, 3).join(", ") : data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch (err) {
    // Fallback to coordinates if API fails
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}
