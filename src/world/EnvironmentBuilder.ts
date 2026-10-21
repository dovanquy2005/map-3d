import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';

export class EnvironmentBuilder {
  /**
   * Triangulates a polygon into a flat 3D surface at height yOffset with guaranteed UPWARD normal (+Y)
   */
  private static triangulatePolygon(
    rings: { x: number; z: number }[][],
    yOffset: number,
    color: THREE.Color
  ): THREE.BufferGeometry | null {
    const rawOuter = rings[0];
    if (!rawOuter || rawOuter.length < 3) return null;

    // Strip duplicate closing vertex if present
    const isClosed =
      rawOuter.length > 3 &&
      Math.abs(rawOuter[0].x - rawOuter[rawOuter.length - 1].x) < 0.001 &&
      Math.abs(rawOuter[0].z - rawOuter[rawOuter.length - 1].z) < 0.001;
    const outerRing = isClosed ? rawOuter.slice(0, -1) : rawOuter;
    if (outerRing.length < 3) return null;

    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    for (let h = 1; h < rings.length; h++) {
      const rawHole = rings[h];
      const holeClosed =
        rawHole.length > 3 &&
        Math.abs(rawHole[0].x - rawHole[rawHole.length - 1].x) < 0.001 &&
        Math.abs(rawHole[0].z - rawHole[rawHole.length - 1].z) < 0.001;
      const hole = holeClosed ? rawHole.slice(0, -1) : rawHole;

      if (hole.length >= 3) {
        holeIndices.push(flatCoords.length / 2);
        for (let i = 0; i < hole.length; i++) {
          flatCoords.push(hole[i].x, hole[i].z);
        }
      }
    }

    const indices = earcut(flatCoords, holeIndices, 2);
    if (indices.length === 0) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      let p0 = { x: flatCoords[indices[i] * 2], z: flatCoords[indices[i] * 2 + 1] };
      let p1 = { x: flatCoords[indices[i + 1] * 2], z: flatCoords[indices[i + 1] * 2 + 1] };
      let p2 = { x: flatCoords[indices[i + 2] * 2], z: flatCoords[indices[i + 2] * 2 + 1] };

      // Vector Cross Product in X-Z plane to guarantee normal points straight UP (+Y)
      const vAx = p1.x - p0.x;
      const vAz = p1.z - p0.z;
      const vBx = p2.x - p0.x;
      const vBz = p2.z - p0.z;
      const crossY = vAz * vBx - vAx * vBz;

      if (crossY < 0) {
        const temp = p1;
        p1 = p2;
        p2 = temp;
      }

      positions.push(p0.x, yOffset, p0.z);
      positions.push(p1.x, yOffset, p1.z);
      positions.push(p2.x, yOffset, p2.z);

      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);

      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    return geometry;
  }

  /**
   * Builds merged road meshes (Dark asphalt main roads & Concrete Saigon alleys)
   * With DoubleSide material so road surfaces are ALWAYS 100% visible
   */
  public static buildRoads(roads: RoadPolygonItem[]): THREE.Mesh | null {
    if (roads.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const asphaltColor = new THREE.Color(SAIGON_PALETTES.mainAsphalt); // Dark charcoal asphalt
    const alleyColor = new THREE.Color(SAIGON_PALETTES.alleyPavement); // Concrete grey alley

    for (const road of roads) {
      const col = road.isAlley ? alleyColor : asphaltColor;
      // Roads raised to y = 0.12m to eliminate z-fighting with ground plane
      const geo = this.triangulatePolygon(road.rings, 0.12, col);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.DoubleSide, // Guarantees roads are never backface culled!
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'roads_merged';
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds merged water bodies (River, canals, ponds) with reflection and water shading
   */
  public static buildWater(waterList: WaterPolygonItem[]): THREE.Mesh | null {
    if (waterList.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const waterColor = new THREE.Color(SAIGON_PALETTES.tropicalWater);

    for (const water of waterList) {
      const geo = this.triangulatePolygon(water.rings, 0.05, waterColor);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.12,
      metalness: 0.45,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.94,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'water_merged';
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds merged parks & green landuse with scattered low-poly tropical trees
   */
  public static buildParks(parks: ParkPolygonItem[]): { parkMesh: THREE.Mesh | null; treeMesh: THREE.Mesh | null } {
    if (parks.length === 0) return { parkMesh: null, treeMesh: null };

    const parkGeometries: THREE.BufferGeometry[] = [];
    const parkColor = new THREE.Color(SAIGON_PALETTES.parkGreen);
    const treePositions: { x: number; z: number }[] = [];

    for (const park of parks) {
      const geo = this.triangulatePolygon(park.rings, 0.08, parkColor);
      if (geo) {
        parkGeometries.push(geo);

        const outer = park.rings[0];
        if (outer && outer.length >= 3) {
          let cx = 0;
          let cz = 0;
          for (const pt of outer) {
            cx += pt.x;
            cz += pt.z;
          }
          cx /= outer.length;
          cz /= outer.length;

          // Scatter tropical trees in park
          treePositions.push({ x: cx, z: cz });
          treePositions.push({ x: cx + 15, z: cz + 10 });
          treePositions.push({ x: cx - 12, z: cz - 14 });
          treePositions.push({ x: cx + 8, z: cz - 18 });
          treePositions.push({ x: cx - 18, z: cz + 12 });
        }
      }
    }

    let parkMesh: THREE.Mesh | null = null;
    if (parkGeometries.length > 0) {
      const mergedParks = BufferGeometryUtils.mergeGeometries(parkGeometries, false);
      for (const g of parkGeometries) g.dispose();

      if (mergedParks) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x15803d,
          roughness: 0.9,
          metalness: 0.05,
          side: THREE.DoubleSide,
        });
        parkMesh = new THREE.Mesh(mergedParks, material);
        parkMesh.name = 'parks_merged';
        parkMesh.receiveShadow = true;
      }
    }

    // Low-poly stylized tropical trees
    let treeMesh: THREE.Mesh | null = null;
    if (treePositions.length > 0) {
      const treeGeometries: THREE.BufferGeometry[] = [];
      const trunkColor = new THREE.Color(0x78350f);
      const canopyColor = new THREE.Color(0x22c55e);

      for (const pos of treePositions) {
        const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.0, 6);
        trunkGeo.translate(pos.x, 1.5, pos.z);
        const trunkColors: number[] = [];
        for (let i = 0; i < trunkGeo.attributes.position.count; i++) {
          trunkColors.push(trunkColor.r, trunkColor.g, trunkColor.b);
        }
        trunkGeo.setAttribute('color', new THREE.Float32BufferAttribute(trunkColors, 3));
        treeGeometries.push(trunkGeo);

        const canopyGeo = new THREE.ConeGeometry(2.5, 4.5, 7);
        canopyGeo.translate(pos.x, 4.5, pos.z);
        const canopyColors: number[] = [];
        for (let i = 0; i < canopyGeo.attributes.position.count; i++) {
          canopyColors.push(canopyColor.r, canopyColor.g, canopyColor.b);
        }
        canopyGeo.setAttribute('color', new THREE.Float32BufferAttribute(canopyColors, 3));
        treeGeometries.push(canopyGeo);
      }

      if (treeGeometries.length > 0) {
        const mergedTrees = BufferGeometryUtils.mergeGeometries(treeGeometries, false);
        for (const g of treeGeometries) g.dispose();

        if (mergedTrees) {
          const treeMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.1,
          });
          treeMesh = new THREE.Mesh(mergedTrees, treeMat);
          treeMesh.name = 'trees_merged';
          treeMesh.castShadow = true;
          treeMesh.receiveShadow = true;
        }
      }
    }

    return { parkMesh, treeMesh };
  }
}
