import { GeofenceVerifierImpl } from '../feature-location/GeofenceVerifierImpl';
import { LatLng, LocationTelemetry } from '../feature-location/IGeofenceVerifier';

describe('GeofenceVerifier Location Security Unit Tests', () => {
  let verifier: GeofenceVerifierImpl;

  // Set up a boundary polygon representing a 100-meter polling unit square in Lagos
  // Center is roughly at lat: 6.5244, lng: 3.3792
  const squareGeofence: LatLng[] = [
    { lat: 6.5250, lng: 3.3780 }, // Top-Left
    { lat: 6.5250, lng: 3.3800 }, // Top-Right
    { lat: 6.5230, lng: 3.3800 }, // Bottom-Right
    { lat: 6.5230, lng: 3.3780 }  // Bottom-Left
  ];

  // Set up a concave L-shaped polygon to test complex crossing counts
  const concaveGeofence: LatLng[] = [
    { lat: 0, lng: 0 },
    { lat: 3, lng: 0 },
    { lat: 3, lng: 1 },
    { lat: 1, lng: 1 },
    { lat: 1, lng: 3 },
    { lat: 0, lng: 3 }
  ];

  beforeEach(() => {
    verifier = new GeofenceVerifierImpl();
  });

  describe('Point-in-Polygon (PIP) Ray-Casting Math', () => {
    it('should identify coordinates strictly inside a convex boundary', () => {
      const insidePoint: LatLng = { lat: 6.5240, lng: 3.3790 };
      expect(verifier.isWithinBoundary(insidePoint, squareGeofence)).toBe(true);
    });

    it('should reject coordinates strictly outside a convex boundary', () => {
      const outsidePoint: LatLng = { lat: 6.5260, lng: 3.3790 };
      expect(verifier.isWithinBoundary(outsidePoint, squareGeofence)).toBe(false);
    });

    it('should correctly classify points inside concave polygons', () => {
      // Point in the core L-shape body
      const insideConcave: LatLng = { lat: 0.5, lng: 0.5 };
      expect(verifier.isWithinBoundary(insideConcave, concaveGeofence)).toBe(true);

      // Point inside the "cutout" area of the bounding box
      const outsideCutout: LatLng = { lat: 2.0, lng: 2.0 };
      expect(verifier.isWithinBoundary(outsideCutout, concaveGeofence)).toBe(false);
    });

    it('should return false for invalid polygons (less than 3 vertices)', () => {
      const point: LatLng = { lat: 6.5240, lng: 3.3790 };
      const invalidLine = [
        { lat: 6.5250, lng: 3.3780 },
        { lat: 6.5250, lng: 3.3800 }
      ];
      expect(verifier.isWithinBoundary(point, invalidLine)).toBe(false);
      expect(verifier.isWithinBoundary(point, [])).toBe(false);
    });
  });

  describe('Telemetry Monotonic Clock Validation', () => {
    const defaultMaxAgeMs = 10000; // 10 seconds

    it('should approve location telemetry when captured recently inside monotonic window', () => {
      const systemMonotonicMs = 250000; // 250 seconds system uptime
      
      const telemetry: LocationTelemetry = {
        lat: 6.5240,
        lng: 3.3790,
        timestamp: Date.now(),
        locationMonotonicMs: 245000 // 245 seconds system uptime (5s latency)
      };

      const result = verifier.isTelemetryFresh(telemetry, systemMonotonicMs, defaultMaxAgeMs);
      expect(result).toBe(true);
    });

    it('should reject replayed telemetry that exceeds maximum aging threshold', () => {
      const systemMonotonicMs = 250000;
      
      // Captured 15 seconds ago (above 10s maximum age limit)
      const telemetry: LocationTelemetry = {
        lat: 6.5240,
        lng: 3.3790,
        timestamp: Date.now() - 15000,
        locationMonotonicMs: 233000
      };

      const result = verifier.isTelemetryFresh(telemetry, systemMonotonicMs, defaultMaxAgeMs);
      expect(result).toBe(false);
    });

    it('should reject telemetry appearing to be from the future (monotonic anomaly)', () => {
      const systemMonotonicMs = 250000;
      
      // Monotonic tick is in the future (anomaly/spoofing indicator)
      const telemetry: LocationTelemetry = {
        lat: 6.5240,
        lng: 3.3790,
        timestamp: Date.now(),
        locationMonotonicMs: 251000 
      };

      const result = verifier.isTelemetryFresh(telemetry, systemMonotonicMs, defaultMaxAgeMs);
      expect(result).toBe(false);
    });
  });
});
