import L from 'leaflet';
import { DEFAULT_COORDS, DEFAULT_RADIUS_METERS, SAIGON_PRESETS } from './config/endpoints';
import { fetchNominatimReverse } from './services/nominatim';
import { fetchVidaOpenBuildings } from './services/openBuildings';
import { fetchOverpassData } from './services/overpass';
import { performSpatialFusion } from './services/spatialFusion';
import { BBox, PipelineTelemetry } from './types/gis';
import { BuildingBuilder } from './world/BuildingBuilder';
import { EnvironmentBuilder } from './world/EnvironmentBuilder';
import { GeoProjection } from './world/projection';
import { SceneManager } from './world/SceneManager';
import { ShipperController } from './world/ShipperController';
import { CityVegetation } from './world/CityVegetation';
import { CityTraffic } from './world/CityTraffic';
import { TrafficSignalSystem } from './world/TrafficSignalSystem';
import { PedestrianSystem } from './world/PedestrianSystem';
import { PoliceChaseSystem } from './world/PoliceChaseSystem';
import { AudioManager } from './services/AudioManager';

class SaigonShipperApp {
  private sceneManager!: SceneManager;
  private shipperController!: ShipperController;
  private cityTraffic!: CityTraffic;
  private trafficSignalSystem!: TrafficSignalSystem;
  private pedestrianSystem!: PedestrianSystem;
  private policeChaseSystem!: PoliceChaseSystem;

  // Geographic state
  private currentLat = DEFAULT_COORDS.lat;
  private currentLon = DEFAULT_COORDS.lon;
  private currentBBox!: BBox;

  // Leaflet map
  private leafletMap!: L.Map;
  private targetRectLayer!: L.Rectangle;
  private targetMarkerLayer!: L.Marker;

  // UI Elements
  private elSidebar!: HTMLElement;
  private elBtnSidebarCollapse!: HTMLButtonElement;
  private elBtnSidebarOpen!: HTMLButtonElement;
  private elBtnSoundToggle!: HTMLButtonElement;
  private elSoundIcon!: HTMLElement;

  private elAreaTitle!: HTMLElement;
  private elAreaCoords!: HTMLElement;
  private elBadgeCountry!: HTMLElement;
  private elLabelStatus!: HTMLElement;
  private elBtnBuild!: HTMLButtonElement;
  private elBtnBuildText!: HTMLElement;
  private elSpinner!: HTMLElement;
  private elBtnModeOrbit!: HTMLButtonElement;
  private elBtnModeShipper!: HTMLButtonElement;
  private elTelemetryLog!: HTMLElement;
  private elMetricDrawCalls!: HTMLElement;
  private elMetricTriangles!: HTMLElement;
  private elMetricFps!: HTMLElement;

  // Shipper HUD Elements
  private elShipperHud!: HTMLElement;
  private elSpeedValue!: HTMLElement;
  private elStreetName!: HTMLElement;
  private elSpeedometerCard!: HTMLElement;
  private elBlinkerLeft!: HTMLElement;
  private elBlinkerRight!: HTMLElement;
  private elBtnHorn!: HTMLButtonElement;

  // Police Chase & Ambulance Emergency Event Elements
  private elBtnTriggerChase!: HTMLButtonElement;
  private elPoliceChaseBanner!: HTMLElement;
  private elChaseBannerBox!: HTMLElement;
  private elChaseIcon!: HTMLElement;
  private elChaseBadgeTitle!: HTMLElement;
  private elChaseBadgeBox!: HTMLElement;
  private elChaseBannerMsg!: HTMLElement;
  private elBtnCloseChase!: HTMLButtonElement;

  private isBuilding = false;


  constructor() {
    this.initDOM();
    this.init3DScene();
    this.initLeafletMinimap();
    this.bindEvents();
    this.startMetricsTicker();

    // Auto-build default area (District 1) on initial load
    this.executeBuildPipeline();
  }

