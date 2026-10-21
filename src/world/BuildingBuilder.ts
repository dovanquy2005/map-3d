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
   * Generates a 3D building geometry with:
   * - Solid Roof Cap (Corrected upward winding + terracotta/concrete styling)
   * - Solid 4-sided vertical walls with floor line accents
   * - Rooftop Chuồng Cu (Staircase housing) & Stainless Steel Water Tank (Bồn nước Tân Á)
   */
  public static createBuildingGeometry(building: BuildingItem): THREE.BufferGeometry | null {
    const rawOuter = building.rings[0];
    if (!rawOuter || rawOuter.length < 3) return null;

    const height = Math.max(3.5, building.height);

    // Strip duplicate closing vertex if present (GeoJSON standard duplicates end=start, which trips earcut)
    const isClosed =
      rawOuter.length > 3 &&
      Math.abs(rawOuter[0].x - rawOuter[rawOuter.length - 1].x) < 0.001 &&
      Math.abs(rawOuter[0].z - rawOuter[rawOuter.length - 1].z) < 0.001;

    const outerRing = isClosed ? rawOuter.slice(0, rawOuter.length - 1) : rawOuter;
    if (outerRing.length < 3) return null;

    // Prepare 2D coordinates for earcut
    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    // Inner holes
    for (let h = 1; h < building.rings.length; h++) {
      const rawHole = building.rings[h];
      const holeClosed =
        rawHole.length > 3 &&
        Math.abs(rawHole[0].x - rawHole[rawHole.length - 1].x) < 0.001 &&
        Math.abs(rawHole[0].z - rawHole[rawHole.length - 1].z) < 0.001;
      const hole = holeClosed ? rawHole.slice(0, rawHole.length - 1) : rawHole;

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

    // Base wall color
    const baseColor = new THREE.Color(building.color);

    // Roof color (Terracotta red/orange for typical Saigon houses, or gold for temples, or slate grey)
    let roofColor: THREE.Color;
    if (building.isHistoric || building.isWorship) {
      roofColor = new THREE.Color(0xf59e0b); // Gold / Vermilion pagoda roof
    } else if (building.color === 0x38bdf8) {
      roofColor = new THREE.Color(0x0284c7); // Modern glass tower roof
    } else {
      // Warm terracotta tile roof
      roofColor = new THREE.Color(0xc2410c);
    }

    const wallColor = baseColor.clone();
    // Parapet trim / rooftop edge color
    const trimColor = wallColor.clone().multiplyScalar(0.75);

    // 1. ADD ROOF CAP (With Guaranteed UPWARDS Normal +Y)
    for (let i = 0; i < roofIndices.length; i += 3) {
      let p0 = { x: flatCoords[roofIndices[i] * 2], z: flatCoords[roofIndices[i] * 2 + 1] };
      let p1 = { x: flatCoords[roofIndices[i + 1] * 2], z: flatCoords[roofIndices[i + 1] * 2 + 1] };
      let p2 = { x: flatCoords[roofIndices[i + 2] * 2], z: flatCoords[roofIndices[i + 2] * 2 + 1] };

      // Vector Cross Product to guarantee normal points UP (+Y)
      const vAx = p1.x - p0.x;
      const vAz = p1.z - p0.z;
      const vBx = p2.x - p0.x;
      const vBz = p2.z - p0.z;
      const crossY = vAz * vBx - vAx * vBz;

      // In Three.js right-handed system, if crossY < 0, swap p1 and p2 so normal points UP
      if (crossY < 0) {
        const temp = p1;
        p1 = p2;
        p2 = temp;
      }

      // Add roof vertices at building height
      positions.push(p0.x, height, p0.z);
      positions.push(p1.x, height, p1.z);
      positions.push(p2.x, height, p2.z);

      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);

      colors.push(roofColor.r, roofColor.g, roofColor.b);
      colors.push(roofColor.r, roofColor.g, roofColor.b);
      colors.push(roofColor.r, roofColor.g, roofColor.b);
    }

    // 2. ADD VERTICAL WALLS (Outer ring + Holes)
    const addWallForRing = (ring: MetricPoint[], isHole = false) => {
      const len = ring.length;
      for (let i = 0; i < len; i++) {
        const nextIdx = (i + 1) % len;
        const pCurrent = ring[i];
        const pNext = ring[nextIdx];

        const dx = pNext.x - pCurrent.x;
        const dz = pNext.z - pCurrent.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.1) continue;

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

        const colBottom = wallColor.clone().multiplyScalar(0.8);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);

        // Triangle 2: V0 -> V2 -> V3
        positions.push(...v0, ...v2, ...v3);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(colBottom.r, colBottom.g, colBottom.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);
        colors.push(wallColor.r, wallColor.g, wallColor.b);

        // Add Rooftop Parapet / Lan Can Gờ Mái (0.5m lip around roof edge)
        const vTop0 = [pCurrent.x, height, pCurrent.z];
        const vTop1 = [pNext.x, height, pNext.z];
        const vLip0 = [pCurrent.x, height + 0.45, pCurrent.z];
        const vLip1 = [pNext.x, height + 0.45, pNext.z];

        positions.push(...vTop0, ...vTop1, ...vLip1);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b);

        positions.push(...vTop0, ...vLip1, ...vLip0);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b);
      }
    };

    addWallForRing(outerRing, false);
    for (let h = 1; h < building.rings.length; h++) {
      const hRing = building.rings[h];
      const hClean = (hRing.length > 3 && hRing[0].x === hRing[hRing.length - 1].x) ? hRing.slice(0, -1) : hRing;
      addWallForRing(hClean, true);
    }

    // 3. ICONIC SAIGON ROOFTOP FEATURE: Chuồng Cu & Bồn Nước Inox (for houses >= 6m)
    if (height >= 6.0 && outerRing.length >= 4) {
      let cx = 0;
      let cz = 0;
      for (const pt of outerRing) {
        cx += pt.x;
        cz += pt.z;
      }
      cx /= outerRing.length;
      cz /= outerRing.length;

      // Small rooftop staircase room (2m x 2m x 2.2m)
      const roomSize = 1.2;
      const roomH = 2.0;
      const rx0 = cx - roomSize;
      const rx1 = cx + roomSize;
      const rz0 = cz - roomSize;
      const rz1 = cz + roomSize;
      const ry0 = height;
      const ry1 = height + roomH;

      // Room walls
      const roomWalls = [
        [[rx0, ry0, rz0], [rx1, ry0, rz0], [rx1, ry1, rz0], [rx0, ry1, rz0], [0, 0, -1]],
        [[rx1, ry0, rz0], [rx1, ry0, rz1], [rx1, ry1, rz1], [rx1, ry1, rz0], [1, 0, 0]],
        [[rx1, ry0, rz1], [rx0, ry0, rz1], [rx0, ry1, rz1], [rx1, ry1, rz1], [0, 0, 1]],
        [[rx0, ry0, rz1], [rx0, ry0, rz0], [rx0, ry1, rz0], [rx0, ry1, rz1], [-1, 0, 0]],
      ];

      for (const [w0, w1, w2, w3, n] of roomWalls) {
        positions.push(...w0, ...w1, ...w2);
        normals.push(...n, ...n, ...n);
        colors.push(0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85);

        positions.push(...w0, ...w2, ...w3);
        normals.push(...n, ...n, ...n);
        colors.push(0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85);
      }

      // Room roof
      positions.push(rx0, ry1, rz0, rx1, ry1, rz0, rx1, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.4, 0.45, 0.5, 0.4, 0.45, 0.5, 0.4, 0.45, 0.5);

      positions.push(rx0, ry1, rz0, rx1, ry1, rz1, rx0, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.4, 0.45, 0.5, 0.4, 0.45, 0.5, 0.4, 0.45, 0.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    return geometry;
  }

  /**
   * Merges all building geometries into a single Draw Call mesh using BufferGeometryUtils
   * Sets DoubleSide material to guarantee 100% solid, non-culled houses from any view!
   */
  public static buildCityMesh(buildings: BuildingItem[]): BuiltCityResult | null {
    if (buildings.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];

    for (const bld of buildings) {
      const geo = this.createBuildingGeometry(bld);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!mergedGeometry) return null;

    // Double-sided standard material with rich shading and shadows
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.12,
      side: THREE.DoubleSide, // Guarantees all walls & roofs are completely solid!
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
