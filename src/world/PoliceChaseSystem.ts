import * as THREE from 'three';
import { RoadGraphEdge, RoadNetworkGraph } from '../types/gis';
import { AudioManager } from '../services/AudioManager';

export interface PoliceChaseStatus {
  isActive: boolean;
  distanceToPlayer: number;
  robberPos: { x: number; y: number; z: number };
  policePos: { x: number; y: number; z: number };
  chaseDuration: number;
  message: string;
}

export class PoliceChaseSystem {
  public group: THREE.Group;
  private roadGraph: RoadNetworkGraph | null = null;

  // 3D Vehicle Groups
  private robberBikeGroup: THREE.Group;
  private policeBikeGroup: THREE.Group;

  // Police Emergency Siren Lights
  private redBeaconMat: THREE.MeshBasicMaterial;
  private blueBeaconMat: THREE.MeshBasicMaterial;
  private redStrobeLight: THREE.PointLight;
  private blueStrobeLight: THREE.PointLight;

  // Kinematic States
  private isActive: boolean = false;
  private isCaught: boolean = false;
  private chaseTimer: number = 0;
  private strobeTimer: number = 0;

  // Robber Kinematics
  private robberFromId: string = '';
  private robberToId: string = '';
  private robberNextId: string = '';
  private robberDist: number = 0;
  private robberLen: number = 0;
  private robberSpeed: number = 19.5; // High speed ~70 km/h
  private robberHeading: number = 0;
  private robberPos: THREE.Vector3 = new THREE.Vector3(0, -999, 0);

  // Police Kinematics (Chasing ~14m behind robber)
  private policeFromId: string = '';
  private policeToId: string = '';
  private policeNextId: string = '';
  private policeDist: number = 0;
  private policeLen: number = 0;
  private policeSpeed: number = 20.0;
  private policeHeading: number = 0;
  private policePos: THREE.Vector3 = new THREE.Vector3(0, -999, 0);

  // Callback for HUD Alert Banner
  private onStatusCallback?: (status: PoliceChaseStatus) => void;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'police_chase_system_group';

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

    // Hide initially until chase event triggers
    this.robberBikeGroup.visible = false;
    this.policeBikeGroup.visible = false;
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

