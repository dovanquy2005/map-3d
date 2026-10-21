import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface VehicleGeometryPack {
  body: THREE.BufferGeometry;
  details: THREE.BufferGeometry;
}

export interface PlayerMotorbikePack {
  bikeBody: THREE.Group;
  frontWheel: THREE.Group;
  rearWheel: THREE.Group;
  steeringFork: THREE.Group;
  headlight: THREE.SpotLight;
  brakeLightMat: THREE.MeshStandardMaterial;
}

/**
 * Assigns per-vertex color to a BufferGeometry for multi-element single-draw-call rendering
 */
function withVertexColor(geo: THREE.BufferGeometry, colorHex: number): THREE.BufferGeometry {
  const color = new THREE.Color(colorHex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class VehicleModels {
  // =========================================================================
  // 1. MODERN SEDAN & URBAN TAXI / CROSSOVER (VINFAST / TOYOTA / MAI LINH)
  // =========================================================================
  public static createCarModel(): VehicleGeometryPack {
    // -----------------------------------------------------------------------
    // A. BODY (Tinted dynamically by InstanceColor: White, Green, Yellow, etc.)
    // -----------------------------------------------------------------------
    const bodyParts: THREE.BufferGeometry[] = [];

    // Main lower chassis and rocker panels
    const lowerChassis = new THREE.BoxGeometry(1.72, 0.38, 4.25);
    lowerChassis.translate(0, 0.40, 0);
    bodyParts.push(lowerChassis);

    // Aerodynamic sloping front hood
    const hood = new THREE.BoxGeometry(1.66, 0.18, 1.25);
    hood.translate(0, 0.60, 1.35);
    bodyParts.push(hood);

    // Front sculpted bumper
    const frontBumper = new THREE.BoxGeometry(1.70, 0.28, 0.25);
    frontBumper.translate(0, 0.28, 2.12);
    bodyParts.push(frontBumper);

    // Cabin roof and pillars
    const cabin = new THREE.BoxGeometry(1.44, 0.46, 2.05);
    cabin.translate(0, 1.02, -0.15);
    bodyParts.push(cabin);

    // Rear trunk deck
    const trunk = new THREE.BoxGeometry(1.64, 0.20, 0.95);
    trunk.translate(0, 0.62, -1.55);
    bodyParts.push(trunk);

    // Rear sculpted bumper
    const rearBumper = new THREE.BoxGeometry(1.70, 0.28, 0.25);
    rearBumper.translate(0, 0.30, -2.12);
    bodyParts.push(rearBumper);

    // Left and right side mirrors
    const leftMirror = new THREE.BoxGeometry(0.18, 0.10, 0.14);
    leftMirror.translate(0.86, 0.84, 0.60);
    bodyParts.push(leftMirror);

    const rightMirror = new THREE.BoxGeometry(0.18, 0.10, 0.14);
    rightMirror.translate(-0.86, 0.84, 0.60);
    bodyParts.push(rightMirror);

    const mergedBody = BufferGeometryUtils.mergeGeometries(bodyParts) || lowerChassis;

    // -----------------------------------------------------------------------
    // B. DETAILS & LIGHTS (Vertex Colors: Wheels, Rims, Glass, Grille, Lights)
    // -----------------------------------------------------------------------
    const detailParts: THREE.BufferGeometry[] = [];

    // 4 Rubber Tires (Tire dark charcoal: 0x18181b) & Alloy Rims (0xcbd5e1) - 8 segments
    const wheelPositions = [
      { x: 0.84, z: 1.25 },
      { x: -0.84, z: 1.25 },
      { x: 0.84, z: -1.25 },
      { x: -0.84, z: -1.25 },
    ];

    for (const wp of wheelPositions) {
      const tire = new THREE.CylinderGeometry(0.31, 0.31, 0.20, 8);
      tire.rotateZ(Math.PI / 2);
      tire.translate(wp.x, 0.31, wp.z);
      detailParts.push(withVertexColor(tire, 0x18181b));

      const rim = new THREE.CylinderGeometry(0.20, 0.20, 0.21, 6);
      rim.rotateZ(Math.PI / 2);
      rim.translate(wp.x, 0.31, wp.z);
      detailParts.push(withVertexColor(rim, 0xcbd5e1));
    }

    // Front Windshield (sloped obsidian tinted glass: 0x0a1120)
    const frontWindshield = new THREE.BoxGeometry(1.38, 0.44, 0.06);
    frontWindshield.rotateX(-0.48);
    frontWindshield.translate(0, 0.88, 0.82);
    detailParts.push(withVertexColor(frontWindshield, 0x0a1120));

    // Rear Windshield
    const rearWindshield = new THREE.BoxGeometry(1.36, 0.42, 0.06);
    rearWindshield.rotateX(0.48);
    rearWindshield.translate(0, 0.88, -1.12);
    detailParts.push(withVertexColor(rearWindshield, 0x0a1120));

    // Side Windows
    const leftSideWindow = new THREE.BoxGeometry(0.04, 0.36, 1.70);
    leftSideWindow.translate(0.71, 1.00, -0.15);
    detailParts.push(withVertexColor(leftSideWindow, 0x0a1120));

    const rightSideWindow = new THREE.BoxGeometry(0.04, 0.36, 1.70);
    rightSideWindow.translate(-0.71, 1.00, -0.15);
    detailParts.push(withVertexColor(rightSideWindow, 0x0a1120));

    // Front Radiator Grille (Matte black: 0x09090b)
    const frontGrille = new THREE.BoxGeometry(1.15, 0.20, 0.06);
    frontGrille.translate(0, 0.44, 2.14);
    detailParts.push(withVertexColor(frontGrille, 0x09090b));

    // Front LED Headlights (Crisp white: 0xffffff)
    const leftHeadlight = new THREE.BoxGeometry(0.28, 0.10, 0.06);
    leftHeadlight.translate(0.64, 0.52, 2.14);
    detailParts.push(withVertexColor(leftHeadlight, 0xffffff));

    const rightHeadlight = new THREE.BoxGeometry(0.28, 0.10, 0.06);
    rightHeadlight.translate(-0.64, 0.52, 2.14);
    detailParts.push(withVertexColor(rightHeadlight, 0xffffff));

    // Rear LED Taillights (Vivid brake red: 0xef4444)
    const leftTaillight = new THREE.BoxGeometry(0.30, 0.10, 0.06);
    leftTaillight.translate(0.64, 0.60, -2.14);
    detailParts.push(withVertexColor(leftTaillight, 0xef4444));

    const rightTaillight = new THREE.BoxGeometry(0.30, 0.10, 0.06);
    rightTaillight.translate(-0.64, 0.60, -2.14);
    detailParts.push(withVertexColor(rightTaillight, 0xef4444));

    const mergedDetails = BufferGeometryUtils.mergeGeometries(detailParts) || frontWindshield;

    return { body: mergedBody, details: mergedDetails };
  }

  // =========================================================================
  // 2. URBAN COMMUTER MOTORBIKE + RIDER (HONDA VISION / SH / LEAD / WAVE)
  // =========================================================================
  public static createScooterModel(isShipper: boolean = false): VehicleGeometryPack {
    // -----------------------------------------------------------------------
    // A. BODY (Tinted dynamically by InstanceColor)
    // -----------------------------------------------------------------------
    const bodyParts: THREE.BufferGeometry[] = [];

    // Front aerodynamic apron / fairing (yếm xe máy)
    const frontFairing = new THREE.BoxGeometry(0.36, 0.44, 0.28);
    frontFairing.rotateX(0.22);
    frontFairing.translate(0, 0.58, 0.42);
    bodyParts.push(frontFairing);

    // Front fender / mudguard
    const frontFender = new THREE.BoxGeometry(0.16, 0.12, 0.34);
    frontFender.translate(0, 0.36, 0.66);
    bodyParts.push(frontFender);

    // Center step-through underbone tunnel
    const centerChassis = new THREE.BoxGeometry(0.20, 0.16, 0.45);
    centerChassis.translate(0, 0.32, 0.12);
    bodyParts.push(centerChassis);

    // Rear body cowl / side panels
    const rearCowl = new THREE.BoxGeometry(0.34, 0.30, 0.58);
    rearCowl.translate(0, 0.52, -0.32);
    bodyParts.push(rearCowl);

    // Rear tail fender
    const rearFender = new THREE.BoxGeometry(0.14, 0.14, 0.16);
    rearFender.translate(0, 0.36, -0.70);
    bodyParts.push(rearFender);

    const mergedBody = BufferGeometryUtils.mergeGeometries(bodyParts) || frontFairing;

    // -----------------------------------------------------------------------
    // B. DETAILS (Wheels, Rims, Shocks, Seat, Handlebars, Rider, Lights, Box)
    // -----------------------------------------------------------------------
    const detailParts: THREE.BufferGeometry[] = [];

    // Front Wheel (Tire 0x18181b + Rim 0xcbd5e1) - 8 segments
    const frontTire = new THREE.CylinderGeometry(0.26, 0.26, 0.08, 8);
    frontTire.rotateZ(Math.PI / 2);
    frontTire.translate(0, 0.26, 0.66);
    detailParts.push(withVertexColor(frontTire, 0x18181b));

    const frontRim = new THREE.CylinderGeometry(0.17, 0.17, 0.09, 6);
    frontRim.rotateZ(Math.PI / 2);
    frontRim.translate(0, 0.26, 0.66);
    detailParts.push(withVertexColor(frontRim, 0xcbd5e1));

    // Rear Wheel (Tire 0x18181b + Rim 0xcbd5e1) - 8 segments
    const rearTire = new THREE.CylinderGeometry(0.26, 0.26, 0.09, 8);
    rearTire.rotateZ(Math.PI / 2);
    rearTire.translate(0, 0.26, -0.55);
    detailParts.push(withVertexColor(rearTire, 0x18181b));

    const rearRim = new THREE.CylinderGeometry(0.17, 0.17, 0.10, 6);
    rearRim.rotateZ(Math.PI / 2);
    rearRim.translate(0, 0.26, -0.55);
    detailParts.push(withVertexColor(rearRim, 0xcbd5e1));

    // Fork Struts
    const forkGeo = new THREE.BoxGeometry(0.18, 0.36, 0.04);
    forkGeo.translate(0, 0.42, 0.60);
    detailParts.push(withVertexColor(forkGeo, 0x94a3b8));

    // Exhaust Pipe (0x334155)
    const exhaust = new THREE.BoxGeometry(0.08, 0.08, 0.48);
    exhaust.translate(0.22, 0.22, -0.38);
    detailParts.push(withVertexColor(exhaust, 0x334155));

    // Scooter Seat (0x1c1917)
    const seat = new THREE.BoxGeometry(0.32, 0.14, 0.66);
    seat.translate(0, 0.68, -0.25);
    detailParts.push(withVertexColor(seat, 0x1c1917));

    // Handlebar & Grips (0xd4d4d8 & 0x09090b)
    const handlebar = new THREE.BoxGeometry(0.54, 0.04, 0.04);
    handlebar.translate(0, 0.94, 0.42);
    detailParts.push(withVertexColor(handlebar, 0xd4d4d8));

    // Side mirrors
    const leftMirror = new THREE.BoxGeometry(0.08, 0.06, 0.03);
    leftMirror.translate(0.26, 1.04, 0.40);
    detailParts.push(withVertexColor(leftMirror, 0x1e293b));

    const rightMirror = new THREE.BoxGeometry(0.08, 0.06, 0.03);
    rightMirror.translate(-0.26, 1.04, 0.40);
    detailParts.push(withVertexColor(rightMirror, 0x1e293b));

    // -----------------------------------------------------------------------
    // RIDER HUMAN FIGURE (Sitting naturally on scooter)
    // -----------------------------------------------------------------------
    // Pants / Legs (Dark indigo: 0x1e293b)
    const legs = new THREE.BoxGeometry(0.32, 0.26, 0.28);
    legs.translate(0, 0.52, 0.10);
    detailParts.push(withVertexColor(legs, 0x1e293b));

    // Torso / Jacket (0x334155 for commuter / 0x059669 for shipper)
    const jacketColor = isShipper ? 0x059669 : 0x334155;
    const torso = new THREE.BoxGeometry(0.34, 0.42, 0.24);
    torso.translate(0, 0.98, -0.08);
    detailParts.push(withVertexColor(torso, jacketColor));

    // Arms
    const arms = new THREE.BoxGeometry(0.44, 0.08, 0.32);
    arms.translate(0, 0.96, 0.18);
    detailParts.push(withVertexColor(arms, jacketColor));

    // Driver Helmet (Octagonal box helmet with dark visor: low-poly, ultra-fast)
    const helmetColor = isShipper ? 0x10b981 : 0xfacc15;
    const helmet = new THREE.BoxGeometry(0.26, 0.22, 0.24);
    helmet.translate(0, 1.34, -0.04);
    detailParts.push(withVertexColor(helmet, helmetColor));

    const helmetVisor = new THREE.BoxGeometry(0.24, 0.07, 0.08);
    helmetVisor.translate(0, 1.33, 0.10);
    detailParts.push(withVertexColor(helmetVisor, 0x09090b));

    // Front Headlight (0xffffff) & Rear Taillight (0xef4444)
    const headlight = new THREE.BoxGeometry(0.16, 0.12, 0.05);
    headlight.translate(0, 0.88, 0.52);
    detailParts.push(withVertexColor(headlight, 0xffffff));

    const taillight = new THREE.BoxGeometry(0.14, 0.08, 0.05);
    taillight.translate(0, 0.58, -0.74);
    detailParts.push(withVertexColor(taillight, 0xef4444));

    // Shipper Cargo Box OR Commuter Grab Rail
    if (isShipper) {
      const cargoBox = new THREE.BoxGeometry(0.46, 0.46, 0.46);
      cargoBox.translate(0, 0.92, -0.66);
      detailParts.push(withVertexColor(cargoBox, 0x059669));

      const reflectiveBand = new THREE.BoxGeometry(0.47, 0.08, 0.47);
      reflectiveBand.translate(0, 0.92, -0.66);
      detailParts.push(withVertexColor(reflectiveBand, 0xfacc15));
    } else {
      const grabBar = new THREE.BoxGeometry(0.28, 0.04, 0.12);
      grabBar.translate(0, 0.74, -0.62);
      detailParts.push(withVertexColor(grabBar, 0x94a3b8));
    }

    const mergedDetails = BufferGeometryUtils.mergeGeometries(detailParts) || seat;

    return { body: mergedBody, details: mergedDetails };
  }

  // =========================================================================
  // 3. ICONIC SAIGON CITY BUS & VINBUS ELECTRIC (XE BUÝT SÀI GÒN - 9.4M)
  // =========================================================================
  public static createBusModel(): VehicleGeometryPack {
    // -----------------------------------------------------------------------
    // A. BODY (Tinted dynamically by InstanceColor)
    // -----------------------------------------------------------------------
    const bodyParts: THREE.BufferGeometry[] = [];

    const chassis = new THREE.BoxGeometry(2.46, 2.10, 9.40);
    chassis.translate(0, 1.55, 0);
    bodyParts.push(chassis);

    const frontCap = new THREE.BoxGeometry(2.44, 0.42, 0.60);
    frontCap.translate(0, 2.65, 4.30);
    bodyParts.push(frontCap);

    const rearCap = new THREE.BoxGeometry(2.44, 0.22, 8.80);
    rearCap.translate(0, 2.70, -0.20);
    bodyParts.push(rearCap);

    const frontBumper = new THREE.BoxGeometry(2.48, 0.36, 0.35);
    frontBumper.translate(0, 0.48, 4.65);
    bodyParts.push(frontBumper);

    const rearBumper = new THREE.BoxGeometry(2.48, 0.36, 0.35);
    rearBumper.translate(0, 0.48, -4.65);
    bodyParts.push(rearBumper);

    const mergedBody = BufferGeometryUtils.mergeGeometries(bodyParts) || chassis;

    // -----------------------------------------------------------------------
    // B. DETAILS (Wheels, Windows, HVAC, LED Display, Headlights, Taillights)
    // -----------------------------------------------------------------------
    const detailParts: THREE.BufferGeometry[] = [];

    // 6 Heavy-duty Wheels (8 segments)
    const busWheelPositions = [
      { x: 1.18, z: 2.80 },
      { x: -1.18, z: 2.80 },
      { x: 1.18, z: -2.35 },
      { x: -1.18, z: -2.35 },
      { x: 1.18, z: -3.20 },
      { x: -1.18, z: -3.20 },
    ];

    for (const wp of busWheelPositions) {
      const tire = new THREE.CylinderGeometry(0.46, 0.46, 0.28, 8);
      tire.rotateZ(Math.PI / 2);
      tire.translate(wp.x, 0.46, wp.z);
      detailParts.push(withVertexColor(tire, 0x18181b));

      const rim = new THREE.CylinderGeometry(0.30, 0.30, 0.29, 6);
      rim.rotateZ(Math.PI / 2);
      rim.translate(wp.x, 0.46, wp.z);
      detailParts.push(withVertexColor(rim, 0x94a3b8));
    }

    // Panoramic Front Windshield (0x080d1a)
    const frontWindshield = new THREE.BoxGeometry(2.36, 1.15, 0.08);
    frontWindshield.translate(0, 1.75, 4.68);
    detailParts.push(withVertexColor(frontWindshield, 0x080d1a));

    // Panoramic Rear Window
    const rearWindow = new THREE.BoxGeometry(2.32, 0.95, 0.08);
    rearWindow.translate(0, 1.85, -4.68);
    detailParts.push(withVertexColor(rearWindow, 0x080d1a));

    // Continuous Side Window Glass Ribbons (Left & Right)
    const leftSideGlass = new THREE.BoxGeometry(0.06, 0.98, 7.80);
    leftSideGlass.translate(1.22, 1.85, -0.10);
    detailParts.push(withVertexColor(leftSideGlass, 0x080d1a));

    const rightSideGlass = new THREE.BoxGeometry(0.06, 0.98, 7.80);
    rightSideGlass.translate(-1.22, 1.85, -0.10);
    detailParts.push(withVertexColor(rightSideGlass, 0x080d1a));

    // Roof HVAC Units
    const frontAC = new THREE.BoxGeometry(1.60, 0.32, 1.80);
    frontAC.translate(0, 2.92, 1.50);
    detailParts.push(withVertexColor(frontAC, 0x94a3b8));

    const rearAC = new THREE.BoxGeometry(1.60, 0.32, 1.80);
    rearAC.translate(0, 2.92, -1.50);
    detailParts.push(withVertexColor(rearAC, 0x94a3b8));

    // Front LED Route Sign (0xf59e0b)
    const ledSign = new THREE.BoxGeometry(1.68, 0.26, 0.06);
    ledSign.translate(0, 2.45, 4.70);
    detailParts.push(withVertexColor(ledSign, 0xf59e0b));

    // Front Headlights (0xffffff)
    const leftHeadlights = new THREE.BoxGeometry(0.34, 0.16, 0.06);
    leftHeadlights.translate(0.88, 0.74, 4.70);
    detailParts.push(withVertexColor(leftHeadlights, 0xffffff));

    const rightHeadlights = new THREE.BoxGeometry(0.34, 0.16, 0.06);
    rightHeadlights.translate(-0.88, 0.74, 4.70);
    detailParts.push(withVertexColor(rightHeadlights, 0xffffff));

    // Rear Taillights (0xef4444)
    const leftTaillightBar = new THREE.BoxGeometry(0.16, 0.54, 0.06);
    leftTaillightBar.translate(0.96, 1.15, -4.70);
    detailParts.push(withVertexColor(leftTaillightBar, 0xef4444));

    const rightTaillightBar = new THREE.BoxGeometry(0.16, 0.54, 0.06);
    rightTaillightBar.translate(-0.96, 1.15, -4.70);
    detailParts.push(withVertexColor(rightTaillightBar, 0xef4444));

    const mergedDetails = BufferGeometryUtils.mergeGeometries(detailParts) || frontWindshield;

    return { body: mergedBody, details: mergedDetails };
  }

  // =========================================================================
  // 4. PLAYABLE SHIPPER MOTORBIKE & DRIVER (HONDA WINNER X / SH SAIGON SPECIAL)
  // =========================================================================
  public static createPlayerMotorbike(): PlayerMotorbikePack {
    const bikeBody = new THREE.Group();
    bikeBody.name = 'player_motorbike_body';

    // Materials
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Saigon delivery crimson red with metallic flakes
      metalness: 0.65,
      roughness: 0.25,
    });
    const blackTrimMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
    });
    const metalChromeMat = new THREE.MeshStandardMaterial({
      color: 0xd4d4d8,
      metalness: 0.85,
      roughness: 0.2,
    });
    const alloyRimMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.3,
    });
    const brakeDiscMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      metalness: 0.9,
      roughness: 0.25,
    });
    const goldCaliperMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.8,
      roughness: 0.3,
    });
    const darkLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.7,
    });
    const redStitchMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.5,
    });
    const lcdDashMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4, // Cyan glowing digital instrument panel
    });
    const shipperBoxMat = new THREE.MeshStandardMaterial({
      color: 0x059669, // Grab emerald green
      roughness: 0.4,
    });
    const reflectiveHazardMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15, // High-visibility yellow safety band
    });
    const headlightLensMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });
    const brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });

    // 1. CHASSIS & FAIRINGS
    // Front angular nose cowl
    const cowlGeo = new THREE.BoxGeometry(0.48, 0.42, 0.45);
    const cowl = new THREE.Mesh(cowlGeo, chassisMat);
    cowl.rotation.x = 0.25;
    cowl.position.set(0, 0.75, 0.45);
    cowl.castShadow = true;
    bikeBody.add(cowl);

    // Front aerodynamic sports visor
    const visorGeo = new THREE.BoxGeometry(0.32, 0.18, 0.04);
    const visor = new THREE.Mesh(visorGeo, blackTrimMat);
    visor.rotation.x = -0.35;
    visor.position.set(0, 0.98, 0.48);
    bikeBody.add(visor);

    // Stepped floorboard / footrests
    const floorGeo = new THREE.BoxGeometry(0.58, 0.08, 0.85);
    const floor = new THREE.Mesh(floorGeo, blackTrimMat);
    floor.position.set(0, 0.30, 0.05);
    floor.receiveShadow = true;
    bikeBody.add(floor);

    // Underbone spine & engine block
    const engineGeo = new THREE.BoxGeometry(0.32, 0.30, 0.55);
    const engine = new THREE.Mesh(engineGeo, blackTrimMat);
    engine.position.set(0, 0.45, 0.0);
    bikeBody.add(engine);

    // Rear side fairings
    const rearCowlGeo = new THREE.BoxGeometry(0.42, 0.32, 0.75);
    const rearCowl = new THREE.Mesh(rearCowlGeo, chassisMat);
    rearCowl.position.set(0, 0.58, -0.40);
    rearCowl.castShadow = true;
    bikeBody.add(rearCowl);

    // Two-tier sporty saddle with red racing trim
    const seatGeo = new THREE.BoxGeometry(0.42, 0.16, 0.72);
    const seat = new THREE.Mesh(seatGeo, darkLeatherMat);
    seat.position.set(0, 0.76, -0.25);
    seat.castShadow = true;
    bikeBody.add(seat);

    const seatStitchGeo = new THREE.BoxGeometry(0.43, 0.02, 0.70);
    const seatStitch = new THREE.Mesh(seatStitchGeo, redStitchMat);
    seatStitch.position.set(0, 0.77, -0.25);
    bikeBody.add(seatStitch);

    // Upswept Sport Exhaust Muffler with Chrome Heat Shield
    const exhaustMuffler = new THREE.Group();
    const pipeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.65, 12);
    pipeGeo.rotateX(Math.PI / 2);
    const pipe = new THREE.Mesh(pipeGeo, blackTrimMat);
    exhaustMuffler.add(pipe);

    const shieldGeo = new THREE.BoxGeometry(0.06, 0.12, 0.48);
    const shield = new THREE.Mesh(shieldGeo, metalChromeMat);
    shield.position.set(0.04, 0.02, 0);
    exhaustMuffler.add(shield);

    const exhaustTipGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.10, 10);
    exhaustTipGeo.rotateX(Math.PI / 2);
    const exhaustTip = new THREE.Mesh(exhaustTipGeo, metalChromeMat);
    exhaustTip.position.set(0, 0.02, -0.35);
    exhaustMuffler.add(exhaustTip);

    exhaustMuffler.rotation.x = -0.15;
    exhaustMuffler.position.set(0.28, 0.28, -0.45);
    bikeBody.add(exhaustMuffler);

    // Rear license plate bracket & LED taillight
    const tailBracketGeo = new THREE.BoxGeometry(0.18, 0.18, 0.22);
    const tailBracket = new THREE.Mesh(tailBracketGeo, blackTrimMat);
    tailBracket.position.set(0, 0.48, -0.82);
    bikeBody.add(tailBracket);

    const brakeLightGeo = new THREE.BoxGeometry(0.24, 0.08, 0.06);
    const brakeLight = new THREE.Mesh(brakeLightGeo, brakeLightMat);
    brakeLight.position.set(0, 0.66, -0.80);
    bikeBody.add(brakeLight);

    // 2. INSULATED SHIPPER CARGO BOX (GRAB / SHOPEEFOOD SPECIAL)
    const cargoBox = new THREE.Group();
    const boxMainGeo = new THREE.BoxGeometry(0.62, 0.60, 0.62);
    const boxMain = new THREE.Mesh(boxMainGeo, shipperBoxMat);
    boxMain.castShadow = true;
    cargoBox.add(boxMain);

    // Reflective safety hazard bands
    const boxStripGeo = new THREE.BoxGeometry(0.63, 0.10, 0.63);
    const boxStrip = new THREE.Mesh(boxStripGeo, reflectiveHazardMat);
    cargoBox.add(boxStrip);

    // Metal corner protectors
    for (const sx of [-0.31, 0.31]) {
      for (const sz of [-0.31, 0.31]) {
        const cornerGeo = new THREE.BoxGeometry(0.04, 0.60, 0.04);
        const corner = new THREE.Mesh(cornerGeo, metalChromeMat);
        corner.position.set(sx, 0, sz);
        cargoBox.add(corner);
      }
    }
    cargoBox.position.set(0, 1.02, -0.72);
    bikeBody.add(cargoBox);

    // 3. SHIPPER DRIVER CHARACTER
    const driverGroup = new THREE.Group();

    // Denim jeans legs
    for (const sx of [-0.16, 0.16]) {
      const thighGeo = new THREE.BoxGeometry(0.13, 0.14, 0.34);
      const thigh = new THREE.Mesh(thighGeo, blackTrimMat);
      thigh.position.set(sx, 0.72, 0.02);
      driverGroup.add(thigh);

      const shinGeo = new THREE.BoxGeometry(0.11, 0.30, 0.13);
      const shin = new THREE.Mesh(shinGeo, blackTrimMat);
      shin.position.set(sx, 0.46, 0.18);
      driverGroup.add(shin);

      const shoeGeo = new THREE.BoxGeometry(0.11, 0.08, 0.20);
      const shoe = new THREE.Mesh(shoeGeo, darkLeatherMat);
      shoe.position.set(sx, 0.28, 0.22);
      driverGroup.add(shoe);
    }

    // Shipper uniform jacket / torso
    const torsoGeo = new THREE.BoxGeometry(0.42, 0.50, 0.28);
    const torso = new THREE.Mesh(torsoGeo, shipperBoxMat);
    torso.rotation.x = 0.14; // Natural forward riding posture
    torso.position.set(0, 1.12, -0.10);
    torso.castShadow = true;
    driverGroup.add(torso);

    // Jacket collar
    const collarGeo = new THREE.BoxGeometry(0.24, 0.08, 0.20);
    const collar = new THREE.Mesh(collarGeo, blackTrimMat);
    collar.position.set(0, 1.38, -0.06);
    driverGroup.add(collar);

    // Arms gripping handlebars
    for (const sx of [-0.22, 0.22]) {
      const armGeo = new THREE.BoxGeometry(0.10, 0.10, 0.42);
      const arm = new THREE.Mesh(armGeo, shipperBoxMat);
      arm.rotation.x = -0.38;
      arm.position.set(sx, 1.08, 0.22);
      driverGroup.add(arm);
    }

    // Driver helmet with dark glossy visor
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0x10b981, // Grab Driver Emerald Helmet
      roughness: 0.25,
      metalness: 0.4,
    });
    const helmetGeo = new THREE.SphereGeometry(0.22, 14, 12);
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.position.set(0, 1.54, -0.04);
    helmet.castShadow = true;
    driverGroup.add(helmet);

    const visorGeo2 = new THREE.BoxGeometry(0.30, 0.09, 0.12);
    const visor2 = new THREE.Mesh(visorGeo2, blackTrimMat);
    visor2.position.set(0, 1.52, 0.12);
    driverGroup.add(visor2);

    bikeBody.add(driverGroup);

    // 4. FRONT STEERING FORK & HANDLEBARS
    const steeringFork = new THREE.Group();
    steeringFork.name = 'player_steering_fork';
    steeringFork.position.set(0, 0, 0.82);

    // Dual telescopic chrome suspension fork stanchions
    for (const sx of [-0.09, 0.09]) {
      const forkGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.52, 10);
      const fork = new THREE.Mesh(forkGeo, metalChromeMat);
      fork.position.set(sx, 0.52, -0.05);
      steeringFork.add(fork);
    }

    // Front mudguard hugging the tire
    const fenderGeo = new THREE.BoxGeometry(0.18, 0.14, 0.48);
    const fender = new THREE.Mesh(fenderGeo, chassisMat);
    fender.position.set(0, 0.46, 0);
    steeringFork.add(fender);

    // Gold-anodized front brake caliper
    const caliperGeo = new THREE.BoxGeometry(0.05, 0.10, 0.12);
    const caliper = new THREE.Mesh(caliperGeo, goldCaliperMat);
    caliper.position.set(0.09, 0.32, -0.08);
    steeringFork.add(caliper);

    // Sport Handlebars
    const handlebarGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 8);
    handlebarGeo.rotateZ(Math.PI / 2);
    const handlebar = new THREE.Mesh(handlebarGeo, metalChromeMat);
    handlebar.position.set(0, 1.05, -0.16);
    steeringFork.add(handlebar);

    // Textured handgrips
    for (const sx of [-0.31, 0.31]) {
      const gripGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8);
      gripGeo.rotateZ(Math.PI / 2);
      const grip = new THREE.Mesh(gripGeo, blackTrimMat);
      grip.position.set(sx, 1.05, -0.16);
      steeringFork.add(grip);

      // Aluminum brake levers
      const leverGeo = new THREE.BoxGeometry(0.08, 0.015, 0.02);
      const lever = new THREE.Mesh(leverGeo, metalChromeMat);
      lever.position.set(sx * 0.75, 1.04, -0.12);
      steeringFork.add(lever);
    }

    // Digital LCD Dashboard Instrument Cluster
    const dashGeo = new THREE.BoxGeometry(0.18, 0.08, 0.12);
    const dash = new THREE.Mesh(dashGeo, blackTrimMat);
    dash.rotation.x = -0.4;
    dash.position.set(0, 1.04, -0.18);
    steeringFork.add(dash);

    const screenGeo = new THREE.BoxGeometry(0.14, 0.01, 0.08);
    const screen = new THREE.Mesh(screenGeo, lcdDashMat);
    screen.rotation.x = -0.4;
    screen.position.set(0, 1.06, -0.18);
    steeringFork.add(screen);

    // Aerodynamic side rearview mirrors
    for (const sx of [-0.32, 0.32]) {
      const mirrorStalkGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.14, 6);
      const mirrorStalk = new THREE.Mesh(mirrorStalkGeo, metalChromeMat);
      mirrorStalk.position.set(sx, 1.14, -0.16);
      steeringFork.add(mirrorStalk);

      const mirrorHeadGeo = new THREE.BoxGeometry(0.10, 0.07, 0.03);
      const mirrorHead = new THREE.Mesh(mirrorHeadGeo, blackTrimMat);
      mirrorHead.position.set(sx * 1.08, 1.20, -0.16);
      steeringFork.add(mirrorHead);
    }

    // 5. WHEELS WITH ALLOY SPOKES & BRAKE ROTORS
    // Front Wheel
    const frontWheel = new THREE.Group();
    frontWheel.name = 'player_front_wheel';
    const tireGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.12, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const fTire = new THREE.Mesh(tireGeo, blackTrimMat);
    fTire.castShadow = true;
    frontWheel.add(fTire);

    const rimGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.13, 14);
    rimGeo.rotateZ(Math.PI / 2);
    const fRim = new THREE.Mesh(rimGeo, alloyRimMat);
    frontWheel.add(fRim);

    const fDiscGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.015, 12);
    fDiscGeo.rotateZ(Math.PI / 2);
    const fDisc = new THREE.Mesh(fDiscGeo, brakeDiscMat);
    fDisc.position.set(0.07, 0, 0);
    frontWheel.add(fDisc);

    frontWheel.position.set(0, 0.30, 0);
    steeringFork.add(frontWheel);
    bikeBody.add(steeringFork);

    // Rear Wheel
    const rearWheel = new THREE.Group();
    rearWheel.name = 'player_rear_wheel';
    const rTireGeo = new THREE.CylinderGeometry(0.30, 0.30, 0.15, 18);
    rTireGeo.rotateZ(Math.PI / 2);
    const rTire = new THREE.Mesh(rTireGeo, blackTrimMat);
    rTire.castShadow = true;
    rearWheel.add(rTire);

    const rRimGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.16, 14);
    rRimGeo.rotateZ(Math.PI / 2);
    const rRim = new THREE.Mesh(rRimGeo, alloyRimMat);
    rearWheel.add(rRim);

    const rDiscGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.015, 12);
    rDiscGeo.rotateZ(Math.PI / 2);
    const rDisc = new THREE.Mesh(rDiscGeo, brakeDiscMat);
    rDisc.position.set(-0.08, 0, 0);
    rearWheel.add(rDisc);

    rearWheel.position.set(0, 0.30, -0.65);
    bikeBody.add(rearWheel);

    // 6. DUAL PREDATOR-EYE LED HEADLIGHTS & REAL SPOTLIGHT
    const leftHeadlightGeo = new THREE.BoxGeometry(0.12, 0.08, 0.04);
    const leftHeadlight = new THREE.Mesh(leftHeadlightGeo, headlightLensMat);
    leftHeadlight.position.set(0.14, 0.78, 0.68);
    bikeBody.add(leftHeadlight);

    const rightHeadlightGeo = new THREE.BoxGeometry(0.12, 0.08, 0.04);
    const rightHeadlight = new THREE.Mesh(rightHeadlightGeo, headlightLensMat);
    rightHeadlight.position.set(-0.14, 0.78, 0.68);
    bikeBody.add(rightHeadlight);

    const headlight = new THREE.SpotLight(0xfff8db, 4.5, 55, Math.PI / 4.8, 0.45, 1.2);
    headlight.position.set(0, 0.85, 0.75);
    const headlightTarget = new THREE.Object3D();
    headlightTarget.position.set(0, 0.1, 18);
    bikeBody.add(headlightTarget);
    headlight.target = headlightTarget;
    bikeBody.add(headlight);

    return {
      bikeBody,
      frontWheel,
      rearWheel,
      steeringFork,
      headlight,
      brakeLightMat,
    };
  }
}