  private initDOM(): void {
    this.elSidebar = document.getElementById('hud-sidebar')!;
    this.elBtnSidebarCollapse = document.getElementById('btn-sidebar-collapse') as HTMLButtonElement;
    this.elBtnSidebarOpen = document.getElementById('btn-sidebar-open') as HTMLButtonElement;
    this.elBtnSoundToggle = document.getElementById('btn-sound-toggle') as HTMLButtonElement;
    this.elSoundIcon = document.getElementById('sound-icon')!;

    this.elAreaTitle = document.getElementById('area-title')!;
    this.elAreaCoords = document.getElementById('area-coords')!;
    this.elBadgeCountry = document.getElementById('badge-country')!;
    this.elLabelStatus = document.getElementById('label-status')!;
    this.elBtnBuild = document.getElementById('btn-build-area') as HTMLButtonElement;
    this.elBtnBuildText = document.getElementById('btn-build-text')!;
    this.elSpinner = document.getElementById('build-spinner')!;
    this.elBtnModeOrbit = document.getElementById('btn-mode-orbit') as HTMLButtonElement;
    this.elBtnModeShipper = document.getElementById('btn-mode-shipper') as HTMLButtonElement;
    this.elTelemetryLog = document.getElementById('telemetry-log')!;
    this.elMetricDrawCalls = document.getElementById('metric-drawcalls')!;
    this.elMetricTriangles = document.getElementById('metric-triangles')!;
    this.elMetricFps = document.getElementById('metric-fps')!;

    this.elShipperHud = document.getElementById('shipper-hud')!;
    this.elSpeedValue = document.getElementById('hud-speed-value')!;
    this.elStreetName = document.getElementById('hud-street-name')!;
    this.elSpeedometerCard = document.getElementById('hud-speedometer-card')!;
    this.elBlinkerLeft = document.getElementById('hud-blinker-left')!;
    this.elBlinkerRight = document.getElementById('hud-blinker-right')!;
    this.elBtnHorn = document.getElementById('hud-btn-horn') as HTMLButtonElement;

    // Police chase & ambulance pursuit event elements
    this.elBtnTriggerChase = document.getElementById('btn-trigger-chase') as HTMLButtonElement;
    this.elPoliceChaseBanner = document.getElementById('police-chase-banner')!;
    this.elChaseBannerBox = document.getElementById('chase-banner-box')!;
    this.elChaseIcon = document.getElementById('chase-icon')!;
    this.elChaseBadgeTitle = document.getElementById('chase-badge-title')!;
    this.elChaseBadgeBox = document.getElementById('chase-badge-box')!;
    this.elChaseBannerMsg = document.getElementById('chase-banner-msg')!;
    this.elBtnCloseChase = document.getElementById('btn-close-chase') as HTMLButtonElement;

    // Initialize audio icon state
    const isMuted = AudioManager.getInstance().getIsMuted();
    this.elSoundIcon.textContent = isMuted ? '🔇' : '🔊';

    this.updateBBox();
  }

