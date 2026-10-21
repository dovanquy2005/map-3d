import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadNetworkGraph } from '../types/gis';

export type SignalLightColor = 'RED' | 'YELLOW' | 'GREEN';

export interface TrafficSignalApproach {
  junctionId: string;
  fromNodeId: string;
  phaseGroup: 0 | 1;
  stopPoint: THREE.Vector3;
  polePoint: THREE.Vector3;
  approachDir: THREE.Vector3;
  laneWidth: number;
  // Mesh references for dynamic lamp emissive updates
  redMesh?: THREE.Mesh;
  yellowMesh?: THREE.Mesh;
  greenMesh?: THREE.Mesh;
}

export interface SignalizedJunction {
  id: string;
  x: number;
  y: number;
  z: number;
  cycleTime: number; // Current second in 22s cycle
  cycleOffset: number; // Random offset so not all intersections turn red simultaneously
  approaches: Map<string, TrafficSignalApproach>; // Key: fromNodeId
}

export class TrafficSignalSystem {
  public group: THREE.Group;
  private junctions: Map<string, SignalizedJunction> = new Map();
  private approachesByKey: Map<string, TrafficSignalApproach> = new Map(); // Key: `${junctionId}_${fromNodeId}`

  // Materials for signal lamps (Off vs On)
  private matRedOn = new THREE.MeshBasicMaterial({ color: 0xff2222 });
  private matRedOff = new THREE.MeshBasicMaterial({ color: 0x330808 });

  private matYellowOn = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
  private matYellowOff = new THREE.MeshBasicMaterial({ color: 0x332800 });

