import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadGraphEdge, RoadNetworkGraph } from '../types/gis';
import { TrafficSignalSystem } from './TrafficSignalSystem';

export interface VehiclePlacement {
  x: number;
  y?: number;
  z: number;
  heading: number;
  isScooter?: boolean;
}

interface SimulatedVehicle {
  id: number;
  type: 'car' | 'scooter' | 'bus';
  fromId: string;
  toId: string;
  nextId: string;

  // Dynamic Kinematics State
  isTurning: boolean;
  edgeDistance: number; // distance in meters along current straight edge
  edgeLength: number;   // total length of current edge in meters
  speed: number;        // current speed in m/s
  cruiseSpeed: number;  // target cruising speed in m/s
  turnSpeed: number;    // reduced speed while navigating turns (m/s)
  laneOffset: number;   // lateral distance from centerline (+ to the right)
  verticalOffset: number; // tire height above road asphalt

  // Quadratic Bézier Cornering Spline (Smooth arc without jerk or snapping)
  turnProgress: number; // 0.0 to 1.0 along the Bézier curve
  turnLength: number;   // approximate length of the turning arc (meters)
  p0: THREE.Vector3;    // Entry point on incoming edge right lane
  p1: THREE.Vector3;    // Intersection control point
  p2: THREE.Vector3;    // Exit point on outgoing edge right lane

  // Spatial outputs
  currentPos: THREE.Vector3;
  heading: number;      // yaw rotation in radians (smoothed via lerpAngle)
}

/**
 * Shortest angular distance interpolation (prevents 360-degree flip around +/- PI)
 */
function lerpAngle(current: number, target: number, alpha: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.max(0, Math.min(1, alpha));
}

export class CityTraffic {
  public group: THREE.Group;
  private roadGraph: RoadNetworkGraph | null = null;
  private trafficSignals: TrafficSignalSystem | null = null;

  // Active agents
  private simulatedCars: SimulatedVehicle[] = [];
  private simulatedScooters: SimulatedVehicle[] = [];
  private simulatedBuses: SimulatedVehicle[] = [];

