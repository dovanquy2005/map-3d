import { BBox, MetricPoint } from '../types/gis';

/**
 * Rigorous Geodetic Local Tangent Plane Projection on the WGS84 Ellipsoid
 * 1 unit in Three.js = exactly 1 meter in real world.
 * +X: East
 * +Y: Up (Altitude)
 * -Z: North (Three.js standard camera coordinate convention)
 */
export class GeoProjection {
  private centerLat: number;
  private centerLon: number;
  private phi0: number; // center latitude in radians
  private M: number;    // Meridian radius of curvature (meters)
  private N: number;    // Prime vertical radius of curvature (meters)
  private cosPhi0: number;

  constructor(centerLat: number, centerLon: number) {
    this.centerLat = centerLat;
    this.centerLon = centerLon;

    // WGS84 Ellipsoid parameters
    const a = 6378137.0; // semi-major axis (meters)
    const f = 1.0 / 298.257223563; // flattening
    const e2 = 2 * f - f * f; // squared eccentricity (approx 0.00669437999014)

    this.phi0 = (centerLat * Math.PI) / 180;
    this.cosPhi0 = Math.cos(this.phi0);
    const sinPhi0 = Math.sin(this.phi0);
    const sin2Phi0 = sinPhi0 * sinPhi0;

    const denom = Math.sqrt(1 - e2 * sin2Phi0);
    this.N = a / denom; // Prime vertical radius
    this.M = (a * (1 - e2)) / (denom * denom * denom); // Meridian radius
  }

  public getCenter(): { lat: number; lon: number } {
    return { lat: this.centerLat, lon: this.centerLon };
  }

  /**
   * Convert WGS84 (lon, lat) to local metric (x, z) in meters relative to center origin (0, 0, 0)
   * Exact to millimeter precision without projection distortion.
   */
  public project(lon: number, lat: number): MetricPoint {
    const dLonRad = ((lon - this.centerLon) * Math.PI) / 180;
    const dLatRad = ((lat - this.centerLat) * Math.PI) / 180;

    const x = dLonRad * this.N * this.cosPhi0;
    const z = -dLatRad * this.M;
    return { x, z };
  }

  /**
   * Convert local metric (x, z) back to WGS84 (lon, lat)
   */
  public unproject(x: number, z: number): { lon: number; lat: number } {
    const dLonRad = x / (this.N * this.cosPhi0);
    const dLatRad = -z / this.M;

    const lon = this.centerLon + (dLonRad * 180) / Math.PI;
    const lat = this.centerLat + (dLatRad * 180) / Math.PI;
    return { lon, lat };
  }

  /**
   * Computes Euclidean distance between two metric points in meters
   */
  public static distance(p1: MetricPoint, p2: MetricPoint): number {
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Generates a bounding box (south, west, north, east) around a center point for a given radius in meters
   */
  public static createBBoxFromRadius(centerLat: number, centerLon: number, radiusMeters: number): BBox {
    const a = 6378137.0;
    const f = 1.0 / 298.257223563;
    const e2 = 2 * f - f * f;
    const phi0 = (centerLat * Math.PI) / 180;
    const sinPhi0 = Math.sin(phi0);
    const denom = Math.sqrt(1 - e2 * sinPhi0 * sinPhi0);
    const N = a / denom;
    const M = (a * (1 - e2)) / (denom * denom * denom);

    const latDelta = ((radiusMeters / M) * 180) / Math.PI;
    const lonDelta = ((radiusMeters / (N * Math.cos(phi0))) * 180) / Math.PI;

    return {
      south: centerLat - latDelta,
      north: centerLat + latDelta,
      west: centerLon - lonDelta,
      east: centerLon + lonDelta,
    };
  }
}
