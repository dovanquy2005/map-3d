import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';
import { TextureGenerator } from './TextureGenerator';

export class EnvironmentBuilder {
  /**
   * Builds Continuous Paved Road Ribbons from line paths + Sidewalk curbs flanking both sides
   */
  public static buildRoads(roads: RoadPolygonItem[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_group';

    const asphaltGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];

    const asphaltColor = new THREE.Color(SAIGON_PALETTES.mainAsphalt);
    const alleyColor = new THREE.Color(SAIGON_PALETTES.alleyPavement);
    const sidewalkColor = new THREE.Color(SAIGON_PALETTES.sidewalkConcrete);

    for (const road of roads) {
      // 1. Path-based Continuous Road Ribbon (No z-fighting, perfectly smooth)
      if (road.path && road.path.length >= 2) {
        const path = road.path;
        const width = Math.max(2.8, road.width);
        const halfW = width / 2;
        const sidewalkW = road.isAlley ? 0.8 : 2.2;
        const col = road.isAlley ? alleyColor : asphaltColor;

        const asphaltPos: number[] = [];
        const asphaltNorm: number[] = [];
        const asphaltCol: number[] = [];
        const asphaltUV: number[] = [];

        const swPos: number[] = [];
        const swNorm: number[] = [];
        const swCol: number[] = [];

        let cumDist = 0;

        for (let i = 0; i < path.length - 1; i++) {
          const p1 = path[i];
          const p2 = path[i + 1];

          const dx = p2.x - p1.x;
          const dz = p2.z - p1.z;
          const segLen = Math.hypot(dx, dz);
          if (segLen < 0.1) continue;

          // Normal perpendicular to road direction in X-Z plane
          const nx = -dz / segLen;
          const nz = dx / segLen;

          const l1 = [p1.x + nx * halfW, 0.08, p1.z + nz * halfW];
          const r1 = [p1.x - nx * halfW, 0.08, p1.z - nz * halfW];
          const l2 = [p2.x + nx * halfW, 0.08, p2.z + nz * halfW];
          const r2 = [p2.x - nx * halfW, 0.08, p2.z - nz * halfW];

          const d1 = cumDist;
          const d2 = cumDist + segLen;
          cumDist = d2;

          // Road Asphalt Quad (l1, r1, r2, l2)
          asphaltPos.push(...l1, ...r1, ...r2);
          asphaltPos.push(...l1, ...r2, ...l2);

          for (let k = 0; k < 6; k++) {
            asphaltNorm.push(0, 1, 0);
            asphaltCol.push(col.r, col.g, col.b);
          }

          // UV mapping: U from 0 to 1 across road width, V along road distance
          asphaltUV.push(0, d1 * 0.08,  1, d1 * 0.08,  1, d2 * 0.08);
          asphaltUV.push(0, d1 * 0.08,  1, d2 * 0.08,  0, d2 * 0.08);

          // Raised Sidewalk Curbs flanking the road (y = 0.12m)
          const swLeft1 = [p1.x + nx * (halfW + sidewalkW), 0.12, p1.z + nz * (halfW + sidewalkW)];
          const swLeft2 = [p2.x + nx * (halfW + sidewalkW), 0.12, p2.z + nz * (halfW + sidewalkW)];
          const swRight1 = [p1.x - nx * (halfW + sidewalkW), 0.12, p1.z - nz * (halfW + sidewalkW)];
          const swRight2 = [p2.x - nx * (halfW + sidewalkW), 0.12, p2.z - nz * (halfW + sidewalkW)];

          // Left Sidewalk Ribbon
          swPos.push(...swLeft1, ...l1, ...l2);
          swPos.push(...swLeft1, ...l2, ...swLeft2);

          // Right Sidewalk Ribbon
          swPos.push(...r1, ...swRight1, ...swRight2);
          swPos.push(...r1, ...swRight2, ...r2);

          for (let k = 0; k < 12; k++) {
            swNorm.push(0, 1, 0);
            swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
          }
        }

        if (asphaltPos.length > 0) {
          const aGeo = new THREE.BufferGeometry();
          aGeo.setAttribute('position', new THREE.Float32BufferAttribute(asphaltPos, 3));
          aGeo.setAttribute('normal', new THREE.Float32BufferAttribute(asphaltNorm, 3));
          aGeo.setAttribute('color', new THREE.Float32BufferAttribute(asphaltCol, 3));
          aGeo.setAttribute('uv', new THREE.Float32BufferAttribute(asphaltUV, 2));
          asphaltGeometries.push(aGeo);
        }

        if (swPos.length > 0) {
          const sGeo = new THREE.BufferGeometry();
          sGeo.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
          sGeo.setAttribute('normal', new THREE.Float32BufferAttribute(swNorm, 3));
          sGeo.setAttribute('color', new THREE.Float32BufferAttribute(swCol, 3));
          sidewalkGeometries.push(sGeo);
        }
      }
      // 2. Polygon-based fallback
      else if (road.rings && road.rings.length > 0) {
        const col = road.isAlley ? alleyColor : asphaltColor;
        const geo = this.triangulatePolygon(road.rings, 0.08, col);
        if (geo) asphaltGeometries.push(geo);
      }
    }

    // Merge Asphalt Mesh with Road Texture (Centerlines & Shoulders)
    if (asphaltGeometries.length > 0) {
      const mergedAsphalt = BufferGeometryUtils.mergeGeometries(asphaltGeometries, false);
      for (const g of asphaltGeometries) g.dispose();

      if (mergedAsphalt) {
        const roadTexture = TextureGenerator.getRoadTexture();
        const roadMaterial = new THREE.MeshStandardMaterial({
          map: roadTexture,
          vertexColors: true,
          roughness: 0.82,
          metalness: 0.08,
          side: THREE.DoubleSide,
        });

        const asphaltMesh = new THREE.Mesh(mergedAsphalt, roadMaterial);
        asphaltMesh.name = 'roads_asphalt_merged';
        asphaltMesh.receiveShadow = true;
        group.add(asphaltMesh);
      }
    }

    // Merge Raised Sidewalk Curbs
    if (sidewalkGeometries.length > 0) {
      const mergedSidewalks = BufferGeometryUtils.mergeGeometries(sidewalkGeometries, false);
      for (const g of sidewalkGeometries) g.dispose();

      if (mergedSidewalks) {
        const sidewalkMaterial = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.92,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const sidewalkMesh = new THREE.Mesh(mergedSidewalks, sidewalkMaterial);
        sidewalkMesh.name = 'roads_sidewalks_merged';
        sidewalkMesh.receiveShadow = true;
        group.add(sidewalkMesh);
      }
    }

    return group;
  }