  private init3DScene(): void {
    const canvasContainer = document.getElementById('three-canvas-container')!;
    this.sceneManager = new SceneManager(canvasContainer);

    this.shipperController = new ShipperController(this.sceneManager.camera);
    this.sceneManager.scene.add(this.shipperController.bikeGroup);

    this.trafficSignalSystem = new TrafficSignalSystem();
    this.sceneManager.scene.add(this.trafficSignalSystem.group);

    this.cityTraffic = new CityTraffic();
    this.sceneManager.scene.add(this.cityTraffic.group);

    this.pedestrianSystem = new PedestrianSystem();
    this.sceneManager.scene.add(this.pedestrianSystem.group);

    this.policeChaseSystem = new PoliceChaseSystem();
    this.sceneManager.scene.add(this.policeChaseSystem.group);

    // Register physics/kinematics update loop
    this.sceneManager.registerUpdateHook((dt) => {
      this.shipperController.update(dt);
      this.trafficSignalSystem.update(dt);
      this.cityTraffic.update(dt);
      this.pedestrianSystem.update(dt);
      const playerPos = this.shipperController.getIsActive() ? this.shipperController.getPosition() : undefined;
      this.policeChaseSystem.update(dt, playerPos);
    });

    // Wire Police Chase & Ambulance event telemetry to Alert Banner
    this.policeChaseSystem.setStatusCallback((status) => {
      if (status.isActive) {
        this.elPoliceChaseBanner.style.display = 'block';
        this.elChaseBannerMsg.textContent = status.message;
        this.elChaseIcon.textContent = status.icon;
        this.elChaseBadgeTitle.textContent = status.badge;
        this.elBtnTriggerChase.classList.add('active-chase');

        if (status.eventType === 'ambulance_rush') {
          this.elChaseBannerBox.classList.add('ambulance-mode');
          this.elChaseBadgeBox.classList.add('ambulance-badge');
        } else {
          this.elChaseBannerBox.classList.remove('ambulance-mode');
          this.elChaseBadgeBox.classList.remove('ambulance-badge');
        }
      } else {
        this.elPoliceChaseBanner.style.display = 'none';
        this.elBtnTriggerChase.classList.remove('active-chase');
      }
    });

    // Wire shipper telemetry to in-game HUD
    this.shipperController.setStatusCallback((status) => {
      this.elSpeedValue.textContent = String(status.speedKmh);
      this.elStreetName.textContent = status.currentRoadName;

      if (status.isColliding) {
        this.elSpeedometerCard.classList.add('collision-warning');
      } else {
        this.elSpeedometerCard.classList.remove('collision-warning');
      }

      // Synchronize Realtime Turn Signal (Xi-Nhan) HUD Badges
      if (status.blinkerState === 'left' && status.isBlinkerPhaseOn) {
        this.elBlinkerLeft.classList.add('blinking-on');
      } else {
        this.elBlinkerLeft.classList.remove('blinking-on');
      }

      if (status.blinkerState === 'right' && status.isBlinkerPhaseOn) {
        this.elBlinkerRight.classList.add('blinking-on');
      } else {
        this.elBlinkerRight.classList.remove('blinking-on');
      }
    });
  }

  private updateBBox(): void {
    this.currentBBox = GeoProjection.createBBoxFromRadius(
      this.currentLat,
      this.currentLon,
      DEFAULT_RADIUS_METERS
    );
  }

