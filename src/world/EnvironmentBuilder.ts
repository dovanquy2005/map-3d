import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';
import { TextureGenerator } from './TextureGenerator';

export class EnvironmentBuilder {
  /**
   * Builds Continuous Paved Road Ribbons with miter corner joints + Raised Sidewalk Curbs
   */
  public static buildRoads(roads: RoadPolygonItem[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_group';

    const mainAsphaltGeometries: THREE.BufferGeometry[] = [];
    const alleyAsphaltGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];

    const sidewalkColor = new THREE.Color(SAIGON_PALETTES.sidewalkConcrete);
    const curbDropColor = new THREE.Color(0x94a3b8);

    for (const road of roads) {
      if (road.path && road.path.length >= 2) {
        const path = road.path;
        const width = Math.max(2.6, road.width);
        const halfW = width / 2;
        const sidewalkW = road.isAlley ? 0.6 : 2.0;

        // Elevation hierarchy to eliminate z-fighting at intersections:
        // Main avenue > Secondary street > Alley
        const asphaltY = road.isAlley
          ? 0.078
          : road.highway === 'primary'
          ? 0.084
          : road.highway === 'secondary'
          ? 0.082
          : 0.080;
        const sidewalkY = 0.120;

        // Step 1: Calculate segment directions and lengths
        const segDirs: Array<{ x: number; z: number; len: number }> = [];
        for (let i = 0; i < path.length - 1; i++) {
          const dx = path[i + 1].x - path[i].x;
          const dz = path[i + 1].z - path[i].z;
          const len = Math.hypot(dx, dz);
          segDirs.push({
            x: len > 0.001 ? dx / len : 0,
            z: len > 0.001 ? dz / len : 1,
            len,
          });
        }

        // Step 2: Calculate miter vertex normals at each path point
        const miterNormals: Array<{ x: number; z: number; scale: number }> = [];
        for (let i = 0; i < path.length; i++) {
          if (i === 0) {
            const d = segDirs[0];
            miterNormals.push({ x: -d.z, z: d.x, scale: 1 });
          } else if (i === path.length - 1) {
            const d = segDirs[segDirs.length - 1];
            miterNormals.push({ x: -d.z, z: d.x, scale: 1 });
          } else {
            const dIn = segDirs[i - 1];
            const dOut = segDirs[i];
            const avgX = dIn.x + dOut.x;
            const avgZ = dIn.z + dOut.z;
            const avgLen = Math.hypot(avgX, avgZ);

            if (avgLen > 0.001) {
              const dirX = avgX / avgLen;
              const dirZ = avgZ / avgLen;
              const normX = -dirZ;
              const normZ = dirX;

              const cosA = normX * (-dIn.z) + normZ * dIn.x;
              const scale = Math.min(2.0, 1.0 / Math.max(0.4, cosA));
              miterNormals.push({ x: normX, z: normZ, scale });
            } else {
              miterNormals.push({ x: -dIn.z, z: dIn.x, scale: 1 });
            }
          }
        }

        // Step 3: Compute ribbon vertex coordinates
        const lRoad: Array<[number, number, number]> = [];
        const rRoad: Array<[number, number, number]> = [];
        const lSidewalk: Array<[number, number, number]> = [];
        const rSidewalk: Array<[number, number, number]> = [];

        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          const m = miterNormals[i];

          const offRoad = halfW * m.scale;
          const offSw = (halfW + sidewalkW) * m.scale;

          lRoad.push([p.x + m.x * offRoad, asphaltY, p.z + m.z * offRoad]);
          rRoad.push([p.x - m.x * offRoad, asphaltY, p.z - m.z * offRoad]);

          lSidewalk.push([p.x + m.x * offSw, sidewalkY, p.z + m.z * offSw]);
          rSidewalk.push([p.x - m.x * offSw, sidewalkY, p.z - m.z * offSw]);
        }

        // Step 4: Build Quads between adjacent vertices
        const aPos: number[] = [];
        const aNorm: number[] = [];
        const aUV: number[] = [];

        const swPos: number[] = [];
        const swNorm: number[] = [];
        const swCol: number[] = [];

        let cumDist = 0;

        for (let i = 0; i < path.length - 1; i++) {
          const segLen = segDirs[i].len;
          if (segLen < 0.1) continue;

          const p1L = lRoad[i];
          const p1R = rRoad[i];
          const p2L = lRoad[i + 1];
          const p2R = rRoad[i + 1];

          const sw1L = lSidewalk[i];
          const sw1R = rSidewalk[i];
          const sw2L = lSidewalk[i + 1];
          const sw2R = rSidewalk[i + 1];

          const v1 = cumDist * 0.08;
          const v2 = (cumDist + segLen) * 0.08;
          cumDist += segLen;

          // Road Asphalt Quad (p1L -> p1R -> p2R, p1L -> p2R -> p2L)
          aPos.push(...p1L, ...p1R, ...p2R);
          aPos.push(...p1L, ...p2R, ...p2L);

          for (let k = 0; k < 6; k++) aNorm.push(0, 1, 0);

          aUV.push(0, v1, 1, v1, 1, v2);
          aUV.push(0, v1, 1, v2, 0, v2);

          // Left Sidewalk Ribbon (Top surface at sidewalkY)
          const sw1L_in = [p1L[0], sidewalkY, p1L[2]];
          const sw2L_in = [p2L[0], sidewalkY, p2L[2]];

          swPos.push(...sw1L, ...sw1L_in, ...sw2L_in);
          swPos.push(...sw1L, ...sw2L_in, ...sw2L);

          // Right Sidewalk Ribbon (Top surface at sidewalkY)
          const sw1R_in = [p1R[0], sidewalkY, p1R[2]];
          const sw2R_in = [p2R[0], sidewalkY, p2R[2]];

          swPos.push(...sw1R_in, ...sw1R, ...sw2R);
          swPos.push(...sw1R_in, ...sw2R, ...sw2R_in);

          for (let k = 0; k < 12; k++) {
            swNorm.push(0, 1, 0);
            swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
          }

          // 3D Sidewalk Curb Drops (Vertical faces from 0.12 down to asphalt 0.08)
          // Left Curb Face
          swPos.push(...sw1L_in, ...p1L, ...p2L);
          swPos.push(...sw1L_in, ...p2L, ...sw2L_in);

          // Right Curb Face
          swPos.push(...p1R, ...sw1R_in, ...sw2R_in);
          swPos.push(...p1R, ...sw2R_in, ...p2R);

          const m = miterNormals[i];
          for (let k = 0; k < 6; k++) {
            swNorm.push(-m.x, 0, -m.z);
            swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
          }
          for (let k = 0; k < 6; k++) {
            swNorm.push(m.x, 0, m.z);
            swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
          }
        }

        if (aPos.length > 0) {
          const aGeo = new THREE.BufferGeometry();
          aGeo.setAttribute('position', new THREE.Float32BufferAttribute(aPos, 3));
          aGeo.setAttribute('normal', new THREE.Float32BufferAttribute(aNorm, 3));
          aGeo.setAttribute('uv', new THREE.Float32BufferAttribute(aUV, 2));

          if (road.isAlley) {
            alleyAsphaltGeometries.push(aGeo);
          } else {
            mainAsphaltGeometries.push(aGeo);
          }
        }

        if (swPos.length > 0) {
          const sGeo = new THREE.BufferGeometry();
          sGeo.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
          sGeo.setAttribute('normal', new THREE.Float32BufferAttribute(swNorm, 3));
          sGeo.setAttribute('color', new THREE.Float32BufferAttribute(swCol, 3));
          sidewalkGeometries.push(sGeo);
        }
      }
      // Polygon-based road fallback (e.g. plazas/roundabouts)
      else if (road.rings && road.rings.length > 0) {
        const col = new THREE.Color(road.isAlley ? SAIGON_PALETTES.alleyPavement : SAIGON_PALETTES.mainAsphalt);
        const geo = this.triangulatePolygon(road.rings, 0.08, col);
        if (geo) {
          if (road.isAlley) alleyAsphaltGeometries.push(geo);
          else mainAsphaltGeometries.push(geo);
        }
      }
    }

