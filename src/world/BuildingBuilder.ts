import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { BuildingItem, MetricPoint } from '../types/gis';
import { TextureGenerator } from './TextureGenerator';
import { SAIGON_PALETTES } from '../config/endpoints';

export interface BuiltCityResult {
  mesh: THREE.Mesh;
  totalBuildings: number;
}

export class BuildingBuilder {
  /**
   * Generates high-detail 3D building geometry matching authentic Vietnamese urban architecture:
   * - Sloped terracotta / blue hip & gable roofs on residential houses & public buildings
   * - Flat roofs with parapets, chuồng cu (stair penthouses), and stainless steel water tanks
   * - Window facade mapping on frontages, smooth solid plaster on party walls
   * - Pure solid color roof mapping (no windows or visual noise on roofs!)
   */
  public static createBuildingGeometry(building: BuildingItem): THREE.BufferGeometry | null {
    const rawOuter = building.rings[0];
    if (!rawOuter || rawOuter.length < 3) return null;

    const height = Math.max(3.5, building.height);
    const levels = Math.max(1, Math.round(height / 3.5));

    // Strip duplicate closing vertex
    const isClosed =
      rawOuter.length > 3 &&
      Math.abs(rawOuter[0].x - rawOuter[rawOuter.length - 1].x) < 0.001 &&
      Math.abs(rawOuter[0].z - rawOuter[rawOuter.length - 1].z) < 0.001;
    const outerRing = isClosed ? rawOuter.slice(0, -1) : rawOuter;
    if (outerRing.length < 3) return null;

    // Architectural typology:
    // 1. Skyscraper / Office Tower (> 35m)
    // 2. Large Apartment Block (Chung cư, 18m - 35m)
    // 3. Public Building / School / Pagoda (isHistoric / isWorship or large area)
    // 4. Saigon Tube House (Nhà ống, 7m - 18m)
    const isTower = height > 35;
    const isApartment = !isTower && height > 18 && outerRing.length >= 4;
    const isPublic = building.isHistoric || building.isWorship;
    // Sloped roofs on 45% of residential tube houses and all public schools/pagodas
    const hasSlopedRoof =
      (isPublic || (!isTower && !isApartment && outerRing.length === 4)) &&
      (building.id.charCodeAt(building.id.length - 1) % 2 === 0);

    // Prepare coordinates for earcut
    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outerRing.length; i++) {
      flatCoords.push(outerRing[i].x, outerRing[i].z);
    }

    for (let h = 1; h < building.rings.length; h++) {
      const rawHole = building.rings[h];
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

    const roofIndices = earcut(flatCoords, holeIndices, 2);
    if (roofIndices.length === 0) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];

    // Colors
    const baseColor = new THREE.Color(building.color);
    let roofColor: THREE.Color;

    if (hasSlopedRoof) {
      // Vibrant terracotta red / orange roof or cobalt blue metal roof as in reference image!
      const roofPalette = [
        SAIGON_PALETTES.terracottaRoof, // 0xdc2626
        SAIGON_PALETTES.crimsonRoof,    // 0xb91c1c
        SAIGON_PALETTES.orangeRoof,     // 0xea580c
        SAIGON_PALETTES.blueRoof,       // 0x2563eb
        SAIGON_PALETTES.sapphireRoof,   // 0x1d4ed8
      ];
      const rIdx = building.id.charCodeAt(0) % roofPalette.length;
      roofColor = new THREE.Color(roofPalette[rIdx]);
    } else if (isTower) {
      roofColor = new THREE.Color(SAIGON_PALETTES.towerSlate); // Dark flat mechanical roof
    } else {
      roofColor = new THREE.Color(SAIGON_PALETTES.flatRoofConcrete); // Clean concrete patio roof
    }

    const wallColor = baseColor.clone();
    const trimColor = wallColor.clone().multiplyScalar(0.75);

    // UV Base Coordinates in Texture Atlas:
    // Solid White: U in [0.5, 1.0], V in [0.5, 1.0]. Center: (0.75, 0.75)
    // Tube House:  U in [0.0, 0.5], V in [0.0, 0.5]
    // Apartment:   U in [0.5, 1.0], V in [0.0, 0.5]
    // Tower:       U in [0.0, 0.5], V in [0.5, 1.0]
    let uvBaseU = 0.0;
    let uvBaseV = 0.0;
    if (isTower) {
      uvBaseU = 0.0;
      uvBaseV = 0.5;
    } else if (isApartment) {
      uvBaseU = 0.5;
      uvBaseV = 0.0;
    } else {
      uvBaseU = 0.0;
      uvBaseV = 0.0;
    }

