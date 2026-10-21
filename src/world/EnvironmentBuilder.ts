import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { ParkPolygonItem, RoadPolygonItem, WaterPolygonItem } from '../types/gis';
import { SAIGON_PALETTES } from '../config/endpoints';

export class EnvironmentBuilder {
  /**
   * Triangulates a polygon into a flat 3D surface at height yOffset with vertex colors
   */
  private static triangulatePolygon(
    rings: { x: number; z: number }[][],
    yOffset: number,
    color: THREE.Color
  ): THREE.BufferGeometry | null {
    const outerRing = rings[0];
    if (!outerRing || outerRing.length < 3) return null;

    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    for (let h = 1; h < rings.length; h++) {
      const hole = rings[h];
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

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i] * 2;
      positions.push(flatCoords[idx], yOffset, flatCoords[idx + 1]);
      normals.push(0, 1, 0);
      colors.push(color.r, color.g, color.b);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    return geometry;
  }

  /**
   * Builds merged road meshes (Main roads & Saigon alleys)
   */
  public static buildRoads(roads: RoadPolygonItem[]): THREE.Mesh | null {
    if (roads.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const asphaltColor = new THREE.Color(SAIGON_PALETTES.mainAsphalt);
    const alleyColor = new THREE.Color(SAIGON_PALETTES.alleyPavement);

    for (const road of roads) {
      const col = road.isAlley ? alleyColor : asphaltColor;
      const geo = this.triangulatePolygon(road.rings, 0.08, col);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'roads_merged';
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds merged water bodies (River, canals, ponds)
   */
  public static buildWater(waterList: WaterPolygonItem[]): THREE.Mesh | null {
    if (waterList.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];
    const waterColor = new THREE.Color(SAIGON_PALETTES.tropicalWater);

    for (const water of waterList) {
      const geo = this.triangulatePolygon(water.rings, 0.03, waterColor);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!merged) return null;

    const material = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.15,
      metalness: 0.35,
      transparent: true,
      opacity: 0.92,
    });

    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'water_merged';
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds merged parks & green landuse
   */
  public static buildParks(parks: ParkPolygonItem[]): { parkMesh: THREE.Mesh | null; treeMesh: THREE.Mesh | null } {
    if (parks.length === 0) return { parkMesh: null, treeMesh: null };

    const parkGeometries: THREE.BufferGeometry[] = [];
    const parkColor = new THREE.Color(SAIGON_PALETTES.parkGreen);
    const treePositions: { x: number; z: number }[] = [];

    for (const park of parks) {
      const geo = this.triangulatePolygon(park.rings, 0.04, parkColor);
      if (geo) {
        parkGeometries.push(geo);

        // Sample tree planting locations inside park bounding box
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

          // Add a few scattered trees around the park centroid
          treePositions.push({ x: cx, z: cz });
          treePositions.push({ x: cx + 12, z: cz + 8 });
          treePositions.push({ x: cx - 10, z: cz - 12 });
          treePositions.push({ x: cx + 6, z: cz - 14 });
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
        });
        parkMesh = new THREE.Mesh(mergedParks, material);
        parkMesh.name = 'parks_merged';
        parkMesh.receiveShadow = true;
      }
    }

    // Build low-poly stylized tropical trees
    let treeMesh: THREE.Mesh | null = null;
    if (treePositions.length > 0) {
      const treeGeometries: THREE.BufferGeometry[] = [];
      const trunkColor = new THREE.Color(0x78350f);
      const canopyColor = new THREE.Color(0x22c55e);

      for (const pos of treePositions) {
        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 2.5, 6);
        trunkGeo.translate(pos.x, 1.25, pos.z);
        const trunkColors: number[] = [];
        for (let i = 0; i < trunkGeo.attributes.position.count; i++) {
          trunkColors.push(trunkColor.r, trunkColor.g, trunkColor.b);
        }
        trunkGeo.setAttribute('color', new THREE.Float32BufferAttribute(trunkColors, 3));
        treeGeometries.push(trunkGeo);

        // Foliage / Canopy (stacked low-poly cones or icosahedron)
        const canopyGeo = new THREE.ConeGeometry(2.2, 3.8, 6);
        canopyGeo.translate(pos.x, 3.8, pos.z);
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
