import * as THREE from 'three';

export class TextureGenerator {
  private static roadTexture: THREE.CanvasTexture | null = null;
  private static alleyTexture: THREE.CanvasTexture | null = null;
  private static facadeAtlas: THREE.CanvasTexture | null = null;

  /**
   * Procedural asphalt road texture with crisp yellow dashed centerline and white shoulder lines
   */
  public static getRoadTexture(): THREE.CanvasTexture {
    if (this.roadTexture) return this.roadTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Clean dark matte asphalt matching reference image
    ctx.fillStyle = '#23272f';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle fine asphalt micro-grain
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const gray = Math.floor(30 + Math.random() * 15);
      ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Crisp white shoulder lines (both edges)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.lineTo(28, 512);
    ctx.moveTo(484, 0);
    ctx.lineTo(484, 512);
    ctx.stroke();

    // Golden yellow dashed centerline
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 8;
    ctx.setLineDash([48, 32]);
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 1);
    this.roadTexture = texture;
    return texture;
  }

  /**
   * Procedural Saigon Alley pavement texture (concrete pavers, no centerlines, subtle drainage lines)
   */
  public static getAlleyTexture(): THREE.CanvasTexture {
    if (this.alleyTexture) return this.alleyTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Light slate alley concrete
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, 256, 256);

    // Interlocking concrete paving grid
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    for (let y = 0; y <= 256; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y);
      ctx.stroke();
    }
    for (let y = 0; y < 256; y += 32) {
      const offset = (y / 32) % 2 === 0 ? 0 : 32;
      for (let x = offset; x <= 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 32);
        ctx.stroke();
      }
    }

    // Subtle edge drainage gutters
    ctx.fillStyle = '#334155';
    ctx.fillRect(8, 0, 8, 256);
    ctx.fillRect(240, 0, 8, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, 4);
    this.alleyTexture = texture;
    return texture;
  }

  /**
   * Architectural Facade & Mask Texture Atlas (1024x1024)
   *
   * Coordinates in Three.js UV space (with flipY = true):
   * - Top-Right [U: 0.5..1.0, V: 0.5..1.0]: PURE 100% SOLID WHITE (#ffffff)
   *   Used for: Sloped terracotta/blue roofs, flat concrete roofs, parapets, water tanks,
   *   and plain side walls. GUARANTEES ZERO TEXTURE NOISE ON ROOFS!
   *
   * - Bottom-Left [U: 0.0..0.5, V: 0.0..0.5]: Saigon Tube House Facade (Nhà Phố)
   *   Pure white wall base (#ffffff), floor separation bands, dark glass windows,
   *   white balcony slabs, dark metal railings, ground-floor shopfronts.
   *
   * - Bottom-Right [U: 0.5..1.0, V: 0.0..0.5]: Saigon Apartment Block (Chung Cư)
   *   Pure white wall base (#ffffff), continuous horizontal balconies, rhythmic windows.
   *
   * - Top-Left [U: 0.0..0.5, V: 0.5..1.0]: Corporate Tower / Landmark Curtain Wall
   *   Reflective sapphire & cyan glass curtain wall with crisp mullions.
   */
  public static getFacadeAtlas(): THREE.CanvasTexture {
    if (this.facadeAtlas) return this.facadeAtlas;

    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    // 1. QUADRANT TOP-RIGHT: Pure Solid White Region (x: 512..1024, y: 0..512)
    // Three.js UV: U in [0.5, 1.0], V in [0.5, 1.0]. Center UV: (0.75, 0.75)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(512, 0, 512, 512);

    // 2. QUADRANT TOP-LEFT: Corporate Glass Tower (x: 0..512, y: 0..512)
    // Three.js UV: U in [0.0, 0.5], V in [0.5, 1.0]
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 512, 512);

    // Grid of reflective glass panes
    const towerRows = 16;
    const towerCols = 10;
    const colW = 512 / towerCols;
    const rowH = 512 / towerRows;

    for (let r = 0; r < towerRows; r++) {
      const y = r * rowH;
      for (let c = 0; c < towerCols; c++) {
        const x = c * colW;
        // Glass pane reflection variations
        const isCyan = (r + c * 3) % 4 === 0;
        const isSky = (r * 2 + c) % 5 === 0;
        ctx.fillStyle = isCyan ? '#0284c7' : isSky ? '#38bdf8' : '#0f172a';
        ctx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);

        // Mullion border
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, colW, rowH);
      }
    }

    // 3. QUADRANT BOTTOM-LEFT: Saigon Tube House (x: 0..512, y: 512..1024)
    // Three.js UV: U in [0.0, 0.5], V in [0.0, 0.5]
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 512, 512, 512);

    const houseFloors = 6;
    const floorH = 512 / houseFloors;

    for (let fl = 0; fl < houseFloors; fl++) {
      const y = 512 + fl * floorH;

      // Floor separation band (gờ phào chỉ phân tầng)
      ctx.fillStyle = '#f1f5f9';
      ctx.fillRect(0, y + floorH - 8, 512, 8);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(0, y + floorH - 2, 512, 2);

      if (fl === houseFloors - 1) {
        // Ground Floor: Roll-up shutter / glass storefront (cửa cuốn / cửa kính)
        for (let b = 0; b < 4; b++) {
          const bx = b * 128;
          // Storefront frame
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(bx + 16, y + 12, 96, floorH - 24);
          // Dark reflective glass / roll-up slats
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx + 22, y + 18, 84, floorH - 34);
          // Store signage band
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(bx + 16, y + 4, 96, 12);
        }
      } else {
        // Upper Residential Floors: Windows & Balconies
        for (let b = 0; b < 4; b++) {
          const bx = b * 128;

          // Crisp white window surround
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(bx + 24, y + 8, 80, floorH - 24);

          // Deep dark reflective glass
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(bx + 28, y + 12, 72, floorH - 32);

          // Diagonal sky reflection highlight
          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.moveTo(bx + 32, y + 14);
          ctx.lineTo(bx + 68, y + 14);
          ctx.lineTo(bx + 32, y + 42);
          ctx.closePath();
          ctx.fill();

          // White Balcony Slab
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(bx + 18, y + floorH - 22, 92, 14);
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx + 18, y + floorH - 22, 92, 14);

          // Balcony dark metal railing
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx + 20, y + floorH - 30, 88, 10);
          for (let rx = bx + 26; rx < bx + 104; rx += 8) {
            ctx.beginPath();
            ctx.moveTo(rx, y + floorH - 30);
            ctx.lineTo(rx, y + floorH - 20);
            ctx.stroke();
          }
        }
      }
    }

    // 4. QUADRANT BOTTOM-RIGHT: Modern Saigon Apartment Block (x: 512..1024, y: 512..1024)
    // Three.js UV: U in [0.5, 1.0], V in [0.0, 0.5]
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(512, 512, 512, 512);

    const aptFloors = 7;
    const aptFloorH = 512 / aptFloors;

    for (let fl = 0; fl < aptFloors; fl++) {
      const y = 512 + fl * aptFloorH;

      // Continuous white cantilever balcony slab
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(512, y + aptFloorH - 22, 512, 16);
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(512, y + aptFloorH - 6, 512, 3);

      // Balcony railing
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(512, y + aptFloorH - 28);
      ctx.lineTo(1024, y + aptFloorH - 28);
      ctx.stroke();

      // Window rhythmic openings
      for (let w = 0; w < 6; w++) {
        const wx = 512 + w * 85 + 14;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(wx, y + 8, 56, aptFloorH - 38);

        // Subtle cyan sky reflection
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(wx + 4, y + 12, 48, 18);
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    this.facadeAtlas = texture;
    return texture;
  }
}