    // 1. ROOF GENERATION: SLOPED GABLE/HIP ROOF OR FLAT ROOF WITH PARAPET
    if (hasSlopedRoof && outerRing.length === 4) {
      // Pitched Hip Roof with central ridge
      const p0 = outerRing[0];
      const p1 = outerRing[1];
      const p2 = outerRing[2];
      const p3 = outerRing[3];

      const len01 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const len12 = Math.hypot(p2.x - p1.x, p2.z - p1.z);

      const ridgeH = height + (isPublic ? 4.2 : 2.6);

      let r0 = { x: 0, z: 0 };
      let r1 = { x: 0, z: 0 };

      if (len01 >= len12) {
        // Ridge runs along edge 01 / 32
        const ridgeRatio = Math.max(0.15, (len01 - len12) / (len01 * 2));
        const mid03 = { x: (p0.x + p3.x) / 2, z: (p0.z + p3.z) / 2 };
        const mid12 = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };

        r0 = {
          x: mid03.x + (mid12.x - mid03.x) * ridgeRatio,
          z: mid03.z + (mid12.z - mid03.z) * ridgeRatio,
        };
        r1 = {
          x: mid12.x + (mid03.x - mid12.x) * ridgeRatio,
          z: mid12.z + (mid03.z - mid12.z) * ridgeRatio,
        };
      } else {
        // Ridge runs along edge 12 / 03
        const ridgeRatio = Math.max(0.15, (len12 - len01) / (len12 * 2));
        const mid01 = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
        const mid32 = { x: (p3.x + p2.x) / 2, z: (p3.z + p2.z) / 2 };

        r0 = {
          x: mid01.x + (mid32.x - mid01.x) * ridgeRatio,
          z: mid01.z + (mid32.z - mid01.z) * ridgeRatio,
        };
        r1 = {
          x: mid32.x + (mid01.x - mid32.x) * ridgeRatio,
          z: mid32.z + (mid01.z - mid32.z) * ridgeRatio,
        };
      }

      // Add roof triangles: Hip roof has 4 faces
      const addRoofTriangle = (ptA: MetricPoint, ptB: MetricPoint, ptC: MetricPoint, hA: number, hB: number, hC: number) => {
        positions.push(ptA.x, hA, ptA.z);
        positions.push(ptB.x, hB, ptB.z);
        positions.push(ptC.x, hC, ptC.z);

        // Calculate upward-facing normal
        const v1x = ptB.x - ptA.x;
        const v1y = hB - hA;
        const v1z = ptB.z - ptA.z;
        const v2x = ptC.x - ptA.x;
        const v2y = hC - hA;
        const v2z = ptC.z - ptA.z;
        let nx = v1y * v2z - v1z * v2y;
        let ny = v1z * v2x - v1x * v2z;
        let nz = v1x * v2y - v1y * v2x;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const len = Math.hypot(nx, ny, nz) || 1;
        for (let k = 0; k < 3; k++) {
          normals.push(nx / len, ny / len, nz / len);
          colors.push(roofColor.r, roofColor.g, roofColor.b);
          // Pure solid white quadrant: Guaranteed zero window decals on roofs!
          uvs.push(0.75, 0.75);
        }
      };

