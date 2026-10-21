import * as THREE from 'three';

export class CityVegetation {
  /**
   * Generates 1,500+ stylized low-poly tropical trees using InstancedMesh (1 Draw Call!)
   */
  public static createVegetation(
    treePositions: Array<{ x: number; z: number; scale?: number }>
  ): THREE.Group {
    const group = new THREE.Group();
    group.name = 'vegetation_group';

    const count = treePositions.length;
    if (count === 0) return group;

    // 1. Trunk InstancedMesh
    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 2.2, 5);
    trunkGeo.translate(0, 1.1, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.9,
      metalness: 0.05,
    });
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;

    // 2. Canopy InstancedMesh
    // Stylized faceted icosahedron canopy (iconic Monument Valley / SimCity aesthetic)
    const canopyGeo = new THREE.IcosahedronGeometry(1.6, 1);
    canopyGeo.translate(0, 2.8, 0);
    const canopyMat = new THREE.MeshStandardMaterial({
      roughness: 0.75,
      metalness: 0.05,
      flatShading: true,
    });
    const canopyMesh = new THREE.InstancedMesh(canopyGeo, canopyMat, count);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;

    // Tree canopy color variations
    const leafColors = [
      new THREE.Color(0x16a34a), // Lush tropical green
      new THREE.Color(0x22c55e), // Fresh spring green
      new THREE.Color(0x84cc16), // Lime green
      new THREE.Color(0x15803d), // Deep forest green
      new THREE.Color(0x65a30d), // Olive green
    ];

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const pt = treePositions[i];
      const s = pt.scale || 0.8 + Math.random() * 0.5;

      dummy.position.set(pt.x, 0, pt.z);
      dummy.scale.set(s, s * (0.9 + Math.random() * 0.3), s);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();

      trunkMesh.setMatrixAt(i, dummy.matrix);
      canopyMesh.setMatrixAt(i, dummy.matrix);

      // Random natural canopy color tint
      const col = leafColors[Math.floor(Math.random() * leafColors.length)];
      canopyMesh.setColorAt(i, col);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;

    group.add(trunkMesh);
    group.add(canopyMesh);

    return group;
  }
}
