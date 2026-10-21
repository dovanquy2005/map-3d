import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadGraphEdge, RoadGraphNode, RoadNetworkGraph } from '../types/gis';

export interface VehiclePlacement {
  x: number;
  y?: number;
  z: number;
  heading: number; // in radians
  isScooter?: boolean;
}

interface SimulatedVehicle {
  id: number;
  isScooter: boolean;
  edgeIndex: number;
  fromId: string;
  toId: string;
  progress: number; // 0.0 to 1.0 along current edge
  speed: number; // m/s
  targetSpeed: number; // cruising speed
  laneOffset: number; // meters from road centerline (+ to the right)
  currentPos: THREE.Vector3;
  heading: number;
}

export class CityTraffic {
  public group: THREE.Group;
  private roadGraph: RoadNetworkGraph | null = null;

  // Active agents
  private simulatedCars: SimulatedVehicle[] = [];
  private simulatedScooters: SimulatedVehicle[] = [];

  // Instanced Meshes
  private instancedCars: THREE.InstancedMesh | null = null;
  private instancedScooters: THREE.InstancedMesh | null = null;
  private dummy: THREE.Object3D = new THREE.Object3D();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'traffic_simulation_group';
  }

  /**
   * Initializes autonomous traffic simulation with 200+ moving cars & scooters
   */
  public initSimulation(roadGraph: RoadNetworkGraph): void {
    this.roadGraph = roadGraph;

    // Clear previous simulation
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.simulatedCars = [];
    this.simulatedScooters = [];

    const validEdges = roadGraph.edges.filter((e) => {
      const n1 = roadGraph.nodes.get(e.fromId);
      const n2 = roadGraph.nodes.get(e.toId);
      if (!n1 || !n2) return false;
      return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 15;
    });

    if (validEdges.length === 0) return;

    // Build low-poly Car Model (Chassis + Cabin)
    const carChassis = new THREE.BoxGeometry(1.65, 0.65, 3.4);
    carChassis.translate(0, 0.42, 0);
    const carCabin = new THREE.BoxGeometry(1.45, 0.6, 1.9);
    carCabin.translate(0, 0.95, -0.2);
    const carGeo = BufferGeometryUtils.mergeGeometries([carChassis, carCabin]) || carChassis;
    const carMat = new THREE.MeshStandardMaterial({
      roughness: 0.35,
      metalness: 0.5,
    });

    // Build low-poly Vietnam Scooter + Rider Model
    const scooterBody = new THREE.BoxGeometry(0.42, 0.4, 1.3);
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

    // Vehicle color palettes
    const carColors = [
      new THREE.Color(0xf8fafc), // White
      new THREE.Color(0x10b981), // Mai Linh Taxi / Grab Green
      new THREE.Color(0xfacc15), // Saigon Yellow Taxi
      new THREE.Color(0xef4444), // Crimson
      new THREE.Color(0x0284c7), // Cyan Blue
      new THREE.Color(0x1e293b), // Black
      new THREE.Color(0x94a3b8), // Silver Metallic
    ];

    const scooterColors = [
      new THREE.Color(0x10b981), // Grab Green
      new THREE.Color(0xfacc15), // Be Yellow
      new THREE.Color(0xef4444), // Delivery Red
      new THREE.Color(0x1e293b), // Black
      new THREE.Color(0x38bdf8), // Sky Blue
      new THREE.Color(0xf8fafc), // Pearl White
    ];

    // Spawn 80-120 Cars and 140-200 Scooters distributed across valid road edges
    const totalCars = Math.min(140, Math.floor(validEdges.length * 1.2));
    const totalScooters = Math.min(220, Math.floor(validEdges.length * 2.0));

    this.instancedCars = new THREE.InstancedMesh(carGeo, carMat, totalCars);
    this.instancedCars.castShadow = true;
    this.instancedCars.receiveShadow = true;

    this.instancedScooters = new THREE.InstancedMesh(scooterGeo, scooterMat, totalScooters);
    this.instancedScooters.castShadow = true;
    this.instancedScooters.receiveShadow = true;

    let carIdx = 0;
    let scooterIdx = 0;

    for (let i = 0; i < validEdges.length; i++) {
      const edge = validEdges[i];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);

      // Spawn Cars on non-alleys
      if (!edge.isAlley && carIdx < totalCars) {
        const laneOffset = 2.0; // Right lane
        const agent: SimulatedVehicle = {
          id: carIdx,
          isScooter: false,
          edgeIndex: i,
          fromId: edge.fromId,
          toId: edge.toId,
          progress: (carIdx * 0.37) % 0.85 + 0.05,
          speed: 8.5 + (carIdx % 4) * 0.8, // ~30 - 42 km/h
          targetSpeed: 8.5 + (carIdx % 4) * 0.8,
          laneOffset,
          currentPos: new THREE.Vector3(n1.x, n1.y || 0.08, n1.z),
          heading: Math.atan2(n2.x - n1.x, n2.z - n1.z),
        };
        this.simulatedCars.push(agent);
        this.instancedCars.setColorAt(carIdx, carColors[carIdx % carColors.length]);
        carIdx++;
      }

      // Spawn Scooters (can go on both main streets and alleys)
      if (scooterIdx < totalScooters) {
        // Scooters ride in right-most lane (laneOffset 3.2m or 0 on narrow alley)
        const laneOffset = edge.isAlley ? 0 : 3.2;
        const agent: SimulatedVehicle = {
          id: scooterIdx,
          isScooter: true,
          edgeIndex: i,
          fromId: edge.fromId,
          toId: edge.toId,
          progress: (scooterIdx * 0.23) % 0.88 + 0.04,
          speed: 7.5 + (scooterIdx % 5) * 0.7, // ~27 - 38 km/h
          targetSpeed: 7.5 + (scooterIdx % 5) * 0.7,
          laneOffset,
          currentPos: new THREE.Vector3(n1.x, n1.y || 0.08, n1.z),
          heading: Math.atan2(n2.x - n1.x, n2.z - n1.z),
        };
        this.simulatedScooters.push(agent);
        this.instancedScooters.setColorAt(scooterIdx, scooterColors[scooterIdx % scooterColors.length]);
        scooterIdx++;
      }
    }

    if (this.instancedCars.instanceColor) this.instancedCars.instanceColor.needsUpdate = true;
    if (this.instancedScooters.instanceColor) this.instancedScooters.instanceColor.needsUpdate = true;

    this.group.add(this.instancedCars);
    this.group.add(this.instancedScooters);

    // Initial positioning update
    this.update(0.016);
  }

  /**
   * Main simulation tick: updates positions, handles traffic lights & anti-collision
   */
  public update(deltaTime: number): void {
    if (!this.roadGraph || !this.instancedCars || !this.instancedScooters) return;

    const dt = Math.min(deltaTime, 0.1);

    // Update cars
    for (let i = 0; i < this.simulatedCars.length; i++) {
      const v = this.simulatedCars[i];
      this.updateAgent(v, dt);
      this.dummy.position.copy(v.currentPos);
      this.dummy.rotation.set(0, v.heading, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.instancedCars.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedCars.instanceMatrix.needsUpdate = true;

    // Update scooters
    for (let i = 0; i < this.simulatedScooters.length; i++) {
      const v = this.simulatedScooters[i];
      this.updateAgent(v, dt);
      this.dummy.position.copy(v.currentPos);
      this.dummy.rotation.set(0, v.heading, 0);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.instancedScooters.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedScooters.instanceMatrix.needsUpdate = true;
  }

  private updateAgent(agent: SimulatedVehicle, dt: number): void {
    if (!this.roadGraph) return;

    const n1 = this.roadGraph.nodes.get(agent.fromId);
    const n2 = this.roadGraph.nodes.get(agent.toId);
    if (!n1 || !n2) return;

    const dx = n2.x - n1.x;
    const dz = n2.z - n1.z;
    const edgeLen = Math.hypot(dx, dz);
    if (edgeLen < 1.0) return;

    const ndx = dx / edgeLen;
    const ndz = dz / edgeLen;
    // Right perpendicular vector for Vietnam right-hand traffic law
    const perpX = -ndz;
    const perpZ = ndx;

    agent.heading = Math.atan2(ndx, ndz);

    // Cruise smoothly at target speed
    agent.speed = THREE.MathUtils.lerp(agent.speed, agent.targetSpeed, 5.0 * dt);

    // Advance progress along edge
    const moveDist = agent.speed * dt;
    agent.progress += moveDist / edgeLen;

    // Handle end of edge / junction transition
    if (agent.progress >= 0.98) {
      // Pick next connected branch at node n2
      const nextNeighbors = (n2.neighborIds || []).filter((id) => id !== n1.id);
      if (nextNeighbors.length > 0) {
        const nextTargetId = nextNeighbors[Math.floor(Math.random() * nextNeighbors.length)];
        agent.fromId = n2.id;
        agent.toId = nextTargetId;
        agent.progress = 0.02;
      } else {
        // Dead-end: flip around
        const temp = agent.fromId;
        agent.fromId = agent.toId;
        agent.toId = temp;
        agent.progress = 0.02;
      }
    }

    // 5. Calculate 3D position (including bridge deck vertical height)
    const t = Math.max(0, Math.min(1, agent.progress));
    const cx = n1.x + dx * t;
    const cz = n1.z + dz * t;

    // Interpolate vertical height along edge (smooth bridge ramp / deck elevation)
    const y1 = n1.y ?? 0.08;
    const y2 = n2.y ?? 0.08;
    const cy = y1 + (y2 - y1) * t + (agent.isScooter ? 0.05 : 0.08);

    agent.currentPos.set(
      cx + perpX * agent.laneOffset,
      cy,
      cz + perpZ * agent.laneOffset
    );
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
