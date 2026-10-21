import { BBox, MetricPoint } from '../types/gis';

/**
 * Local Tangent Plane Projection (WGS84 Lat/Lon to Metric X, Z)
 * 1 unit in Three.js = exactly 1 meter in real world.
 * +X: East
 * +Y: Up (Altitude)
 * -Z: North (Three.js standard camera coordinate convention)
 */
export class GeoProjection {
  private centerLat: number;
  private centerLon: number;
  private cosLat: number;

  constructor(centerLat: number, centerLon: number) {
    this.centerLat = centerLat;
    this.centerLon = centerLon;
    this.cosLat = Math.cos((centerLat * Math.PI) / 180);
  }

  public getCenter(): { lat: number; lon: number } {
    return { lat: this.centerLat, lon: this.centerLon };
  }

  /**
   * Convert WGS84 (lon, lat) to local metric (x, z) in meters relative to center origin (0, 0, 0)
   */
  public project(lon: number, lat: number): MetricPoint {
    const x = (lon - this.centerLon) * 111320 * this.cosLat;
    const z = -(lat - this.centerLat) * 111132;
    return { x, z };
  }

  /**
   * Convert local metric (x, z) back to WGS84 (lon, lat)
   */
  public unproject(x: number, z: number): { lon: number; lat: number } {
    const lon = this.centerLon + x / (111320 * this.cosLat);
    const lat = this.centerLat - z / 111132;
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
    const latDelta = radiusMeters / 111132;
    const lonDelta = radiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));

    return {
      south: centerLat - latDelta,
      north: centerLat + latDelta,
      west: centerLon - lonDelta,
      east: centerLon + lonDelta,
    };
  }
}
