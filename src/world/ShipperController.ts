import * as THREE from 'three';
import { BuildingItem, MetricPoint, RoadNetworkGraph } from '../types/gis';

export interface ShipperStatus {
  speedKmh: number;
  currentRoadName: string;
  isColliding: boolean;
  position: { x: number; z: number };
}

export class ShipperController {
  public bikeGroup: THREE.Group;
  private headlight: THREE.SpotLight;
  private frontWheel: THREE.Mesh;
  private rearWheel: THREE.Mesh;
  private bikeBody: THREE.Group;

  private camera: THREE.PerspectiveCamera;
  private buildings: BuildingItem[] = [];
  private roadGraph: RoadNetworkGraph | null = null;

  // Kinematics & Physics
  private position: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  private velocity: number = 0; // m/s
  private heading: number = 0; // radians
  private steerAngle: number = 0;
  private leanAngle: number = 0;

  private readonly maxSpeed: number = 13.0; // ~47 km/h
  private readonly maxReverseSpeed: number = -3.5; // ~12 km/h
  private readonly acceleration: number = 10.0; // m/s^2
  private readonly brakingDecel: number = 16.0;
  private readonly friction: number = 3.5;
  private readonly turnSpeed: number = 2.4;
  private readonly bikeRadius: number = 0.8;

