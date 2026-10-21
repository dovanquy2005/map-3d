import * as THREE from 'three';

export class TextureGenerator {
  private static roadTexture: THREE.CanvasTexture | null = null;
  private static facadeAtlas: THREE.CanvasTexture | null = null;

  /**
   * Procedural asphalt road texture with clean yellow dashed centerline and white shoulder lines
   */
  public static getRoadTexture(): THREE.CanvasTexture {
    if (this.roadTexture) return this.roadTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Clean dark slate asphalt
    ctx.fillStyle = '#334155';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle fine asphalt texture
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const gray = Math.floor(48 + Math.random() * 20);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }

    // White shoulder lines
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(16, 256);
    ctx.moveTo(240, 0);
    ctx.lineTo(240, 256);
    ctx.stroke();

    // Yellow dashed centerline
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 7;
    ctx.setLineDash([32, 24]);
    ctx.beginPath();
    ctx.moveTo(128, 0);
    ctx.lineTo(128, 256);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 4);
    this.roadTexture = texture;
    return texture;
  }

  /**
   * Crisp White Architectural Mask Atlas.
   * Because the wall base is pure white (#ffffff), multiplying by building vertexColors
   * preserves 100% of the vibrant, clean wall colors (yellow, mint, coral, cream)
   * while giving crisp dark windows and white balcony trims!
   */
  public static getFacadeAtlas(): THREE.CanvasTexture {
    if (this.facadeAtlas) return this.facadeAtlas;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 4 Atlas Quadrants (all with pure white wall base):
    // [0,0] to [256,256]: Saigon Tube House (Rộng 4m, ban công trắng, cửa sổ kính)
    // [256,0] to [512,256]: Modern Apartment (Chung cư ban công dài, cửa sổ lặp nhịp)
    // [0,256] to [256,512]: Corporate Tower / Landmark (Kính phản quang, lam chắn nắng)
    // [256,256] to [512,512]: Clean Roofs & Utility Surfaces (Mái ngói, sân thượng)

    // Quadrant 1: Saigon Tube House
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);

    for (let floor = 0; floor < 6; floor++) {
      const y = floor * 42 + 4;
      // Floor separation band (gờ chỉ phân tầng)
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, y + 36, 256, 4);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, y + 39, 256, 1.5);

      // Windows & Balconies
      for (let w = 0; w < 4; w++) {
        const x = w * 60 + 16;
        // White window frame
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(x - 2, y + 4, 34, 26);
        // Dark reflective glass
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x, y + 6, 30, 22);
        // Sky reflection highlight
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(x + 2, y + 8, 26, 10);

        // White Balcony railing
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - 4, y + 24, 38, 8);
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - 4, y + 24, 38, 8);
      }
    }

    // Quadrant 2: Modern Apartment (Chung cư Sài Gòn)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(256, 0, 256, 256);

    for (let floor = 0; floor < 7; floor++) {
      const y = floor * 36 + 4;
      // Continuous white balcony slab
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(256, y + 24, 256, 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(256, y + 31, 256, 2);

      for (let w = 0; w < 6; w++) {
        const x = 256 + w * 40 + 8;
        // Window opening
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(x, y + 4, 26, 19);
        // Cyan glass reflection
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(x + 2, y + 6, 22, 14);
      }
    }

    // Quadrant 3: Corporate Tower Curtain Wall
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 256, 256, 256);

    for (let r = 0; r < 12; r++) {
      const y = 256 + r * 21;
      // White mullion grid lines
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, y, 256, 2);

      for (let c = 0; c < 8; c++) {
        const x = c * 32;
        ctx.fillStyle = '#64748b';
        ctx.fillRect(x, 256, 2, 256);

        // Reflective cyan / sapphire glass panes
        const isBright = (r + c) % 2 === 0;
        ctx.fillStyle = isBright ? '#38bdf8' : '#0284c7';
        ctx.fillRect(x + 3, y + 3, 27, 16);
      }
    }

    // Quadrant 4: Clean Roof & Plain Wall Region
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(256, 256, 256, 256);
    // Subtle rooftop border pattern
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.strokeRect(260, 260, 248, 248);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.facadeAtlas = texture;
    return texture;
  }
}
