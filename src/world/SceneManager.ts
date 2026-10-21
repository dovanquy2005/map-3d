import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public renderer: THREE.WebGLRenderer;
  public orbitControls: OrbitControls;
  public sunLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public headlight: THREE.SpotLight | null = null;

  private container: HTMLElement;
  private animFrameId: number | null = null;
  private cameraMode: 'orbit' | 'shipper' = 'orbit';

  // Stats calculation
  private lastTime: number = performance.now();
  private frameCount: number = 0;
  public currentFps: number = 60;

  // Custom update hooks (e.g. shipper controller)
  private updateHooks: Array<(deltaTime: number) => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdbeafe); // Soft Saigon daylight sky
    this.scene.fog = new THREE.FogExp2(0xdbeafe, 0.00018); // Gentle atmospheric perspective for 2.2km panorama

    // 2. Camera setup - Isometric SimCity Perspective (FOV 40, tilted ~53° as shown in reference)
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(40, width / height, 1, 10000);
    this.camera.position.set(780, 820, 780); // High-angle diagonal view covering expanded 2.2km city

    // 3. Renderer setup
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.05;
    this.orbitControls.maxPolarAngle = Math.PI / 2 - 0.08;
    this.orbitControls.minDistance = 20;
    this.orbitControls.maxDistance = 6500;
    this.orbitControls.target.set(0, 0, 0);

    // 5. Lighting - Warm Tropical Sun + Soft Neutral Skylight (Crisp diagonal shadows)
    this.hemiLight = new THREE.HemisphereLight(0xfffbeb, 0xcfd4dc, 1.15);
    this.hemiLight.position.set(0, 1000, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff8db, 2.2);
    this.sunLight.position.set(750, 1100, 500);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 4096;
    this.sunLight.shadow.mapSize.height = 4096;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 3500;
    const shadowDist = 1700;
    this.sunLight.shadow.camera.left = -shadowDist;
    this.sunLight.shadow.camera.right = shadowDist;
    this.sunLight.shadow.camera.top = shadowDist;
    this.sunLight.shadow.camera.bottom = -shadowDist;
    this.sunLight.shadow.bias = -0.0003;
    this.scene.add(this.sunLight);

    // 6. Base Urban Parcel Ground
    this.createBaseGround();

    // 7. Resize handling
    window.addEventListener('resize', this.onWindowResize);

    // Start loop
    this.animate();
  }

  private createBaseGround(): void {
    const groundGeo = new THREE.PlaneGeometry(9000, 9000, 32, 32);
    groundGeo.rotateX(-Math.PI / 2);

    // Warm concrete urban parcel ground (matches the reference city screenshot)
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xdbe0e8,
      roughness: 0.95,
      metalness: 0.05,
    });

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.y = 0;
    groundMesh.receiveShadow = true;
    groundMesh.name = 'baseGround';
    this.scene.add(groundMesh);
  }

  public registerUpdateHook(hook: (deltaTime: number) => void): void {
    this.updateHooks.push(hook);
  }

  public removeUpdateHook(hook: (deltaTime: number) => void): void {
    this.updateHooks = this.updateHooks.filter((h) => h !== hook);
  }

  public setCameraMode(mode: 'orbit' | 'shipper'): void {
    this.cameraMode = mode;
    if (mode === 'orbit') {
      this.orbitControls.enabled = true;
    } else {
      this.orbitControls.enabled = false;
    }
  }

  public getCameraMode(): 'orbit' | 'shipper' {
    return this.cameraMode;
  }

  public clearWorldObjects(): void {
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (
        obj.name.startsWith('building_') ||
        obj.name.startsWith('roads_') ||
        obj.name.startsWith('water_') ||
        obj.name.startsWith('parks_') ||
        obj.name.startsWith('trees_') ||
        obj.name.startsWith('vegetation_') ||
        obj.name.startsWith('traffic_') ||
        obj.name.startsWith('marker_')
      ) {
        toRemove.push(obj);
      }
    });

    for (const obj of toRemove) {
      this.scene.remove(obj);
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    }
  }

  public getPerformanceStats(): { drawCalls: number; triangles: number; fps: number } {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      fps: this.currentFps,
    };
  }

  private onWindowResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private animate = (): void => {
    this.animFrameId = requestAnimationFrame(this.animate);

    const now = performance.now();
    const deltaTime = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // FPS calculation
    this.frameCount++;
    if (this.frameCount % 20 === 0) {
      this.currentFps = Math.round(1 / (deltaTime || 0.016));
    }

    // Run game logic update hooks
    for (const hook of this.updateHooks) {
      hook(deltaTime);
    }

    // Update orbit controls if in orbit mode
    if (this.cameraMode === 'orbit') {
      this.orbitControls.update();
    }

    this.renderer.render(this.scene, this.camera);
  };

  public dispose(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