  /**
   * Triangulates a polygon into a flat 3D surface at height yOffset with guaranteed UPWARD normal (+Y)
   */
  public static triangulatePolygon(
    rings: { x: number; z: number }[][],
    yOffset: number,
    color: THREE.Color
  ): THREE.BufferGeometry | null {
    const rawOuter = rings[0];
    if (!rawOuter || rawOuter.length < 3) return null;

    const isClosed =
      rawOuter.length > 3 &&
      Math.abs(rawOuter[0].x - rawOuter[rawOuter.length - 1].x) < 0.001 &&
      Math.abs(rawOuter[0].z - rawOuter[rawOuter.length - 1].z) < 0.001;
    const outerRing = isClosed ? rawOuter.slice(0, -1) : rawOuter;
    if (outerRing.length < 3) return null;

    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    for (let h = 1; h < rings.length; h++) {
      const rawHole = rings[h];
      const holeClosed =
        rawHole.length > 3 &&
        Math.abs(rawHole[0].x - rawHole[rawHole.length - 1].x) < 0.001 &&
        Math.abs(rawHole[0].z - rawHole[rawHole.length - 1].z) < 0.001;
      const hole = holeClosed ? rawHole.slice(0, -1) : rawHole;

      if (hole.length >= 3) {
        holeIndices.push(flatCoords.length / 2);
        for (let i = 0; i < hole.length; i++) {
          flatCoords.push(hole[i].x, hole[i].z);
        }
      }
    }

    const indices = earcut(flatCoords, holeIndices, 2);
    if (indices.length === 0) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      let p0 = { x: flatCoords[indices[i] * 2], z: flatCoords[indices[i] * 2 + 1] };
      let p1 = { x: flatCoords[indices[i + 1] * 2], z: flatCoords[indices[i + 1] * 2 + 1] };
      let p2 = { x: flatCoords[indices[i + 2] * 2], z: flatCoords[indices[i + 2] * 2 + 1] };

      const vAx = p1.x - p0.x;
      const vAz = p1.z - p0.z;
      const vBx = p2.x - p0.x;
      const vBz = p2.z - p0.z;
      const crossY = vAz * vBx - vAx * vBz;

      if (crossY < 0) {
        const temp = p1;
        p1 = p2;
        p2 = temp;
      }

      positions.push(p0.x, yOffset, p0.z);
      positions.push(p1.x, yOffset, p1.z);
      positions.push(p2.x, yOffset, p2.z);

      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);

      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);

      uvs.push(0, 0, 1, 0, 0.5, 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    return geometry;
  }

  /**
   * Builds merged water bodies (River, canals, ponds) with reflection and water shading
   */
  public static buildWater(waterList: WaterPolygonItem[]): THREE.Mesh | null {
    if (waterList.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const waterColor = new THREE.Color(SAIGON_PALETTES.tropicalWater);

    for (const water of waterList) {
      const geo = this.triangulatePolygon(water.rings, 0.04, waterColor);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.1,
      metalness: 0.4,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'water_merged';
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds merged parks & green landuse
   */
  public static buildParks(parks: ParkPolygonItem[]): { parkMesh: THREE.Mesh | null } {
    if (parks.length === 0) return { parkMesh: null };

    const parkGeometries: THREE.BufferGeometry[] = [];
    const parkColor = new THREE.Color(SAIGON_PALETTES.parkGreen);

    for (const park of parks) {
      const geo = this.triangulatePolygon(park.rings, 0.05, parkColor);
      if (geo) parkGeometries.push(geo);
    }

    let parkMesh: THREE.Mesh | null = null;
    if (parkGeometries.length > 0) {
      const mergedParks = BufferGeometryUtils.mergeGeometries(parkGeometries, false);
      for (const g of parkGeometries) g.dispose();

      if (mergedParks) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x4ade80, // Fresh vibrant green
          roughness: 0.9,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        parkMesh = new THREE.Mesh(mergedParks, material);
        parkMesh.name = 'parks_merged';
        parkMesh.receiveShadow = true;
      }
    }

    return { parkMesh };
  }
}
