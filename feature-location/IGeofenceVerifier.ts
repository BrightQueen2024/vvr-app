export interface LatLng {
  lat: number;
  lng: number;
}

export interface LocationTelemetry {
  lat: number;
  lng: number;
  /**
   * System wall-clock timestamp (Unix time) when the location was captured.
   */
  timestamp: number;
  /**
   * Monotonic hardware clock time (boot uptime) when the location was captured.
   */
  locationMonotonicMs: number;
}

export interface IGeofenceVerifier {
  /**
   * Determines if the given GPS coordinate (point) is physically located inside
   * the polygon boundaries using the Ray-Casting Point-in-Polygon (PIP) algorithm.
   */
  isWithinBoundary(point: LatLng, polygon: LatLng[]): boolean;

  /**
   * Validates if the location telemetry event is fresh by checking the latency
   * delta against the system monotonic clock. This prevents cached location replay attacks.
   * 
   * @param telemetry The captured coordinate telemetry data.
   * @param systemMonotonicMs The current active monotonic uptime of the host system.
   * @param maxAgeMs The maximum allowed age limit in milliseconds (e.g. 10000ms).
   */
  isTelemetryFresh(
    telemetry: LocationTelemetry,
    systemMonotonicMs: number,
    maxAgeMs: number
  ): boolean;
}
