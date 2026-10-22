import * as THREE from 'three';
import { RoadGraphEdge, RoadNetworkGraph } from '../types/gis';
import { AudioManager } from '../services/AudioManager';

export type EmergencyEventType = 'none' | 'police_chase' | 'ambulance_rush';

export interface PoliceChaseStatus {
  isActive: boolean;
  eventType: EmergencyEventType;
  distanceToPlayer: number;
  robberPos?: { x: number; y: number; z: number };
  policePos?: { x: number; y: number; z: number };
  ambulancePos?: { x: number; y: number; z: number };
  duration: number;
  icon: string;
  badge: string;
  message: string;
}

export class PoliceChaseSystem {
  public group: THREE.Group;
  private roadGraph: RoadNetworkGraph | null = null;

  // 3D Vehicle Groups
  private robberBikeGroup: THREE.Group;
  private policeBikeGroup: THREE.Group;
  private ambulanceGroup: THREE.Group;

  // Police Emergency Siren Lights
  private redBeaconMat: THREE.MeshBasicMaterial;
  private blueBeaconMat: THREE.MeshBasicMaterial;
  private redStrobeLight: THREE.PointLight;
  private blueStrobeLight: THREE.PointLight;

  // Ambulance Emergency Siren Lights
  private ambBeaconMat1: THREE.MeshBasicMaterial;
  private ambBeaconMat2: THREE.MeshBasicMaterial;
  private ambStrobeLight1: THREE.PointLight;
  private ambStrobeLight2: THREE.PointLight;

  // Event State Machine
  private currentEvent: EmergencyEventType = 'none';
  private isCompleted: boolean = false;
  private eventTimer: number = 0;
  private strobeTimer: number = 0;

  // Automated Spontaneous Event Director
  // Starts first spontaneous event after 18 seconds, then every 35-50s
  private cooldownTimer: number = 18.0;

  // Robber Kinematics
  private robberFromId: string = '';
  private robberToId: string = '';
  private robberNextId: string = '';
  private robberDist: number = 0;
  private robberLen: number = 0;
  private robberSpeed: number = 19.5; // ~70 km/h
  private robberHeading: number = 0;
  private robberPos: THREE.Vector3 = new THREE.Vector3(0, -999, 0);

  // Police Kinematics (Chasing ~14m behind robber)
  private policeFromId: string = '';
  private policeToId: string = '';
  private policeNextId: string = '';
  private policeDist: number = 0;
  private policeLen: number = 0;
  private policeSpeed: number = 20.2;
  private policeHeading: number = 0;
  private policePos: THREE.Vector3 = new THREE.Vector3(0, -999, 0);

  // Ambulance Kinematics (High-speed emergency navigation)
  private ambFromId: string = '';
  private ambToId: string = '';
  private ambNextId: string = '';
  private ambDist: number = 0;
  private ambLen: number = 0;
  private ambSpeed: number = 18.0; // ~65 km/h
  private ambHeading: number = 0;
  private ambPos: THREE.Vector3 = new THREE.Vector3(0, -999, 0);

  // Callback for HUD Alert Banner
  private onStatusCallback?: (status: PoliceChaseStatus) => void;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'city_emergency_system_group';

    // 1. Build Custom Criminal Robber Racing Motorbike ("Xe Độ Cọp")
    this.robberBikeGroup = this.createRobberMotorbike();
    this.group.add(this.robberBikeGroup);

    // 2. Build Vietnamese CSGT Police High-Displacement Motorbike
    const policePack = this.createPoliceMotorbike();
    this.policeBikeGroup = policePack.group;
    this.redBeaconMat = policePack.redBeaconMat;
    this.blueBeaconMat = policePack.blueBeaconMat;
    this.redStrobeLight = policePack.redStrobeLight;
    this.blueStrobeLight = policePack.blueStrobeLight;
    this.group.add(this.policeBikeGroup);

    // 3. Build Vietnamese 115 Emergency Medical Ambulance
    const ambPack = this.createAmbulanceVehicle();
    this.ambulanceGroup = ambPack.group;
    this.ambBeaconMat1 = ambPack.beaconMat1;
    this.ambBeaconMat2 = ambPack.beaconMat2;
    this.ambStrobeLight1 = ambPack.strobeLight1;
    this.ambStrobeLight2 = ambPack.strobeLight2;
    this.group.add(this.ambulanceGroup);