    // Sport Racing Exhaust
    const exhaustGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.75, 10);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaust = new THREE.Mesh(exhaustGeo, chromeMat);
    exhaust.position.set(0.24, 0.32, -0.40);
    exhaust.rotation.x = -0.2;
    group.add(exhaust);

    // Wheels
    for (const z of [0.65, -0.65]) {
      const wheelGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.12, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(wheelGeo, blackMat);
      wheel.position.set(0, 0.30, z);
      group.add(wheel);
    }

    // Bandit Driver Figure (Black hoodie & dark helmet)
    const torsoGeo = new THREE.BoxGeometry(0.36, 0.46, 0.26);
    const torso = new THREE.Mesh(torsoGeo, blackMat);
    torso.position.set(0, 1.08, -0.08);
    torso.rotation.x = 0.32; // Leaning forward aggressively
    group.add(torso);

    const helmetGeo = new THREE.SphereGeometry(0.22, 12, 10);
    const helmet = new THREE.Mesh(helmetGeo, blackMat);
    helmet.position.set(0, 1.48, 0.08);
    group.add(helmet);

    return group;
  }

  /**
   * Builds authentic Vietnamese CSGT Police Patrol Motorbike with flashing emergency sirens
   */
  private createPoliceMotorbike(): {
    group: THREE.Group;
    redBeaconMat: THREE.MeshBasicMaterial;
    blueBeaconMat: THREE.MeshBasicMaterial;
    redStrobeLight: THREE.PointLight;
    blueStrobeLight: THREE.PointLight;
  } {
    const group = new THREE.Group();
    group.name = 'police_patrol_bike';

    const whitePoliceMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.4 });
    const bluePoliceMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3, metalness: 0.3 }); // Police blue
    const csgtUniformMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6, metalness: 0.1 }); // CSGT tan/khaki uniform
    const blackTrimMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });

    // 1. Police Bike Body
    const chassisGeo = new THREE.BoxGeometry(0.44, 0.48, 0.95);
    const chassis = new THREE.Mesh(chassisGeo, whitePoliceMat);
    chassis.position.set(0, 0.60, 0);
    group.add(chassis);

    // Blue Police Decal Stripe
    const stripeGeo = new THREE.BoxGeometry(0.45, 0.12, 0.96);
    const stripe = new THREE.Mesh(stripeGeo, bluePoliceMat);
    stripe.position.set(0, 0.62, 0);
    group.add(stripe);

    // Tall aerodynamic police windshield
    const shieldGeo = new THREE.BoxGeometry(0.40, 0.52, 0.04);
    const shield = new THREE.Mesh(shieldGeo, new THREE.MeshStandardMaterial({ color: 0xe0f2fe, roughness: 0.1, transparent: true, opacity: 0.7 }));
    shield.position.set(0, 1.15, 0.52);
    shield.rotation.x = -0.25;
    group.add(shield);

    // Dual police side pannier hard cases
    for (const sx of [-0.28, 0.28]) {
      const caseGeo = new THREE.BoxGeometry(0.18, 0.32, 0.48);
      const pCase = new THREE.Mesh(caseGeo, whitePoliceMat);
      pCase.position.set(sx, 0.62, -0.48);
      group.add(pCase);

      const caseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.08, 0.49), bluePoliceMat);
      caseStripe.position.set(sx, 0.62, -0.48);
      group.add(caseStripe);
    }

    // Heavy-duty wheels
    for (const z of [0.72, -0.68]) {
      const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.14, 14);
      wheelGeo.rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(wheelGeo, blackTrimMat);
      wheel.position.set(0, 0.32, z);
      group.add(wheel);
    }

    // 2. High-Mast Rear Emergency Strobe Light Beacons (Red & Blue)
    const redBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
    const blueBeaconMat = new THREE.MeshBasicMaterial({ color: 0x0066ff });

    const mastGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.75, 8);
    const mast = new THREE.Mesh(mastGeo, blackTrimMat);
    mast.position.set(0.18, 1.05, -0.72);
    group.add(mast);

    const redBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), redBeaconMat);
    redBeacon.position.set(0.18, 1.45, -0.72);
    group.add(redBeacon);

    const mast2 = new THREE.Mesh(mastGeo, blackTrimMat);
    mast2.position.set(-0.18, 1.05, -0.72);
    group.add(mast2);

    const blueBeacon = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), blueBeaconMat);
    blueBeacon.position.set(-0.18, 1.45, -0.72);
    group.add(blueBeacon);

    // Realtime Dynamic Emergency Point Lights
    const redStrobeLight = new THREE.PointLight(0xff0033, 4.0, 35, 1.5);
    redStrobeLight.position.set(0.18, 1.55, -0.72);
    group.add(redStrobeLight);

    const blueStrobeLight = new THREE.PointLight(0x0066ff, 4.0, 35, 1.5);
    blueStrobeLight.position.set(-0.18, 1.55, -0.72);
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

  public setEnvironment(roadGraph: RoadNetworkGraph): void {
    if (this.isActive) {
      this.stopChaseEvent();
    }
    this.roadGraph = roadGraph;
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
   * Triggers a dramatic, high-speed Police Chase pursuit event across city streets
   */
  public startChaseEvent(nearPos?: { x: number; z: number }): void {
    if (!this.roadGraph || this.roadGraph.edges.length < 2) return;

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
      // Pick a prominent starting edge
      const candidateEdges = this.roadGraph.edges.filter((e) => {
        const n1 = this.roadGraph!.nodes.get(e.fromId);
        const n2 = this.roadGraph!.nodes.get(e.toId);
        if (!n1 || !n2) return false;
        return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 28;
      });

      startEdge = candidateEdges[Math.floor(Math.random() * candidateEdges.length)] || this.roadGraph.edges[0];
    }
    const n1 = this.roadGraph.nodes.get(startEdge.fromId)!;
    const n2 = this.roadGraph.nodes.get(startEdge.toId)!;
    const len = Math.hypot(n2.x - n1.x, n2.z - n1.z);

    this.isActive = true;
    this.isCaught = false;
    this.chaseTimer = 0;
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

    // Start wailing police siren
    AudioManager.getInstance().startPoliceSiren(25);
  }

  public stopChaseEvent(): void {
    this.isActive = false;
    this.isCaught = false;
    this.robberBikeGroup.visible = false;
    this.policeBikeGroup.visible = false;
    AudioManager.getInstance().stopPoliceSiren();

    this.onStatusCallback?.({
      isActive: false,
      distanceToPlayer: 999,
      robberPos: { x: 0, y: 0, z: 0 },
      policePos: { x: 0, y: 0, z: 0 },
      chaseDuration: 0,
      message: '',
    });
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Main per-frame update loop for the pursuit simulation
   */
  public update(deltaTime: number, playerPos?: { x: number; z: number }): void {
    if (!this.isActive || !this.roadGraph) return;
    const dt = Math.min(deltaTime, 0.08);

    this.chaseTimer += dt;
    this.strobeTimer += dt;

    // 1. Alternate Emergency Flashing Red & Blue Strobe Lights (~4 Hz)
    const strobePhase = Math.sin(this.strobeTimer * 26.0) > 0;
    if (strobePhase) {
      this.redBeaconMat.color.setHex(0xff0033);
      this.blueBeaconMat.color.setHex(0x001144); // dimmed blue
      this.redStrobeLight.intensity = 5.5;
      this.blueStrobeLight.intensity = 0.2;
    } else {
      this.redBeaconMat.color.setHex(0x330011); // dimmed red
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
        // Transition to next road branch
        this.robberDist = 0;
        this.robberFromId = this.robberToId;
        this.robberToId = this.robberNextId;
        this.robberNextId = this.pickNextNode(this.robberToId, this.robberFromId);
      }

      const tR = Math.max(0, Math.min(1, this.robberDist / rLen));
      const rGroundY = (rN1.y ?? 0.08) + ((rN2.y ?? 0.08) - (rN1.y ?? 0.08)) * tR + 0.08;

      // Slight erratic swerving
      const swerve = Math.sin(this.chaseTimer * 5.0) * 0.45;
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
      this.robberBikeGroup.rotation.z = swerve * 0.35; // Racing motorcycle lean
    }

    // 3. Advance Police Pursuit Vehicle (Aggressively tracking robber)
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
        this.policeNextId = this.robberToId; // Track toward robber's current road
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
    if (this.chaseTimer > 40 || gapToRobber < 5.5) {
      if (!this.isCaught) {
        this.isCaught = true;
        this.robberSpeed = 0;
        this.policeSpeed = 0;
        AudioManager.getInstance().playPoliceChirp();
      }

      // Conclude event after 6 seconds of successful capture
      if (this.chaseTimer > 46) {
        this.stopChaseEvent();
        return;
      }
    }

    // Status Message for In-Game Banner
    let message = '';
    if (this.isCaught) {
      message = '👮 ĐÃ KHỐNG CHẾ & BẮT GIỮ THÀNH CÔNG ĐỐI TƯỢNG CƯỚP!';
    } else {
      const distStr = playerPos ? ` (Cách bạn ${Math.round(distToPlayer)}m)` : '';
      message = `🚨 SỰ KIỆN: Cảnh sát đang truy bắt đối tượng cướp giật!${distStr}`;
    }

    this.onStatusCallback?.({
      isActive: true,
      distanceToPlayer: distToPlayer,
      robberPos: { x: this.robberPos.x, y: this.robberPos.y, z: this.robberPos.z },
      policePos: { x: this.policePos.x, y: this.policePos.y, z: this.policePos.z },
      chaseDuration: this.chaseTimer,
      message,
    });
  }
}
