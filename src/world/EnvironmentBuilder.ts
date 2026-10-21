import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadNetworkGraph, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';
import { TextureGenerator } from './TextureGenerator';

export class EnvironmentBuilder {
  /**
  /**
   * Builds Continuous Paved Road Ribbons with miter corner joints,
   * Clean Light Concrete Sidewalk Borders, and Architectural Bridge Structures.
   *
   * Elevation Hierarchy for 100% Seamless Intersections:
   * - Primary/Trunk Asphalt: y = 0.084
   * - Secondary Asphalt:     y = 0.083
   * - Residential Asphalt:   y = 0.082
   * - Saigon Alley Pavers:   y = 0.080
   * - Sidewalk Base Ribbon:  y = 0.078
   *
   * Because all asphalt layers (0.080 - 0.084) are higher than the sidewalk base (0.078),
   * whenever roads cross or connect at any angle (T-junctions, crossroads, forks),
   * the asphalt smoothly and automatically covers the sidewalk inside the intersection!
   * Zero curb cuts, zero broken teeth, zero circular blotches!
   */
  public static buildRoads(roads: RoadPolygonItem[], _roadGraph?: RoadNetworkGraph): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_group';

    const mainAsphaltGeometries: THREE.BufferGeometry[] = [];
    const alleyAsphaltGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];

    // Dedicated bridge structure collections
    const bridgeGirderGeometries: THREE.BufferGeometry[] = [];
    const bridgeParapetGeometries: THREE.BufferGeometry[] = [];
    const bridgePierGeometries: THREE.BufferGeometry[] = [];

    const sidewalkColor = new THREE.Color(0xe2e4e8); // Clean light architectural concrete
    const curbEdgeColor = new THREE.Color(0xb0b8c4); // Soft concrete edge drop shadow

    for (const road of roads) {
      if (road.path && road.path.length >= 2) {
        const path = road.path;
        const width = Math.max(2.6, road.width);
        const halfW = width / 2;
        const isAlley = !!road.isAlley;
        const isBridge = !!road.isBridge;
        const elevationProfile = road.elevationProfile;

        // Sidewalk width (alleys are shared streets without separate sidewalk)
        const sidewalkW = isAlley
          ? 0.0
          : road.highway === 'primary' || road.highway === 'trunk'
          ? 1.5
          : road.highway === 'secondary'
          ? 1.1
          : 0.9;

        // Elevation hierarchy: asphalt overrides sidewalk at intersections automatically
        const defaultAsphaltY = isAlley
          ? 0.080
          : road.highway === 'primary' || road.highway === 'trunk'
          ? 0.084
          : road.highway === 'secondary'
          ? 0.083
          : 0.082;
        const defaultSidewalkY = 0.078;

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
              const scale = Math.min(1.25, 1.0 / Math.max(0.7, cosA));
              miterNormals.push({ x: normX, z: normZ, scale });
            } else {
              miterNormals.push({ x: -dIn.z, z: dIn.x, scale: 1 });
            }
          }
        }

        // Step 3: Compute coordinates
        const lRoad: Array<[number, number, number]> = [];
        const rRoad: Array<[number, number, number]> = [];
        const lSidewalk: Array<[number, number, number]> = [];
        const rSidewalk: Array<[number, number, number]> = [];

        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          const m = miterNormals[i];

          const offRoad = halfW * m.scale;
          const offSw = (halfW + sidewalkW) * m.scale;

          const yRoad = elevationProfile ? elevationProfile[i] : defaultAsphaltY;
          const ySidewalk = elevationProfile ? elevationProfile[i] - 0.004 : defaultSidewalkY;

          lRoad.push([p.x + m.x * offRoad, yRoad, p.z + m.z * offRoad]);
          rRoad.push([p.x - m.x * offRoad, yRoad, p.z - m.z * offRoad]);

          lSidewalk.push([p.x + m.x * offSw, ySidewalk, p.z + m.z * offSw]);
          rSidewalk.push([p.x - m.x * offSw, ySidewalk, p.z - m.z * offSw]);
        }

        // Step 4: Build continuous quads along segments
        const aPos: number[] = [];
        const aNorm: number[] = [];
        const aUV: number[] = [];

        const swPos: number[] = [];
        const swNorm: number[] = [];
        const swCol: number[] = [];

        // Bridge structure arrays
        const girderPos: number[] = [];
        const girderNorm: number[] = [];
        const parapetPos: number[] = [];
        const parapetNorm: number[] = [];
        const pierPos: number[] = [];
        const pierNorm: number[] = [];

        let cumDist = 0;
        let lastPierDist = -999;

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

          // 1. Road Driving Surface Quad
          aPos.push(...p1L, ...p1R, ...p2R);
          aPos.push(...p1L, ...p2R, ...p2L);

          for (let k = 0; k < 6; k++) aNorm.push(0, 1, 0);

          aUV.push(0, v1, 1, v1, 1, v2);
          aUV.push(0, v1, 1, v2, 0, v2);

          // 2. Continuous Sidewalk Ribbons (Light concrete borders alongside road)
          if (!isBridge && sidewalkW > 0) {
            const sw1L_in = [p1L[0], defaultSidewalkY, p1L[2]];
            const sw2L_in = [p2L[0], defaultSidewalkY, p2L[2]];
            const sw1R_in = [p1R[0], defaultSidewalkY, p1R[2]];
            const sw2R_in = [p2R[0], defaultSidewalkY, p2R[2]];

            // Left sidewalk top surface
            swPos.push(...sw1L, ...sw1L_in, ...sw2L_in);
            swPos.push(...sw1L, ...sw2L_in, ...sw2L);

            // Right sidewalk top surface
            swPos.push(...sw1R_in, ...sw1R, ...sw2R);
            swPos.push(...sw1R_in, ...sw2R, ...sw2R_in);

            for (let k = 0; k < 12; k++) {
              swNorm.push(0, 1, 0);
              swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
            }

            // Outer curb drop (from sidewalk outer edge 0.078 down to ground 0.0)
            const m = miterNormals[i];
            const dropY = 0.0;
            // Left outer drop
            swPos.push(sw1L[0], sw1L[1], sw1L[2], sw1L[0], dropY, sw1L[2], sw2L[0], dropY, sw2L[2]);
            swPos.push(sw1L[0], sw1L[1], sw1L[2], sw2L[0], dropY, sw2L[2], sw2L[0], sw2L[1], sw2L[2]);
            // Right outer drop
            swPos.push(sw1R[0], dropY, sw1R[2], sw1R[0], sw1R[1], sw1R[2], sw2R[0], sw2R[1], sw2R[2]);
            swPos.push(sw1R[0], dropY, sw1R[2], sw2R[0], sw2R[1], sw2R[2], sw2R[0], dropY, sw2R[2]);

            for (let k = 0; k < 6; k++) {
              swNorm.push(m.x, 0, m.z);
              swCol.push(curbEdgeColor.r, curbEdgeColor.g, curbEdgeColor.b);
            }
            for (let k = 0; k < 6; k++) {
              swNorm.push(-m.x, 0, -m.z);
              swCol.push(curbEdgeColor.r, curbEdgeColor.g, curbEdgeColor.b);
            }
          }

          // 3. 3D Architectural Bridge Modeling (Girders, Safety Parapets, and Concrete Piers)
          if (isBridge) {
            const m = miterNormals[i];
            const girderDepth = 0.95;
            const railH = 0.88;

            const b1L = [sw1L[0], sw1L[1] - girderDepth, sw1L[2]];
            const b1R = [sw1R[0], sw1R[1] - girderDepth, sw1R[2]];
            const b2L = [sw2L[0], sw2L[1] - girderDepth, sw2L[2]];
            const b2R = [sw2R[0], sw2R[1] - girderDepth, sw2R[2]];

            // Concrete Box Girder Underside
            girderPos.push(...b1L, ...b2R, ...b1R);
            girderPos.push(...b1L, ...b2L, ...b2R);
            for (let k = 0; k < 6; k++) girderNorm.push(0, -1, 0);

            // Concrete Girder Outer Fascia
            girderPos.push(...sw1L, ...b1L, ...b2L);
            girderPos.push(...sw1L, ...b2L, ...sw2L);
            for (let k = 0; k < 6; k++) girderNorm.push(m.x, 0, m.z);

            girderPos.push(...sw1R, ...b2R, ...b1R);
            girderPos.push(...sw1R, ...sw2R, ...b2R);
            for (let k = 0; k < 6; k++) girderNorm.push(-m.x, 0, -m.z);

            // Safety Parapets
            const railTop1L = [sw1L[0], sw1L[1] + railH, sw1L[2]];
            const railTop2L = [sw2L[0], sw2L[1] + railH, sw2L[2]];
            const railTop1R = [sw1R[0], sw1R[1] + railH, sw1R[2]];
            const railTop2R = [sw2R[0], sw2R[1] + railH, sw2R[2]];

            parapetPos.push(...sw1L, ...railTop1L, ...railTop2L);
            parapetPos.push(...sw1L, ...railTop2L, ...sw2L);
            parapetPos.push(...sw1L, ...railTop2L, ...railTop1L);
            parapetPos.push(...sw1L, ...sw2L, ...railTop2L);
            for (let k = 0; k < 12; k++) parapetNorm.push(m.x, 0, m.z);

            parapetPos.push(...sw1R, ...railTop2R, ...railTop1R);
            parapetPos.push(...sw1R, ...sw2R, ...railTop2R);
            parapetPos.push(...sw1R, ...railTop1R, ...railTop2R);
            parapetPos.push(...sw1R, ...railTop2R, ...sw2R);
            for (let k = 0; k < 12; k++) parapetNorm.push(-m.x, 0, -m.z);

            // Reinforced Concrete Support Piers
            const midElev = (sw1L[1] + sw2L[1]) / 2;
            if (midElev >= 1.6 && cumDist - lastPierDist >= 22) {
              lastPierDist = cumDist;
              const pierCenterX = (path[i].x + path[i + 1].x) / 2;
              const pierCenterZ = (path[i].z + path[i + 1].z) / 2;
              const pierTopY = midElev - girderDepth;
              const pierBottomY = 0.0;
              const pierRadius = Math.min(1.2, halfW * 0.35);

              const sides = 8;
              for (let s = 0; s < sides; s++) {
                const a1 = (s * Math.PI * 2) / sides;
                const a2 = ((s + 1) * Math.PI * 2) / sides;
                const px1 = pierCenterX + Math.cos(a1) * pierRadius;
                const pz1 = pierCenterZ + Math.sin(a1) * pierRadius;
                const px2 = pierCenterX + Math.cos(a2) * pierRadius;
                const pz2 = pierCenterZ + Math.sin(a2) * pierRadius;

                pierPos.push(px1, pierBottomY, pz1, px2, pierBottomY, pz2, px2, pierTopY, pz2);
                pierPos.push(px1, pierBottomY, pz1, px2, pierTopY, pz2, px1, pierTopY, pz1);

                const cNormX = (Math.cos(a1) + Math.cos(a2)) / 2;
                const cNormZ = (Math.sin(a1) + Math.sin(a2)) / 2;
                for (let k = 0; k < 6; k++) pierNorm.push(cNormX, 0, cNormZ);
              }
            }
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

        if (girderPos.length > 0) {
          const gGeo = new THREE.BufferGeometry();
          gGeo.setAttribute('position', new THREE.Float32BufferAttribute(girderPos, 3));
          gGeo.setAttribute('normal', new THREE.Float32BufferAttribute(girderNorm, 3));
          bridgeGirderGeometries.push(gGeo);
        }

        if (parapetPos.length > 0) {
          const pGeo = new THREE.BufferGeometry();
          pGeo.setAttribute('position', new THREE.Float32BufferAttribute(parapetPos, 3));
          pGeo.setAttribute('normal', new THREE.Float32BufferAttribute(parapetNorm, 3));
          bridgeParapetGeometries.push(pGeo);
        }

        if (pierPos.length > 0) {
          const pierGeo = new THREE.BufferGeometry();
          pierGeo.setAttribute('position', new THREE.Float32BufferAttribute(pierPos, 3));
          pierGeo.setAttribute('normal', new THREE.Float32BufferAttribute(pierNorm, 3));
          bridgePierGeometries.push(pierGeo);
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

    // 4. Bridge Concrete Girders (Dầm cầu bê tông cốt thép)
    if (bridgeGirderGeometries.length > 0) {
      const mergedGirders = BufferGeometryUtils.mergeGeometries(bridgeGirderGeometries, false);
      for (const g of bridgeGirderGeometries) g.dispose();

      if (mergedGirders) {
        const girderMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8, // Clean architectural concrete grey
          roughness: 0.85,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        const girderMesh = new THREE.Mesh(mergedGirders, girderMat);
        girderMesh.name = 'bridge_girders_merged';
        girderMesh.castShadow = true;
        girderMesh.receiveShadow = true;
        group.add(girderMesh);
      }
    }

    // 5. Bridge Safety Parapets (Lan can cầu)
    if (bridgeParapetGeometries.length > 0) {
      const mergedParapets = BufferGeometryUtils.mergeGeometries(bridgeParapetGeometries, false);
      for (const g of bridgeParapetGeometries) g.dispose();

      if (mergedParapets) {
        const parapetMat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc, // Clean safety white
          roughness: 0.75,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        const parapetMesh = new THREE.Mesh(mergedParapets, parapetMat);
        parapetMesh.name = 'bridge_parapets_merged';
        parapetMesh.castShadow = true;
        parapetMesh.receiveShadow = true;
        group.add(parapetMesh);
      }
    }

    // 6. Bridge Concrete Piers (Trụ cầu bê tông)
    if (bridgePierGeometries.length > 0) {
      const mergedPiers = BufferGeometryUtils.mergeGeometries(bridgePierGeometries, false);
      for (const g of bridgePierGeometries) g.dispose();

      if (mergedPiers) {
        const pierMat = new THREE.MeshStandardMaterial({
          color: 0x64748b, // Sturdy reinforced concrete
          roughness: 0.9,
          metalness: 0.05,
        });
        const pierMesh = new THREE.Mesh(mergedPiers, pierMat);
        pierMesh.name = 'bridge_piers_merged';
        pierMesh.castShadow = true;
        pierMesh.receiveShadow = true;
        group.add(pierMesh);
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