  // Instanced Meshes (1 draw call per vehicle class = max 3 draw calls total)
  private instancedCars: THREE.InstancedMesh | null = null;
  private instancedScooters: THREE.InstancedMesh | null = null;
  private instancedBuses: THREE.InstancedMesh | null = null;
  private dummy: THREE.Object3D = new THREE.Object3D();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'traffic_simulation_group';
  }

  /**
   * Helper to compute authentic right-hand lane offset proportional to road width
   */
  private getRoadLaneOffset(edge: RoadGraphEdge | undefined, vehicleType: 'car' | 'scooter' | 'bus', reverseIndex: number = 0): number {
    if (!edge) return 1.8;
    const roadWidth = edge.width || (edge.highway === 'primary' ? 14.0 : edge.highway === 'secondary' ? 9.0 : edge.isAlley ? 2.8 : 6.0);
    if (edge.isAlley) {
      return reverseIndex % 2 === 0 ? 0.35 : -0.35;
    }
    if (vehicleType === 'scooter') {
      return roadWidth * 0.36; // Outer right shoulder motorcycle lane
    }
    return roadWidth * 0.22; // Inner right automotive travel lane
  }

  /**
   * Initializes autonomous moving traffic with lane discipline and traffic light compliance
   */
  public initSimulation(roadGraph: RoadNetworkGraph, trafficSignals?: TrafficSignalSystem): void {
    this.roadGraph = roadGraph;
    this.trafficSignals = trafficSignals || null;

    // Clear previous simulation meshes
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.simulatedCars = [];
    this.simulatedScooters = [];
    this.simulatedBuses = [];

    // Filter valid road segments with minimum navigable length
    const validEdges = roadGraph.edges.filter((e) => {
      const n1 = roadGraph.nodes.get(e.fromId);
      const n2 = roadGraph.nodes.get(e.toId);
      if (!n1 || !n2) return false;
      return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 12;
    });

    if (validEdges.length === 0) return;

    // =========================================================================
    // 1. 3D LOW-POLY VEHICLE MODELS (Clean, authentic Saigon streetscape)
    // =========================================================================
    // A. Sedan & Taxi Model (Chassis, Cabin, Glass bevel)
    const carChassis = new THREE.BoxGeometry(1.68, 0.62, 3.6);
    carChassis.translate(0, 0.42, 0);
    const carCabin = new THREE.BoxGeometry(1.48, 0.58, 2.0);
    carCabin.translate(0, 0.95, -0.2);
    const carGeo = BufferGeometryUtils.mergeGeometries([carChassis, carCabin]) || carChassis;
    const carMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.4,
    });

    // B. Vietnam Scooter + Rider Model (Scooter, Torso, Iconic Helmet)
    const scooterBody = new THREE.BoxGeometry(0.42, 0.4, 1.35);
    scooterBody.translate(0, 0.35, 0);
    const riderTorso = new THREE.BoxGeometry(0.38, 0.55, 0.38);
    riderTorso.translate(0, 0.85, -0.15);
    const riderHelmet = new THREE.SphereGeometry(0.22, 8, 8);
    riderHelmet.translate(0, 1.25, -0.15);
    const scooterGeo = BufferGeometryUtils.mergeGeometries([scooterBody, riderTorso, riderHelmet]) || scooterBody;
    const scooterMat = new THREE.MeshStandardMaterial({
      roughness: 0.45,
      metalness: 0.25,
    });

    // C. Iconic Saigon City Bus Model (Xe Buýt Sài Gòn - 8m bus)
    const busChassis = new THREE.BoxGeometry(2.35, 2.15, 8.2);
    busChassis.translate(0, 1.35, 0);
    const busRoof = new THREE.BoxGeometry(2.25, 0.32, 7.8);
    busRoof.translate(0, 2.55, 0);
    const busGeo = BufferGeometryUtils.mergeGeometries([busChassis, busRoof]) || busChassis;
    const busMat = new THREE.MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.2,
    });

    // Authentic Vietnamese vehicle colors
    const carColors = [
      new THREE.Color(0xf8fafc), // Pearl White (VinFast / Toyota)
      new THREE.Color(0x10b981), // Mai Linh Taxi / Grab Green
      new THREE.Color(0xfacc15), // Saigon Yellow Taxi
      new THREE.Color(0xef4444), // Crimson Red
      new THREE.Color(0x0284c7), // Cyan Blue
      new THREE.Color(0x1e293b), // Black VIP Sedan
      new THREE.Color(0x94a3b8), // Silver Metallic
    ];

    const scooterColors = [
      new THREE.Color(0x10b981), // Grab Driver Green
      new THREE.Color(0xfacc15), // Be Yellow Driver
      new THREE.Color(0xef4444), // ShopeeFood Red
      new THREE.Color(0x1e293b), // Commuter Black
      new THREE.Color(0x38bdf8), // Sky Blue
      new THREE.Color(0xf8fafc), // White Scooter
    ];

    const busColors = [
      new THREE.Color(0x15803d), // Iconic Saigon City Bus Green
      new THREE.Color(0x16a34a), // Saigon Bus Light Green
      new THREE.Color(0x2563eb), // Modern VinBus Electric Blue
    ];

    // =========================================================================
    // 2. SPAWN AGENTS IN BOTH DIRECTIONS (Right-hand traffic simulation)
    // =========================================================================
    // =========================================================================
    // 2. SPAWN 3,000 AGENTS IN BOTH DIRECTIONS (Dense metropolis traffic)
    // =========================================================================
    const carEdges = validEdges.filter((e) => !e.isAlley);
    const scooterEdges = validEdges;
    const majorEdges = validEdges.filter(
      (e) => !e.isAlley && (e.highway === 'primary' || e.highway === 'secondary' || e.highway === 'trunk' || e.highway === 'tertiary')
    );
    const busEdges = majorEdges.length > 0 ? majorEdges : carEdges;

    if (carEdges.length === 0 || scooterEdges.length === 0) return;

    const totalCars = 700;
    const totalScooters = 2200;
    const totalBuses = 100;

    this.instancedCars = new THREE.InstancedMesh(carGeo, carMat, totalCars);
    this.instancedCars.castShadow = true;
    this.instancedCars.receiveShadow = true;

    this.instancedScooters = new THREE.InstancedMesh(scooterGeo, scooterMat, totalScooters);
    this.instancedScooters.castShadow = true;
    this.instancedScooters.receiveShadow = true;

    this.instancedBuses = new THREE.InstancedMesh(busGeo, busMat, totalBuses);
    this.instancedBuses.castShadow = true;
    this.instancedBuses.receiveShadow = true;

    // A. Spawn 700 Cars (sedans, taxis, SUVs alternating lanes in both directions)
    for (let i = 0; i < totalCars; i++) {
      const edge = carEdges[i % carEdges.length];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
      const reverse = i % 2 === 1;
      const from = reverse ? n2 : n1;
      const to = reverse ? n1 : n2;
      const nextId = this.pickNextNode(to.id, from.id);
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      const perpX = -Math.cos(heading);
      const perpZ = Math.sin(heading);
      const laneOffset = this.getRoadLaneOffset(edge, 'car', i);
      const initialDist = ((i * 31.7) % (dist * 0.78)) + dist * 0.11;

      const agent: SimulatedVehicle = {
        id: i,
        type: 'car',
        fromId: from.id,
        toId: to.id,
        nextId,
        isTurning: false,
        edgeDistance: initialDist,
        edgeLength: dist,
        speed: 8.5 + (i % 5) * 0.6, // ~30-40 km/h
        cruiseSpeed: 8.5 + (i % 5) * 0.6,
        turnSpeed: 5.2,
        laneOffset,
        verticalOffset: 0.08,
        turnProgress: 0,
        turnLength: 1,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
        currentPos: new THREE.Vector3(
          from.x + (to.x - from.x) * (initialDist / dist) + perpX * laneOffset,
          from.y || 0.08,
          from.z + (to.z - from.z) * (initialDist / dist) + perpZ * laneOffset
        ),
        heading,
      };
      this.simulatedCars.push(agent);
      this.instancedCars.setColorAt(i, carColors[i % carColors.length]);
    }

    // B. Spawn 2,200 Scooters (Iconic Vietnam motorbike swarm: Grab, Be, ShopeeFood, commuters)
    for (let i = 0; i < totalScooters; i++) {
      const edge = scooterEdges[i % scooterEdges.length];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
      const reverse = i % 2 === 1;
      const from = reverse ? n2 : n1;
      const to = reverse ? n1 : n2;
      const nextId = this.pickNextNode(to.id, from.id);
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      const perpX = -Math.cos(heading);
      const perpZ = Math.sin(heading);
      const laneOffset = this.getRoadLaneOffset(edge, 'scooter', i);
      const initialDist = ((i * 19.3) % (dist * 0.82)) + dist * 0.09;

      const agent: SimulatedVehicle = {
        id: i,
        type: 'scooter',
        fromId: from.id,
        toId: to.id,
        nextId,
        isTurning: false,
        edgeDistance: initialDist,
        edgeLength: dist,
        speed: 7.2 + (i % 6) * 0.5, // ~26-36 km/h
        cruiseSpeed: 7.2 + (i % 6) * 0.5,
        turnSpeed: 4.8,
        laneOffset,
        verticalOffset: 0.05,
        turnProgress: 0,
        turnLength: 1,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
        currentPos: new THREE.Vector3(
          from.x + (to.x - from.x) * (initialDist / dist) + perpX * laneOffset,
          from.y || 0.08,
          from.z + (to.z - from.z) * (initialDist / dist) + perpZ * laneOffset
        ),
        heading,
      };
      this.simulatedScooters.push(agent);
      this.instancedScooters.setColorAt(i, scooterColors[i % scooterColors.length]);
    }

    // C. Spawn 100 City Buses (Xe Buýt Sài Gòn & VinBus cruising along major arteries)
    for (let i = 0; i < totalBuses; i++) {
      const edge = busEdges[i % busEdges.length];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
      const reverse = i % 2 === 1;
      const from = reverse ? n2 : n1;
      const to = reverse ? n1 : n2;
      const nextId = this.pickNextNode(to.id, from.id);
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      const perpX = -Math.cos(heading);
      const perpZ = Math.sin(heading);
      const laneOffset = this.getRoadLaneOffset(edge, 'bus', i);
      const initialDist = ((i * 47.1) % (dist * 0.7)) + dist * 0.15;

      const agent: SimulatedVehicle = {
        id: i,
        type: 'bus',
        fromId: from.id,
        toId: to.id,
        nextId,
        isTurning: false,
        edgeDistance: initialDist,
        edgeLength: dist,
        speed: 7.0, // ~25 km/h city cruising speed
        cruiseSpeed: 7.0,
        turnSpeed: 3.8, // Slow majestic turning
        laneOffset,
        verticalOffset: 0.1,
        turnProgress: 0,
        turnLength: 1,
        p0: new THREE.Vector3(),
        p1: new THREE.Vector3(),
        p2: new THREE.Vector3(),
        currentPos: new THREE.Vector3(
          from.x + (to.x - from.x) * (initialDist / dist) + perpX * laneOffset,
          from.y || 0.08,
          from.z + (to.z - from.z) * (initialDist / dist) + perpZ * laneOffset
        ),
        heading,
      };
      this.simulatedBuses.push(agent);
      this.instancedBuses.setColorAt(i, busColors[i % busColors.length]);
    }

    if (this.instancedCars.instanceColor) this.instancedCars.instanceColor.needsUpdate = true;
    if (this.instancedScooters.instanceColor) this.instancedScooters.instanceColor.needsUpdate = true;
    if (this.instancedBuses.instanceColor) this.instancedBuses.instanceColor.needsUpdate = true;

    this.group.add(this.instancedCars);
    this.group.add(this.instancedScooters);
    this.group.add(this.instancedBuses);

    // Initial update
    this.update(0.016);
  }

  /**
   * Main simulation tick called every animation frame
   */
  public update(deltaTime: number): void {
    if (!this.roadGraph) return;
    const dt = Math.min(deltaTime, 0.08);

    // 1. Update Cars
    if (this.instancedCars && this.simulatedCars.length > 0) {
      for (let i = 0; i < this.simulatedCars.length; i++) {
        const v = this.simulatedCars[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedCars.setMatrixAt(i, this.dummy.matrix);
      }
      this.instancedCars.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Scooters
    if (this.instancedScooters && this.simulatedScooters.length > 0) {
      for (let i = 0; i < this.simulatedScooters.length; i++) {
        const v = this.simulatedScooters[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedScooters.setMatrixAt(i, this.dummy.matrix);
      }
      this.instancedScooters.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Buses
    if (this.instancedBuses && this.simulatedBuses.length > 0) {
      for (let i = 0; i < this.simulatedBuses.length; i++) {
        const v = this.simulatedBuses[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedBuses.setMatrixAt(i, this.dummy.matrix);
      }
      this.instancedBuses.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Helper to pick a connected outgoing road node from curNode (avoiding immediate U-turn if possible)
   */
  private pickNextNode(curNodeId: string, prevNodeId: string): string {
    const node = this.roadGraph?.nodes.get(curNodeId);
    if (!node || !node.neighborIds || node.neighborIds.length === 0) return prevNodeId;
    const branches = node.neighborIds.filter((id) => id !== prevNodeId);
    if (branches.length > 0) {
      return branches[Math.floor(Math.random() * branches.length)];
    }
    return prevNodeId; // Dead-end loop back
  }

  /**
   * Vehicle Kinematics with Smooth Quadratic Bézier Cornering
   */
  private updateVehicle(v: SimulatedVehicle, dt: number): void {
    if (!this.roadGraph) return;

    const n1 = this.roadGraph.nodes.get(v.fromId);
    const n2 = this.roadGraph.nodes.get(v.toId);
    if (!n1 || !n2) return;

    const dx1 = n2.x - n1.x;
    const dz1 = n2.z - n1.z;
    const len1 = Math.hypot(dx1, dz1);
    if (len1 < 1.0) return;

    const dir1X = dx1 / len1;
    const dir1Z = dz1 / len1;
    const perp1X = -dir1Z;
    const perp1Z = dir1X;

    // Cornering radius: vehicles begin smoothly arching into turns before reaching node n2
    const turnRadius = Math.min(6.5, len1 * 0.35);

    // =========================================================================
    // TRAFFIC SIGNAL STATE CHECK (Approaching intersection node n2 from n1)
    // =========================================================================
    let isRedOrYellow = false;
    let distToStop = 999;
    if (this.trafficSignals) {
      const signalColor = this.trafficSignals.getSignalColor(v.toId, v.fromId);
      if (signalColor === 'RED' || signalColor === 'YELLOW') {
        isRedOrYellow = true;
        distToStop = (len1 - 6.0) - v.edgeDistance;
      }
    }

    // =========================================================================
    // STATE A: CRUISING STRAIGHT ALONG CURRENT EDGE
    // =========================================================================
    if (!v.isTurning) {
      if (isRedOrYellow && distToStop > -0.5 && distToStop < 28.0) {
        // Red / Yellow traffic light ahead: smoothly decelerate and stop at the stop line
        if (distToStop <= 1.0) {
          v.speed = 0.0;
        } else {
          const decelFactor = Math.max(0, distToStop / 22.0);
          v.speed = THREE.MathUtils.lerp(v.speed, v.cruiseSpeed * decelFactor, 6.0 * dt);
        }
      } else {
        // Normal cruising or green light
        v.speed = THREE.MathUtils.lerp(v.speed, v.cruiseSpeed, 3.5 * dt);
      }

      v.edgeDistance += v.speed * dt;

      // Do not initiate corner turn if stopped at red/yellow light
      if (isRedOrYellow && distToStop <= 1.5) {
        // Remain waiting at stop line
        return;
      }

      // Check if entering the corner turn zone
      if (v.edgeDistance >= len1 - turnRadius) {
        const n3 = this.roadGraph.nodes.get(v.nextId);
        if (n3 && v.nextId !== v.toId) {
          const dx2 = n3.x - n2.x;
          const dz2 = n3.z - n2.z;
          const len2 = Math.hypot(dx2, dz2);

          if (len2 >= 1.0) {
            const dir2X = dx2 / len2;
            const dir2Z = dz2 / len2;
            const perp2X = -dir2Z;
            const perp2Z = dir2X;

            const exitRadius = Math.min(6.5, len2 * 0.35);

            // Compute outgoing road's authentic lane offset
            const outgoingEdge = this.roadGraph.edges.find(
              (e) => (e.fromId === n2.id && e.toId === n3.id) || (e.fromId === n3.id && e.toId === n2.id)
            );
            const outLaneOffset = this.getRoadLaneOffset(outgoingEdge, v.type, v.id);

            // Construct smooth Quadratic Bézier Curve (P0 -> P1 -> P2):
            // P0: Turn Entry point on incoming edge right lane
            const y1 = n1.y ?? 0.08;
            const y2 = n2.y ?? 0.08;
            const y3 = n3.y ?? 0.08;
            const entryY = y1 + (y2 - y1) * ((len1 - turnRadius) / len1);

            v.p0.set(
              n2.x - dir1X * turnRadius + perp1X * v.laneOffset,
              entryY,
              n2.z - dir1Z * turnRadius + perp1Z * v.laneOffset
            );

            // P2: Turn Exit point on outgoing edge right lane
            const exitY = y2 + (y3 - y2) * (exitRadius / len2);
            v.p2.set(
              n2.x + dir2X * exitRadius + perp2X * outLaneOffset,
              exitY,
              n2.z + dir2Z * exitRadius + perp2Z * outLaneOffset
            );

            // P1: Control Point at intersection of incoming & outgoing lanes
            // Ray 1: P0 + dir1 * t; Ray 2: P2 - dir2 * s
            const det = dir1X * dir2Z - dir1Z * dir2X;
            if (Math.abs(det) > 0.06) {
              const diffX = v.p2.x - v.p0.x;
              const diffZ = v.p2.z - v.p0.z;
              const u = (diffX * dir2Z - diffZ * dir2X) / det;
              if (u > 0 && u < turnRadius + exitRadius + 8.0) {
                v.p1.set(v.p0.x + dir1X * u, (entryY + exitY) / 2, v.p0.z + dir1Z * u);
              } else {
                v.p1.set(
                  n2.x + ((perp1X + perp2X) / 2) * v.laneOffset,
                  (entryY + exitY) / 2,
                  n2.z + ((perp1Z + perp2Z) / 2) * v.laneOffset
                );
              }
            } else {
              // Nearly straight continuation or U-turn
              v.p1.set(
                (v.p0.x + v.p2.x) / 2,
                (entryY + exitY) / 2,
                (v.p0.z + v.p2.z) / 2
              );
            }

            v.turnLength = Math.hypot(v.p1.x - v.p0.x, v.p1.z - v.p0.z) + Math.hypot(v.p2.x - v.p1.x, v.p2.z - v.p1.z);
            v.turnProgress = 0.0;
            v.isTurning = true;
          }
        }
      }

      // If not turning, compute position along straight edge
      if (!v.isTurning) {
        // Handle end of edge fallback if next edge is unavailable
        if (v.edgeDistance >= len1) {
          v.fromId = v.toId;
          v.toId = v.nextId;
          v.nextId = this.pickNextNode(v.toId, v.fromId);
          const newEdge = this.roadGraph.edges.find(
            (e) => (e.fromId === v.fromId && e.toId === v.toId) || (e.fromId === v.toId && e.toId === v.fromId)
          );
          v.laneOffset = this.getRoadLaneOffset(newEdge, v.type, v.id);
          v.edgeDistance = 0.0;
          return;
        }

        const t = Math.max(0, Math.min(1, v.edgeDistance / len1));
        const cx = n1.x + dx1 * t;
        const cz = n1.z + dz1 * t;
        const cy = (n1.y ?? 0.08) + ((n2.y ?? 0.08) - (n1.y ?? 0.08)) * t + v.verticalOffset;

        v.currentPos.set(cx + perp1X * v.laneOffset, cy, cz + perp1Z * v.laneOffset);

        const targetHeading = Math.atan2(dir1X, dir1Z);
        v.heading = lerpAngle(v.heading, targetHeading, 16.0 * dt);
        return;
      }
    }

    // =========================================================================
    // STATE B: NAVIGATING CORNER ARC VIA QUADRATIC BÉZIER SPLINE
    // =========================================================================
    if (v.isTurning) {
      // Decelerate smoothly while navigating the corner
      v.speed = THREE.MathUtils.lerp(v.speed, v.turnSpeed, 5.0 * dt);
      v.turnProgress += (v.speed * dt) / Math.max(1.0, v.turnLength);

      // Finished cornering transition
      if (v.turnProgress >= 1.0) {
        v.isTurning = false;
        v.fromId = v.toId;
        v.toId = v.nextId;
        v.nextId = this.pickNextNode(v.toId, v.fromId);

        const newN1 = this.roadGraph.nodes.get(v.fromId);
        const newN2 = this.roadGraph.nodes.get(v.toId);
        if (newN1 && newN2) {
          v.edgeLength = Math.hypot(newN2.x - newN1.x, newN2.z - newN1.z);
          // Start cleanly right after the exit arc radius
          v.edgeDistance = Math.min(6.5, v.edgeLength * 0.35);
        } else {
          v.edgeDistance = 0.0;
        }

        // Dynamically adjust lane offset to the new road's width
        const newEdge = this.roadGraph.edges.find(
          (e) => (e.fromId === v.fromId && e.toId === v.toId) || (e.fromId === v.toId && e.toId === v.fromId)
        );
        v.laneOffset = this.getRoadLaneOffset(newEdge, v.type, v.id);

        v.currentPos.copy(v.p2);
        return;
      }

      // Sample position along Quadratic Bézier Curve: B(u) = (1-u)^2 * P0 + 2(1-u)u * P1 + u^2 * P2
      const u = v.turnProgress;
      const om = 1.0 - u;
      const om2 = om * om;
      const u2 = u * u;
      const twoOmU = 2.0 * om * u;

      const px = om2 * v.p0.x + twoOmU * v.p1.x + u2 * v.p2.x;
      const py = om2 * v.p0.y + twoOmU * v.p1.y + u2 * v.p2.y + v.verticalOffset;
      const pz = om2 * v.p0.z + twoOmU * v.p1.z + u2 * v.p2.z;

      v.currentPos.set(px, py, pz);

      // Sample tangent vector: B'(u) = 2(1-u)(P1 - P0) + 2u(P2 - P1)
      const tx = 2.0 * om * (v.p1.x - v.p0.x) + 2.0 * u * (v.p2.x - v.p1.x);
      const tz = 2.0 * om * (v.p1.z - v.p0.z) + 2.0 * u * (v.p2.z - v.p1.z);

      if (Math.hypot(tx, tz) > 0.01) {
        const targetHeading = Math.atan2(tx, tz);
        v.heading = lerpAngle(v.heading, targetHeading, 22.0 * dt);
      }
    }
  }

  /**
   * Backward-compatible static factory for static placements if needed
   */
  public static createTraffic(placements: VehiclePlacement[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'traffic_static_group';
    return group;
  }
}
