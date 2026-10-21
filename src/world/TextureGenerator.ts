import * as THREE from 'three';

export class TextureGenerator {
  private static roadTexture: THREE.CanvasTexture | null = null;
  private static facadeAtlas: THREE.CanvasTexture | null = null;
  private static roofTileTexture: THREE.CanvasTexture | null = null;

  /**
   * Procedural asphalt road texture with yellow dashed centerline and white side curbs
   */
  public static getRoadTexture(): THREE.CanvasTexture {
    if (this.roadTexture) return this.roadTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Dark asphalt base
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle asphalt noise
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const gray = Math.floor(45 + Math.random() * 25);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // White shoulder lines
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(14, 256);
    ctx.moveTo(242, 0);
    ctx.lineTo(242, 256);
    ctx.stroke();

    // Yellow dashed centerline
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 7;
    ctx.setLineDash([28, 20]);
    ctx.beginPath();
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 256);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 8);
    this.roadTexture = texture;
    return texture;
  }

  /**
   * Procedural architectural facade texture atlas with window grids, balconies, and floor lines
   */
  public static getFacadeAtlas(): THREE.CanvasTexture {
    if (this.facadeAtlas) return this.facadeAtlas;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 4 Quad Atlas Regions:
    // [0,0]: Saigon Residential Tube House (pastel ochre + shutter windows)
    // [256,0]: Apartment Complex (repeating white balconies + dark glass)
    // [0,256]: Modern Glass Office Tower (cyan/charcoal curtain wall)
    // [256,256]: French Colonial / School (cream walls + arched windows)

    // Region 1: Saigon Tube House
    ctx.fillStyle = '#fef3c7'; // Warm ochre
    ctx.fillRect(0, 0, 256, 256);
    for (let floor = 0; floor < 6; floor++) {
      const y = floor * 42 + 8;
      // Floor line
      ctx.fillStyle = '#d97706';
      ctx.fillRect(0, y + 36, 256, 3);
      // Windows
      for (let w = 0; w < 4; w++) {
        const x = w * 60 + 16;
        // Window frame
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y + 4, 32, 24);
        // Glass
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 3, y + 7, 26, 18);
        // Balcony railing
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 4, y + 22, 40, 10);
      }
    }

    // Region 2: Modern Apartment (Chung cư Sài Gòn)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(256, 0, 256, 256);
    for (let floor = 0; floor < 7; floor++) {
      const y = floor * 36 + 4;
      // Balcony ledge
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(256, y + 26, 256, 8);
      ctx.fillStyle = '#3b82f6'; // Blue balcony accent
      ctx.fillRect(256, y + 32, 256, 3);

      for (let w = 0; w < 6; w++) {
        const x = 256 + w * 40 + 8;
        // Dark tinted window
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x, y + 4, 26, 20);
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(x + 2, y + 6, 22, 16);
      }
    }

    // Region 3: Glass Skyscraper Curtain Wall
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 256, 256, 256);
    for (let r = 0; r < 12; r++) {
      const y = 256 + r * 21;
      // Mullion line
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, y, 256, 2);
      for (let c = 0; c < 8; c++) {
        const x = c * 32;
        ctx.fillStyle = '#475569';
        ctx.fillRect(x, 256, 2, 256);
        // Reflective glass
        const glow = (r + c) % 3 === 0 ? '#38bdf8' : '#0369a1';
        ctx.fillStyle = glow;
        ctx.fillRect(x + 3, y + 3, 27, 16);
      }
    }

    // Region 4: French Colonial / Institutional
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(256, 256, 256, 256);
    for (let floor = 0; floor < 5; floor++) {
      const y = 256 + floor * 50 + 6;
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(256, y + 42, 256, 4);

      for (let w = 0; w < 4; w++) {
        const x = 256 + w * 60 + 18;
        // Arch top window
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(x + 15, y + 14, 15, Math.PI, 0);
        ctx.rect(x, y + 14, 30, 22);
        ctx.fill();
        ctx.fillStyle = '#67e8f9';
        ctx.fillRect(x + 3, y + 16, 24, 18);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.facadeAtlas = texture;
    return texture;
  }

  /**
   * Terracotta roof tile texture with diagonal shingles
   */
  public static getRoofTileTexture(): THREE.CanvasTexture {
    if (this.roofTileTexture) return this.roofTileTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#c2410c'; // Warm terracotta
    ctx.fillRect(0, 0, 128, 128);

    // Shingle rows
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 3;
    for (let y = 0; y < 128; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();

      // Shingle vertical cuts
      const offset = (y / 16) % 2 === 0 ? 0 : 8;
      for (let x = offset; x < 128; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 16);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2, 2);
    this.roofTileTexture = texture;
    return texture;
  }
}
