import * as THREE from 'three';
import { RoadGraphEdge, RoadNetworkGraph } from '../types/gis';
import { TrafficSignalSystem } from './TrafficSignalSystem';
import { VehicleModels } from './VehicleModels';

export interface VehiclePlacement {
  x: number;
  y?: number;
  z: number;
  heading: number;
  isScooter?: boolean;
}

interface SimulatedVehicle {
  id: number;
  type: 'car' | 'scooter' | 'shipper' | 'bus';
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

  // Turn signal state (Xi-nhan)
  turnSignal: 'none' | 'left' | 'right';
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

  // Active agents (1,880 dense metropolis agents: 500 cars, 900 commuters, 400 shippers, 80 buses)
  private simulatedCars: SimulatedVehicle[] = [];
  private simulatedScooters: SimulatedVehicle[] = [];
  private simulatedShippers: SimulatedVehicle[] = [];
  private simulatedBuses: SimulatedVehicle[] = [];

  // O(1) Edge Fast Lookup Map (prevents 15,000,000 array scans per frame)
  private edgeMap: Map<string, RoadGraphEdge> = new Map();

  // Synchronized Instanced Meshes (Body + Details per vehicle class sharing instanceMatrix)
  private instancedCarsBody: THREE.InstancedMesh | null = null;
  private instancedCarsDetails: THREE.InstancedMesh | null = null;
  private instancedCarsBlinkersLeft: THREE.InstancedMesh | null = null;
  private instancedCarsBlinkersRight: THREE.InstancedMesh | null = null;

  private instancedScootersBody: THREE.InstancedMesh | null = null;
  private instancedScootersDetails: THREE.InstancedMesh | null = null;
  private instancedScootersBlinkersLeft: THREE.InstancedMesh | null = null;
  private instancedScootersBlinkersRight: THREE.InstancedMesh | null = null;

  private instancedShippersBody: THREE.InstancedMesh | null = null;
  private instancedShippersDetails: THREE.InstancedMesh | null = null;
  private instancedShippersBlinkersLeft: THREE.InstancedMesh | null = null;
  private instancedShippersBlinkersRight: THREE.InstancedMesh | null = null;

  private instancedBusesBody: THREE.InstancedMesh | null = null;
  private instancedBusesDetails: THREE.InstancedMesh | null = null;
  private instancedBusesBlinkersLeft: THREE.InstancedMesh | null = null;
  private instancedBusesBlinkersRight: THREE.InstancedMesh | null = null;

