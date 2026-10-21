import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadNetworkGraph, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';
import { TextureGenerator } from './TextureGenerator';

export class EnvironmentBuilder {
  /**
   * Builds Continuous Paved Road Ribbons with miter corner joints,
   * 3D Raised Sidewalk Curbs, and Architectural Bridge Structures (Girders, Parapets, and Concrete Piers)
   */
  public static buildRoads(roads: RoadPolygonItem[], roadGraph?: RoadNetworkGraph): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_group';

    const mainAsphaltGeometries: THREE.BufferGeometry[] = [];
    const alleyAsphaltGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];
    const intersectionGeometries: THREE.BufferGeometry[] = [];

    // Dedicated bridge structure collections
    const bridgeGirderGeometries: THREE.BufferGeometry[] = [];
    const bridgeParapetGeometries: THREE.BufferGeometry[] = [];
    const bridgePierGeometries: THREE.BufferGeometry[] = [];

    const sidewalkColor = new THREE.Color(SAIGON_PALETTES.sidewalkConcrete);
    const curbDropColor = new THREE.Color(0xb0b8c4); // Neutral concrete curb drop (eliminates blue tint)

    // =========================================================================
    // STEP 1: DETECT & INDEX ALL ROAD JUNCTIONS / CROSSROADS
    // =========================================================================
    interface JunctionPoint {
      x: number;
      z: number;
      radius: number;
      maxRoadWidth: number;
    }

    const junctionDict = new Map<string, { x: number; z: number; maxW: number }>();

    const addJunction = (x: number, z: number, w: number) => {
      const snapKey = `${Math.round(x)}_${Math.round(z)}`;
      const cur = junctionDict.get(snapKey);
      if (cur) {
        if (w > cur.maxW) cur.maxW = w;
      } else {
        junctionDict.set(snapKey, { x, z, maxW: w });
      }
    };

    // 1A. Graph-based junctions (nodes with >= 3 connecting edges: crossroads, T-junctions, forks)
    if (roadGraph) {
      for (const node of roadGraph.nodes.values()) {
        if (node.neighborIds.length >= 3) {
          let maxW = 10.0;
          for (const edge of roadGraph.edges) {
            if (edge.fromId === node.id || edge.toId === node.id) {
              const ew = edge.highway === 'primary' || edge.highway === 'trunk' ? 14.0 :
                         edge.highway === 'secondary' ? 10.0 :
                         edge.isAlley ? 3.5 : 7.0;
              if (ew > maxW) maxW = ew;
            }
          }
          addJunction(node.x, node.z, maxW);
        }
      }
    }

    // 1B. Spatial cross-check: detect meeting points between different roads
    const vertexMap = new Map<string, { roads: Set<string>; maxW: number; x: number; z: number }>();
    for (const r of roads) {
      if (r.path && r.path.length >= 2 && !r.isBridge) {
        for (const pt of r.path) {
          const k = `${Math.round(pt.x)}_${Math.round(pt.z)}`;
          let entry = vertexMap.get(k);
          if (!entry) {
            entry = { roads: new Set(), maxW: r.width, x: pt.x, z: pt.z };
            vertexMap.set(k, entry);
          }
          entry.roads.add(r.id);
          if (r.width > entry.maxW) entry.maxW = r.width;
        }
      }
    }

    for (const entry of vertexMap.values()) {
      if (entry.roads.size >= 2) {
        addJunction(entry.x, entry.z, entry.maxW);
      }
    }

    const junctions: JunctionPoint[] = [];
    for (const j of junctionDict.values()) {
      // Clearance radius covers the junction opening so intersecting sidewalks never cut across lanes
      const radius = Math.max(4.5, (j.maxW / 2) * 1.35);
      junctions.push({ x: j.x, z: j.z, radius, maxRoadWidth: j.maxW });
    }

    // Fast helper to find nearest junction within radius
    const findNearestJunction = (x: number, z: number): { junction: JunctionPoint; dist: number } | null => {
      let bestJ: JunctionPoint | null = null;
      let minDist = Infinity;
      for (let jIdx = 0; jIdx < junctions.length; jIdx++) {
        const j = junctions[jIdx];
        if (Math.abs(x - j.x) > j.radius + 1.0 || Math.abs(z - j.z) > j.radius + 1.0) continue;
        const d = Math.hypot(x - j.x, z - j.z);
        if (d <= j.radius + 0.5 && d < minDist) {
          minDist = d;
          bestJ = j;
        }
      }
      return bestJ ? { junction: bestJ, dist: minDist } : null;
    };

    // =========================================================================
    // STEP 2: CREATE CONTINUOUS ASPHALT JUNCTION CLEARINGS
    // Seamlessly unifies crossroads with solid dark matte asphalt, zero curb slices!
    // =========================================================================
    const jPos: number[] = [];
    const jNorm: number[] = [];
    const jUV: number[] = [];
    const jSegs = 16;
    const jHeight = 0.0815; // 1.5mm above road segment (0.080) to seal seams, well below sidewalk (0.120)

    for (let jIdx = 0; jIdx < junctions.length; jIdx++) {
      const j = junctions[jIdx];
      const r = j.radius * 0.95;
      for (let s = 0; s < jSegs; s++) {
        const a1 = (s * Math.PI * 2) / jSegs;
        const a2 = ((s + 1) * Math.PI * 2) / jSegs;
        const x1 = j.x + Math.cos(a1) * r;
        const z1 = j.z + Math.sin(a1) * r;
        const x2 = j.x + Math.cos(a2) * r;
        const z2 = j.z + Math.sin(a2) * r;

        jPos.push(j.x, jHeight, j.z, x1, jHeight, z1, x2, jHeight, z2);
        for (let k = 0; k < 3; k++) jNorm.push(0, 1, 0);

        jUV.push(0.5, 0.5, 0.5 + Math.cos(a1) * 0.4, 0.5 + Math.sin(a1) * 0.4, 0.5 + Math.cos(a2) * 0.4, 0.5 + Math.sin(a2) * 0.4);
      }
    }

    if (jPos.length > 0) {
      const jGeo = new THREE.BufferGeometry();
      jGeo.setAttribute('position', new THREE.Float32BufferAttribute(jPos, 3));
      jGeo.setAttribute('normal', new THREE.Float32BufferAttribute(jNorm, 3));
      jGeo.setAttribute('uv', new THREE.Float32BufferAttribute(jUV, 2));
      intersectionGeometries.push(jGeo);
    }

    for (const road of roads) {
      if (road.path && road.path.length >= 2) {
        const path = road.path;
        const width = Math.max(2.6, road.width);
        const halfW = width / 2;
        const sidewalkW = road.isAlley ? 0.4 : road.highway === 'primary' || road.highway === 'trunk' ? 1.4 : 0.85;
        const isBridge = !!road.isBridge;
        const elevationProfile = road.elevationProfile;

        // Elevation hierarchy for ground roads
        const defaultAsphaltY = road.isAlley
          ? 0.078
          : road.highway === 'primary'
          ? 0.084
          : road.highway === 'secondary'
          ? 0.082
          : 0.080;
        const defaultSidewalkY = 0.120;

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
              const scale = Math.min(1.2, 1.0 / Math.max(0.75, cosA));
              miterNormals.push({ x: normX, z: normZ, scale });
            } else {
              miterNormals.push({ x: -dIn.z, z: dIn.x, scale: 1 });
            }
          }
        }

        // Step 3: Compute ribbon vertex coordinates with vertical elevation profiles
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
          const ySidewalk = elevationProfile ? elevationProfile[i] + 0.04 : defaultSidewalkY;

          lRoad.push([p.x + m.x * offRoad, yRoad, p.z + m.z * offRoad]);
          rRoad.push([p.x - m.x * offRoad, yRoad, p.z - m.z * offRoad]);

          lSidewalk.push([p.x + m.x * offSw, ySidewalk, p.z + m.z * offSw]);
          rSidewalk.push([p.x - m.x * offSw, ySidewalk, p.z - m.z * offSw]);
        }

        // Step 4: Build Quads between adjacent vertices
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

          // Road Asphalt Quad (Always pushed so asphalt is continuous)
          aPos.push(...p1L, ...p1R, ...p2R);
          aPos.push(...p1L, ...p2R, ...p2L);

          for (let k = 0; k < 6; k++) aNorm.push(0, 1, 0);

          aUV.push(0, v1, 1, v1, 1, v2);
          aUV.push(0, v1, 1, v2, 0, v2);

          // For bridges, generate standard bridge sidewalk & curb
          if (isBridge) {
            const sw1L_in = [p1L[0], sw1L[1], p1L[2]];
            const sw2L_in = [p2L[0], sw2L[1], p2L[2]];
            swPos.push(...sw1L, ...sw1L_in, ...sw2L_in);
            swPos.push(...sw1L, ...sw2L_in, ...sw2L);

            const sw1R_in = [p1R[0], sw1R[1], p1R[2]];
            const sw2R_in = [p2R[0], sw2R[1], p2R[2]];
            swPos.push(...sw1R_in, ...sw1R, ...sw2R);
            swPos.push(...sw1R_in, ...sw2R, ...sw2R_in);

            for (let k = 0; k < 12; k++) {
              swNorm.push(0, 1, 0);
              swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
            }

            swPos.push(...sw1L_in, ...p1L, ...p2L);
            swPos.push(...sw1L_in, ...p2L, ...sw2L_in);
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
          } else {
            // ===============================================================
            // GROUND ROADS: INTERSECTION SIDEWALK CLEARANCE & CURB CAPPING
            // Prevents sidewalks and vertical curbs from cutting through crossroad lanes!
            // ===============================================================
            const nearJ1 = findNearestJunction(path[i].x, path[i].z);
            const nearJ2 = findNearestJunction(path[i + 1].x, path[i + 1].z);

            let clearStart = 0;
            if (nearJ1) {
              clearStart = Math.min(nearJ1.junction.radius - nearJ1.dist + 0.5, segLen * 0.48);
              if (clearStart < 0) clearStart = 0;
            }

            let clearEnd = 0;
            if (nearJ2) {
              clearEnd = Math.min(nearJ2.junction.radius - nearJ2.dist + 0.5, segLen * 0.48);
              if (clearEnd < 0) clearEnd = 0;
            }

            // If the entire segment is inside an intersection clearance zone, omit sidewalks completely
            if (segLen > clearStart + clearEnd + 1.2) {
              const t1 = clearStart;
              const t2 = segLen - clearEnd;

              const sd = segDirs[i];
              const snX = -sd.z;
              const snZ = sd.x;

              const ySw = defaultSidewalkY;
              const yRoad = defaultAsphaltY;

              // Left & right coordinates at t1
              let sw1L_coord: [number, number, number];
              let sw1R_coord: [number, number, number];
              let sw1L_in_coord: [number, number, number];
              let sw1R_in_coord: [number, number, number];
              let curbBaseL_1: [number, number, number];
              let curbBaseR_1: [number, number, number];

              if (t1 <= 0.05) {
                sw1L_coord = lSidewalk[i];
                sw1R_coord = rSidewalk[i];
                sw1L_in_coord = [p1L[0], ySw, p1L[2]];
                sw1R_in_coord = [p1R[0], ySw, p1R[2]];
                curbBaseL_1 = p1L;
                curbBaseR_1 = p1R;
              } else {
                const cx1 = path[i].x + sd.x * t1;
                const cz1 = path[i].z + sd.z * t1;
                const rLx1 = cx1 + snX * halfW;
                const rLz1 = cz1 + snZ * halfW;
                const rRx1 = cx1 - snX * halfW;
                const rRz1 = cz1 - snZ * halfW;

                sw1L_coord = [cx1 + snX * (halfW + sidewalkW), ySw, cz1 + snZ * (halfW + sidewalkW)];
                sw1R_coord = [cx1 - snX * (halfW + sidewalkW), ySw, cz1 - snZ * (halfW + sidewalkW)];
                sw1L_in_coord = [rLx1, ySw, rLz1];
                sw1R_in_coord = [rRx1, ySw, rRz1];
                curbBaseL_1 = [rLx1, yRoad, rLz1];
                curbBaseR_1 = [rRx1, yRoad, rRz1];

                // Clean curb end-cap facing backwards into intersection J1
                swPos.push(...sw1L_coord, ...sw1L_in_coord, ...curbBaseL_1);
                swPos.push(...sw1L_coord, ...curbBaseL_1, sw1L_coord[0], yRoad, sw1L_coord[2]);
                swPos.push(...sw1R_in_coord, ...sw1R_coord, sw1R_coord[0], yRoad, sw1R_coord[2]);
                swPos.push(...sw1R_in_coord, sw1R_coord[0], yRoad, sw1R_coord[2], ...curbBaseR_1);

                for (let k = 0; k < 12; k++) {
                  swNorm.push(-sd.x, 0, -sd.z);
                  swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
                }
              }

              // Left & right coordinates at t2
              let sw2L_coord: [number, number, number];
              let sw2R_coord: [number, number, number];
              let sw2L_in_coord: [number, number, number];
              let sw2R_in_coord: [number, number, number];
              let curbBaseL_2: [number, number, number];
              let curbBaseR_2: [number, number, number];

              if (t2 >= segLen - 0.05) {
                sw2L_coord = lSidewalk[i + 1];
                sw2R_coord = rSidewalk[i + 1];
                sw2L_in_coord = [p2L[0], ySw, p2L[2]];
                sw2R_in_coord = [p2R[0], ySw, p2R[2]];
                curbBaseL_2 = p2L;
                curbBaseR_2 = p2R;
              } else {
                const cx2 = path[i].x + sd.x * t2;
                const cz2 = path[i].z + sd.z * t2;
                const rLx2 = cx2 + snX * halfW;
                const rLz2 = cz2 + snZ * halfW;
                const rRx2 = cx2 - snX * halfW;
                const rRz2 = cz2 - snZ * halfW;

                sw2L_coord = [cx2 + snX * (halfW + sidewalkW), ySw, cz2 + snZ * (halfW + sidewalkW)];
                sw2R_coord = [cx2 - snX * (halfW + sidewalkW), ySw, cz2 - snZ * (halfW + sidewalkW)];
                sw2L_in_coord = [rLx2, ySw, rLz2];
                sw2R_in_coord = [rRx2, ySw, rRz2];
                curbBaseL_2 = [rLx2, yRoad, rLz2];
                curbBaseR_2 = [rRx2, yRoad, rRz2];

                // Clean curb end-cap facing forward into intersection J2
                swPos.push(...sw2L_in_coord, ...sw2L_coord, sw2L_coord[0], yRoad, sw2L_coord[2]);
                swPos.push(...sw2L_in_coord, sw2L_coord[0], yRoad, sw2L_coord[2], ...curbBaseL_2);
                swPos.push(...sw2R_coord, ...sw2R_in_coord, ...curbBaseR_2);
                swPos.push(...sw2R_coord, ...curbBaseR_2, sw2R_coord[0], yRoad, sw2R_coord[2]);

                for (let k = 0; k < 12; k++) {
                  swNorm.push(sd.x, 0, sd.z);
                  swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
                }
              }

              // Top Sidewalk Ribbons
              swPos.push(...sw1L_coord, ...sw1L_in_coord, ...sw2L_in_coord);
              swPos.push(...sw1L_coord, ...sw2L_in_coord, ...sw2L_coord);

              swPos.push(...sw1R_in_coord, ...sw1R_coord, ...sw2R_coord);
              swPos.push(...sw1R_in_coord, ...sw2R_coord, ...sw2R_in_coord);

              for (let k = 0; k < 12; k++) {
                swNorm.push(0, 1, 0);
                swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
              }

              // Vertical Curb Drops (Facing the street)
              swPos.push(...sw1L_in_coord, ...curbBaseL_1, ...curbBaseL_2);
              swPos.push(...sw1L_in_coord, ...curbBaseL_2, ...sw2L_in_coord);

              swPos.push(...curbBaseR_1, ...sw1R_in_coord, ...sw2R_in_coord);
              swPos.push(...curbBaseR_1, ...sw2R_in_coord, ...curbBaseR_2);

              for (let k = 0; k < 6; k++) {
                swNorm.push(-snX, 0, -snZ);
                swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
              }
              for (let k = 0; k < 6; k++) {
                swNorm.push(snX, 0, snZ);
                swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
              }
            }
          }

          // =================================================================
          // 3D BRIDGE STRUCTURAL MODELING (Girders, Safety Parapets, and Piers)
          // =================================================================
          if (isBridge) {
            const m = miterNormals[i];
            const girderDepth = 0.95; // 0.95m concrete girder thickness under deck
            const railH = 0.88;       // 0.88m concrete safety parapet height

            // Girder Bottom Vertices
            const b1L = [sw1L[0], sw1L[1] - girderDepth, sw1L[2]];
            const b1R = [sw1R[0], sw1R[1] - girderDepth, sw1R[2]];
            const b2L = [sw2L[0], sw2L[1] - girderDepth, sw2L[2]];
            const b2R = [sw2R[0], sw2R[1] - girderDepth, sw2R[2]];

            // 1. Concrete Box Girder Underside (Đáy dầm cầu)
            girderPos.push(...b1L, ...b2R, ...b1R);
            girderPos.push(...b1L, ...b2L, ...b2R);
            for (let k = 0; k < 6; k++) girderNorm.push(0, -1, 0);

            // 2. Concrete Girder Outer Fascia (Thành dầm cầu)
            // Left Fascia
            girderPos.push(...sw1L, ...b1L, ...b2L);
            girderPos.push(...sw1L, ...b2L, ...sw2L);
            for (let k = 0; k < 6; k++) girderNorm.push(m.x, 0, m.z);

            // Right Fascia
            girderPos.push(...sw1R, ...b2R, ...b1R);
            girderPos.push(...sw1R, ...sw2R, ...b2R);
            for (let k = 0; k < 6; k++) girderNorm.push(-m.x, 0, -m.z);

            // 3. Safety Parapets & Crash Barriers (Lan can bảo vệ cầu)
            const railTop1L = [sw1L[0], sw1L[1] + railH, sw1L[2]];
            const railTop2L = [sw2L[0], sw2L[1] + railH, sw2L[2]];
            const railTop1R = [sw1R[0], sw1R[1] + railH, sw1R[2]];
            const railTop2R = [sw2R[0], sw2R[1] + railH, sw2R[2]];

            // Left Parapet (Outer & Inner faces)
            parapetPos.push(...sw1L, ...railTop1L, ...railTop2L);
            parapetPos.push(...sw1L, ...railTop2L, ...sw2L);
            parapetPos.push(...sw1L, ...railTop2L, ...railTop1L);
            parapetPos.push(...sw1L, ...sw2L, ...railTop2L);
            for (let k = 0; k < 12; k++) parapetNorm.push(m.x, 0, m.z);

            // Right Parapet (Outer & Inner faces)
            parapetPos.push(...sw1R, ...railTop2R, ...railTop1R);
            parapetPos.push(...sw1R, ...sw2R, ...railTop2R);
            parapetPos.push(...sw1R, ...railTop1R, ...railTop2R);
            parapetPos.push(...sw1R, ...railTop2R, ...sw2R);
            for (let k = 0; k < 12; k++) parapetNorm.push(-m.x, 0, -m.z);

            // 4. Reinforced Concrete Support Piers (Trụ cầu bê tông)
            // Place solid cylindrical concrete piers under elevated spans
            const midElev = (sw1L[1] + sw2L[1]) / 2;
            if (midElev >= 1.6 && cumDist - lastPierDist >= 22) {
              lastPierDist = cumDist;

              const pierCenterX = (path[i].x + path[i + 1].x) / 2;
              const pierCenterZ = (path[i].z + path[i + 1].z) / 2;
              const pierTopY = midElev - girderDepth;
              const pierBottomY = 0.0;
              const pierRadius = Math.min(1.2, halfW * 0.35);

              // 8-sided cylindrical pier column
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

    // 1B. Seamless Asphalt Crossroads & Junction Clearings
    if (intersectionGeometries.length > 0) {
      const mergedIntersections = BufferGeometryUtils.mergeGeometries(intersectionGeometries, false);
      for (const g of intersectionGeometries) g.dispose();

      if (mergedIntersections) {
        const intersectionMat = new THREE.MeshStandardMaterial({
          color: 0x23272f, // Exact dark charcoal matte asphalt
          roughness: 0.85,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });

        const interMesh = new THREE.Mesh(mergedIntersections, intersectionMat);
        interMesh.name = 'roads_intersections_merged';
        interMesh.receiveShadow = true;
        group.add(interMesh);
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