  // Input states
  private keys = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
  };

  private isActive: boolean = false;
  private onStatusChange?: (status: ShipperStatus) => void;
  private currentRoadName: string = 'Đường phố Sài Gòn';

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.bikeGroup = new THREE.Group();
    this.bikeBody = new THREE.Group();
    this.bikeGroup.add(this.bikeBody);

    // Build stylized Vietnam delivery motorbike
    const { frontWheel, rearWheel, headlight } = this.buildMotorbikeMesh();
    this.frontWheel = frontWheel;
    this.rearWheel = rearWheel;
    this.headlight = headlight;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private buildMotorbikeMesh(): {
    frontWheel: THREE.Mesh;
    rearWheel: THREE.Mesh;
    headlight: THREE.SpotLight;
  } {
    // 1. Frame / Chassis (Scooter body - Vietnam iconic red/teal)
    const chassisGeo = new THREE.BoxGeometry(0.55, 0.45, 1.4);
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Saigon delivery red
      metalness: 0.6,
      roughness: 0.3,
    });
    const chassis = new THREE.Mesh(chassisGeo, chassisMat);
    chassis.position.set(0, 0.5, 0);
    chassis.castShadow = true;
    this.bikeBody.add(chassis);

    // 2. Footrest / Floorboard
    const floorGeo = new THREE.BoxGeometry(0.6, 0.1, 0.9);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(0, 0.28, 0.1);
    this.bikeBody.add(floor);

    // 3. Scooter Seat
    const seatGeo = new THREE.BoxGeometry(0.48, 0.18, 0.7);
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.8 });
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.set(0, 0.78, -0.15);
    seat.castShadow = true;
    this.bikeBody.add(seat);

    // 4. Wheels (Front & Rear)
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 16);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9 });

    const frontWheel = new THREE.Mesh(wheelGeo, tireMat);
    frontWheel.position.set(0, 0.3, 0.85);
    frontWheel.castShadow = true;
    this.bikeBody.add(frontWheel);

    const rearWheel = new THREE.Mesh(wheelGeo, tireMat);
    rearWheel.position.set(0, 0.3, -0.65);
    rearWheel.castShadow = true;
    this.bikeBody.add(rearWheel);

    // 5. Handlebars & Dashboard
    const handlebarGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8);
    handlebarGeo.rotateZ(Math.PI / 2);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.8 });
    const handlebar = new THREE.Mesh(handlebarGeo, barMat);
    handlebar.position.set(0, 1.05, 0.65);
    this.bikeBody.add(handlebar);

    // 6. Iconic Insulated Food Delivery Box (Backpack Carrier)
    const boxGeo = new THREE.BoxGeometry(0.65, 0.65, 0.65);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Vibrant Saigon Shipper emerald green
      roughness: 0.4,
    });
    const deliveryBox = new THREE.Mesh(boxGeo, boxMat);
    deliveryBox.position.set(0, 0.95, -0.7);
    deliveryBox.castShadow = true;
    this.bikeBody.add(deliveryBox);

    // Box top reflective strip
    const stripGeo = new THREE.BoxGeometry(0.66, 0.1, 0.66);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      emissive: 0x854d0e,
      roughness: 0.2,
    });
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(0, 0.95, -0.7);
    this.bikeBody.add(strip);

    // 7. Stylized Driver Helmet
    const helmetGeo = new THREE.SphereGeometry(0.24, 14, 14);
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15, // Bright yellow safety helmet
      roughness: 0.3,
    });
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.set(0, 1.45, 0.0);
    helmet.castShadow = true;
    this.bikeBody.add(helmet);

    // 8. Front Headlight & Real SpotLight
    const headlightMeshGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.1, 12);
    headlightMeshGeo.rotateX(Math.PI / 2);
    const headlightMeshMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffee,
      emissiveIntensity: 1.5,
    });
    const headlightMesh = new THREE.Mesh(headlightMeshGeo, headlightMeshMat);
    headlightMesh.position.set(0, 0.85, 0.95);
    this.bikeBody.add(headlightMesh);

    const headlight = new THREE.SpotLight(0xfff8db, 4.0, 45, Math.PI / 5, 0.4, 1.2);
    headlight.position.set(0, 0.85, 0.95);
    const targetObj = new THREE.Object3D();
    targetObj.position.set(0, 0.1, 15);
    this.bikeBody.add(targetObj);
    headlight.target = targetObj;
    this.bikeBody.add(headlight);

    return { frontWheel, rearWheel, headlight };
  }

  public setEnvironment(buildings: BuildingItem[], roadGraph: RoadNetworkGraph): void {
    this.buildings = buildings;
    this.roadGraph = roadGraph;

    // Place bike at first road graph node if available, otherwise origin
    if (roadGraph.nodes.size > 0) {
      const firstNode = roadGraph.nodes.values().next().value;
      if (firstNode) {
        this.resetPosition(firstNode.x, firstNode.z, firstNode.y ?? 0.05);
        return;
      }
    }
    this.resetPosition(0, 0, 0.05);
  }

  public resetPosition(x = 0, z = 0, y?: number): void {
    let initY = y ?? 0.05;
    if (this.roadGraph && y === undefined) {
      let minDist = Infinity;
      for (const node of this.roadGraph.nodes.values()) {
        const d = Math.hypot(x - node.x, z - node.z);
        if (d < minDist) {
          minDist = d;
          if (d < 20) initY = node.y ?? 0.05;
        }
      }
    }
    this.position.set(x, initY, z);
    this.velocity = 0;
    this.heading = 0;
    this.steerAngle = 0;
    this.leanAngle = 0;
    this.bikeGroup.position.copy(this.position);
    this.bikeGroup.rotation.y = this.heading;
  }

  public setActive(active: boolean): void {
    this.isActive = active;
    if (active) {
      // Immediate camera snap
      this.updateCamera(0.1, true);
    }
  }

  public getIsActive(): boolean {
    return this.isActive;
  }

  public setStatusCallback(callback: (status: ShipperStatus) => void): void {
    this.onStatusChange = callback;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = true;
        break;
      case 'Space':
        this.keys.brake = true;
        break;
      case 'KeyR':
        // Teleport to nearest safe node or center
        this.resetPosition(0, 0);
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = false;
        break;
      case 'Space':
        this.keys.brake = false;
        break;
    }
  };

  /**
   * Fast circle vs. line segment collision test
   */
  private checkSegmentCollision(
    px: number,
    pz: number,
    radius: number,
    x1: number,
    z1: number,
    x2: number,
    z2: number
  ): { collided: boolean; normalX: number; normalZ: number; penetration: number } {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lenSq = dx * dx + dz * dz;

    if (lenSq === 0) {
      const dist = Math.hypot(px - x1, pz - z1);
      if (dist < radius) {
        return {
          collided: true,
          normalX: (px - x1) / (dist || 1),
          normalZ: (pz - z1) / (dist || 1),
          penetration: radius - dist,
        };
      }
      return { collided: false, normalX: 0, normalZ: 0, penetration: 0 };
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
    const closestX = x1 + t * dx;
    const closestZ = z1 + t * dz;

    const distX = px - closestX;
    const distZ = pz - closestZ;
    const dist = Math.hypot(distX, distZ);

    if (dist < radius) {
      const normalX = dist > 0.001 ? distX / dist : 0;
      const normalZ = dist > 0.001 ? distZ / dist : 1;
      return {
        collided: true,
        normalX,
        normalZ,
        penetration: radius - dist,
      };
    }

    return { collided: false, normalX: 0, normalZ: 0, penetration: 0 };
  }

  /**
   * Collision resolution against building walls
   */
  private resolveCollisions(nextPos: THREE.Vector3): boolean {
    let hadCollision = false;

    for (const bld of this.buildings) {
      // If bike is elevated above building height (e.g. flyover / high bridge), skip collision
      if (nextPos.y > bld.height) {
        continue;
      }

      // 1. Broadphase BBox check
      const bb = bld.bbox;
      if (
        nextPos.x + this.bikeRadius < bb.minX ||
        nextPos.x - this.bikeRadius > bb.maxX ||
        nextPos.z + this.bikeRadius < bb.minZ ||
        nextPos.z - this.bikeRadius > bb.maxZ
      ) {
        continue;
      }

      // 2. Narrowphase polygon segment tests
      const outerRing = bld.rings[0];
      if (!outerRing) continue;

      for (let i = 0; i < outerRing.length - 1; i++) {
        const p1 = outerRing[i];
        const p2 = outerRing[i + 1];

        const res = this.checkSegmentCollision(
          nextPos.x,
          nextPos.z,
          this.bikeRadius,
          p1.x,
          p1.z,
          p2.x,
          p2.z
        );

        if (res.collided) {
          hadCollision = true;
          // Push bike back outside obstacle
          nextPos.x += res.normalX * res.penetration;
          nextPos.z += res.normalZ * res.penetration;
          // Dampen velocity on impact
          this.velocity *= 0.3;
        }
      }
    }

    return hadCollision;
  }

  public update(deltaTime: number): void {
    if (!this.isActive) return;

    // 1. Acceleration / Braking
    if (this.keys.brake) {
      if (this.velocity > 0) {
        this.velocity = Math.max(0, this.velocity - this.brakingDecel * deltaTime);
      } else if (this.velocity < 0) {
        this.velocity = Math.min(0, this.velocity + this.brakingDecel * deltaTime);
      }
    } else if (this.keys.forward) {
      this.velocity = Math.min(this.maxSpeed, this.velocity + this.acceleration * deltaTime);
    } else if (this.keys.backward) {
      this.velocity = Math.max(this.maxReverseSpeed, this.velocity - (this.acceleration * 0.7) * deltaTime);
    } else {
      // Coasting friction
      if (this.velocity > 0) {
        this.velocity = Math.max(0, this.velocity - this.friction * deltaTime);
      } else if (this.velocity < 0) {
        this.velocity = Math.min(0, this.velocity + this.friction * deltaTime);
      }
    }

    // 2. Steering & Banking / Leaning
    let steerInput = 0;
    if (this.keys.left) steerInput += 1;
    if (this.keys.right) steerInput -= 1;

    if (Math.abs(this.velocity) > 0.1) {
      const dirFactor = this.velocity >= 0 ? 1 : -1;
      this.heading += steerInput * this.turnSpeed * dirFactor * deltaTime;

      // Realistic motorcycle lean into turns
      const targetLean = -steerInput * (Math.abs(this.velocity) / this.maxSpeed) * 0.42;
      this.leanAngle = THREE.MathUtils.lerp(this.leanAngle, targetLean, 10 * deltaTime);
    } else {
      this.leanAngle = THREE.MathUtils.lerp(this.leanAngle, 0, 10 * deltaTime);
    }

    // 3. Position update with collision resolution & Bridge Deck Elevation
    // Heading 0 faces +Z in local coordinates
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);

    const nextPos = this.position.clone();
    nextPos.x += forwardX * this.velocity * deltaTime;
    nextPos.z += forwardZ * this.velocity * deltaTime;

    // Sample Road / Bridge Elevation from Road Graph
    let targetY = 0.05;
    let minEdgeDist = Infinity;
    let nearestEdge: any = null;
    let isOnBridgeDeck = false;

    if (this.roadGraph && this.roadGraph.edges.length > 0) {
      for (const edge of this.roadGraph.edges) {
        const n1 = this.roadGraph.nodes.get(edge.fromId);
        const n2 = this.roadGraph.nodes.get(edge.toId);
        if (!n1 || !n2) continue;

        const dx = n2.x - n1.x;
        const dz = n2.z - n1.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 0.01) continue;

        const t = Math.max(0, Math.min(1, ((nextPos.x - n1.x) * dx + (nextPos.z - n1.z) * dz) / lenSq));
        const cx = n1.x + t * dx;
        const cz = n1.z + t * dz;
        const d = Math.hypot(nextPos.x - cx, nextPos.z - cz);

        if (d < minEdgeDist) {
          minEdgeDist = d;
          nearestEdge = edge;
        }

        const isElevatedBridge = !!edge.isBridge || (n1.y ?? 0) > 0.5 || (n2.y ?? 0) > 0.5;
        if (isElevatedBridge && d < 7.5) {
          const y1 = n1.y ?? 0.05;
          const y2 = n2.y ?? 0.05;
          const edgeY = y1 + (y2 - y1) * t;
          if (edgeY > targetY) {
            targetY = edgeY;
            isOnBridgeDeck = true;
          }

          // Bridge Safety Parapet barrier: keeps motorcycle safely on bridge deck
          if (d > 5.5) {
            const pushBack = d - 5.5;
            const nx = (cx - nextPos.x) / (d || 1);
            const nz = (cz - nextPos.z) / (d || 1);
            nextPos.x += nx * pushBack;
            nextPos.z += nz * pushBack;
            this.velocity *= 0.65; // bump friction against parapet
          }
        }
      }

      // If not on an elevated bridge, check if on ground road
      if (!isOnBridgeDeck && nearestEdge && minEdgeDist < 12.0) {
        const n1 = this.roadGraph.nodes.get(nearestEdge.fromId);
        const n2 = this.roadGraph.nodes.get(nearestEdge.toId);
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dz = n2.z - n1.z;
          const lenSq = dx * dx + dz * dz;
          if (lenSq >= 0.01) {
            const t = Math.max(0, Math.min(1, ((nextPos.x - n1.x) * dx + (nextPos.z - n1.z) * dz) / lenSq));
            const y1 = n1.y ?? 0.05;
            const y2 = n2.y ?? 0.05;
            targetY = y1 + (y2 - y1) * t;
          }
        }
      }
    }

    // Smoothly adapt bike height to road / bridge slope
    nextPos.y = THREE.MathUtils.lerp(this.position.y, targetY, Math.min(1, 14 * deltaTime));

    const hadCollision = this.resolveCollisions(nextPos);
    this.position.copy(nextPos);

    // Apply to 3D meshes
    this.bikeGroup.position.copy(this.position);
    this.bikeGroup.rotation.y = this.heading;
    this.bikeBody.rotation.z = this.leanAngle;

    // Spin wheels
    const wheelRot = (this.velocity / 0.3) * deltaTime;
    this.frontWheel.rotation.x += wheelRot;
    this.rearWheel.rotation.x += wheelRot;

    // 4. Update 3rd-Person Follow Camera
    this.updateCamera(deltaTime, false);

    // 5. Detect Nearest Street / Alley / Bridge name from Road Graph
    if (minEdgeDist < 40 && nearestEdge && nearestEdge.name) {
      if (nearestEdge.isBridge) {
        this.currentRoadName = nearestEdge.name.toLowerCase().startsWith('cầu')
          ? nearestEdge.name
          : `Cầu ${nearestEdge.name}`;
      } else if (nearestEdge.isAlley) {
        this.currentRoadName = `Hẻm: ${nearestEdge.name}`;
      } else {
        this.currentRoadName = nearestEdge.name;
      }
    }

    // Status callback
    const speedKmh = Math.round(Math.abs(this.velocity) * 3.6);
    this.onStatusChange?.({
      speedKmh,
      currentRoadName: this.currentRoadName,
      isColliding: hadCollision,
      position: { x: this.position.x, z: this.position.z },
    });
  }

  /**
   * Smooth AAA 3rd-person follow camera
   */
  private updateCamera(deltaTime: number, snap = false): void {
    const forwardX = Math.sin(this.heading);
    const forwardZ = Math.cos(this.heading);

    // Follow distance: 4.8m behind, 2.2m above
    const desiredCamPos = new THREE.Vector3(
      this.position.x - forwardX * 4.8,
      this.position.y + 2.2,
      this.position.z - forwardZ * 4.8
    );

    const lookTarget = new THREE.Vector3(
      this.position.x + forwardX * 3.5,
      this.position.y + 1.2,
      this.position.z + forwardZ * 3.5
    );

    if (snap) {
      this.camera.position.copy(desiredCamPos);
      this.camera.lookAt(lookTarget);
    } else {
      // Smooth lerp
      this.camera.position.lerp(desiredCamPos, 9 * deltaTime);
      this.camera.lookAt(lookTarget);
    }
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
