import { IGeofenceVerifier, LatLng, LocationTelemetry } from './IGeofenceVerifier';

export class GeofenceVerifierImpl implements IGeofenceVerifier {
  /**
   * Evaluates if a given coordinate is inside the boundary polygon using
   * the mathematical Ray-Casting (Point-in-Polygon) algorithm.
   */
  public isWithinBoundary(point: LatLng, polygon: LatLng[]): boolean {
    // A polygon must have at least 3 vertices to form a closed shape
    if (!polygon || polygon.length < 3) {
      return false;
    }

    let inside = false;
    const numVertices = polygon.length;

    // Iterate through all edges of the polygon.
    // i is the current vertex, j is the previous vertex.
    for (let i = 0, j = numVertices - 1; i < numVertices; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;

      // Check if the horizontal ray cast to the right from the point intersects the edge
      const intersectsY = (yi > point.lat) !== (yj > point.lat);
      
      // Calculate the X-coordinate of the intersection point of the edge and the ray
      // and check if the point's X (longitude) is to the left of the intersection point.
      const intersectsX = intersectsY && (point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi);

      if (intersectsX) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Validates if the location telemetry event is fresh.
   * Compares the location event's monotonic boot clock against the current system monotonic reference.
   * 
   * @param telemetry Telemetry dataset from location sensor.
   * @param systemMonotonicMs Active system boot monotonic clock in milliseconds.
   * @param maxAgeMs Maximum age allowance (e.g. 10000ms).
   */
  public isTelemetryFresh(
    telemetry: LocationTelemetry,
    systemMonotonicMs: number,
    maxAgeMs: number
  ): boolean {
    const ageMs = systemMonotonicMs - telemetry.locationMonotonicMs;

    // Zero-Trust checks:
    // 1. Telemetry cannot be from the future relative to the system clock (ageMs < 0)
    // 2. Telemetry must not exceed the maximum aging window (ageMs > maxAgeMs)
    if (ageMs < 0 || ageMs > maxAgeMs) {
      return false;
    }

    return true;
  }
}