      if (len01 >= len12) {
        // Face 1: p0, p1, r1, r0 (quad split into 2 tris)
        addRoofTriangle(p0, p1, r1, height, height, ridgeH);
        addRoofTriangle(p0, r1, r0, height, ridgeH, ridgeH);
        // Face 2: p1, p2, r1 (triangle)
        addRoofTriangle(p1, p2, r1, height, height, ridgeH);
        // Face 3: p2, p3, r0, r1 (quad)
        addRoofTriangle(p2, p3, r0, height, height, ridgeH);
        addRoofTriangle(p2, r0, r1, height, ridgeH, ridgeH);
        // Face 4: p3, p0, r0 (triangle)
        addRoofTriangle(p3, p0, r0, height, height, ridgeH);
      } else {
        addRoofTriangle(p1, p2, r1, height, height, ridgeH);
        addRoofTriangle(p1, r1, r0, height, ridgeH, ridgeH);
        addRoofTriangle(p2, p3, r1, height, height, ridgeH);
        addRoofTriangle(p3, p0, r0, height, height, ridgeH);
        addRoofTriangle(p3, r0, r1, height, ridgeH, ridgeH);
        addRoofTriangle(p0, p1, r0, height, height, ridgeH);
      }
    } else {
      // Flat Roof with guaranteed upward (+Y) normal and solid white UV mapping
      for (let i = 0; i < roofIndices.length; i += 3) {
        let p0 = { x: flatCoords[roofIndices[i] * 2], z: flatCoords[roofIndices[i] * 2 + 1] };
        let p1 = { x: flatCoords[roofIndices[i + 1] * 2], z: flatCoords[roofIndices[i + 1] * 2 + 1] };
        let p2 = { x: flatCoords[roofIndices[i + 2] * 2], z: flatCoords[roofIndices[i + 2] * 2 + 1] };

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

        positions.push(p0.x, height, p0.z);
        positions.push(p1.x, height, p1.z);
        positions.push(p2.x, height, p2.z);

        normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);

        colors.push(roofColor.r, roofColor.g, roofColor.b);
        colors.push(roofColor.r, roofColor.g, roofColor.b);
        colors.push(roofColor.r, roofColor.g, roofColor.b);

        // Pure solid white UV: Concrete roof is 100% clean, no windows or garbage textures!
        uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
      }
    }

    // 2. VERTICAL WALLS WITH ARCHITECTURAL UV MAPPING
    const isTubeHouse = !isTower && !isApartment && outerRing.length === 4;

    const addWallForRing = (ring: MetricPoint[], isHole = false) => {
      const len = ring.length;

      // Determine party walls for tube houses: shorter sides are front/back, longer sides are party walls
      let sideLengths: number[] = [];
      if (isTubeHouse && !isHole) {
        for (let i = 0; i < len; i++) {
          const nextIdx = (i + 1) % len;
          const dx = ring[nextIdx].x - ring[i].x;
          const dz = ring[nextIdx].z - ring[i].z;
          sideLengths.push(Math.hypot(dx, dz));
        }
      }

      for (let i = 0; i < len; i++) {
        const nextIdx = (i + 1) % len;
        const pCurrent = ring[i];
        const pNext = ring[nextIdx];

        const dx = pNext.x - pCurrent.x;
        const dz = pNext.z - pCurrent.z;
        const segLen = Math.hypot(dx, dz);
        if (segLen < 0.1) continue;

        let nx = dz / segLen;
        let nz = -dx / segLen;
        if (isHole) {
          nx = -nx;
          nz = -nz;
        }

        const v0 = [pCurrent.x, 0, pCurrent.z];
        const v1 = [pNext.x, 0, pNext.z];
        const v2 = [pNext.x, height, pNext.z];
        const v3 = [pCurrent.x, height, pCurrent.z];

        // Is this a party wall? In tube houses, the two longer sides touch neighboring walls
        // and have smooth solid plaster (no windows), while the two shorter sides have windows & balconies
        const isPartyWall =
          isTubeHouse &&
          !isHole &&
          sideLengths.length === 4 &&
          segLen > Math.min(sideLengths[0], sideLengths[1], sideLengths[2], sideLengths[3]) * 1.3;

        let u0 = 0.75;
        let u1 = 0.75;
        let v0_uv = 0.75;
        let v1_uv = 0.75;

        if (!isPartyWall) {
          // Front / Rear facade or tower facade with windows
          const numBays = Math.max(1, Math.round(segLen / 3.8));
          u0 = uvBaseU;
          u1 = uvBaseU + Math.min(0.48, numBays * 0.125);
          v0_uv = uvBaseV;
          v1_uv = uvBaseV + Math.min(0.48, (levels / 6.0) * 0.48);
        }

        // Triangle 1: V0 -> V1 -> V2
        positions.push(...v0, ...v1, ...v2);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(
          wallColor.r, wallColor.g, wallColor.b,
          wallColor.r, wallColor.g, wallColor.b,
          wallColor.r, wallColor.g, wallColor.b
        );
        uvs.push(u0, v0_uv, u1, v0_uv, u1, v1_uv);

        // Triangle 2: V0 -> V2 -> V3
        positions.push(...v0, ...v2, ...v3);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(
          wallColor.r, wallColor.g, wallColor.b,
          wallColor.r, wallColor.g, wallColor.b,
          wallColor.r, wallColor.g, wallColor.b
        );
        uvs.push(u0, v0_uv, u1, v1_uv, u0, v1_uv);

        // Rooftop Parapet border (0.45m wall around flat roofs)
        if (!hasSlopedRoof) {
          const vTop0 = [pCurrent.x, height, pCurrent.z];
          const vTop1 = [pNext.x, height, pNext.z];
          const vLip0 = [pCurrent.x, height + 0.45, pCurrent.z];
          const vLip1 = [pNext.x, height + 0.45, pNext.z];

          positions.push(...vTop0, ...vTop1, ...vLip1);
          normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
          colors.push(
            trimColor.r, trimColor.g, trimColor.b,
            trimColor.r, trimColor.g, trimColor.b,
            trimColor.r, trimColor.g, trimColor.b
          );
          uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);

          positions.push(...vTop0, ...vLip1, ...vLip0);
          normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
          colors.push(
            trimColor.r, trimColor.g, trimColor.b,
            trimColor.r, trimColor.g, trimColor.b,
            trimColor.r, trimColor.g, trimColor.b
          );
          uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
        }
      }
    };

    addWallForRing(outerRing, false);
    for (let h = 1; h < building.rings.length; h++) {
      const hRing = building.rings[h];
      const hClean =
        hRing.length > 3 && hRing[0].x === hRing[hRing.length - 1].x
          ? hRing.slice(0, -1)
          : hRing;
      addWallForRing(hClean, true);
    }

    // 3. ROOFTOP STRUCTURES: CHUỒNG CU & BỒN NƯỚC INOX (For flat-roofed houses)
    if (!hasSlopedRoof && height >= 7.0 && outerRing.length >= 4) {
      let cx = 0;
      let cz = 0;
      for (const pt of outerRing) {
        cx += pt.x;
        cz += pt.z;
      }
      cx /= outerRing.length;
      cz /= outerRing.length;

      const roomW = 1.3;
      const roomH = 2.2;
      const rx0 = cx - roomW;
      const rx1 = cx + roomW;
      const rz0 = cz - roomW;
      const rz1 = cz + roomW;
      const ry0 = height;
      const ry1 = height + roomH;

      const roomQuads = [
        [[rx0, ry0, rz0], [rx1, ry0, rz0], [rx1, ry1, rz0], [rx0, ry1, rz0], [0, 0, -1]],
        [[rx1, ry0, rz0], [rx1, ry0, rz1], [rx1, ry1, rz1], [rx1, ry1, rz0], [1, 0, 0]],
        [[rx1, ry0, rz1], [rx0, ry0, rz1], [rx0, ry1, rz1], [rx0, ry1, rz1], [0, 0, 1]],
        [[rx0, ry0, rz1], [rx0, ry0, rz0], [rx0, ry1, rz0], [rx0, ry1, rz1], [-1, 0, 0]],
      ];

      for (const [w0, w1, w2, w3, n] of roomQuads) {
        positions.push(...w0, ...w1, ...w2);
        normals.push(...n, ...n, ...n);
        colors.push(0.92, 0.92, 0.94, 0.92, 0.92, 0.94, 0.92, 0.92, 0.94);
        uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);

        positions.push(...w0, ...w2, ...w3);
        normals.push(...n, ...n, ...n);
        colors.push(0.92, 0.92, 0.94, 0.92, 0.92, 0.94, 0.92, 0.92, 0.94);
        uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
      }

      // Chuồng cu roof
      positions.push(rx0, ry1, rz0, rx1, ry1, rz0, rx1, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.5, 0.55, 0.6, 0.5, 0.55, 0.6, 0.5, 0.55, 0.6);
      uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);

      positions.push(rx0, ry1, rz0, rx1, ry1, rz1, rx0, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.5, 0.55, 0.6, 0.5, 0.55, 0.6, 0.5, 0.55, 0.6);
      uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);

      // Stainless Steel Water Tank (Bồn nước Tân Á Đại Thành)
      const tankX = cx + roomW + 0.8;
      const tankZ = cz;
      const tankY = height + 0.5;
      const tankR = 0.55;
      const tankH = 1.0;

      for (let s = 0; s < 6; s++) {
        const a1 = (s * Math.PI * 2) / 6;
        const a2 = ((s + 1) * Math.PI * 2) / 6;
        const tx1 = tankX + Math.cos(a1) * tankR;
        const tz1 = tankZ + Math.sin(a1) * tankR;
        const tx2 = tankX + Math.cos(a2) * tankR;
        const tz2 = tankZ + Math.sin(a2) * tankR;

        positions.push(tx1, tankY, tz1, tx2, tankY, tz2, tx2, tankY + tankH, tz2);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        colors.push(0.88, 0.92, 0.96, 0.88, 0.92, 0.96, 0.88, 0.92, 0.96);
        uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);

        positions.push(tx1, tankY, tz1, tx2, tankY + tankH, tz2, tx1, tankY + tankH, tz1);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        colors.push(0.88, 0.92, 0.96, 0.88, 0.92, 0.96, 0.88, 0.92, 0.96);
        uvs.push(0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    return geometry;
  }

  /**
   * Merges all buildings into 1 Draw Call with architectural facade texture atlas
   */
  public static buildCityMesh(buildings: BuildingItem[]): BuiltCityResult | null {
    if (buildings.length === 0) return null;

    const geometries: THREE.BufferGeometry[] = [];

    for (const bld of buildings) {
      const geo = this.createBuildingGeometry(bld);
      if (geo) geometries.push(geo);
    }

    if (geometries.length === 0) return null;

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();

    if (!mergedGeometry) return null;

    const facadeTexture = TextureGenerator.getFacadeAtlas();

    const material = new THREE.MeshStandardMaterial({
      map: facadeTexture,
      vertexColors: true,
      roughness: 0.78, // Crisp matte plaster wall, never glossy
      metalness: 0.02, // Low metalness guarantees vibrant pastel colors!
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(mergedGeometry, material);
    mesh.name = 'building_city_merged';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return {
      mesh,
      totalBuildings: buildings.length,
    };
  }
}
