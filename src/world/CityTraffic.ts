import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface VehiclePlacement {
  x: number;
  z: number;
  heading: number; // in radians
  isScooter?: boolean;
}

export class CityTraffic {
  /**
   * Generates 500-900+ stylized low-poly vehicles along roads and parking spots in 1 Draw Call
   */
  public static createTraffic(placements: VehiclePlacement[]): THREE.Group {
    const group = new THREE.Group();
    group.name = 'traffic_group';

    const count = placements.length;
    if (count === 0) return group;

    // Stylized low-poly car geometry
    const chassisGeo = new THREE.BoxGeometry(1.7, 0.7, 3.6);
    chassisGeo.translate(0, 0.45, 0);

    const cabinGeo = new THREE.BoxGeometry(1.5, 0.65, 2.0);
    cabinGeo.translate(0, 1.05, -0.2);

    const carGeo = new THREE.BufferGeometry();
    const mergedCarGeo = BufferGeometryUtils.mergeGeometries([chassisGeo, cabinGeo]) || chassisGeo;

    const carMat = new THREE.MeshStandardMaterial({
      roughness: 0.4,
      metalness: 0.5,
    });

    const instancedCars = new THREE.InstancedMesh(mergedCarGeo, carMat, count);
    instancedCars.castShadow = true;
    instancedCars.receiveShadow = true;

    const vehicleColors = [
      new THREE.Color(0xf8fafc), // White
      new THREE.Color(0xfacc15), // Saigon Taxi Yellow
      new THREE.Color(0xef4444), // Crimson Red
      new THREE.Color(0x0284c7), // Sky Blue
      new THREE.Color(0x1e293b), // Charcoal Black
      new THREE.Color(0x10b981), // Grab / Delivery Green
      new THREE.Color(0x94a3b8), // Silver Metallic
    ];

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const v = placements[i];

      dummy.position.set(v.x, 0.12, v.z);
      dummy.rotation.set(0, v.heading, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      instancedCars.setMatrixAt(i, dummy.matrix);

      const col = vehicleColors[i % vehicleColors.length];
      instancedCars.setColorAt(i, col);
    }

    instancedCars.instanceMatrix.needsUpdate = true;
    if (instancedCars.instanceColor) instancedCars.instanceColor.needsUpdate = true;

    group.add(instancedCars);
    return group;
  }
}