  private dummy: THREE.Object3D = new THREE.Object3D();
  private zeroMatrix: THREE.Matrix4 = new THREE.Matrix4().makeScale(0, 0, 0);
  private blinkTimer: number = 0;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'traffic_simulation_group';
  }

  /**
   * Helper to compute authentic right-hand lane offset proportional to road width
   */
  private getRoadLaneOffset(edge: RoadGraphEdge | undefined, vehicleType: 'car' | 'scooter' | 'shipper' | 'bus', reverseIndex: number = 0): number {
    if (!edge) return 1.8;
    const roadWidth = edge.width || (edge.highway === 'primary' ? 14.0 : edge.highway === 'secondary' ? 9.0 : edge.isAlley ? 2.8 : 6.0);
    if (edge.isAlley) {
      return reverseIndex % 2 === 0 ? 0.35 : -0.35;
    }
    if (vehicleType === 'scooter' || vehicleType === 'shipper') {
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
    this.simulatedShippers = [];
    this.simulatedBuses = [];

    // Build O(1) Edge Lookup Map
    this.edgeMap.clear();
    for (const edge of roadGraph.edges) {
      this.edgeMap.set(`${edge.fromId}_${edge.toId}`, edge);
      this.edgeMap.set(`${edge.toId}_${edge.fromId}`, edge);
    }

    // Filter valid road segments with minimum navigable length
    const validEdges = roadGraph.edges.filter((e) => {
      const n1 = roadGraph.nodes.get(e.fromId);
      const n2 = roadGraph.nodes.get(e.toId);
      if (!n1 || !n2) return false;
      return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 12;
    });

    if (validEdges.length === 0) return;

    // =========================================================================
    // 1. GENERATE HIGH-FIDELITY 3D VEHICLE GEOMETRIES (Cars, Scooters, Shippers, Buses)
    // =========================================================================
    const carPack = VehicleModels.createCarModel();
    const commuterPack = VehicleModels.createScooterModel(false);
    const shipperPack = VehicleModels.createScooterModel(true);
    const busPack = VehicleModels.createBusModel();

    // Amber turn signal geometries and material
    const carBlinkers = VehicleModels.createCarBlinkersGeo();
    const scooterBlinkers = VehicleModels.createScooterBlinkersGeo();
    const busBlinkers = VehicleModels.createBusBlinkersGeo();
    const blinkerAmberMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    // High-end clearcoat automotive materials
    const carBodyMat = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.6 });
    const carDetailsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });

    const scooterBodyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 });
    const scooterDetailsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });

    const shipperBodyMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.45 });
    const shipperDetailsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 });

    const busBodyMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5 });
    const busDetailsMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 });

    // Authentic Vietnamese vehicle palettes
    const carColors = [
      new THREE.Color(0xf8fafc), // VinFast / Toyota Pearl White
      new THREE.Color(0x10b981), // Mai Linh Taxi / Green SM Emerald
      new THREE.Color(0xfacc15), // Saigon Yellow Taxi
      new THREE.Color(0xdc2626), // Crimson Metallic Red
      new THREE.Color(0x0284c7), // Ocean Cyan Blue
      new THREE.Color(0x0f172a), // Executive Gloss Black Sedan
      new THREE.Color(0x64748b), // Titanium Metallic Silver
      new THREE.Color(0x1e3a8a), // VinFast Deep Navy
    ];

    const commuterColors = [
      new THREE.Color(0xf8fafc), // Pearl White Honda Vision/SH
      new THREE.Color(0x1e293b), // Phantom Black AirBlade
      new THREE.Color(0xdc2626), // Candy Red Honda Lead
      new THREE.Color(0x0284c7), // Cyan Blue Honda Wave
      new THREE.Color(0x64748b), // Metallic Silver Future
      new THREE.Color(0xd97706), // Metallic Gold SH
    ];

    const shipperColors = [
      new THREE.Color(0x10b981), // Grab Vietnam Emerald Green Driver
      new THREE.Color(0xfacc15), // Be Vietnam Bumblebee Yellow Driver
      new THREE.Color(0xef4444), // ShopeeFood Crimson Red Driver
      new THREE.Color(0x059669), // Baemin / Ahamove Mint Driver
      new THREE.Color(0x1e293b), // Lalamove Black Driver
    ];

    const busColors = [
      new THREE.Color(0x15803d), // Iconic Saigon City Bus Emerald Green
      new THREE.Color(0x16a34a), // Saigon Transerco Light Green
      new THREE.Color(0x2563eb), // Modern VinBus Electric Eco Blue
      new THREE.Color(0xf59e0b), // Airport Shuttle Bus Yellow
    ];

    // =========================================================================
    // 2. SPAWN 1,880 AGENTS (500 Cars, 900 Commuters, 400 Shippers, 80 Buses)
    // =========================================================================
    const carEdges = validEdges.filter((e) => !e.isAlley);
    const scooterEdges = validEdges;
    const majorEdges = validEdges.filter(
      (e) => !e.isAlley && (e.highway === 'primary' || e.highway === 'secondary' || e.highway === 'trunk' || e.highway === 'tertiary')
    );
    const busEdges = majorEdges.length > 0 ? majorEdges : carEdges;

    if (carEdges.length === 0 || scooterEdges.length === 0) return;

    const totalCars = 500;
    const totalScooters = 900;
    const totalShippers = 400;
    const totalBuses = 80;

    // A. Cars Instanced Meshes (Body + Details sharing instanceMatrix buffer)
    this.instancedCarsBody = new THREE.InstancedMesh(carPack.body, carBodyMat, totalCars);
    this.instancedCarsDetails = new THREE.InstancedMesh(carPack.details, carDetailsMat, totalCars);
    this.instancedCarsDetails.instanceMatrix = this.instancedCarsBody.instanceMatrix;
    this.instancedCarsBody.castShadow = false;
    this.instancedCarsBody.receiveShadow = true;
    this.instancedCarsDetails.castShadow = false;
    this.instancedCarsDetails.receiveShadow = true;

    this.instancedCarsBlinkersLeft = new THREE.InstancedMesh(carBlinkers.leftGeo, blinkerAmberMat, totalCars);
    this.instancedCarsBlinkersRight = new THREE.InstancedMesh(carBlinkers.rightGeo, blinkerAmberMat, totalCars);
    for (let i = 0; i < totalCars; i++) {
      this.instancedCarsBlinkersLeft.setMatrixAt(i, this.zeroMatrix);
      this.instancedCarsBlinkersRight.setMatrixAt(i, this.zeroMatrix);
    }

    // B. Commuter Scooters Instanced Meshes
    this.instancedScootersBody = new THREE.InstancedMesh(commuterPack.body, scooterBodyMat, totalScooters);
    this.instancedScootersDetails = new THREE.InstancedMesh(commuterPack.details, scooterDetailsMat, totalScooters);
    this.instancedScootersDetails.instanceMatrix = this.instancedScootersBody.instanceMatrix;
    this.instancedScootersBody.castShadow = false;
    this.instancedScootersBody.receiveShadow = true;
    this.instancedScootersDetails.castShadow = false;
    this.instancedScootersDetails.receiveShadow = true;

    this.instancedScootersBlinkersLeft = new THREE.InstancedMesh(scooterBlinkers.leftGeo, blinkerAmberMat, totalScooters);
    this.instancedScootersBlinkersRight = new THREE.InstancedMesh(scooterBlinkers.rightGeo, blinkerAmberMat, totalScooters);
    for (let i = 0; i < totalScooters; i++) {
      this.instancedScootersBlinkersLeft.setMatrixAt(i, this.zeroMatrix);
      this.instancedScootersBlinkersRight.setMatrixAt(i, this.zeroMatrix);
    }

    // C. Delivery Shippers Instanced Meshes
    this.instancedShippersBody = new THREE.InstancedMesh(shipperPack.body, shipperBodyMat, totalShippers);
    this.instancedShippersDetails = new THREE.InstancedMesh(shipperPack.details, shipperDetailsMat, totalShippers);
    this.instancedShippersDetails.instanceMatrix = this.instancedShippersBody.instanceMatrix;
    this.instancedShippersBody.castShadow = false;
    this.instancedShippersBody.receiveShadow = true;
    this.instancedShippersDetails.castShadow = false;
    this.instancedShippersDetails.receiveShadow = true;

    this.instancedShippersBlinkersLeft = new THREE.InstancedMesh(scooterBlinkers.leftGeo, blinkerAmberMat, totalShippers);
    this.instancedShippersBlinkersRight = new THREE.InstancedMesh(scooterBlinkers.rightGeo, blinkerAmberMat, totalShippers);
    for (let i = 0; i < totalShippers; i++) {
      this.instancedShippersBlinkersLeft.setMatrixAt(i, this.zeroMatrix);
      this.instancedShippersBlinkersRight.setMatrixAt(i, this.zeroMatrix);
    }

    // D. City Buses Instanced Meshes
    this.instancedBusesBody = new THREE.InstancedMesh(busPack.body, busBodyMat, totalBuses);
    this.instancedBusesDetails = new THREE.InstancedMesh(busPack.details, busDetailsMat, totalBuses);
    this.instancedBusesDetails.instanceMatrix = this.instancedBusesBody.instanceMatrix;
    this.instancedBusesBody.castShadow = false;
    this.instancedBusesBody.receiveShadow = true;
    this.instancedBusesDetails.castShadow = false;
    this.instancedBusesDetails.receiveShadow = true;

    this.instancedBusesBlinkersLeft = new THREE.InstancedMesh(busBlinkers.leftGeo, blinkerAmberMat, totalBuses);
    this.instancedBusesBlinkersRight = new THREE.InstancedMesh(busBlinkers.rightGeo, blinkerAmberMat, totalBuses);
    for (let i = 0; i < totalBuses; i++) {
      this.instancedBusesBlinkersLeft.setMatrixAt(i, this.zeroMatrix);
      this.instancedBusesBlinkersRight.setMatrixAt(i, this.zeroMatrix);
    }


    // 1. Spawn 500 Sedans / Taxis / Crossovers
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
        speed: 8.5 + (i % 5) * 0.6,
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
        turnSignal: 'none',
      };
      this.simulatedCars.push(agent);
      this.instancedCarsBody.setColorAt(i, carColors[i % carColors.length]);
    }

    // 2. Spawn 900 Commuter Motorbikes
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
        speed: 7.2 + (i % 6) * 0.5,
        cruiseSpeed: 7.2 + (i % 6) * 0.5,
        turnSpeed: 4.8,
        laneOffset,
        verticalOffset: 0.06,
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
        turnSignal: 'none',
      };
      this.simulatedScooters.push(agent);
      this.instancedScootersBody.setColorAt(i, commuterColors[i % commuterColors.length]);
    }

    // 3. Spawn 400 Delivery Shipper Scooters (Grab, Be, ShopeeFood)
    for (let i = 0; i < totalShippers; i++) {
      const edge = scooterEdges[(i * 3 + 7) % scooterEdges.length];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
      const reverse = i % 2 === 0;
      const from = reverse ? n2 : n1;
      const to = reverse ? n1 : n2;
      const nextId = this.pickNextNode(to.id, from.id);
      const heading = Math.atan2(to.x - from.x, to.z - from.z);
      const perpX = -Math.cos(heading);
      const perpZ = Math.sin(heading);
      const laneOffset = this.getRoadLaneOffset(edge, 'shipper', i);
      const initialDist = ((i * 23.7) % (dist * 0.8)) + dist * 0.10;

      const agent: SimulatedVehicle = {
        id: i,
        type: 'shipper',
        fromId: from.id,
        toId: to.id,
        nextId,
        isTurning: false,
        edgeDistance: initialDist,
        edgeLength: dist,
        speed: 7.8 + (i % 5) * 0.5,
        cruiseSpeed: 7.8 + (i % 5) * 0.5,
        turnSpeed: 5.0,
        laneOffset,
        verticalOffset: 0.06,
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
        turnSignal: 'none',
      };
      this.simulatedShippers.push(agent);
      this.instancedShippersBody.setColorAt(i, shipperColors[i % shipperColors.length]);
    }

    // 4. Spawn 80 City Buses (Saigon City Bus & VinBus Electric)
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
        speed: 7.0,
        cruiseSpeed: 7.0,
        turnSpeed: 3.8,
        laneOffset,
        verticalOffset: 0.10,
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
        turnSignal: 'none',
      };
      this.simulatedBuses.push(agent);
      this.instancedBusesBody.setColorAt(i, busColors[i % busColors.length]);
    }

    if (this.instancedCarsBody.instanceColor) this.instancedCarsBody.instanceColor.needsUpdate = true;
    if (this.instancedScootersBody.instanceColor) this.instancedScootersBody.instanceColor.needsUpdate = true;
    if (this.instancedShippersBody.instanceColor) this.instancedShippersBody.instanceColor.needsUpdate = true;
    if (this.instancedBusesBody.instanceColor) this.instancedBusesBody.instanceColor.needsUpdate = true;

    // Add synchronized instanced meshes to group (Body + Details + Amber Blinkers per class)
    this.group.add(this.instancedCarsBody);
    this.group.add(this.instancedCarsDetails);
    if (this.instancedCarsBlinkersLeft) this.group.add(this.instancedCarsBlinkersLeft);
    if (this.instancedCarsBlinkersRight) this.group.add(this.instancedCarsBlinkersRight);

    this.group.add(this.instancedScootersBody);
    this.group.add(this.instancedScootersDetails);
    if (this.instancedScootersBlinkersLeft) this.group.add(this.instancedScootersBlinkersLeft);
    if (this.instancedScootersBlinkersRight) this.group.add(this.instancedScootersBlinkersRight);

    this.group.add(this.instancedShippersBody);
    this.group.add(this.instancedShippersDetails);
    if (this.instancedShippersBlinkersLeft) this.group.add(this.instancedShippersBlinkersLeft);
    if (this.instancedShippersBlinkersRight) this.group.add(this.instancedShippersBlinkersRight);

    this.group.add(this.instancedBusesBody);
    this.group.add(this.instancedBusesDetails);
    if (this.instancedBusesBlinkersLeft) this.group.add(this.instancedBusesBlinkersLeft);
    if (this.instancedBusesBlinkersRight) this.group.add(this.instancedBusesBlinkersRight);

    // Initial update
    this.update(0.016);
  }

  /**
   * Main simulation tick called every animation frame (Lightweight & 60 FPS Locked)
   */
  public update(deltaTime: number): void {
    if (!this.roadGraph) return;
    const dt = Math.min(deltaTime, 0.08);

    // Global blink cycle for vehicle turn signals (~2.4 Hz)
    this.blinkTimer += dt;
    const blinkOn = Math.sin(this.blinkTimer * 14.0) > 0;

    // 1. Update Cars
    if (this.instancedCarsBody && this.simulatedCars.length > 0) {
      for (let i = 0; i < this.simulatedCars.length; i++) {
        const v = this.simulatedCars[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedCarsBody.setMatrixAt(i, this.dummy.matrix);

        if (this.instancedCarsBlinkersLeft) {
          this.instancedCarsBlinkersLeft.setMatrixAt(
            i,
            v.turnSignal === 'left' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
        if (this.instancedCarsBlinkersRight) {
          this.instancedCarsBlinkersRight.setMatrixAt(
            i,
            v.turnSignal === 'right' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
      }
      this.instancedCarsBody.instanceMatrix.needsUpdate = true;
      if (this.instancedCarsBlinkersLeft) this.instancedCarsBlinkersLeft.instanceMatrix.needsUpdate = true;
      if (this.instancedCarsBlinkersRight) this.instancedCarsBlinkersRight.instanceMatrix.needsUpdate = true;
    }

    // 2. Update Commuter Scooters
    if (this.instancedScootersBody && this.simulatedScooters.length > 0) {
      for (let i = 0; i < this.simulatedScooters.length; i++) {
        const v = this.simulatedScooters[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedScootersBody.setMatrixAt(i, this.dummy.matrix);

        if (this.instancedScootersBlinkersLeft) {
          this.instancedScootersBlinkersLeft.setMatrixAt(
            i,
            v.turnSignal === 'left' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
        if (this.instancedScootersBlinkersRight) {
          this.instancedScootersBlinkersRight.setMatrixAt(
            i,
            v.turnSignal === 'right' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
      }
      this.instancedScootersBody.instanceMatrix.needsUpdate = true;
      if (this.instancedScootersBlinkersLeft) this.instancedScootersBlinkersLeft.instanceMatrix.needsUpdate = true;
      if (this.instancedScootersBlinkersRight) this.instancedScootersBlinkersRight.instanceMatrix.needsUpdate = true;
    }

    // 3. Update Delivery Shippers
    if (this.instancedShippersBody && this.simulatedShippers.length > 0) {
      for (let i = 0; i < this.simulatedShippers.length; i++) {
        const v = this.simulatedShippers[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedShippersBody.setMatrixAt(i, this.dummy.matrix);

        if (this.instancedShippersBlinkersLeft) {
          this.instancedShippersBlinkersLeft.setMatrixAt(
            i,
            v.turnSignal === 'left' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
        if (this.instancedShippersBlinkersRight) {
          this.instancedShippersBlinkersRight.setMatrixAt(
            i,
            v.turnSignal === 'right' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
      }
      this.instancedShippersBody.instanceMatrix.needsUpdate = true;
      if (this.instancedShippersBlinkersLeft) this.instancedShippersBlinkersLeft.instanceMatrix.needsUpdate = true;
      if (this.instancedShippersBlinkersRight) this.instancedShippersBlinkersRight.instanceMatrix.needsUpdate = true;
    }

    // 4. Update Buses
    if (this.instancedBusesBody && this.simulatedBuses.length > 0) {
      for (let i = 0; i < this.simulatedBuses.length; i++) {
        const v = this.simulatedBuses[i];
        this.updateVehicle(v, dt);
        this.dummy.position.copy(v.currentPos);
        this.dummy.rotation.set(0, v.heading, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.instancedBusesBody.setMatrixAt(i, this.dummy.matrix);

        if (this.instancedBusesBlinkersLeft) {
          this.instancedBusesBlinkersLeft.setMatrixAt(
            i,
            v.turnSignal === 'left' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
        if (this.instancedBusesBlinkersRight) {
          this.instancedBusesBlinkersRight.setMatrixAt(
            i,
            v.turnSignal === 'right' && blinkOn ? this.dummy.matrix : this.zeroMatrix
          );
        }
      }
      this.instancedBusesBody.instanceMatrix.needsUpdate = true;
      if (this.instancedBusesBlinkersLeft) this.instancedBusesBlinkersLeft.instanceMatrix.needsUpdate = true;
      if (this.instancedBusesBlinkersRight) this.instancedBusesBlinkersRight.instanceMatrix.needsUpdate = true;
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

      // Advance Turn Signal detection: vehicles activate turn signal when within 24m of the turn
      if (v.edgeDistance >= len1 - 24.0) {
        const n3 = this.roadGraph.nodes.get(v.nextId);
        if (n3 && v.nextId !== v.toId) {
          const dx2 = n3.x - n2.x;
          const dz2 = n3.z - n2.z;
          const len2 = Math.hypot(dx2, dz2);
          if (len2 >= 1.0) {
            const dir2X = dx2 / len2;
            const dir2Z = dz2 / len2;
            const cross = dir1X * dir2Z - dir1Z * dir2X;
            if (cross > 0.08) {
              v.turnSignal = 'right';
            } else if (cross < -0.08) {
              v.turnSignal = 'left';
            } else {
              v.turnSignal = 'none';
            }
          }
        }
      } else {
        v.turnSignal = 'none';
      }

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

            // Compute outgoing road's authentic lane offset (O(1) Map lookup)
            const outgoingEdge = this.edgeMap.get(`${n2.id}_${n3.id}`);
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
        v.turnSignal = 'none';
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

        // Dynamically adjust lane offset to the new road's width (O(1) Map lookup)
        const newEdge = this.edgeMap.get(`${v.fromId}_${v.toId}`);
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