    // 1. Main Avenues & Streets Asphalt Mesh
    if (mainAsphaltGeometries.length > 0) {
      const mergedMain = BufferGeometryUtils.mergeGeometries(mainAsphaltGeometries, false);
      for (const g of mainAsphaltGeometries) g.dispose();

      if (mergedMain) {
        const roadTexture = TextureGenerator.getRoadTexture();
        const roadMat = new THREE.MeshStandardMaterial({
          map: roadTexture,
          roughness: 0.85,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const mainMesh = new THREE.Mesh(mergedMain, roadMat);
        mainMesh.name = 'roads_main_merged';
        mainMesh.receiveShadow = true;
        group.add(mainMesh);
      }
    }

    // 2. Saigon Alleys Asphalt / Paver Mesh
    if (alleyAsphaltGeometries.length > 0) {
      const mergedAlley = BufferGeometryUtils.mergeGeometries(alleyAsphaltGeometries, false);
      for (const g of alleyAsphaltGeometries) g.dispose();

      if (mergedAlley) {
        const alleyTexture = TextureGenerator.getAlleyTexture();
        const alleyMat = new THREE.MeshStandardMaterial({
          map: alleyTexture,
          roughness: 0.9,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const alleyMesh = new THREE.Mesh(mergedAlley, alleyMat);
        alleyMesh.name = 'roads_alley_merged';
        alleyMesh.receiveShadow = true;
        group.add(alleyMesh);
      }
    }

    // 3. Raised Sidewalk Curbs
    if (sidewalkGeometries.length > 0) {
      const mergedSidewalks = BufferGeometryUtils.mergeGeometries(sidewalkGeometries, false);
      for (const g of sidewalkGeometries) g.dispose();

      if (mergedSidewalks) {
        const sidewalkMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9,
          metalness: 0.02,
          side: THREE.DoubleSide,
        });

        const swMesh = new THREE.Mesh(mergedSidewalks, sidewalkMat);
        swMesh.name = 'roads_sidewalks_merged';
        swMesh.receiveShadow = true;
        group.add(swMesh);
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

      uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
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
      roughness: 0.15,
      metalness: 0.35,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
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
          roughness: 0.88,
          metalness: 0.02,
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