  private initLeafletMinimap(): void {
    // CartoDB Dark Matter tile layer
    this.leafletMap = L.map('leaflet-minimap', {
      center: [this.currentLat, this.currentLon],
      zoom: 14, // Expanded 2.2km metropolis view
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(this.leafletMap);

    // Glowing target bounding box
    const bounds: L.LatLngBoundsExpression = [
      [this.currentBBox.south, this.currentBBox.west],
      [this.currentBBox.north, this.currentBBox.east],
    ];

    this.targetRectLayer = L.rectangle(bounds, {
      color: '#06b6d4',
      weight: 2,
      fillColor: '#06b6d4',
      fillOpacity: 0.15,
      dashArray: '4, 4',
    }).addTo(this.leafletMap);

    // High-tech pulse center icon
    const pulseIcon = L.divIcon({
      className: 'minimap-pulse-icon',
      html: `
        <div style="
          width: 16px;
          height: 16px;
          background: #06b6d4;
          border: 2px solid #ffffff;
          border-radius: 50%;
          box-shadow: 0 0 12px #06b6d4;
          transform: translate(-50%, -50%);
        "></div>
      `,
      iconSize: [16, 16],
    });

    this.targetMarkerLayer = L.marker([this.currentLat, this.currentLon], {
      icon: pulseIcon,
      draggable: true,
    }).addTo(this.leafletMap);

    // When marker is dragged
    this.targetMarkerLayer.on('dragend', () => {
      const pos = this.targetMarkerLayer.getLatLng();
      this.setNewCoordinates(pos.lat, pos.lng);
    });

    // When map is clicked
    this.leafletMap.on('click', (e: L.LeafletMouseEvent) => {
      this.setNewCoordinates(e.latlng.lat, e.latlng.lng);
    });
  }

  private setNewCoordinates(lat: number, lon: number): void {
    this.currentLat = lat;
    this.currentLon = lon;
    this.updateBBox();

    this.targetMarkerLayer.setLatLng([lat, lon]);
    this.targetRectLayer.setBounds([
      [this.currentBBox.south, this.currentBBox.west],
      [this.currentBBox.north, this.currentBBox.east],
    ]);

    this.leafletMap.panTo([lat, lon]);

    this.elAreaCoords.textContent = `${lat.toFixed(4)}° N, ${lon.toFixed(4)}° E (~${DEFAULT_RADIUS_METERS * 2}m × ${DEFAULT_RADIUS_METERS * 2}m)`;
    this.appendTelemetryLog(`[Tọa độ] Đã chọn tâm mới: ${lat.toFixed(4)}, ${lon.toFixed(4)}`, 'info');
  }

  private toggleSidebar(force?: boolean): void {
    const isCurrentlyCollapsed = this.elSidebar.classList.contains('collapsed');
    const shouldCollapse = force !== undefined ? force : !isCurrentlyCollapsed;

    if (shouldCollapse) {
      this.elSidebar.classList.add('collapsed');
      this.elBtnSidebarOpen.classList.add('visible');
    } else {
      this.elSidebar.classList.remove('collapsed');
      this.elBtnSidebarOpen.classList.remove('visible');
      setTimeout(() => this.leafletMap?.invalidateSize(), 360);
    }
  }

  private bindEvents(): void {
    // Sidebar collapse & open triggers
    this.elBtnSidebarCollapse.addEventListener('click', () => {
      this.toggleSidebar(true);
    });

    this.elBtnSidebarOpen.addEventListener('click', () => {
      this.toggleSidebar(false);
    });

    // Master Sound Mute/Unmute Toggle
    this.elBtnSoundToggle.addEventListener('click', () => {
      const isMuted = AudioManager.getInstance().toggleMute();
      this.elSoundIcon.textContent = isMuted ? '🔇' : '🔊';
      this.elBtnSoundToggle.title = isMuted ? 'Bật âm thanh xe cộ & phố xá' : 'Tắt âm thanh';
      this.appendTelemetryLog(
        `[Âm thanh] ${isMuted ? 'Đã tắt tiếng xe cộ & phố xá' : 'Đã bật âm thanh xe cộ & phố xá'}`,
        'info'
      );
    });

    // Shipper Horn Button
    this.elBtnHorn.addEventListener('click', () => {
      AudioManager.getInstance().playHorn();
    });

    // Clickable Turn Signal Badges (triggers Q or E on keyboard)
    this.elBlinkerLeft.addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
    });
    this.elBlinkerRight.addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    });

    // Trigger / Toggle Emergency Events Manually (events also occur automatically and spontaneously!)
    this.elBtnTriggerChase.addEventListener('click', () => {
      AudioManager.getInstance().ensureResumed();
      const playerPos = this.shipperController.getIsActive() ? this.shipperController.getPosition() : undefined;
      this.policeChaseSystem.toggleManualEvent(playerPos);
      if (this.policeChaseSystem.getIsActive()) {
        const typeStr = this.policeChaseSystem.getCurrentEventType() === 'ambulance_rush' ? 'Xe Cứu Thương 115' : 'Cảnh sát CSGT';
        this.appendTelemetryLog(`[Sự kiện Khẩn cấp] 🚨 Đã kích hoạt sự kiện ${typeStr}!`, 'warn');
      } else {
        this.appendTelemetryLog(`[Sự kiện Khẩn cấp] Đã dừng sự kiện khẩn cấp.`, 'info');
      }
    });

    this.elBtnCloseChase.addEventListener('click', () => {
      this.policeChaseSystem.stopEmergencyEvent();
      this.appendTelemetryLog(`[Sự kiện Khẩn cấp] Đã đóng sự kiện.`, 'info');
    });

    // Keyboard Shortcuts for Sidebar & Game Events
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (e.code === 'KeyH' && !this.shipperController.getIsActive()) {
        this.toggleSidebar();
      } else if (e.code === 'KeyP') {
        this.elBtnTriggerChase.click();
      }
    });

    // Build Area CTA Button
    this.elBtnBuild.addEventListener('click', () => {
      if (!this.isBuilding) {
        this.executeBuildPipeline();
      }
    });

    // Preset buttons
    const presetButtons = document.querySelectorAll<HTMLButtonElement>('.btn-preset');
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetId = btn.getAttribute('data-preset');
        const preset = SAIGON_PRESETS.find((p) => p.id === presetId);
        if (preset) {
          this.setNewCoordinates(preset.lat, preset.lon);
          this.executeBuildPipeline();
        }
      });
    });

    // Mode Toggle Buttons
    this.elBtnModeOrbit.addEventListener('click', () => {
      this.switchMode('orbit');
    });

    this.elBtnModeShipper.addEventListener('click', () => {
      this.switchMode('shipper');
    });
  }

  private switchMode(mode: 'orbit' | 'shipper'): void {
    AudioManager.getInstance().ensureResumed();

    if (mode === 'orbit') {
      this.sceneManager.setCameraMode('orbit');
      this.shipperController.setActive(false);
      this.elBtnModeOrbit.classList.add('active');
      this.elBtnModeShipper.classList.remove('active');
      this.elShipperHud.style.display = 'none';
      this.appendTelemetryLog(`[Chế độ] Đã chuyển sang Góc nhìn Tự do (Orbit Camera)`, 'info');
    } else {
      this.sceneManager.setCameraMode('shipper');
      this.shipperController.setActive(true);
      this.elBtnModeShipper.classList.add('active');
      this.elBtnModeOrbit.classList.remove('active');
      this.elShipperHud.style.display = 'flex';
      this.appendTelemetryLog(`[Chế độ] Đã nổ máy xe máy Shipper! Dùng W/S (Ga/Lùi), A/D (Lái), Q/E (Sin nhan), H (Còi)`, 'success');
    }
  }

  private appendTelemetryLog(text: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    entry.textContent = `[${timeStr}] ${text}`;
    this.elTelemetryLog.appendChild(entry);
    this.elTelemetryLog.scrollTop = this.elTelemetryLog.scrollHeight;
  }

  /**
   * Main Pipeline Orchestrator
   */
  private async executeBuildPipeline(): Promise<void> {
    if (this.isBuilding) return;
    this.isBuilding = true;

    this.elBtnBuild.disabled = true;
    this.elSpinner.style.display = 'inline-block';
    this.elBtnBuildText.textContent = 'ĐANG DỰNG KHU VỰC...';
    this.elLabelStatus.style.color = '#38bdf8';
    this.elLabelStatus.textContent = '● Đang xử lý...';

    const startTime = performance.now();
    const projection = new GeoProjection(this.currentLat, this.currentLon);

    this.appendTelemetryLog(`──────────────────────────────────────────`, 'info');
    this.appendTelemetryLog(`[Pipeline] Bắt đầu dựng 3D khu vực ${this.currentLat.toFixed(4)}, ${this.currentLon.toFixed(4)}`, 'info');

    try {
      // Step 1: Nominatim Reverse Geocoding
      const nominatimPromise = fetchNominatimReverse(this.currentLat, this.currentLon).then((res) => {
        this.elAreaTitle.textContent = res.formattedTitle;
        this.elBadgeCountry.textContent = res.countryCode;
        this.appendTelemetryLog(`[Nominatim] Xác định địa chỉ: ${res.formattedTitle} [${res.countryCode}]`, 'success');
        return res;
      });

      // Step 2: OpenStreetMap Overpass with 7s multi-server race
      const overpassPromise = fetchOverpassData(this.currentBBox, (_, log, type) => {
        if (log) this.appendTelemetryLog(log, type);
      });

      // Step 3: VIDA Open Buildings via PMTiles HTTP Range
      const vidaPromise = fetchVidaOpenBuildings(this.currentBBox, (_, log, type) => {
        if (log) this.appendTelemetryLog(log, type);
      });

      // Await Overpass and VIDA (with resilience guarantees)
      const [, overpassResult, vidaBuildings] = await Promise.all([
        nominatimPromise.catch(() => null),
        overpassPromise,
        vidaPromise.catch(() => []),
      ]);

      // Step 4: Spatial Fusion & Deduplication via RBush R-Trees
      const fusionResult = performSpatialFusion(
        overpassResult.geojson,
        vidaBuildings,
        this.currentBBox,
        projection,
        (_, log, type) => {
          if (log) this.appendTelemetryLog(log, type);
        }
      );

      // Step 5: Construct 3D World in Three.js Main Thread
      this.appendTelemetryLog(`[Three.js Engine] Dựng hình học 3D & gộp Draw Calls...`, 'info');
      this.sceneManager.clearWorldObjects();

      // 5A. 3D Merged Buildings
      const cityResult = BuildingBuilder.buildCityMesh(fusionResult.buildings);
      if (cityResult) {
        this.sceneManager.scene.add(cityResult.mesh);
      }

      // 5B. 3D Merged Roads & Saigon Alleys with Seamless Crossroads
      const roadMesh = EnvironmentBuilder.buildRoads(fusionResult.roads, fusionResult.roadGraph);
      if (roadMesh) {
        this.sceneManager.scene.add(roadMesh);
      }

      // 5C. 3D Merged Water Bodies
      const waterMesh = EnvironmentBuilder.buildWater(fusionResult.water);
      if (waterMesh) {
        this.sceneManager.scene.add(waterMesh);
      }

      // 5D. 3D Merged Parks
      const { parkMesh } = EnvironmentBuilder.buildParks(fusionResult.parks);
      if (parkMesh) this.sceneManager.scene.add(parkMesh);

      // 5E. Curated Boulevard Trees (Drastically reduced, strictly outside roads & water)
      const treePositions: Array<{ x: number; z: number; scale?: number }> = [];

      // Check distance squared from (tx, tz) to a 2D line segment (x1, z1)-(x2, z2)
      const distToSegmentSq = (px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number => {
        const dx = x2 - x1;
        const dz = z2 - z1;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 0.001) return (px - x1) * (px - x1) + (pz - z1) * (pz - z1);
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
        const projX = x1 + t * dx;
        const projZ = z1 + t * dz;
        return (px - projX) * (px - projX) + (pz - projZ) * (pz - projZ);
      };

      // Trees filtered against buildings
      const isInsideAnyBuilding = (tx: number, tz: number) => {
        for (let i = 0; i < fusionResult.buildings.length; i++) {
          const b = fusionResult.buildings[i];
          if (
            tx >= b.bbox.minX - 0.9 &&
            tx <= b.bbox.maxX + 0.9 &&
            tz >= b.bbox.minZ - 0.9 &&
            tz <= b.bbox.maxZ + 0.9
          ) {
            return true;
          }
        }
        return false;
      };

      // Trees filtered strictly against lakes, ponds, canals
      const isInsideOrNearWater = (tx: number, tz: number, minDist: number = 4.5) => {
        const minDistSq = minDist * minDist;
        for (let i = 0; i < fusionResult.water.length; i++) {
          const w = fusionResult.water[i];
          for (let r = 0; r < w.rings.length; r++) {
            const ring = w.rings[r];
            if (ring.length < 3) continue;

            // Bounding box pre-check
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (let k = 0; k < ring.length; k++) {
              if (ring[k].x < minX) minX = ring[k].x;
              if (ring[k].x > maxX) maxX = ring[k].x;
              if (ring[k].z < minZ) minZ = ring[k].z;
              if (ring[k].z > maxZ) maxZ = ring[k].z;
            }
            if (tx < minX - minDist || tx > maxX + minDist || tz < minZ - minDist || tz > maxZ + minDist) {
              continue;
            }

            // Ray casting point-in-polygon
            let inside = false;
            for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
              const xi = ring[j].x, zi = ring[j].z;
              const xj = ring[k].x, zj = ring[k].z;
              const intersect = ((zi > tz) !== (zj > tz)) && (tx < ((xj - xi) * (tz - zi)) / (zj - zi) + xi);
              if (intersect) inside = !inside;
            }
            if (inside) return true;

            // Distance to perimeter boundary
            for (let j = 0; j < ring.length; j++) {
              const p1 = ring[j];
              const p2 = ring[(j + 1) % ring.length];
              if (distToSegmentSq(tx, tz, p1.x, p1.z, p2.x, p2.z) < minDistSq) return true;
            }
          }
        }
        return false;
      };

      // Trees filtered against road driving lanes
      const isTooCloseToRoadCenter = (tx: number, tz: number, minDist: number = 6.0) => {
        const minDistSq = minDist * minDist;
        for (let i = 0; i < fusionResult.roadGraph.edges.length; i++) {
          const edge = fusionResult.roadGraph.edges[i];
          const n1 = fusionResult.roadGraph.nodes.get(edge.fromId);
          const n2 = fusionResult.roadGraph.nodes.get(edge.toId);
          if (n1 && n2) {
            if (distToSegmentSq(tx, tz, n1.x, n1.z, n2.x, n2.z) < minDistSq) return true;
          }
        }
        return false;
      };

      // 1. Boulevard trees along major avenues
      for (const edge of fusionResult.roadGraph.edges) {
        // Major avenues only, never on alleys or bridges
        const isMajorAvenue = edge.highway === 'primary' || edge.highway === 'secondary' || edge.highway === 'trunk';
        if (!isMajorAvenue || edge.isAlley || edge.isBridge) continue;

        const n1 = fusionResult.roadGraph.nodes.get(edge.fromId);
        const n2 = fusionResult.roadGraph.nodes.get(edge.toId);
        if (n1 && n2) {
          const dist = Math.hypot(n2.x - n1.x, n2.z - n1.z);
          if (dist < 60) continue; // Keep intersections completely clear!

          // Road half width + verge margin (placed safely outside the curb!)
          const roadWidth = edge.highway === 'primary' || edge.highway === 'trunk' ? 14.0 : 10.0;
          const treeOffset = roadWidth / 2 + 2.4;

          const steps = Math.floor(dist / 65); // Generous 65m spacing (tasteful, uncrowded)
          for (let s = 1; s <= steps; s++) {
            const t = s / (steps + 1);
            const midX = n1.x + (n2.x - n1.x) * t;
            const midZ = n1.z + (n2.z - n1.z) * t;

            // Check distance to both endpoint junctions
            const distToN1 = Math.hypot(midX - n1.x, midZ - n1.z);
            const distToN2 = Math.hypot(midX - n2.x, midZ - n2.z);
            if (distToN1 < 22 || distToN2 < 22) continue; // Keep intersection clear!

            const perpX = -(n2.z - n1.z) / (dist || 1);
            const perpZ = (n2.x - n1.x) / (dist || 1);

            // Stagger 1 tree per interval alternating left and right
            const side = s % 2 === 0 ? 1 : -1;
            const treePt = { x: midX + perpX * (treeOffset * side), z: midZ + perpZ * (treeOffset * side) };

            if (
              !isInsideAnyBuilding(treePt.x, treePt.z) &&
              !isInsideOrNearWater(treePt.x, treePt.z, 3.5) &&
              !isTooCloseToRoadCenter(treePt.x, treePt.z, roadWidth / 2 + 0.5)
            ) {
              treePositions.push({ x: treePt.x, z: treePt.z, scale: 0.9 + Math.random() * 0.35 });
            }
          }
        }
      }

      // 2. Trees in parks and plazas (Drastically reduced to 3-6 per park, strictly inside boundary)
      for (const park of fusionResult.parks) {
        const outer = park.rings[0];
        if (outer && outer.length >= 3) {
          let cx = 0, cz = 0;
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const pt of outer) {
            cx += pt.x; cz += pt.z;
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.z < minZ) minZ = pt.z;
            if (pt.z > maxZ) maxZ = pt.z;
          }
          cx /= outer.length; cz /= outer.length;

          const parkRadius = Math.min(25, Math.min(maxX - minX, maxZ - minZ) * 0.32);
          const maxParkTrees = Math.min(6, Math.max(3, Math.floor(outer.length / 4)));
          let planted = 0;

          for (let k = 0; k < 18 && planted < maxParkTrees; k++) {
            const rad = Math.random() * parkRadius;
            const ang = Math.random() * Math.PI * 2;
            const candX = cx + Math.cos(ang) * rad;
            const candZ = cz + Math.sin(ang) * rad;

            // Point in polygon test for park
            let insidePark = false;
            for (let j = 0, l = outer.length - 1; j < outer.length; l = j++) {
              const xi = outer[j].x, zi = outer[j].z;
              const xj = outer[l].x, zj = outer[l].z;
              const intersect = ((zi > candZ) !== (zj > candZ)) && (candX < ((xj - xi) * (candZ - zi)) / (zj - zi) + xi);
              if (intersect) insidePark = !insidePark;
            }

            if (
              insidePark &&
              !isInsideAnyBuilding(candX, candZ) &&
              !isInsideOrNearWater(candX, candZ, 4.0) &&
              !isTooCloseToRoadCenter(candX, candZ, 6.0)
            ) {
              treePositions.push({
                x: candX,
                z: candZ,
                scale: 0.9 + Math.random() * 0.5,
              });
              planted++;
            }
          }
        }
      }

      const vegetationGroup = CityVegetation.createVegetation(treePositions);
      this.sceneManager.scene.add(vegetationGroup);

      // 5F. Authentic Intersection Traffic Signals (Cột đèn tín hiệu ngã ba / ngã tư)
      this.trafficSignalSystem.initSignals(fusionResult.roadGraph);
      this.sceneManager.scene.add(this.trafficSignalSystem.group);

      // 5G. Autonomous Moving Traffic Simulation Obeying Lanes & Signals (3,000 xe)
      this.cityTraffic.initSimulation(fusionResult.roadGraph, this.trafficSignalSystem);
      this.sceneManager.scene.add(this.cityTraffic.group);

      // 5H. Crowded Vietnamese Pedestrians on Sidewalks (650+ Người dân đi bộ đội nón lá)
      this.pedestrianSystem.initPedestrians(fusionResult.roadGraph);
      this.sceneManager.scene.add(this.pedestrianSystem.group);

      // 5I. Police Chase Pursuit System (Sự kiện Cảnh sát rượt đuổi tội phạm cướp giật)
      this.policeChaseSystem.setEnvironment(fusionResult.roadGraph);
      this.sceneManager.scene.add(this.policeChaseSystem.group);

      // Step 6: Initialize Shipper scooter environment
      this.shipperController.setEnvironment(fusionResult.buildings, fusionResult.roadGraph);

      const totalTime = (performance.now() - startTime) / 1000;
      this.appendTelemetryLog(
        `[Đô thị Sài Gòn 3D] ~4.8 km² • ${fusionResult.buildings.length} tòa nhà • ${treePositions.length} cây xanh • 3.000 xe tuân thủ đèn tín hiệu • 650+ người dân đi bộ trên vỉa hè • Hệ thống sự kiện Đô thị tự động (Cảnh sát bắt cướp & Cứu thương 115 ngẫu nhiên xuất hiện trên đường) • Dựng xong trong ${totalTime.toFixed(1)}s`,
        'success'
      );

      this.elLabelStatus.style.color = '#34d399';
      this.elLabelStatus.textContent = '● Sẵn sàng';
    } catch (err: any) {
      console.error('[Pipeline Error]', err);
      this.appendTelemetryLog(`[Lỗi Dựng Hình] ${err?.message || err}`, 'error');
      this.elLabelStatus.style.color = '#f87171';
      this.elLabelStatus.textContent = '● Lỗi';
    } finally {
      this.isBuilding = false;
      this.elBtnBuild.disabled = false;
      this.elSpinner.style.display = 'none';
      this.elBtnBuildText.textContent = '🚀 DỰNG KHU NÀY (BUILD 3D)';
    }
  }

  private startMetricsTicker(): void {
    setInterval(() => {
      const stats = this.sceneManager.getPerformanceStats();
      this.elMetricDrawCalls.textContent = String(stats.drawCalls);
      this.elMetricTriangles.textContent = Number(stats.triangles).toLocaleString();
      this.elMetricFps.textContent = String(stats.fps);

      if (stats.fps >= 50) {
        this.elMetricFps.style.color = '#34d399';
      } else if (stats.fps >= 30) {
        this.elMetricFps.style.color = '#fbbf24';
      } else {
        this.elMetricFps.style.color = '#f87171';
      }
    }, 400);
  }
}

// Boot application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new SaigonShipperApp();
});
