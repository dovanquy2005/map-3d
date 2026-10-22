import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { MetricPoint, ParkPolygonItem, RoadNetworkGraph, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';
import { TextureGenerator } from './TextureGenerator';

interface ConnectedBranch {
  roadId: string;
  road: RoadPolygonItem;
  endpoint: 'start' | 'end';
  dirX: number; // outward direction leaving node
  dirZ: number;
  normX: number;
  normZ: number;
  width: number;
  halfW: number;
  angle: number; // Math.atan2(dirZ, dirX)
  baseY: number;
}

interface IntersectionNode {
  key: string;
  x: number;
  z: number;
  branches: ConnectedBranch[];
  maxRoadWidth: number;
  pullbackDist: number;
  junctionRadius: number;
  isBridge: boolean;
  elevation: number;
}

export class EnvironmentBuilder {
  /**
   * Refactored 3D Road Network Builder:
   * 1. Eliminates black circular disks completely - smooth Miter / Bevel joins at all vertices.
   * 2. Intersection Graph with seamless asphalt patches (single patch per junction, identical asphalt material).
   * 3. Road Markings with Pullback: lane markings stop before intersections; Stop Lines & Zebra Crossings at boundaries.
   * 4. Strict Elevation Hierarchy (Ground 0.00m, Water 0.01m, Parks 0.02m, Intersection 0.040m, Roads 0.042m-0.052m, Markings +0.008m, Sidewalk 0.15m).
   * 5. Single Draw Call Batching for maximum performance and 60 FPS.
   */
  public static buildRoads(roads: RoadPolygonItem[], roadGraph?: RoadNetworkGraph): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads_group';

    const asphaltGeometries: THREE.BufferGeometry[] = [];
    const markingsGeometries: THREE.BufferGeometry[] = [];
    const sidewalkGeometries: THREE.BufferGeometry[] = [];

    // Dedicated bridge structure collections
    const bridgeGirderGeometries: THREE.BufferGeometry[] = [];
    const bridgeParapetGeometries: THREE.BufferGeometry[] = [];
    const bridgePierGeometries: THREE.BufferGeometry[] = [];

    const sidewalkColor = new THREE.Color(SAIGON_PALETTES.sidewalkConcrete);
    const curbDropColor = new THREE.Color(SAIGON_PALETTES.curbDropColor);
    const whiteMarkingColor = new THREE.Color(SAIGON_PALETTES.roadMarkingWhite);
    const yellowMarkingColor = new THREE.Color(SAIGON_PALETTES.roadMarkingYellow);

    // =========================================================================
    // STEP 1: BUILD INTERSECTION GRAPH & CLASSIFY NODES (0.1m QUANTIZATION)
    // =========================================================================
    const snapCoord = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
    const snapKey = (x: number, z: number) => `${snapCoord(x)}_${snapCoord(z)}`;

    const nodeBranchMap = new Map<string, { x: number; z: number; branches: ConnectedBranch[] }>();

    const getRoadBaseY = (r: RoadPolygonItem): number => {
      if (r.isBridge) return 3.8;
      if (r.isAlley) return 0.042;
      if (r.highway === 'residential' || r.highway === 'unclassified') return 0.045;
      if (r.highway === 'tertiary' || r.highway === 'secondary') return 0.048;
      return 0.052; // primary, trunk, motorway
    };

    // Register all endpoints into nodeBranchMap
    for (const r of roads) {
      if (!r.path || r.path.length < 2) continue;
      const path = r.path;
      const N = path.length;
      const width = Math.max(2.4, r.width);
      const halfW = width / 2;
      const baseY = getRoadBaseY(r);

      // Start point P0 (leaving direction P0 -> P1)
      const d0x = path[1].x - path[0].x;
      const d0z = path[1].z - path[0].z;
      const len0 = Math.hypot(d0x, d0z) || 1;
      const dir0X = d0x / len0;
      const dir0Z = d0z / len0;
      const k0 = snapKey(path[0].x, path[0].z);

      let e0 = nodeBranchMap.get(k0);
      if (!e0) {
        e0 = { x: path[0].x, z: path[0].z, branches: [] };
        nodeBranchMap.set(k0, e0);
      }
      e0.branches.push({
        roadId: r.id,
        road: r,
        endpoint: 'start',
        dirX: dir0X,
        dirZ: dir0Z,
        normX: -dir0Z,
        normZ: dir0X,
        width,
        halfW,
        angle: Math.atan2(dir0Z, dir0X),
        baseY,
      });

      // End point P_{N-1} (leaving direction P_{N-1} -> P_{N-2})
      const d1x = path[N - 2].x - path[N - 1].x;
      const d1z = path[N - 2].z - path[N - 1].z;
      const len1 = Math.hypot(d1x, d1z) || 1;
      const dir1X = d1x / len1;
      const dir1Z = d1z / len1;
      const k1 = snapKey(path[N - 1].x, path[N - 1].z);

      let e1 = nodeBranchMap.get(k1);
      if (!e1) {
        e1 = { x: path[N - 1].x, z: path[N - 1].z, branches: [] };
        nodeBranchMap.set(k1, e1);
      }
      e1.branches.push({
        roadId: r.id,
        road: r,
        endpoint: 'end',
        dirX: dir1X,
        dirZ: dir1Z,
        normX: -dir1Z,
        normZ: dir1X,
        width,
        halfW,
        angle: Math.atan2(dir1Z, dir1X),
        baseY,
      });
    }

    // Classify nodes: Intersections are nodes with >= 3 branches, OR 2 branches meeting at non-smooth angle
    const intersections = new Map<string, IntersectionNode>();

    for (const [k, entry] of nodeBranchMap.entries()) {
      let isJunction = false;

      if (entry.branches.length >= 3) {
        isJunction = true;
      } else if (entry.branches.length === 2) {
        const b1 = entry.branches[0];
        const b2 = entry.branches[1];
        // Dot product between directions: -1 means straight continuation
        const dot = b1.dirX * b2.dirX + b1.dirZ * b2.dirZ;
        // If angle between branches is sharper than ~145 degrees or different road IDs meet
        if (dot > -0.82 || b1.roadId !== b2.roadId) {
          isJunction = true;
        }
      }

      if (isJunction) {
        const maxRoadWidth = Math.max(...entry.branches.map((b) => b.width));
        const pullbackDist = Math.max(5.5, maxRoadWidth * 0.75);
        const junctionRadius = Math.max(3.8, maxRoadWidth * 0.55);
        const isBridge = entry.branches.some((b) => b.road.isBridge);
        const elevation = isBridge ? 3.8 : 0.040; // 0.040m intersection patch

        // Sort branches radially in clockwise order
        entry.branches.sort((a, b) => a.angle - b.angle);

        intersections.set(k, {
          key: k,
          x: entry.x,
          z: entry.z,
          branches: entry.branches,
          maxRoadWidth,
          pullbackDist,
          junctionRadius,
          isBridge,
          elevation,
        });
      }
    }

    // Helper: Find nearest intersection within pullback zone
    const findNearestIntersection = (
      x: number,
      z: number
    ): { node: IntersectionNode; dist: number } | null => {
      let bestNode: IntersectionNode | null = null;
      let minDist = Infinity;
      for (const node of intersections.values()) {
        if (Math.abs(x - node.x) > node.pullbackDist + 1.5 || Math.abs(z - node.z) > node.pullbackDist + 1.5) {
          continue;
        }
        const d = Math.hypot(x - node.x, z - node.z);
        if (d <= node.pullbackDist + 0.5 && d < minDist) {
          minDist = d;
          bestNode = node;
        }
      }
      return bestNode ? { node: bestNode, dist: minDist } : null;
    };

    // =========================================================================
    // STEP 2: BUILD SEAMLESS ASPHALT INTERSECTION PATCHES (1 PER JUNCTION)
    // Eliminates black circle disks completely - uses authentic asphalt material!
    // =========================================================================
    const patchPositions: number[] = [];
    const patchNormals: number[] = [];
    const patchUVs: number[] = [];

    for (const node of intersections.values()) {
      if (node.branches.length < 2) continue;

      const patchElev = node.elevation;
      const boundaryPts: Array<{ x: number; z: number }> = [];

      for (const b of node.branches) {
        const dist = Math.max(node.junctionRadius, b.halfW * 1.1);
        const cx = node.x + b.dirX * dist;
        const cz = node.z + b.dirZ * dist;

        // Left and right corners of road branch entrance
        boundaryPts.push({
          x: cx + b.normX * b.halfW,
          z: cz + b.normZ * b.halfW,
        });
        boundaryPts.push({
          x: cx - b.normX * b.halfW,
          z: cz - b.normZ * b.halfW,
        });
      }

      // Sort perimeter boundary points radially around junction center
      boundaryPts.sort((p1, p2) => {
        const a1 = Math.atan2(p1.z - node.z, p1.x - node.x);
        const a2 = Math.atan2(p2.z - node.z, p2.x - node.x);
        return a1 - a2;
      });

      // Triangulate radial fan around center point
      const count = boundaryPts.length;
      for (let i = 0; i < count; i++) {
        const p1 = boundaryPts[i];
        const p2 = boundaryPts[(i + 1) % count];

        patchPositions.push(node.x, patchElev, node.z);
        patchPositions.push(p1.x, patchElev, p1.z);
        patchPositions.push(p2.x, patchElev, p2.z);

        for (let k = 0; k < 3; k++) {
          patchNormals.push(0, 1, 0);
        }

        patchUVs.push(node.x * 0.05, node.z * 0.05);
        patchUVs.push(p1.x * 0.05, p1.z * 0.05);
        patchUVs.push(p2.x * 0.05, p2.z * 0.05);
      }
    }

    if (patchPositions.length > 0) {
      const patchGeo = new THREE.BufferGeometry();
      patchGeo.setAttribute('position', new THREE.Float32BufferAttribute(patchPositions, 3));
      patchGeo.setAttribute('normal', new THREE.Float32BufferAttribute(patchNormals, 3));
      patchGeo.setAttribute('uv', new THREE.Float32BufferAttribute(patchUVs, 2));
      asphaltGeometries.push(patchGeo);
    }

    // =========================================================================
    // STEP 3: BUILD CONTINUOUS ROAD STRIPS (MITER & BEVEL JOIN)
    // No circle geometry at vertices - continuous miter strips across all bends!
    // =========================================================================
    for (const road of roads) {
      if (!road.path || road.path.length < 2) continue;
      const path = road.path;
      const N = path.length;
      const width = Math.max(2.4, road.width);
      const halfW = width / 2;
      const sidewalkW = road.isAlley ? 0.4 : road.highway === 'primary' || road.highway === 'trunk' ? 1.4 : 0.95;
      const isBridge = !!road.isBridge;
      const elevationProfile = road.elevationProfile;
      const asphaltY = getRoadBaseY(road);
      const sidewalkY = 0.15; // Raised sidewalk top at 0.15m

      // 3A. Calculate segment directions and lengths
      const segDirs: Array<{ x: number; z: number; len: number }> = [];
      for (let i = 0; i < N - 1; i++) {
        const dx = path[i + 1].x - path[i].x;
        const dz = path[i + 1].z - path[i].z;
        const len = Math.hypot(dx, dz);
        segDirs.push({
          x: len > 0.001 ? dx / len : 0,
          z: len > 0.001 ? dz / len : 1,
          len,
        });
      }

      // 3B. Calculate Miter / Bevel vertex normals at each path point
      // Implements miterLimit = 2.5 * halfW to prevent spikes at sharp corners
      const miterNormals: Array<{ x: number; z: number; scale: number }> = [];
      for (let i = 0; i < N; i++) {
        if (i === 0) {
          const d = segDirs[0];
          miterNormals.push({ x: -d.z, z: d.x, scale: 1 });
        } else if (i === N - 1) {
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
            // Clamped miter join (bevel limit 2.5)
            const scale = Math.min(2.5, 1.0 / Math.max(0.35, cosA));
            miterNormals.push({ x: normX, z: normZ, scale });
          } else {
            miterNormals.push({ x: -dIn.z, z: dIn.x, scale: 1 });
          }
        }
      }

      // 3C. Compute ribbon left/right coordinates
      const lRoad: Array<[number, number, number]> = [];
      const rRoad: Array<[number, number, number]> = [];
      const lSidewalk: Array<[number, number, number]> = [];
      const rSidewalk: Array<[number, number, number]> = [];

      for (let i = 0; i < N; i++) {
        const p = path[i];
        const m = miterNormals[i];

        const offRoad = halfW * m.scale;
        const offSw = (halfW + sidewalkW) * m.scale;

        const yRoad = elevationProfile ? elevationProfile[i] : asphaltY;
        const ySw = elevationProfile ? elevationProfile[i] + 0.04 : sidewalkY;

        lRoad.push([p.x + m.x * offRoad, yRoad, p.z + m.z * offRoad]);
        rRoad.push([p.x - m.x * offRoad, yRoad, p.z - m.z * offRoad]);

        lSidewalk.push([p.x + m.x * offSw, ySw, p.z + m.z * offSw]);
        rSidewalk.push([p.x - m.x * offSw, ySw, p.z - m.z * offSw]);
      }

      // 3D. Build Road Asphalt Geometry
      const rPos: number[] = [];
      const rNorm: number[] = [];
      const rUV: number[] = [];

      const swPos: number[] = [];
      const swNorm: number[] = [];
      const swCol: number[] = [];

      // Bridge arrays
      const girderPos: number[] = [];
      const girderNorm: number[] = [];
      const parapetPos: number[] = [];
      const parapetNorm: number[] = [];
      const pierPos: number[] = [];
      const pierNorm: number[] = [];

      let cumDist = 0;
      let lastPierDist = -999;

      for (let i = 0; i < N - 1; i++) {
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

        const v1 = cumDist * 0.05;
        const v2 = (cumDist + segLen) * 0.05;
        cumDist += segLen;

        // Continuous Asphalt Quad
        rPos.push(...p1L, ...p1R, ...p2R);
        rPos.push(...p1L, ...p2R, ...p2L);

        for (let k = 0; k < 6; k++) {
          rNorm.push(0, 1, 0);
        }

        rUV.push(0, v1, 1, v1, 1, v2);
        rUV.push(0, v1, 1, v2, 0, v2);

        // 3E. Sidewalks with Intersection Clearance (Curbs never cut across lanes)
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

          // Curb drop facing road
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

          // Bridge 3D Structural Modeling
          const girderDepth = 0.95;
          const railH = 0.88;
          const b1L = [sw1L[0], sw1L[1] - girderDepth, sw1L[2]];
          const b1R = [sw1R[0], sw1R[1] - girderDepth, sw1R[2]];
          const b2L = [sw2L[0], sw2L[1] - girderDepth, sw2L[2]];
          const b2R = [sw2R[0], sw2R[1] - girderDepth, sw2R[2]];

          // Girder Underside
          girderPos.push(...b1L, ...b2R, ...b1R);
          girderPos.push(...b1L, ...b2L, ...b2R);
          for (let k = 0; k < 6; k++) girderNorm.push(0, -1, 0);

          // Girder Outer Fascia
          girderPos.push(...sw1L, ...b1L, ...b2L);
          girderPos.push(...sw1L, ...b2L, ...sw2L);
          for (let k = 0; k < 6; k++) girderNorm.push(m.x, 0, m.z);

          girderPos.push(...sw1R, ...b2R, ...b1R);
          girderPos.push(...sw1R, ...sw2R, ...b2R);
          for (let k = 0; k < 6; k++) girderNorm.push(-m.x, 0, -m.z);

          // Parapets
          const railTop1L = [sw1L[0], sw1L[1] + railH, sw1L[2]];
          const railTop2L = [sw2L[0], sw2L[1] + railH, sw2L[2]];
          const railTop1R = [sw1R[0], sw1R[1] + railH, sw1R[2]];
          const railTop2R = [sw2R[0], sw2R[1] + railH, sw2R[2]];

          parapetPos.push(...sw1L, ...railTop1L, ...railTop2L);
          parapetPos.push(...sw1L, ...railTop2L, ...sw2L);
          parapetPos.push(...sw1R, ...railTop2R, ...railTop1R);
          parapetPos.push(...sw1R, ...sw2R, ...railTop2R);
          for (let k = 0; k < 6; k++) parapetNorm.push(m.x, 0, m.z);
          for (let k = 0; k < 6; k++) parapetNorm.push(-m.x, 0, -m.z);

          // Concrete Support Piers
          const midElev = (sw1L[1] + sw2L[1]) / 2;
          if (midElev >= 1.6 && cumDist - lastPierDist >= 22) {
            lastPierDist = cumDist;
            const pierCenterX = (path[i].x + path[i + 1].x) / 2;
            const pierCenterZ = (path[i].z + path[i + 1].z) / 2;
            const pierTopY = midElev - girderDepth;
            const pierRadius = Math.min(1.2, halfW * 0.35);

            for (let s = 0; s < 8; s++) {
              const a1 = (s * Math.PI * 2) / 8;
              const a2 = ((s + 1) * Math.PI * 2) / 8;
              const px1 = pierCenterX + Math.cos(a1) * pierRadius;
              const pz1 = pierCenterZ + Math.sin(a1) * pierRadius;
              const px2 = pierCenterX + Math.cos(a2) * pierRadius;
              const pz2 = pierCenterZ + Math.sin(a2) * pierRadius;

              pierPos.push(px1, 0, pz1, px2, 0, pz2, px2, pierTopY, pz2);
              pierPos.push(px1, 0, pz1, px2, pierTopY, pz2, px1, pierTopY, pz1);

              const cNormX = (Math.cos(a1) + Math.cos(a2)) / 2;
              const cNormZ = (Math.sin(a1) + Math.sin(a2)) / 2;
              for (let k = 0; k < 6; k++) pierNorm.push(cNormX, 0, cNormZ);
            }
          }
        } else {
          // Ground Roads: Sidewalk Stop at Intersection
          const nearJ1 = findNearestIntersection(path[i].x, path[i].z);
          const nearJ2 = findNearestIntersection(path[i + 1].x, path[i + 1].z);

          let clearStart = nearJ1 ? Math.min(nearJ1.node.junctionRadius - nearJ1.dist + 0.3, segLen * 0.48) : 0;
          if (clearStart < 0) clearStart = 0;
          let clearEnd = nearJ2 ? Math.min(nearJ2.node.junctionRadius - nearJ2.dist + 0.3, segLen * 0.48) : 0;
          if (clearEnd < 0) clearEnd = 0;

          if (segLen > clearStart + clearEnd + 1.2) {
            const t1 = clearStart;
            const t2 = segLen - clearEnd;
            const sd = segDirs[i];
            const snX = -sd.z;
            const snZ = sd.x;

            const ySw = sidewalkY;
            const yRoad = asphaltY;

            let sw1L_c: [number, number, number], sw1R_c: [number, number, number];
            let sw1L_in: [number, number, number], sw1R_in: [number, number, number];
            let curbBaseL1: [number, number, number], curbBaseR1: [number, number, number];

            if (t1 <= 0.05) {
              sw1L_c = lSidewalk[i];
              sw1R_c = rSidewalk[i];
              sw1L_in = [p1L[0], ySw, p1L[2]];
              sw1R_in = [p1R[0], ySw, p1R[2]];
              curbBaseL1 = p1L;
              curbBaseR1 = p1R;
            } else {
              const cx1 = path[i].x + sd.x * t1;
              const cz1 = path[i].z + sd.z * t1;
              const rLx1 = cx1 + snX * halfW;
              const rLz1 = cz1 + snZ * halfW;
              const rRx1 = cx1 - snX * halfW;
              const rRz1 = cz1 - snZ * halfW;

              sw1L_c = [cx1 + snX * (halfW + sidewalkW), ySw, cz1 + snZ * (halfW + sidewalkW)];
              sw1R_c = [cx1 - snX * (halfW + sidewalkW), ySw, cz1 - snZ * (halfW + sidewalkW)];
              sw1L_in = [rLx1, ySw, rLz1];
              sw1R_in = [rRx1, ySw, rRz1];
              curbBaseL1 = [rLx1, yRoad, rLz1];
              curbBaseR1 = [rRx1, yRoad, rRz1];

              // Clean curb end-cap facing backwards into junction
              swPos.push(...sw1L_c, ...sw1L_in, ...curbBaseL1);
              swPos.push(...sw1L_c, ...curbBaseL1, sw1L_c[0], yRoad, sw1L_c[2]);
              swPos.push(...sw1R_in, ...sw1R_c, sw1R_c[0], yRoad, sw1R_c[2]);
              swPos.push(...sw1R_in, sw1R_c[0], yRoad, sw1R_c[2], ...curbBaseR1);

              for (let k = 0; k < 12; k++) {
                swNorm.push(-sd.x, 0, -sd.z);
                swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
              }
            }

            let sw2L_c: [number, number, number], sw2R_c: [number, number, number];
            let sw2L_in: [number, number, number], sw2R_in: [number, number, number];
            let curbBaseL2: [number, number, number], curbBaseR2: [number, number, number];

            if (t2 >= segLen - 0.05) {
              sw2L_c = lSidewalk[i + 1];
              sw2R_c = rSidewalk[i + 1];
              sw2L_in = [p2L[0], ySw, p2L[2]];
              sw2R_in = [p2R[0], ySw, p2R[2]];
              curbBaseL2 = p2L;
              curbBaseR2 = p2R;
            } else {
              const cx2 = path[i].x + sd.x * t2;
              const cz2 = path[i].z + sd.z * t2;
              const rLx2 = cx2 + snX * halfW;
              const rLz2 = cz2 + snZ * halfW;
              const rRx2 = cx2 - snX * halfW;
              const rRz2 = cz2 - snZ * halfW;

              sw2L_c = [cx2 + snX * (halfW + sidewalkW), ySw, cz2 + snZ * (halfW + sidewalkW)];
              sw2R_c = [cx2 - snX * (halfW + sidewalkW), ySw, cz2 - snZ * (halfW + sidewalkW)];
              sw2L_in = [rLx2, ySw, rLz2];
              sw2R_in = [rRx2, ySw, rRz2];
              curbBaseL2 = [rLx2, yRoad, rLz2];
              curbBaseR2 = [rRx2, yRoad, rRz2];

              // Clean curb end-cap facing forward into junction
              swPos.push(...sw2L_in, ...sw2L_c, sw2L_c[0], yRoad, sw2L_c[2]);
              swPos.push(...sw2L_in, sw2L_c[0], yRoad, sw2L_c[2], ...curbBaseL2);
              swPos.push(...sw2R_c, ...sw2R_in, ...curbBaseR2);
              swPos.push(...sw2R_c, ...curbBaseR2, sw2R_c[0], yRoad, sw2R_c[2]);

              for (let k = 0; k < 12; k++) {
                swNorm.push(sd.x, 0, sd.z);
                swCol.push(curbDropColor.r, curbDropColor.g, curbDropColor.b);
              }
            }

            // Top Sidewalk Ribbons
            swPos.push(...sw1L_c, ...sw1L_in, ...sw2L_in);
            swPos.push(...sw1L_c, ...sw2L_in, ...sw2L_c);
            swPos.push(...sw1R_in, ...sw1R_c, ...sw2R_c);
            swPos.push(...sw1R_in, ...sw2R_c, ...sw2R_in);

            for (let k = 0; k < 12; k++) {
              swNorm.push(0, 1, 0);
              swCol.push(sidewalkColor.r, sidewalkColor.g, sidewalkColor.b);
            }

            // Vertical Curbs
            swPos.push(...sw1L_in, ...curbBaseL1, ...curbBaseL2);
            swPos.push(...sw1L_in, ...curbBaseL2, ...sw2L_in);
            swPos.push(...curbBaseR1, ...sw1R_in, ...sw2R_in);
            swPos.push(...curbBaseR1, ...sw2R_in, ...curbBaseR2);

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
      }

      if (rPos.length > 0) {
        const rGeo = new THREE.BufferGeometry();
        rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
        rGeo.setAttribute('normal', new THREE.Float32BufferAttribute(rNorm, 3));
        rGeo.setAttribute('uv', new THREE.Float32BufferAttribute(rUV, 2));
        asphaltGeometries.push(rGeo);
      }

      if (swPos.length > 0) {
        const swGeo = new THREE.BufferGeometry();
        swGeo.setAttribute('position', new THREE.Float32BufferAttribute(swPos, 3));
        swGeo.setAttribute('normal', new THREE.Float32BufferAttribute(swNorm, 3));
        swGeo.setAttribute('color', new THREE.Float32BufferAttribute(swCol, 3));
        sidewalkGeometries.push(swGeo);
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

      // =========================================================================
      // STEP 4: ROAD MARKINGS WITH PULLBACK & ZEBRA CROSSINGS (+0.008m ELEVATION)
      // Vạch kẻ ngắt trước giao lộ (Pullback), vạch dừng & vạch đi bộ tại ranh giới
      // =========================================================================
      if (!road.isAlley && width >= 4.5) {
        const mPos: number[] = [];
        const mNorm: number[] = [];
        const mCol: number[] = [];

        const markY = asphaltY + 0.008; // Strict +0.008m above asphalt
        const isMajor = road.highway === 'primary' || road.highway === 'trunk' || road.highway === 'motorway';
        const isSecondary = road.highway === 'secondary' || road.highway === 'tertiary';

        let distAlong = 0;

        for (let i = 0; i < N - 1; i++) {
          const segLen = segDirs[i].len;
          if (segLen < 0.2) continue;

          const sd = segDirs[i];
          const snX = -sd.z;
          const snZ = sd.x;

          // Check intersection clearance for start and end of this segment
          const near1 = findNearestIntersection(path[i].x, path[i].z);
          const near2 = findNearestIntersection(path[i + 1].x, path[i + 1].z);

          const pull1 = near1 ? Math.min(near1.node.pullbackDist - near1.dist + 0.5, segLen * 0.48) : 0;
          const pull2 = near2 ? Math.min(near2.node.pullbackDist - near2.dist + 0.5, segLen * 0.48) : 0;

          const startT = Math.max(0, pull1);
          const endT = Math.min(segLen, segLen - Math.max(0, pull2));

          if (endT > startT + 1.0) {
            // Subdivide segment into small intervals for crisp line rendering
            const stepLen = 2.0;
            const subSteps = Math.ceil((endT - startT) / stepLen);

            for (let st = 0; st < subSteps; st++) {
              const tA = startT + (st / subSteps) * (endT - startT);
              const tB = startT + ((st + 1) / subSteps) * (endT - startT);

              const pA_x = path[i].x + sd.x * tA;
              const pA_z = path[i].z + sd.z * tA;
              const pB_x = path[i].x + sd.x * tB;
              const pB_z = path[i].z + sd.z * tB;

              const globalDist = distAlong + tA;

              // 1. Edge Shoulder Lines (Continuous thin white lines)
              const edgeOffset = halfW - 0.24;
              const edgeW = 0.12;

              // Left edge line
              const lA_x1 = pA_x + snX * (edgeOffset - edgeW / 2);
              const lA_z1 = pA_z + snZ * (edgeOffset - edgeW / 2);
              const lA_x2 = pA_x + snX * (edgeOffset + edgeW / 2);
              const lA_z2 = pA_z + snZ * (edgeOffset + edgeW / 2);
              const lB_x1 = pB_x + snX * (edgeOffset - edgeW / 2);
              const lB_z1 = pB_z + snZ * (edgeOffset - edgeW / 2);
              const lB_x2 = pB_x + snX * (edgeOffset + edgeW / 2);
              const lB_z2 = pB_z + snZ * (edgeOffset + edgeW / 2);

              mPos.push(lA_x1, markY, lA_z1, lA_x2, markY, lA_z2, lB_x2, markY, lB_z2);
              mPos.push(lA_x1, markY, lA_z1, lB_x2, markY, lB_z2, lB_x1, markY, lB_z1);

              // Right edge line
              const rA_x1 = pA_x - snX * (edgeOffset + edgeW / 2);
              const rA_z1 = pA_z - snZ * (edgeOffset + edgeW / 2);
              const rA_x2 = pA_x - snX * (edgeOffset - edgeW / 2);
              const rA_z2 = pA_z - snZ * (edgeOffset - edgeW / 2);
              const rB_x1 = pB_x - snX * (edgeOffset + edgeW / 2);
              const rB_z1 = pB_z - snZ * (edgeOffset + edgeW / 2);
              const rB_x2 = pB_x - snX * (edgeOffset - edgeW / 2);
              const rB_z2 = pB_z - snZ * (edgeOffset - edgeW / 2);

              mPos.push(rA_x1, markY, rA_z1, rA_x2, markY, rA_z2, rB_x2, markY, rB_z2);
              mPos.push(rA_x1, markY, rA_z1, rB_x2, markY, rB_z2, rB_x1, markY, rB_z1);

              for (let k = 0; k < 12; k++) {
                mNorm.push(0, 1, 0);
                mCol.push(whiteMarkingColor.r, whiteMarkingColor.g, whiteMarkingColor.b);
              }

              // 2. Centerline
              if (isMajor) {
                // Double Golden Yellow Solid Line
                const lineW = 0.12;
                const gap = 0.14;

                for (const side of [-1, 1]) {
                  const off = side * (gap / 2 + lineW / 2);
                  const cA_x1 = pA_x + snX * (off - lineW / 2);
                  const cA_z1 = pA_z + snZ * (off - lineW / 2);
                  const cA_x2 = pA_x + snX * (off + lineW / 2);
                  const cA_z2 = pA_z + snZ * (off + lineW / 2);
                  const cB_x1 = pB_x + snX * (off - lineW / 2);
                  const cB_z1 = pB_z + snZ * (off - lineW / 2);
                  const cB_x2 = pB_x + snX * (off + lineW / 2);
                  const cB_z2 = pB_z + snZ * (off + lineW / 2);

                  mPos.push(cA_x1, markY, cA_z1, cA_x2, markY, cA_z2, cB_x2, markY, cB_z2);
                  mPos.push(cA_x1, markY, cA_z1, cB_x2, markY, cB_z2, cB_x1, markY, cB_z1);

                  for (let k = 0; k < 6; k++) {
                    mNorm.push(0, 1, 0);
                    mCol.push(yellowMarkingColor.r, yellowMarkingColor.g, yellowMarkingColor.b);
                  }
                }
              } else {
                // Dashed White Line (3m dash, 2m gap)
                const dashCycle = isSecondary ? 5.0 : 4.5;
                const dashLen = isSecondary ? 3.0 : 2.2;
                const inDash = (globalDist % dashCycle) < dashLen;

                if (inDash) {
                  const lineW = isSecondary ? 0.14 : 0.10;
                  const cA_x1 = pA_x - snX * (lineW / 2);
                  const cA_z1 = pA_z - snZ * (lineW / 2);
                  const cA_x2 = pA_x + snX * (lineW / 2);
                  const cA_z2 = pA_z + snZ * (lineW / 2);
                  const cB_x1 = pB_x - snX * (lineW / 2);
                  const cB_z1 = pB_z - snZ * (lineW / 2);
                  const cB_x2 = pB_x + snX * (lineW / 2);
                  const cB_z2 = pB_z + snZ * (lineW / 2);

                  mPos.push(cA_x1, markY, cA_z1, cA_x2, markY, cA_z2, cB_x2, markY, cB_z2);
                  mPos.push(cA_x1, markY, cA_z1, cB_x2, markY, cB_z2, cB_x1, markY, cB_z1);

                  for (let k = 0; k < 6; k++) {
                    mNorm.push(0, 1, 0);
                    mCol.push(whiteMarkingColor.r, whiteMarkingColor.g, whiteMarkingColor.b);
                  }
                }
              }
            }
          }

          // 3. Stop Line & Zebra Crossing at Pullback Boundaries
          if ((isMajor || isSecondary) && (near1 || near2)) {
            const junctionRef = near1 || near2;
            if (junctionRef) {
              const isStartCut = !!near1 && pull1 > 0;
              const isEndCut = !!near2 && pull2 > 0;

              if (isStartCut || isEndCut) {
                const cutT = isStartCut ? startT : endT;
                const cutX = path[i].x + sd.x * cutT;
                const cutZ = path[i].z + sd.z * cutT;

                // Stop line bar (0.45m thick across lane)
                const stopThick = 0.45;
                const stopSpan = halfW - 0.35;
                const sA1_x = cutX - snX * stopSpan;
                const sA1_z = cutZ - snZ * stopSpan;
                const sA2_x = cutX + snX * stopSpan;
                const sA2_z = cutZ + snZ * stopSpan;
                const sB1_x = sA1_x + sd.x * (isStartCut ? stopThick : -stopThick);
                const sB1_z = sA1_z + sd.z * (isStartCut ? stopThick : -stopThick);
                const sB2_x = sA2_x + sd.x * (isStartCut ? stopThick : -stopThick);
                const sB2_z = sA2_z + sd.z * (isStartCut ? stopThick : -stopThick);

                mPos.push(sA1_x, markY, sA1_z, sA2_x, markY, sA2_z, sB2_x, markY, sB2_z);
                mPos.push(sA1_x, markY, sA1_z, sB2_x, markY, sB2_z, sB1_x, markY, sB1_z);
                for (let k = 0; k < 6; k++) {
                  mNorm.push(0, 1, 0);
                  mCol.push(whiteMarkingColor.r, whiteMarkingColor.g, whiteMarkingColor.b);
                }

                // Pedestrian Zebra Crossing (4-8 white bars across road)
                if (isMajor && segLen > 6.0) {
                  const zOffset = isStartCut ? 1.6 : -1.6;
                  const zCenter_x = cutX + sd.x * zOffset;
                  const zCenter_z = cutZ + sd.z * zOffset;
                  const barLen = 2.4; // 2.4m length along road
                  const barW = 0.5;   // 0.5m width
                  const barGap = 0.5;

                  const totalBars = Math.floor((stopSpan * 2) / (barW + barGap));
                  for (let b = 0; b < totalBars; b++) {
                    const offsetAcross = -stopSpan + (b + 0.5) * (barW + barGap);
                    const bMid_x = zCenter_x + snX * offsetAcross;
                    const bMid_z = zCenter_z + snZ * offsetAcross;

                    const z1_x = bMid_x - snX * (barW / 2) - sd.x * (barLen / 2);
                    const z1_z = bMid_z - snZ * (barW / 2) - sd.z * (barLen / 2);
                    const z2_x = bMid_x + snX * (barW / 2) - sd.x * (barLen / 2);
                    const z2_z = bMid_z + snZ * (barW / 2) - sd.z * (barLen / 2);
                    const z3_x = bMid_x + snX * (barW / 2) + sd.x * (barLen / 2);
                    const z3_z = bMid_z + snZ * (barW / 2) + sd.z * (barLen / 2);
                    const z4_x = bMid_x - snX * (barW / 2) + sd.x * (barLen / 2);
                    const z4_z = bMid_z - snZ * (barW / 2) + sd.z * (barLen / 2);

                    mPos.push(z1_x, markY, z1_z, z2_x, markY, z2_z, z3_x, markY, z3_z);
                    mPos.push(z1_x, markY, z1_z, z3_x, markY, z3_z, z4_x, markY, z4_z);
                    for (let k = 0; k < 6; k++) {
                      mNorm.push(0, 1, 0);
                      mCol.push(whiteMarkingColor.r, whiteMarkingColor.g, whiteMarkingColor.b);
                    }
                  }
                }
              }
            }
          }

          distAlong += segLen;
        }

        if (mPos.length > 0) {
          const mGeo = new THREE.BufferGeometry();
          mGeo.setAttribute('position', new THREE.Float32BufferAttribute(mPos, 3));
          mGeo.setAttribute('normal', new THREE.Float32BufferAttribute(mNorm, 3));
          mGeo.setAttribute('color', new THREE.Float32BufferAttribute(mCol, 3));
          markingsGeometries.push(mGeo);
        }
      }
    }

    // =========================================================================
    // STEP 5: MERGE GEOMETRIES & ASSIGN OPTIMIZED MATERIALS (1-3 DRAW CALLS)
    // =========================================================================

    // 1. Asphalt Mesh (Roads + Seamless Intersections)
    if (asphaltGeometries.length > 0) {
      const mergedAsphalt = BufferGeometryUtils.mergeGeometries(asphaltGeometries, false);
      for (const g of asphaltGeometries) g.dispose();

      if (mergedAsphalt) {
        const roadTexture = TextureGenerator.getRoadTexture();
        const roadMat = new THREE.MeshStandardMaterial({
          map: roadTexture,
          roughness: 0.85,
          metalness: 0.04,
          side: THREE.DoubleSide,
        });

        const mainMesh = new THREE.Mesh(mergedAsphalt, roadMat);
        mainMesh.name = 'roads_main_merged';
        mainMesh.receiveShadow = true;
        group.add(mainMesh);
      }
    }

    // 2. Road Markings Mesh (Centerlines, Edge Lines, Stop Lines, Zebra Crossings)
    if (markingsGeometries.length > 0) {
      const mergedMarkings = BufferGeometryUtils.mergeGeometries(markingsGeometries, false);
      for (const g of markingsGeometries) g.dispose();

      if (mergedMarkings) {
        const markingsMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.55,
          metalness: 0.05,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
          side: THREE.DoubleSide,
        });

        const markMesh = new THREE.Mesh(mergedMarkings, markingsMat);
        markMesh.name = 'roads_markings_merged';
        markMesh.receiveShadow = true;
        group.add(markMesh);
      }
    }

    // 3. Sidewalks & Curbs Mesh
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

    // 4. Bridge Girders
    if (bridgeGirderGeometries.length > 0) {
      const mergedGirders = BufferGeometryUtils.mergeGeometries(bridgeGirderGeometries, false);
      for (const g of bridgeGirderGeometries) g.dispose();

      if (mergedGirders) {
        const girderMat = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
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

    // 5. Bridge Safety Parapets
    if (bridgeParapetGeometries.length > 0) {
      const mergedParapets = BufferGeometryUtils.mergeGeometries(bridgeParapetGeometries, false);
      for (const g of bridgeParapetGeometries) g.dispose();

      if (mergedParapets) {
        const parapetMat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
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

    // 6. Bridge Concrete Piers
    if (bridgePierGeometries.length > 0) {
      const mergedPiers = BufferGeometryUtils.mergeGeometries(bridgePierGeometries, false);
      for (const g of bridgePierGeometries) g.dispose();

      if (mergedPiers) {
        const pierMat = new THREE.MeshStandardMaterial({
          color: 0x64748b,
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
   * Builds merged water bodies (River, canals, ponds) at strict elevation y = 0.01m
   */
  public static buildWater(waterList: WaterPolygonItem[]): THREE.Mesh | null {
    if (waterList.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const waterColor = new THREE.Color(SAIGON_PALETTES.tropicalWater);

    for (const water of waterList) {
      const geo = this.triangulatePolygon(water.rings, 0.01, waterColor);
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
   * Builds merged parks & green landuse at strict elevation y = 0.02m
   */
  public static buildParks(parks: ParkPolygonItem[]): { parkMesh: THREE.Mesh | null } {
    if (parks.length === 0) return { parkMesh: null };

    const parkGeometries: THREE.BufferGeometry[] = [];
    const parkColor = new THREE.Color(SAIGON_PALETTES.parkGreen);

    for (const park of parks) {
      const geo = this.triangulatePolygon(park.rings, 0.02, parkColor);
      if (geo) parkGeometries.push(geo);
    }

    let parkMesh: THREE.Mesh | null = null;
    if (parkGeometries.length > 0) {
      const mergedParks = BufferGeometryUtils.mergeGeometries(parkGeometries, false);
      for (const g of parkGeometries) g.dispose();

      if (mergedParks) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x4ade80,
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