    // Hide initially until an event triggers
    this.robberBikeGroup.visible = false;
    this.policeBikeGroup.visible = false;
    this.ambulanceGroup.visible = false;
  }

  /**
   * Builds custom customized street racer motorcycle for the bandit
   */
  private createRobberMotorbike(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'robber_bike';

    const frameMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.6 }); // Crimson red
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.5, metalness: 0.3 }); // Matte black
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.2, metalness: 0.8 }); // Exhaust chrome

    // Chassis & Sport Fairing
    const chassisGeo = new THREE.BoxGeometry(0.38, 0.42, 0.85);
    const chassis = new THREE.Mesh(chassisGeo, frameMat);
    chassis.position.set(0, 0.55, 0.0);
    group.add(chassis);

    const frontFairingGeo = new THREE.BoxGeometry(0.34, 0.45, 0.40);
    const frontFairing = new THREE.Mesh(frontFairingGeo, blackMat);
    frontFairing.position.set(0, 0.70, 0.48);
    frontFairing.rotation.x = 0.25;
    group.add(frontFairing);

    // Drag bar & Grips
    const handlebarGeo = new THREE.BoxGeometry(0.68, 0.04, 0.04);
    const handlebar = new THREE.Mesh(handlebarGeo, chromeMat);
    handlebar.position.set(0, 0.92, 0.45);
    group.add(handlebar);

    // 2 Wheels (Tires & Rims)
    const tireGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.12, 12);
    tireGeo.rotateZ(Math.PI / 2);

    const frontTire = new THREE.Mesh(tireGeo, blackMat);
    frontTire.position.set(0, 0.30, 0.68);
    group.add(frontTire);

    const rearTire = new THREE.Mesh(tireGeo, blackMat);
    rearTire.position.set(0, 0.30, -0.62);
    group.add(rearTire);

    // Racing Exhaust Pipe
    const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.65, 8);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaust = new THREE.Mesh(exhaustGeo, chromeMat);
    exhaust.position.set(0.24, 0.32, -0.42);
    exhaust.rotation.x = -0.22;
    group.add(exhaust);

    // Bandit Driver Figure (Hoodie & Helmet)
    const banditMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.26), banditMat);
    torso.position.set(0, 0.95, -0.05);
    torso.rotation.x = 0.38; // aggressive forward lean
    group.add(torso);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), blackMat);
    helmet.position.set(0, 1.35, 0.12);
    group.add(helmet);

    return group;
  }

  /**
   * Builds high-displacement Vietnamese CSGT Police Patrol Motorbike
   */
  private createPoliceMotorbike(): {
    group: THREE.Group;
    redBeaconMat: THREE.MeshBasicMaterial;
    blueBeaconMat: THREE.MeshBasicMaterial;
    redStrobeLight: THREE.PointLight;
    blueStrobeLight: THREE.PointLight;
  } {
    const group = new THREE.Group();
    group.name = 'police_bike';

    // Authentic CSGT Police colors (White body, navy stripes, gold badges)
    const whitePoliceMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.2 });
    const blueStripeMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4 });
    const blackTireMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.8 });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.2, metalness: 0.85 });
    const csgtUniformMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 }); // CSGT Yellow-Khaki uniform

    // 1. Patrol Bike Body & Windshield
    const bodyGeo = new THREE.BoxGeometry(0.48, 0.55, 1.15);
    const body = new THREE.Mesh(bodyGeo, whitePoliceMat);
    body.position.set(0, 0.62, 0.0);
    group.add(body);

    // Police side stripes
    const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.95), blueStripeMat);
    stripeL.position.set(0.245, 0.62, 0.0);
    group.add(stripeL);
    const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.95), blueStripeMat);
    stripeR.position.set(-0.245, 0.62, 0.0);
    group.add(stripeR);

    // Tall aerodynamic clear police windshield
    const windshieldMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65, roughness: 0.1 });
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.03), windshieldMat);
    windshield.position.set(0, 1.15, 0.52);
    windshield.rotation.x = -0.22;
    group.add(windshield);

    // Heavy duty dual wheels
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.14, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const frontWheel = new THREE.Mesh(wheelGeo, blackTireMat);
    frontWheel.position.set(0, 0.32, 0.75);
    group.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelGeo, blackTireMat);
    rearWheel.position.set(0, 0.32, -0.68);
    group.add(rearWheel);

    // Rear Dual Police Side Boxes (White panniers)
    const pannierGeo = new THREE.BoxGeometry(0.22, 0.30, 0.48);
    const leftPannier = new THREE.Mesh(pannierGeo, whitePoliceMat);
    leftPannier.position.set(0.34, 0.68, -0.55);
    group.add(leftPannier);

    const rightPannier = new THREE.Mesh(pannierGeo, whitePoliceMat);
    rightPannier.position.set(-0.34, 0.68, -0.55);
    group.add(rightPannier);

    // 2. High-Tech Emergency Strobe Light Mast
    const mastGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.55, 6);
    const mast = new THREE.Mesh(mastGeo, chromeMat);
    mast.position.set(0.22, 1.15, -0.72);
    group.add(mast);

    const redBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
    const blueBeaconMat = new THREE.MeshBasicMaterial({ color: 0x0066ff });

    const beaconGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8);
    const redBeacon = new THREE.Mesh(beaconGeo, redBeaconMat);
    redBeacon.position.set(0.22, 1.45, -0.72);
    group.add(redBeacon);

    const blueBeacon = new THREE.Mesh(beaconGeo, blueBeaconMat);
    blueBeacon.position.set(-0.22, 1.45, -0.72);
    group.add(blueBeacon);

    // Realtime Dynamic Emergency Point Lights
    const redStrobeLight = new THREE.PointLight(0xff0033, 4.0, 35, 1.5);
    redStrobeLight.position.set(0.22, 1.55, -0.72);
    group.add(redStrobeLight);

    const blueStrobeLight = new THREE.PointLight(0x0066ff, 4.0, 35, 1.5);
    blueStrobeLight.position.set(-0.22, 1.55, -0.72);
    group.add(blueStrobeLight);

    // 3. Police Officer Driver Figure (CSGT Uniform)
    const officerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.50, 0.28), csgtUniformMat);
    officerTorso.position.set(0, 1.10, -0.10);
    officerTorso.rotation.x = 0.18;
    group.add(officerTorso);

    const officerHelmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 12), whitePoliceMat);
    officerHelmet.position.set(0, 1.56, 0.0);
    group.add(officerHelmet);

    return {
      group,
      redBeaconMat,
      blueBeaconMat,
      redStrobeLight,
      blueStrobeLight,
    };
  }

  /**
   * Builds authentic Vietnamese 115 Emergency Medical Ambulance (Toyota HiAce / Ford Transit)
   */
  private createAmbulanceVehicle(): {
    group: THREE.Group;
    beaconMat1: THREE.MeshBasicMaterial;
    beaconMat2: THREE.MeshBasicMaterial;
    strobeLight1: THREE.PointLight;
    strobeLight2: THREE.PointLight;
  } {
    const group = new THREE.Group();
    group.name = 'ambulance_vehicle';

    // Materials
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.08 });
    const redStripeMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.35, metalness: 0.1 });
    const redCrossMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, metalness: 0.1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0a1120, roughness: 0.15, metalness: 0.9 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8, metalness: 0.2 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.2, metalness: 0.8 });
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 });

    // 1. Main White Van Body Chassis
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.88, 0.95, 4.5), whiteMat);
    lowerBody.position.set(0, 0.75, 0.0);
    group.add(lowerBody);

    // Aerodynamic Sloped Cabin / Hood
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.45, 1.05), whiteMat);
    hood.position.set(0, 0.65, 1.85);
    group.add(hood);

    // Front Bumper
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.32, 0.28), bumperMat);
    frontBumper.position.set(0, 0.35, 2.40);
    group.add(frontBumper);

    // Rear Bumper
    const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.90, 0.28, 0.22), bumperMat);
    rearBumper.position.set(0, 0.35, -2.32);
    group.add(rearBumper);

    // Medical High Roof Cap
    const highRoof = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.48, 3.4), whiteMat);
    highRoof.position.set(0, 1.45, -0.45);
    group.add(highRoof);

    // 2. Red Medical Beltline Stripe
    const leftStripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 4.35), redStripeMat);
    leftStripe.position.set(0.95, 0.80, 0.05);
    group.add(leftStripe);

    const rightStripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.22, 4.35), redStripeMat);
    rightStripe.position.set(-0.95, 0.80, 0.05);
    group.add(rightStripe);

    // 3. Iconic Red Crosses ➕ (Left, Right, Roof)
    // Left Red Cross
    const crossLeftH = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.58), redCrossMat);
    crossLeftH.position.set(0.955, 1.18, -0.3);
    group.add(crossLeftH);
    const crossLeftV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.58, 0.14), redCrossMat);
    crossLeftV.position.set(0.955, 1.18, -0.3);
    group.add(crossLeftV);

    // Right Red Cross
    const crossRightH = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.58), redCrossMat);
    crossRightH.position.set(-0.955, 1.18, -0.3);
    group.add(crossRightH);
    const crossRightV = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.58, 0.14), redCrossMat);
    crossRightV.position.set(-0.955, 1.18, -0.3);
    group.add(crossRightV);

    // Roof Red Cross
    const crossRoofH = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.02, 0.14), redCrossMat);
    crossRoofH.position.set(0, 1.70, -0.5);
    group.add(crossRoofH);
    const crossRoofV = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.58), redCrossMat);
    crossRoofV.position.set(0, 1.70, -0.5);
    group.add(crossRoofV);

    // 4. Windows (Dark Privacy Tint)
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.58, 0.06), glassMat);
    windshield.rotation.x = -0.42;
    windshield.position.set(0, 1.12, 1.48);
    group.add(windshield);

    const leftWin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 2.5), glassMat);
    leftWin.position.set(0.95, 1.18, -0.6);
    group.add(leftWin);
    const rightWin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 2.5), glassMat);
    rightWin.position.set(-0.95, 1.18, -0.6);
    group.add(rightWin);

    // 5. 4 Wheels & Rims
    const wheelPositions = [
      { x: 0.90, z: 1.45 },
      { x: -0.90, z: 1.45 },
      { x: 0.90, z: -1.35 },
      { x: -0.90, z: -1.35 },
    ];
    for (const wp of wheelPositions) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(wp.x, 0.33, wp.z);
      group.add(tire);

      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.23, 8), rimMat);
      rim.rotation.z = Math.PI / 2;
      rim.position.set(wp.x, 0.33, wp.z);
      group.add(rim);
    }

    // 6. Emergency Lightbar on Roof
    const barMount = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.08, 0.30), bumperMat);
    barMount.position.set(0, 1.73, 0.75);
    group.add(barMount);

    const beaconMat1 = new THREE.MeshBasicMaterial({ color: 0xff0033 });
    const beacon1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), beaconMat1);
    beacon1.position.set(0.40, 1.84, 0.75);
    group.add(beacon1);

    const beaconMat2 = new THREE.MeshBasicMaterial({ color: 0x0066ff });
    const beacon2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), beaconMat2);
    beacon2.position.set(-0.40, 1.84, 0.75);
    group.add(beacon2);

    // Realtime Dynamic Emergency PointLights
    const strobeLight1 = new THREE.PointLight(0xff0033, 4.5, 38, 1.5);
    strobeLight1.position.set(0.40, 1.95, 0.75);
    group.add(strobeLight1);

    const strobeLight2 = new THREE.PointLight(0x0066ff, 4.5, 38, 1.5);
    strobeLight2.position.set(-0.40, 1.95, 0.75);
    group.add(strobeLight2);

    return {
      group,
      beaconMat1,
      beaconMat2,
      strobeLight1,
      strobeLight2,
    };
  }

  public setEnvironment(roadGraph: RoadNetworkGraph): void {
    if (this.currentEvent !== 'none') {
      this.stopEmergencyEvent();
    }
    this.roadGraph = roadGraph;
    // Reset automatic timer
    this.cooldownTimer = 18.0;
  }

  public setStatusCallback(callback: (status: PoliceChaseStatus) => void): void {
    this.onStatusCallback = callback;
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
    return prevNodeId;
  }

  /**
   * Finds candidate road edge near given coordinates
   */
  private findStartingEdge(nearPos?: { x: number; z: number }): RoadGraphEdge | undefined {
    if (!this.roadGraph || this.roadGraph.edges.length < 2) return undefined;

    let startEdge: RoadGraphEdge | undefined;
    if (nearPos) {
      let bestDist = Infinity;
      for (const edge of this.roadGraph.edges) {
        const n1 = this.roadGraph.nodes.get(edge.fromId);
        const n2 = this.roadGraph.nodes.get(edge.toId);
        if (!n1 || !n2) continue;
        const len = Math.hypot(n2.x - n1.x, n2.z - n1.z);
        if (len < 25) continue;
        const midX = (n1.x + n2.x) / 2;
        const midZ = (n1.z + n2.z) / 2;
        const d = Math.hypot(midX - nearPos.x, midZ - nearPos.z);
        if (d < bestDist) {
          bestDist = d;
          startEdge = edge;
        }
      }
    }

    if (!startEdge) {
      const candidateEdges = this.roadGraph.edges.filter((e) => {
        const n1 = this.roadGraph!.nodes.get(e.fromId);
        const n2 = this.roadGraph!.nodes.get(e.toId);
        if (!n1 || !n2) return false;
        return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 28;
      });

      startEdge = candidateEdges[Math.floor(Math.random() * candidateEdges.length)] || this.roadGraph.edges[0];
    }
    return startEdge;
  }

  /**
   * Triggers Police Chase pursuit event
   */
  public startChaseEvent(nearPos?: { x: number; z: number }): void {
    if (!this.roadGraph || this.roadGraph.edges.length < 2) return;

    this.stopEmergencyEvent();

    const startEdge = this.findStartingEdge(nearPos);
    if (!startEdge) return;

    const n1 = this.roadGraph.nodes.get(startEdge.fromId)!;
    const n2 = this.roadGraph.nodes.get(startEdge.toId)!;
    const len = Math.hypot(n2.x - n1.x, n2.z - n1.z);

    this.currentEvent = 'police_chase';
    this.isCompleted = false;
    this.eventTimer = 0;
    this.strobeTimer = 0;

    // Robber starts ahead (at 55% of edge)
    this.robberFromId = n1.id;
    this.robberToId = n2.id;
    this.robberNextId = this.pickNextNode(n2.id, n1.id);
    this.robberDist = len * 0.55;
    this.robberLen = len;
    this.robberSpeed = 20.0; // ~72 km/h
    this.robberHeading = Math.atan2(n2.x - n1.x, n2.z - n1.z);

    // Police starts behind (at 18% of edge)
    this.policeFromId = n1.id;
    this.policeToId = n2.id;
    this.policeNextId = this.robberNextId;
    this.policeDist = Math.max(2, len * 0.18);
    this.policeLen = len;
    this.policeSpeed = 20.8;
    this.policeHeading = this.robberHeading;

    this.robberBikeGroup.visible = true;
    this.policeBikeGroup.visible = true;
    this.ambulanceGroup.visible = false;

    // Start wailing police siren
    AudioManager.getInstance().startPoliceSiren(25);
  }

  /**
   * Triggers 115 Emergency Medical Ambulance Rush event
   */
  public startAmbulanceEvent(nearPos?: { x: number; z: number }): void {
    if (!this.roadGraph || this.roadGraph.edges.length < 2) return;

    this.stopEmergencyEvent();

    const startEdge = this.findStartingEdge(nearPos);
    if (!startEdge) return;

    const n1 = this.roadGraph.nodes.get(startEdge.fromId)!;
    const n2 = this.roadGraph.nodes.get(startEdge.toId)!;
    const len = Math.hypot(n2.x - n1.x, n2.z - n1.z);

    this.currentEvent = 'ambulance_rush';
    this.isCompleted = false;
    this.eventTimer = 0;
    this.strobeTimer = 0;

    this.ambFromId = n1.id;
    this.ambToId = n2.id;
    this.ambNextId = this.pickNextNode(n2.id, n1.id);
    this.ambDist = Math.max(2, len * 0.20);
    this.ambLen = len;
    this.ambSpeed = 18.5; // ~66 km/h
    this.ambHeading = Math.atan2(n2.x - n1.x, n2.z - n1.z);

    this.robberBikeGroup.visible = false;
    this.policeBikeGroup.visible = false;
    this.ambulanceGroup.visible = true;

    // Start authentic two-tone ambulance siren
    AudioManager.getInstance().startAmbulanceSiren(25);
  }

  /**
   * Toggles emergency event manually (or cycles between Police Chase -> Ambulance Rush -> Stop)
   */
  public toggleManualEvent(nearPos?: { x: number; z: number }): void {
    if (this.currentEvent === 'none') {
      if (Math.random() < 0.5) {
        this.startChaseEvent(nearPos);
      } else {
        this.startAmbulanceEvent(nearPos);
      }
    } else if (this.currentEvent === 'police_chase') {
      this.startAmbulanceEvent(nearPos);
    } else {
      this.stopEmergencyEvent();
    }
  }

  public stopEmergencyEvent(): void {
    this.currentEvent = 'none';
    this.isCompleted = false;
    this.robberBikeGroup.visible = false;
    this.policeBikeGroup.visible = false;
    this.ambulanceGroup.visible = false;

    AudioManager.getInstance().stopPoliceSiren();
    AudioManager.getInstance().stopAmbulanceSiren();

    // Reset cooldown for next random spontaneous city event (35 to 55 seconds)
    this.cooldownTimer = 35.0 + Math.random() * 20.0;

    this.onStatusCallback?.({
      isActive: false,
      eventType: 'none',
      distanceToPlayer: 999,
      duration: 0,
      icon: '',
      badge: '',
      message: '',
    });
  }

  // Alias for backward compatibility
  public stopChaseEvent(): void {
    this.stopEmergencyEvent();
  }

  public getIsActive(): boolean {
    return this.currentEvent !== 'none';
  }

  public getCurrentEventType(): EmergencyEventType {
    return this.currentEvent;
  }

  /**
   * Main per-frame update loop for the emergency events and autonomic director
   */
  public update(deltaTime: number, playerPos?: { x: number; z: number }): void {
    if (!this.roadGraph) return;
    const dt = Math.min(deltaTime, 0.08);

    // ─────────────────────────────────────────────────────────────────────────
    // A. AUTONOMIC EVENT SCHEDULER (Tự động kích hoạt sự kiện ngẫu nhiên trên phố)
    // ─────────────────────────────────────────────────────────────────────────
    if (this.currentEvent === 'none') {
      this.cooldownTimer -= dt;
      if (this.cooldownTimer <= 0) {
        // Automatically spawn a spontaneous city event near player!
        const pick = Math.random() < 0.5 ? 'police_chase' : 'ambulance_rush';
        if (pick === 'police_chase') {
          this.startChaseEvent(playerPos);
        } else {
          this.startAmbulanceEvent(playerPos);
        }
      }
      return;
    }

    this.eventTimer += dt;
    this.strobeTimer += dt;

    // ─────────────────────────────────────────────────────────────────────────
    // B. POLICE PURSUIT SIMULATION
    // ─────────────────────────────────────────────────────────────────────────
    if (this.currentEvent === 'police_chase') {
      // 1. Alternate Emergency Flashing Red & Blue Strobe Lights (~4 Hz)
      const strobePhase = Math.sin(this.strobeTimer * 26.0) > 0;
      if (strobePhase) {
        this.redBeaconMat.color.setHex(0xff0033);
        this.blueBeaconMat.color.setHex(0x001144);
        this.redStrobeLight.intensity = 5.5;
        this.blueStrobeLight.intensity = 0.2;
      } else {
        this.redBeaconMat.color.setHex(0x330011);
        this.blueBeaconMat.color.setHex(0x0066ff);
        this.redStrobeLight.intensity = 0.2;
        this.blueStrobeLight.intensity = 5.5;
      }

      // 2. Advance Robber Vehicle
      const rN1 = this.roadGraph.nodes.get(this.robberFromId);
      const rN2 = this.roadGraph.nodes.get(this.robberToId);
      if (rN1 && rN2) {
        const rDx = rN2.x - rN1.x;
        const rDz = rN2.z - rN1.z;
        const rLen = Math.hypot(rDx, rDz) || 1;

        this.robberDist += this.robberSpeed * dt;

        if (this.robberDist >= rLen) {
          this.robberDist = 0;
          this.robberFromId = this.robberToId;
          this.robberToId = this.robberNextId;
          this.robberNextId = this.pickNextNode(this.robberToId, this.robberFromId);
        }

        const tR = Math.max(0, Math.min(1, this.robberDist / rLen));
        const rGroundY = (rN1.y ?? 0.08) + ((rN2.y ?? 0.08) - (rN1.y ?? 0.08)) * tR + 0.08;

        const swerve = Math.sin(this.eventTimer * 5.0) * 0.45;
        const rHeading = Math.atan2(rDx, rDz);
        const rPerpX = -Math.cos(rHeading);
        const rPerpZ = Math.sin(rHeading);

        this.robberPos.set(
          rN1.x + rDx * tR + rPerpX * swerve,
          rGroundY,
          rN1.z + rDz * tR + rPerpZ * swerve
        );
        this.robberHeading = rHeading;

        this.robberBikeGroup.position.copy(this.robberPos);
        this.robberBikeGroup.rotation.y = this.robberHeading;
        this.robberBikeGroup.rotation.z = swerve * 0.35;
      }

      // 3. Advance Police Pursuit Vehicle
      const pN1 = this.roadGraph.nodes.get(this.policeFromId);
      const pN2 = this.roadGraph.nodes.get(this.policeToId);
      if (pN1 && pN2) {
        const pDx = pN2.x - pN1.x;
        const pDz = pN2.z - pN1.z;
        const pLen = Math.hypot(pDx, pDz) || 1;

        this.policeDist += this.policeSpeed * dt;

        if (this.policeDist >= pLen) {
          this.policeDist = 0;
          this.policeFromId = this.policeToId;
          this.policeToId = this.policeNextId;
          this.policeNextId = this.robberToId;
        }

        const tP = Math.max(0, Math.min(1, this.policeDist / pLen));
        const pGroundY = (pN1.y ?? 0.08) + ((pN2.y ?? 0.08) - (pN1.y ?? 0.08)) * tP + 0.08;
        const pHeading = Math.atan2(pDx, pDz);

        this.policePos.set(
          pN1.x + pDx * tP,
          pGroundY,
          pN1.z + pDz * tP
        );
        this.policeHeading = pHeading;

        this.policeBikeGroup.position.copy(this.policePos);
        this.policeBikeGroup.rotation.y = this.policeHeading;
      }

      // 4. Distance to Player & Dynamic Siren Spatialization
      let distToPlayer = 999;
      if (playerPos) {
        distToPlayer = Math.hypot(this.policePos.x - playerPos.x, this.policePos.z - playerPos.z);
        AudioManager.getInstance().updatePoliceSirenDistance(distToPlayer);
      }

      // 5. Interception & Capture Condition
      const gapToRobber = this.policePos.distanceTo(this.robberPos);
      if (this.eventTimer > 36 || gapToRobber < 5.5) {
        if (!this.isCompleted) {
          this.isCompleted = true;
          this.robberSpeed = 0;
          this.policeSpeed = 0;
          AudioManager.getInstance().playPoliceChirp();
        }

        if (this.eventTimer > 42) {
          this.stopEmergencyEvent();
          return;
        }
      }

      let message = '';
      if (this.isCompleted) {
        message = '👮 ĐÃ BẮT GIỮ THÀNH CÔNG ĐỐI TƯỢNG CƯỚP GIẬT!';
      } else {
        const distStr = playerPos ? ` (Cách bạn ${Math.round(distToPlayer)}m)` : '';
        message = `Cảnh sát CSGT đang rượt đuổi đối tượng cướp giật phóng bạt mạng!${distStr}`;
      }

      this.onStatusCallback?.({
        isActive: true,
        eventType: 'police_chase',
        distanceToPlayer: distToPlayer,
        robberPos: { x: this.robberPos.x, y: this.robberPos.y, z: this.robberPos.z },
        policePos: { x: this.policePos.x, y: this.policePos.y, z: this.policePos.z },
        duration: this.eventTimer,
        icon: '🚨',
        badge: 'CẢNH SÁT TRUY BẮT',
        message,
      });
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C. 115 AMBULANCE EMERGENCY RUSH SIMULATION
    // ─────────────────────────────────────────────────────────────────────────
    if (this.currentEvent === 'ambulance_rush') {
      // 1. Alternate Emergency Flashing Red & Blue Beacons (~4 Hz)
      const strobePhase = Math.sin(this.strobeTimer * 26.0) > 0;
      if (strobePhase) {
        this.ambBeaconMat1.color.setHex(0xff0033);
        this.ambBeaconMat2.color.setHex(0x001144);
        this.ambStrobeLight1.intensity = 5.5;
        this.ambStrobeLight2.intensity = 0.2;
      } else {
        this.ambBeaconMat1.color.setHex(0x330011);
        this.ambBeaconMat2.color.setHex(0x0066ff);
        this.ambStrobeLight1.intensity = 0.2;
        this.ambStrobeLight2.intensity = 5.5;
      }

      // 2. Advance Ambulance Vehicle along Road Graph
      const aN1 = this.roadGraph.nodes.get(this.ambFromId);
      const aN2 = this.roadGraph.nodes.get(this.ambToId);
      if (aN1 && aN2) {
        const aDx = aN2.x - aN1.x;
        const aDz = aN2.z - aN1.z;
        const aLen = Math.hypot(aDx, aDz) || 1;

        this.ambDist += this.ambSpeed * dt;

        if (this.ambDist >= aLen) {
          this.ambDist = 0;
          this.ambFromId = this.ambToId;
          this.ambToId = this.ambNextId;
          this.ambNextId = this.pickNextNode(this.ambToId, this.ambFromId);
        }

        const tA = Math.max(0, Math.min(1, this.ambDist / aLen));
        const aGroundY = (aN1.y ?? 0.08) + ((aN2.y ?? 0.08) - (aN1.y ?? 0.08)) * tA + 0.08;
        const aHeading = Math.atan2(aDx, aDz);

        this.ambPos.set(
          aN1.x + aDx * tA,
          aGroundY,
          aN1.z + aDz * tA
        );
        this.ambHeading = aHeading;

        this.ambulanceGroup.position.copy(this.ambPos);
        this.ambulanceGroup.rotation.y = this.ambHeading;
      }

      // 3. Distance to Player & Dynamic Siren Spatialization
      let distToPlayer = 999;
      if (playerPos) {
        distToPlayer = Math.hypot(this.ambPos.x - playerPos.x, this.ambPos.z - playerPos.z);
        AudioManager.getInstance().updateAmbulanceSirenDistance(distToPlayer);
      }

      // 4. Mission Hospital Delivery Condition (after 36 seconds)
      if (this.eventTimer > 35) {
        if (!this.isCompleted) {
          this.isCompleted = true;
          this.ambSpeed = 0;
        }

        if (this.eventTimer > 41) {
          this.stopEmergencyEvent();
          return;
        }
      }

      let message = '';
      if (this.isCompleted) {
        message = '🏥 XE CẤP CỨU 115 ĐÃ ĐƯA BỆNH NHÂN ĐẾN BỆNH VIỆN AN TOÀN!';
      } else {
        const distStr = playerPos ? ` (Cách bạn ${Math.round(distToPlayer)}m)` : '';
        message = `Xe cứu thương 115 đang hối hả vượt ngã tư đưa bệnh nhân đi cấp cứu!${distStr}`;
      }

      this.onStatusCallback?.({
        isActive: true,
        eventType: 'ambulance_rush',
        distanceToPlayer: distToPlayer,
        ambulancePos: { x: this.ambPos.x, y: this.ambPos.y, z: this.ambPos.z },
        duration: this.eventTimer,
        icon: '🚑',
        badge: 'CẤP CỨU 115',
        message,
      });
    }
  }
}