  private matGreenOn = new THREE.MeshBasicMaterial({ color: 0x10b981 });
  private matGreenOff = new THREE.MeshBasicMaterial({ color: 0x042b1a });

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'traffic_signal_system_group';
  }

  /**
   * Initializes traffic signal poles strictly at authentic urban street intersections (ngã ba, ngã tư).
   * Alleys and minor footways never receive signal poles.
   */
  public initSignals(roadGraph: RoadNetworkGraph): void {
    // Clear previous
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.junctions.clear();
    this.approachesByKey.clear();

    // 1. Identify genuine street intersections (degree >= 3 on non-alley roads)
    const candidateNodes: string[] = [];

    for (const [nodeId, node] of roadGraph.nodes.entries()) {
      if (!node.neighborIds || node.neighborIds.length < 3) continue;

      // Filter non-alley connections
      const connectedEdges = roadGraph.edges.filter(
        (e) => (e.fromId === nodeId || e.toId === nodeId) && !e.isAlley
      );

      if (connectedEdges.length >= 3) {
        candidateNodes.push(nodeId);
      }
    }

    // Cluster filter: ensure at least 40m distance between signalized junctions
    const selectedJunctionNodes: string[] = [];
    for (const candId of candidateNodes) {
      const candNode = roadGraph.nodes.get(candId)!;
      let tooClose = false;
      for (const selId of selectedJunctionNodes) {
        const selNode = roadGraph.nodes.get(selId)!;
        if (Math.hypot(candNode.x - selNode.x, candNode.z - selNode.z) < 40) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) {
        selectedJunctionNodes.push(candId);
      }
    }

    if (selectedJunctionNodes.length === 0) return;

    // 2. Build 3D Traffic Light Models and Approach Metadata
    const metalGeometries: THREE.BufferGeometry[] = [];
    let signalCount = 0;

    for (const juncId of selectedJunctionNodes) {
      const jNode = roadGraph.nodes.get(juncId)!;
      const jY = jNode.y ?? 0.08;

      const junction: SignalizedJunction = {
        id: juncId,
        x: jNode.x,
        y: jY,
        z: jNode.z,
        cycleTime: 0,
        cycleOffset: (Math.abs(Math.round(jNode.x * 13 + jNode.z * 17)) % 220) / 10, // Staggered phase offsets
        approaches: new Map(),
      };

      // Collect incoming approaches from neighbors
      const neighbors = jNode.neighborIds || [];
      for (const fromId of neighbors) {
        const fromNode = roadGraph.nodes.get(fromId);
        if (!fromNode) continue;

        const edge = roadGraph.edges.find(
          (e) => (e.fromId === fromId && e.toId === juncId) || (e.fromId === juncId && e.toId === fromId)
        );
        if (!edge || edge.isAlley) continue;

        const dx = jNode.x - fromNode.x;
        const dz = jNode.z - fromNode.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 10) continue;

        const dirX = dx / dist;
        const dirZ = dz / dist;
        const perpX = -dirZ;
        const perpZ = dirX;

        const roadWidth = edge.width || (edge.highway === 'primary' ? 14.0 : 9.0);
        const halfW = roadWidth / 2;

        // Approach phase grouping: based on orientation angle
        const angleDeg = (Math.atan2(dirX, dirZ) * 180) / Math.PI;
        const normAngle = ((angleDeg % 180) + 180) % 180;
        const phaseGroup: 0 | 1 = normAngle >= 45 && normAngle <= 135 ? 1 : 0;

        // A. Stop line: 6.0m before junction center
        const stopDist = Math.min(7.5, dist * 0.35);
        const stopX = jNode.x - dirX * stopDist;
        const stopZ = jNode.z - dirZ * stopDist;
        const stopPoint = new THREE.Vector3(stopX, jY, stopZ);

        // B. Pole placement: on the right-hand sidewalk curb outside the asphalt (+0.8m beyond curb)
        const poleX = stopX + perpX * (halfW + 0.85);
        const poleZ = stopZ + perpZ * (halfW + 0.85);
        const poleBaseY = jY + 0.04;
        const polePoint = new THREE.Vector3(poleX, poleBaseY, poleZ);

        // C. Construct 3D Traffic Light Metal Geometry:
        // 1. Vertical steel pole: 5.4m high, 0.16m diameter
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.4, 8);
        poleGeo.translate(poleX, poleBaseY + 2.7, poleZ);

        // 2. Cantilever Mast Arm extending over right travel lane (length 3.2m)
        const mastLen = Math.min(3.6, halfW * 0.85);
        const mastGeo = new THREE.CylinderGeometry(0.06, 0.07, mastLen, 8);
        mastGeo.rotateZ(Math.PI / 2);
        // Rotate mast arm to point along -perp (inwards over the right lane)
        const mastYaw = Math.atan2(-perpX, -perpZ);
        mastGeo.rotateY(mastYaw);
        mastGeo.translate(poleX - (perpX * mastLen) / 2, poleBaseY + 5.1, poleZ - (perpZ * mastLen) / 2);

        // 3. Signal Head Enclosure Box: mounted at mast arm tip facing incoming traffic
        const headTipX = poleX - perpX * (mastLen * 0.85);
        const headTipZ = poleZ - perpZ * (mastLen * 0.85);
        const headY = poleBaseY + 4.9;

        const headBox = new THREE.BoxGeometry(0.38, 1.05, 0.28);
        const facingYaw = Math.atan2(-dirX, -dirZ); // Faces incoming traffic (away from junction)
        headBox.rotateY(facingYaw);
        headBox.translate(headTipX, headY, headTipZ);

        // 4. Secondary Pedestrian/Curbside Signal Head on pole (height 2.6m)
        const curbHeadBox = new THREE.BoxGeometry(0.3, 0.75, 0.22);
        curbHeadBox.rotateY(facingYaw);
        curbHeadBox.translate(poleX, poleBaseY + 2.6, poleZ);

        metalGeometries.push(poleGeo, mastGeo, headBox, curbHeadBox);

        // D. Create 3 Lenses (Red, Yellow, Green) on Overhead Mast Signal Head
        const lensRadius = 0.11;
        const lensOutOffset = 0.15; // slightly proud of front face
        const lensFaceX = headTipX - dirX * lensOutOffset;
        const lensFaceZ = headTipZ - dirZ * lensOutOffset;

        // Top Lens: Red
        const redGeo = new THREE.SphereGeometry(lensRadius, 8, 8);
        const redMesh = new THREE.Mesh(redGeo, this.matRedOff);
        redMesh.position.set(lensFaceX, headY + 0.32, lensFaceZ);
        this.group.add(redMesh);

        // Middle Lens: Yellow
        const yellowGeo = new THREE.SphereGeometry(lensRadius, 8, 8);
        const yellowMesh = new THREE.Mesh(yellowGeo, this.matYellowOff);
        yellowMesh.position.set(lensFaceX, headY, lensFaceZ);
        this.group.add(yellowMesh);

        // Bottom Lens: Green
        const greenGeo = new THREE.SphereGeometry(lensRadius, 8, 8);
        const greenMesh = new THREE.Mesh(greenGeo, this.matGreenOff);
        greenMesh.position.set(lensFaceX, headY - 0.32, lensFaceZ);
        this.group.add(greenMesh);

        const approach: TrafficSignalApproach = {
          junctionId: juncId,
          fromNodeId: fromId,
          phaseGroup,
          stopPoint,
          polePoint,
          approachDir: new THREE.Vector3(dirX, 0, dirZ),
          laneWidth: roadWidth,
          redMesh,
          yellowMesh,
          greenMesh,
        };

        junction.approaches.set(fromId, approach);
        this.approachesByKey.set(`${juncId}_${fromId}`, approach);
        signalCount++;
      }

      this.junctions.set(juncId, junction);
    }

    // 3. Merge all structural steel poles and mast arms into 1 Draw Call
    if (metalGeometries.length > 0) {
      const mergedMetal = BufferGeometryUtils.mergeGeometries(metalGeometries, false);
      for (const g of metalGeometries) g.dispose();

      if (mergedMetal) {
        const metalMat = new THREE.MeshStandardMaterial({
          color: 0x334155, // Clean graphite steel
          roughness: 0.5,
          metalness: 0.45,
        });
        const metalMesh = new THREE.Mesh(mergedMetal, metalMat);
        metalMesh.name = 'traffic_signal_poles_merged';
        metalMesh.castShadow = true;
        this.group.add(metalMesh);
      }
    }
  }

  /**
   * Evaluates current light color for an approach based on the intersection 22-second cycle
   *
   * Cycle Breakdown (22.0s total):
   * - Phase 0 (Main corridor):
   *   - 0.0s .. 9.0s:  GREEN  (Phase 1: RED)
   *   - 9.0s .. 11.5s: YELLOW (Phase 1: RED)
   * - Phase 1 (Cross street):
   *   - 11.5s .. 19.5s: GREEN (Phase 0: RED)
   *   - 19.5s .. 22.0s: YELLOW (Phase 0: RED)
   */
  public getSignalColor(junctionId: string, fromNodeId: string): SignalLightColor | null {
    const approach = this.approachesByKey.get(`${junctionId}_${fromNodeId}`);
    if (!approach) return null;

    const junc = this.junctions.get(junctionId);
    if (!junc) return null;

    const t = (junc.cycleTime + junc.cycleOffset) % 22.0;

    if (approach.phaseGroup === 0) {
      if (t < 9.0) return 'GREEN';
      if (t < 11.5) return 'YELLOW';
      return 'RED';
    } else {
      if (t < 11.5) return 'RED';
      if (t < 19.5) return 'GREEN';
      return 'YELLOW';
    }
  }

  /**
   * Main per-frame tick to advance traffic signal clocks and update glowing lamp materials
   */
  public update(dt: number): void {
    if (this.junctions.size === 0) return;

    for (const junc of this.junctions.values()) {
      junc.cycleTime += dt;

      for (const approach of junc.approaches.values()) {
        const color = this.getSignalColor(approach.junctionId, approach.fromNodeId);

        if (approach.redMesh && approach.yellowMesh && approach.greenMesh) {
          approach.redMesh.material = color === 'RED' ? this.matRedOn : this.matRedOff;
          approach.yellowMesh.material = color === 'YELLOW' ? this.matYellowOn : this.matYellowOff;
          approach.greenMesh.material = color === 'GREEN' ? this.matGreenOn : this.matGreenOff;
        }
      }
    }
  }

  /**
   * Returns distance from vehicle to stop line for approach (N_from -> Junction)
   */
  public getDistanceToStopLine(
    junctionId: string,
    fromNodeId: string,
    vehX: number,
    vehZ: number
  ): number | null {
    const approach = this.approachesByKey.get(`${junctionId}_${fromNodeId}`);
    if (!approach) return null;

    // Dot product along approach direction to stop point
    const toStopX = approach.stopPoint.x - vehX;
    const toStopZ = approach.stopPoint.z - vehZ;
    const distProj = toStopX * approach.approachDir.x + toStopZ * approach.approachDir.z;

    return distProj;
  }
}
