import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadGraphEdge, RoadNetworkGraph } from '../types/gis';

interface PedestrianAgent {
  id: number;
  edge: RoadGraphEdge;
  dist: number;
  edgeLength: number;
  speed: number;
  direction: 1 | -1;
  sideOffset: number; // offset to left or right sidewalk
  heading: number;
  walkPhase: number;
  variant: number;
  hasHat: boolean;
  currentPos: THREE.Vector3;
}

/**
 * Assigns per-vertex color to BufferGeometry
 */
function withVertexColor(geo: THREE.BufferGeometry, colorHex: number): THREE.BufferGeometry {
  const color = new THREE.Color(colorHex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class PedestrianSystem {
  public group: THREE.Group;
  private roadGraph: RoadNetworkGraph | null = null;
  private pedestrians: PedestrianAgent[] = [];

  private instancedBodies: THREE.InstancedMesh | null = null;
  private instancedHats: THREE.InstancedMesh | null = null;

  private dummy: THREE.Object3D = new THREE.Object3D();
  private zeroMatrix: THREE.Matrix4 = new THREE.Matrix4().makeScale(0, 0, 0);

  private readonly totalPedestrians = 650;

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'pedestrian_crowd_group';
  }

  /**
   * Builds optimized stylized low-poly Vietnamese pedestrian geometry
   */
  private createPedestrianGeometries(): { bodyGeo: THREE.BufferGeometry; hatGeo: THREE.BufferGeometry } {
    // 1. Human Body Base (Head, Torso, Arms, Legs)
    const bodyParts: THREE.BufferGeometry[] = [];

    // Head (Skin tone: 0xf5d0b0)
    const head = new THREE.BoxGeometry(0.19, 0.20, 0.18);
    head.translate(0, 1.54, 0);
    bodyParts.push(withVertexColor(head, 0xf5d0b0));

    // Hair / Cap (Dark charcoal: 0x1c1917)
    const hair = new THREE.BoxGeometry(0.20, 0.08, 0.19);
    hair.translate(0, 1.62, -0.01);
    bodyParts.push(withVertexColor(hair, 0x1c1917));

    // Torso (Shirt neutral base, will be instance tinted or colorful)
    const torso = new THREE.BoxGeometry(0.34, 0.46, 0.20);
    torso.translate(0, 1.18, 0);
    bodyParts.push(withVertexColor(torso, 0x38bdf8));

    // Arms
    const leftArm = new THREE.BoxGeometry(0.08, 0.40, 0.09);
    leftArm.translate(0.21, 1.15, 0);
    bodyParts.push(withVertexColor(leftArm, 0xf5d0b0));

    const rightArm = new THREE.BoxGeometry(0.08, 0.40, 0.09);
    rightArm.translate(-0.21, 1.15, 0);
    bodyParts.push(withVertexColor(rightArm, 0xf5d0b0));

    // Pants / Legs (Dark navy: 0x1e293b)
    const leftLeg = new THREE.BoxGeometry(0.12, 0.64, 0.13);
    leftLeg.translate(0.09, 0.40, 0);
    bodyParts.push(withVertexColor(leftLeg, 0x1e293b));

    const rightLeg = new THREE.BoxGeometry(0.12, 0.64, 0.13);
    rightLeg.translate(-0.09, 0.40, 0);
    bodyParts.push(withVertexColor(rightLeg, 0x1e293b));

    // Shoes (Charcoal: 0x0f172a)
    const leftShoe = new THREE.BoxGeometry(0.12, 0.08, 0.18);
    leftShoe.translate(0.09, 0.04, 0.02);
    bodyParts.push(withVertexColor(leftShoe, 0x0f172a));

    const rightShoe = new THREE.BoxGeometry(0.12, 0.08, 0.18);
    rightShoe.translate(-0.09, 0.04, 0.02);
    bodyParts.push(withVertexColor(rightShoe, 0x0f172a));

    const mergedBody = BufferGeometryUtils.mergeGeometries(bodyParts) || head;

    // 2. Traditional Vietnamese Conical Hat (Nón Lá) & Helmet Accessories
    const hatParts: THREE.BufferGeometry[] = [];
    const coneHat = new THREE.ConeGeometry(0.28, 0.14, 10);
    coneHat.translate(0, 1.68, 0);
    hatParts.push(withVertexColor(coneHat, 0xfef08a)); // Bamboo leaf warm yellow

    const mergedHat = BufferGeometryUtils.mergeGeometries(hatParts) || coneHat;

    return { bodyGeo: mergedBody, hatGeo: mergedHat };
  }

  /**
   * Initializes pedestrian crowd along city sidewalks and pedestrian plazas
   */
  public initPedestrians(roadGraph: RoadNetworkGraph): void {
    this.roadGraph = roadGraph;

    // Clear previous objects
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if ((child as any).geometry) (child as any).geometry.dispose();
    }
    this.pedestrians = [];

    // Filter valid pedestrian edges with minimum length
    const validEdges = roadGraph.edges.filter((e) => {
      const n1 = roadGraph.nodes.get(e.fromId);
      const n2 = roadGraph.nodes.get(e.toId);
      if (!n1 || !n2) return false;
      return Math.hypot(n2.x - n1.x, n2.z - n1.z) >= 14;
    });

    if (validEdges.length === 0) return;

    const { bodyGeo, hatGeo } = this.createPedestrianGeometries();

    const bodyMat = new THREE.MeshStandardMaterial({
      roughness: 0.6,
      metalness: 0.1,
      vertexColors: true,
    });

    const hatMat = new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.05,
      vertexColors: true,
    });

    this.instancedBodies = new THREE.InstancedMesh(bodyGeo, bodyMat, this.totalPedestrians);
    this.instancedHats = new THREE.InstancedMesh(hatGeo, hatMat, this.totalPedestrians);

    this.instancedBodies.castShadow = true;
    this.instancedBodies.receiveShadow = true;

    // Diverse Vietnamese outfit color palettes (Áo Dài, shirts, casual summer dresses)
    const outfitColors = [
      new THREE.Color(0xf8fafc), // Clean white dress / shirt
      new THREE.Color(0x38bdf8), // Cyan blue student polo
      new THREE.Color(0xf43f5e), // Rose red áo dài
      new THREE.Color(0xfacc15), // Saigon yellow summer dress
      new THREE.Color(0x10b981), // Emerald green uniform
      new THREE.Color(0xa855f7), // Purple lavender áo dài
      new THREE.Color(0xf97316), // Tangerine orange shirt
      new THREE.Color(0x06b6d4), // Ocean turquoise
      new THREE.Color(0x475569), // Slate grey office attire
      new THREE.Color(0xec4899), // Lotus pink
    ];

    // Spawn 650 pedestrians across sidewalk ribbons
    for (let i = 0; i < this.totalPedestrians; i++) {
      const edge = validEdges[i % validEdges.length];
      const n1 = roadGraph.nodes.get(edge.fromId)!;
      const n2 = roadGraph.nodes.get(edge.toId)!;
      const len = Math.hypot(n2.x - n1.x, n2.z - n1.z);

      // Sidewalk lateral offset: just outside the curb (half width + sidewalk offset)
      const roadW = edge.width || (edge.highway === 'primary' ? 14.0 : edge.highway === 'secondary' ? 10.0 : edge.isAlley ? 3.0 : 6.0);
      const sidewalkW = edge.isAlley ? 0.4 : 1.2;
      const isLeftSide = i % 2 === 0;
      const sideOffset = (roadW / 2 + sidewalkW * 0.55) * (isLeftSide ? -1 : 1);

      const dir = (n1.id < n2.id ? 1 : -1) * (i % 3 === 0 ? -1 : 1);
      const initialDist = (i * 17.3 + (i % 7) * 4.1) % (len * 0.85) + len * 0.08;

      const dx = n2.x - n1.x;
      const dz = n2.z - n1.z;
      const headingBase = Math.atan2(dx, dz);
      const heading = dir > 0 ? headingBase : headingBase + Math.PI;

      const hasHat = i % 3 === 0; // 33% of pedestrians wear iconic Nón Lá conical hats
      const walkSpeed = 1.15 + (i % 5) * 0.12; // Natural walking speed 1.15 - 1.63 m/s

      const agent: PedestrianAgent = {
        id: i,
        edge,
        dist: initialDist,
        edgeLength: len,
        speed: walkSpeed,
        direction: dir > 0 ? 1 : -1,
        sideOffset,
        heading,
        walkPhase: (i * 1.35) % (Math.PI * 2),
        variant: i % outfitColors.length,
        hasHat,
        currentPos: new THREE.Vector3(),
      };

      this.pedestrians.push(agent);
      this.instancedBodies.setColorAt(i, outfitColors[agent.variant]);
    }

    if (this.instancedBodies.instanceColor) {
      this.instancedBodies.instanceColor.needsUpdate = true;
    }

    this.group.add(this.instancedBodies);
    this.group.add(this.instancedHats);

    // Initial positioning
    this.update(0.016);
  }

  /**
   * Updates walking kinematics and stride animation for all pedestrians
   */
  public update(deltaTime: number): void {
    if (!this.roadGraph || !this.instancedBodies || this.pedestrians.length === 0) return;
    const dt = Math.min(deltaTime, 0.08);

    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      const n1 = this.roadGraph.nodes.get(p.edge.fromId);
      const n2 = this.roadGraph.nodes.get(p.edge.toId);
      if (!n1 || !n2) continue;

      const dx = n2.x - n1.x;
      const dz = n2.z - n1.z;
      const len = p.edgeLength;
      if (len < 1.0) continue;

      const dirX = dx / len;
      const dirZ = dz / len;
      const perpX = -dirZ;
      const perpZ = dirX;

      // Advance along sidewalk
      p.dist += p.speed * p.direction * dt;
      p.walkPhase += p.speed * 4.5 * dt;

      // Turn around or bounce when reaching sidewalk ends
      if (p.dist >= len - 3.5) {
        p.dist = len - 3.5;
        p.direction = -1;
        p.heading = Math.atan2(dirX, dirZ) + Math.PI;
      } else if (p.dist <= 3.5) {
        p.dist = 3.5;
        p.direction = 1;
        p.heading = Math.atan2(dirX, dirZ);
      }

      const t = Math.max(0, Math.min(1, p.dist / len));
      const cx = n1.x + dx * t;
      const cz = n1.z + dz * t;
      const groundY = (n1.y ?? 0.08) + ((n2.y ?? 0.08) - (n1.y ?? 0.08)) * t + 0.078; // Sidewalk elevation

      // Natural vertical stride bobbing
      const bobY = Math.abs(Math.sin(p.walkPhase)) * 0.035;

      p.currentPos.set(
        cx + perpX * p.sideOffset,
        groundY + bobY,
        cz + perpZ * p.sideOffset
      );

      // Body transformation matrix
      this.dummy.position.copy(p.currentPos);
      // Subtle natural torso walking sway
      const sway = Math.sin(p.walkPhase) * 0.04;
      this.dummy.rotation.set(0, p.heading, sway);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.instancedBodies.setMatrixAt(i, this.dummy.matrix);

      // Nón Lá / Hat transformation matrix
      if (this.instancedHats) {
        if (p.hasHat) {
          this.instancedHats.setMatrixAt(i, this.dummy.matrix);
        } else {
          this.instancedHats.setMatrixAt(i, this.zeroMatrix);
        }
      }
    }

    this.instancedBodies.instanceMatrix.needsUpdate = true;
    if (this.instancedHats) {
      this.instancedHats.instanceMatrix.needsUpdate = true;
    }
  }
}
