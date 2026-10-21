import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import earcut from 'earcut';
import { BuildingItem, MetricPoint } from '../types/gis';
import { TextureGenerator } from './TextureGenerator';

export interface BuiltCityResult {
  mesh: THREE.Mesh;
  totalBuildings: number;
}

export class BuildingBuilder {
  /**
   * Generates high-detail 3D building geometry matching authentic Vietnamese urban architecture:
   * - Sloped terracotta / blue gable roofs on residential houses & public buildings
   * - Flat roofs with parapets, chuồng cu (stair penthouses), and stainless steel water tanks
   * - Procedural UV mapping for realistic windows, balconies, and floor lines
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

    // Determine architectural typology:
    // 1. Skyscraper / Office Tower (> 35m)
    // 2. Large Apartment Block (Chung cư, 18m - 35m)
    // 3. Public Building / School / Pagoda (isHistoric / isWorship or large area)
    // 4. Saigon Tube House (Nhà ống, 7m - 18m)
    const isTower = height > 35;
    const isApartment = !isTower && height > 18 && outerRing.length >= 4;
    const isPublic = building.isHistoric || building.isWorship;
    // 40% of residential houses and public buildings have sloped hip/gable roofs like in the sample image!
    const hasSlopedRoof = (isPublic || (!isTower && !isApartment && (outerRing.length === 4 || outerRing.length === 5))) && (building.id.charCodeAt(building.id.length - 1) % 2 === 0);

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
      // Vibrant terracotta red / orange roof or blue metal sheet roof as in reference image!
      const roofPalette = [0xdc2626, 0xea580c, 0xc2410c, 0x2563eb];
      const rIdx = building.id.charCodeAt(0) % roofPalette.length;
      roofColor = new THREE.Color(roofPalette[rIdx]);
    } else if (isTower) {
      roofColor = new THREE.Color(0x1e293b); // Dark flat mechanical roof
    } else {
      roofColor = new THREE.Color(0xd4d4d8); // Light concrete / gravel roof with patio
    }

    const wallColor = baseColor.clone();
    const trimColor = wallColor.clone().multiplyScalar(0.7);

    // UV Offset selection in Texture Atlas:
    // [0, 0] to [0.5, 0.5]: Tube House
    // [0.5, 0] to [1, 0.5]: Apartment
    // [0, 0.5] to [0.5, 1]: Skyscraper
    // [0.5, 0.5] to [1, 1]: Colonial / School
    let uvBaseU = 0.0;
    let uvBaseV = 0.0;
    if (isTower) {
      uvBaseU = 0.0;
      uvBaseV = 0.5;
    } else if (isApartment) {
      uvBaseU = 0.5;
      uvBaseV = 0.0;
    } else if (isPublic) {
      uvBaseU = 0.5;
      uvBaseV = 0.5;
    } else {
      uvBaseU = 0.0;
      uvBaseV = 0.0;
    }

    // 1. ROOF GENERATION: SLOPED GABLE ROOF OR FLAT ROOF WITH PARAPET
    if (hasSlopedRoof && outerRing.length === 4) {
      // Sloped Hip / Gable Roof
      let cx = 0;
      let cz = 0;
      for (const pt of outerRing) {
        cx += pt.x;
        cz += pt.z;
      }
      cx /= 4;
      cz /= 4;

      const ridgeH = height + (isPublic ? 4.5 : 2.5);
      // Create pitched roof pyramid / ridge triangles
      for (let i = 0; i < 4; i++) {
        const next = (i + 1) % 4;
        const p1 = outerRing[i];
        const p2 = outerRing[next];

        // Triangle from base wall edge to roof peak
        positions.push(p1.x, height, p1.z);
        positions.push(p2.x, height, p2.z);
        positions.push(cx, ridgeH, cz);

        // Compute upward sloped normal
        const v1x = p2.x - p1.x;
        const v1y = 0;
        const v1z = p2.z - p1.z;
        const v2x = cx - p1.x;
        const v2y = ridgeH - height;
        const v2z = cz - p1.z;
        const nx = v1y * v2z - v1z * v2y;
        const ny = v1z * v2x - v1x * v2z;
        const nz = v1x * v2y - v1y * v2x;
        const len = Math.hypot(nx, ny, nz) || 1;

        normals.push(nx / len, Math.abs(ny / len), nz / len);
        normals.push(nx / len, Math.abs(ny / len), nz / len);
        normals.push(nx / len, Math.abs(ny / len), nz / len);

        colors.push(roofColor.r, roofColor.g, roofColor.b);
        colors.push(roofColor.r, roofColor.g, roofColor.b);
        colors.push(roofColor.r, roofColor.g, roofColor.b);

        uvs.push(0, 0, 1, 0, 0.5, 1);
      }
    } else {
      // Flat Roof with guaranteed UPWARD Normal (+Y)
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

        uvs.push(0.1, 0.1, 0.4, 0.1, 0.4, 0.4);
      }
    }

    // 2. VERTICAL WALLS WITH TEXTURE UV MAPPING
    const addWallForRing = (ring: MetricPoint[], isHole = false) => {
      const len = ring.length;
      let cumDist = 0;

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

        // UV coordinates mapping to Atlas
        const u0 = uvBaseU + (cumDist % 8) / 16;
        const u1 = uvBaseU + ((cumDist + segLen) % 8) / 16;
        const v0_uv = uvBaseV;
        const v1_uv = uvBaseV + Math.min(0.48, (levels * 0.08));

        cumDist += segLen;

        // Triangle 1: V0 -> V1 -> V2
        positions.push(...v0, ...v1, ...v2);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(wallColor.r, wallColor.g, wallColor.b, wallColor.r, wallColor.g, wallColor.b, wallColor.r, wallColor.g, wallColor.b);
        uvs.push(u0, v0_uv, u1, v0_uv, u1, v1_uv);

        // Triangle 2: V0 -> V2 -> V3
        positions.push(...v0, ...v2, ...v3);
        normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
        colors.push(wallColor.r, wallColor.g, wallColor.b, wallColor.r, wallColor.g, wallColor.b, wallColor.r, wallColor.g, wallColor.b);
        uvs.push(u0, v0_uv, u1, v1_uv, u0, v1_uv);

        // Rooftop Parapet border (0.4m wall around flat roofs)
        if (!hasSlopedRoof) {
          const vTop0 = [pCurrent.x, height, pCurrent.z];
          const vTop1 = [pNext.x, height, pNext.z];
          const vLip0 = [pCurrent.x, height + 0.45, pCurrent.z];
          const vLip1 = [pNext.x, height + 0.45, pNext.z];

          positions.push(...vTop0, ...vTop1, ...vLip1);
          normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
          colors.push(trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b);
          uvs.push(0, 0, 1, 0, 1, 1);

          positions.push(...vTop0, ...vLip1, ...vLip0);
          normals.push(nx, 0, nz, nx, 0, nz, nx, 0, nz);
          colors.push(trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b, trimColor.r, trimColor.g, trimColor.b);
          uvs.push(0, 0, 1, 1, 0, 1);
        }
      }
    };

    addWallForRing(outerRing, false);
    for (let h = 1; h < building.rings.length; h++) {
      const hRing = building.rings[h];
      const hClean = (hRing.length > 3 && hRing[0].x === hRing[hRing.length - 1].x) ? hRing.slice(0, -1) : hRing;
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
        colors.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
        uvs.push(0, 0, 1, 0, 1, 1);

        positions.push(...w0, ...w2, ...w3);
        normals.push(...n, ...n, ...n);
        colors.push(0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9);
        uvs.push(0, 0, 1, 1, 0, 1);
      }

      // Chuồng cu roof
      positions.push(rx0, ry1, rz0, rx1, ry1, rz0, rx1, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.4, 0.45, 0.5, 0.4, 0.45, 0.5, 0.4, 0.45, 0.5);
      uvs.push(0, 0, 1, 0, 1, 1);

      positions.push(rx0, ry1, rz0, rx1, ry1, rz1, rx0, ry1, rz1);
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      colors.push(0.4, 0.45, 0.5, 0.4, 0.45, 0.5, 0.4, 0.45, 0.5);
      uvs.push(0, 0, 1, 1, 0, 1);

      // Stainless Steel Water Tank (Bồn nước Tân Á Đại Thành)
      const tankX = cx + roomW + 0.8;
      const tankZ = cz;
      const tankY = height + 0.5;
      const tankR = 0.55;
      const tankH = 1.0;
      // Cylinder approximated as small prism
      for (let s = 0; s < 6; s++) {
        const a1 = (s * Math.PI * 2) / 6;
        const a2 = ((s + 1) * Math.PI * 2) / 6;
        const tx1 = tankX + Math.cos(a1) * tankR;
        const tz1 = tankZ + Math.sin(a1) * tankR;
        const tx2 = tankX + Math.cos(a2) * tankR;
        const tz2 = tankZ + Math.sin(a2) * tankR;

        positions.push(tx1, tankY, tz1, tx2, tankY, tz2, tx2, tankY + tankH, tz2);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        colors.push(0.85, 0.9, 0.95, 0.85, 0.9, 0.95, 0.85, 0.9, 0.95);
        uvs.push(0, 0, 1, 0, 1, 1);

        positions.push(tx1, tankY, tz1, tx2, tankY + tankH, tz2, tx1, tankY + tankH, tz1);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        colors.push(0.85, 0.9, 0.95, 0.85, 0.9, 0.95, 0.85, 0.9, 0.95);
        uvs.push(0, 0, 1, 1, 0, 1);
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
      roughness: 0.65,
      metalness: 0.15,
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
