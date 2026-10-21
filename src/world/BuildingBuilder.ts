import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { BuildingItem, MetricPoint } from '../types/gis';

export interface BuiltCityResult {
  mesh: THREE.Mesh;
  totalBuildings: number;
}

export class BuildingBuilder {
  /**
   * Generates a 3D building geometry using earcut triangulation for roofs and quad walls.
   */
  public static createBuildingGeometry(building: BuildingItem): THREE.BufferGeometry | null {
    const outerRing = building.rings[0];
    if (!outerRing || outerRing.length < 3) return null;

    const height = Math.max(3.0, building.height);

    // Prepare 2D coordinates for earcut
    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    // Outer ring
    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    // Inner holes
    for (let h = 1; h < building.rings.length; h++) {
      const hole = building.rings[h];
      if (hole.length >= 3) {
        holeIndices.push(flatCoords.length / 2);
        for (let i = 0; i < hole.length; i++) {
          flatCoords.push(hole[i].x, hole[i].z);
        }
      }
    }

    // Triangulate roof cap
    const roofIndices = earcut(flatCoords, holeIndices, 2);
    if (roofIndices.length === 0) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];

    // Base color
    const baseColor = new THREE.Color(building.color);
    // Roof color (slightly warmer/darker or terracotta)
    const roofColor = building.roofColor
      ? new THREE.Color(building.roofColor)
      : building.isHistoric || building.isWorship
      ? new THREE.Color(0xf59e0b) // Gold/terracotta roof
      : baseColor.clone().multiplyScalar(0.85);

    const wallColor = baseColor.clone();

    // 1. Add Roof Cap Triangles (at y = height)
    for (let i = 0; i < roofIndices.length; i += 3) {
      const i0 = roofIndices[i] * 2;
      const i1 = roofIndices[i + 1] * 2;
      const i2 = roofIndices[i + 2] * 2;

      const p0 = { x: flatCoords[i0], z: flatCoords[i0 + 1] };
      const p1 = { x: flatCoords[i1], z: flatCoords[i1 + 1] };
      const p2 = { x: flatCoords[i2], z: flatCoords[i2 + 1] };

      // Ensure upward normal by checking winding order
      positions.push(p0.x, height, p0.z);
      positions.push(p1.x, height, p1.z);
      positions.push(p2.x, height, p2.z);

      normals.push(0, 1, 0);
      normals.push(0, 1, 0);
      normals.push(0, 1, 0);

      colors.push(roofColor.r, roofColor.g, roofColor.b);
      colors.push(roofColor.r, roofColor.g, roofColor.b);
      colors.push(roofColor.r, roofColor.g, roofColor.b);
    }

    // 2. Add Vertical Walls for all rings (outer + holes)
    const addWallForRing = (ring: MetricPoint[], isHole = false) => {
      const len = ring.length;
      for (let i = 0; i < len; i++) {
        const nextIdx = (i + 1) % len;
        // Avoid duplicate start/end points
        if (i === len - 1 && ring[0].x === ring[i].x && ring[0].z === ring[i].z) {
          continue;
        }

        const pCurrent = ring[i];
        const pNext = ring[nextIdx];

        const dx = pNext.x - pCurrent.x;
        const dz = pNext.z - pCurrent.z;
        const segLen = Math.sqrt(dx * dx + dz * dz);
        if (segLen < 0.05) continue; // Skip degenerate segments

        // Compute outward normal
        let nx = dz / segLen;
        let nz = -dx / segLen;
        if (isHole) {
          nx = -nx;
          nz = -nz;
        }

        // Quad vertices:
        // V0 (bottom start), V1 (bottom end), V2 (top end), V3 (top start)
        const v0 = [pCurrent.x, 0, pCurrent.z];
        const v1 = [pNext.x, 0, pNext.z];
        const v2 = [pNext.x, height, pNext.z];
        const v3 = [pCurrent.x, height, pCurrent.z];

        // Triangle 1: V0 -> V1 -> V2
        positions.push(...v0, ...v1, ...v2);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);

        // Subtle gradient on walls: bottom slightly darker
        const colBottom = wallColor.clone().multiplyScalar(0.9);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);

        // Triangle 2: V0 -> V2 -> V3
        positions.push(...v0, ...v2, ...v3);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);
      }
    };

    addWallForRing(outerRing, false);
    for (let h = 1; h < building.rings.length; h++) {
      addWallForRing(building.rings[h], true);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    return geometry;
  }

  /**
   * Merges all building geometries into a single Draw Call mesh using BufferGeometryUtils
   */
  public static buildCityMesh(buildings: BuildingItem[]): BuiltCityResult | null {
    if (buildings.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];

    for (const bld of buildings) {
      const geo = this.createBuildingGeometry(bld);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    // Merge all building buffer geometries into one
    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);

    // Dispose temporary geometries to free memory
    for (const g of geometries) {
      g.dispose();
    }

    if (!mergedGeometry) return null;

    // Material using vertex colors
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.15,
      flatShading: false,
    });

    const mesh = new THREE.Mesh(mergedGeometry, material);
    mesh.name = 'building_city_merged';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return {
      mesh,
      totalBuildings: buildings.length,
    };
  }
}
