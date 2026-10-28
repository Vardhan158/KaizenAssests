import { memo, Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import type { JourneyStage } from "./data/journeyStages";
import { JourneyCamera } from "./JourneyCamera";
import { JourneyRoadmap3D } from "./JourneyRoadmap3D";
import { WarehouseBuilding as WarehouseBuildingModel } from "./models/WarehouseBuilding";
import { GateBarrier as GateBarrierModel } from "./models/GateBarrier";
import { LogisticsTruck as LogisticsTruckModel } from "./models/LogisticsTruck";
import { LoadingDock as LoadingDockModel } from "./models/LoadingDock";
import { DockInspector as DockInspectorModel } from "./models/DockInspector";
import { StorageRack as StorageRackModel } from "./models/StorageRack";
import { WarehouseForklift as WarehouseForkliftModel } from "./models/WarehouseForklift";
import { PalletAndCargo as PalletAndCargoModel } from "./models/PalletAndCargo";
import { ConveyorSystem as ConveyorSystemModel } from "./models/ConveyorSystem";
import { PumpAssemblyCell as PumpAssemblyCellModel } from "./models/PumpAssemblyCell";
import { NatureEnvironment as NatureEnvironmentModel } from "./models/NatureEnvironment";
import { SupplierAsnEnvelope as SupplierAsnEnvelopeModel } from "./models/SupplierAsnEnvelope";
import { supplierJourney } from "./supplierJourney";

// Compare transform tuples by value so unchanged models skip reconciliation.
function sameModelProps(previous: object, next: object) {
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  return (
    Object.keys(before).length === Object.keys(after).length &&
    Object.keys(after).every((key) => {
      const a = before[key],
        b = after[key];
      return (
        Object.is(a, b) ||
        (Array.isArray(a) &&
          Array.isArray(b) &&
          a.length === b.length &&
          a.every((value, index) => Object.is(value, b[index])))
      );
    })
  );
}
const WarehouseBuilding = memo(WarehouseBuildingModel, sameModelProps);
const GateBarrier = memo(GateBarrierModel, sameModelProps);
const LogisticsTruck = memo(LogisticsTruckModel, sameModelProps);
const LoadingDock = memo(LoadingDockModel, sameModelProps);
const DockInspector = memo(DockInspectorModel, sameModelProps);
const StorageRack = memo(StorageRackModel, sameModelProps);
const WarehouseForklift = memo(WarehouseForkliftModel, sameModelProps);
const PalletAndCargo = memo(PalletAndCargoModel, sameModelProps);
const ConveyorSystem = memo(ConveyorSystemModel, sameModelProps);
const PumpAssemblyCell = memo(PumpAssemblyCellModel, sameModelProps);
const NatureEnvironment = memo(NatureEnvironmentModel, sameModelProps);
const SupplierAsnEnvelope = memo(SupplierAsnEnvelopeModel, sameModelProps);

interface JourneyCanvasProps {
  stages: JourneyStage[];
  activeIndex: number;
  scrollProgress: number; // 0 to 1
  overviewProgress?: number;
  mouseOffset: { x: number; y: number };
  onSelectStage: (index: number) => void;
  isFreeOrbit?: boolean;
  selectedAsn?: any;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function JourneyCanvas({
  stages,
  activeIndex,
  scrollProgress: journeyProgress,
  overviewProgress = 1,
  mouseOffset,
  onSelectStage,
  isFreeOrbit = false,
  selectedAsn,
}: JourneyCanvasProps) {
  const supplierProgress = clamp(journeyProgress / 0.12, 0, 1);
  const scrollProgress = clamp((journeyProgress - 0.12) / 0.88, 0, 1);
  const [manualTruckOffset, setManualTruckOffset] = useState({ x: 0, z: 0 });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      const step = event.shiftKey ? 1.2 : 0.55;
      setManualTruckOffset((current) => ({
        x: clamp(
          current.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
          -8,
          8,
        ),
        z: clamp(
          current.z + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          -10,
          10,
        ),
      }));
    };
    window.addEventListener("keydown", handleKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── STAGE PROGRESS CALCULATIONS ───

  // Inbound truck: forward approach, apron turn, rear docking, then receiving.
  // Keep the landing-page vehicle visibly separated from the warehouse while
  // remaining close enough to read as part of the same entrance scene.
  let truck1Pos: [number, number, number] = [0.8, 0, 16.5];
  let truck1Rot: [number, number, number] = [0, Math.PI, 0];
  let barrier1Open = 0;
  let dockDoorOpen = 0;
  let truck1Doors = 0;
  let wheelRot = 0;
  let isReversing = false;
  // Animation progress is intentionally independent of backend snapshot data.
  // The landing page is a scroll-controlled visual journey; API availability
  // must not freeze or reset the existing truck/camera animation.
  const inboundProgress = scrollProgress;

  if (inboundProgress < 0.09) {
    // Approach the stop line, wait for security clearance, then pass the raised boom.
    const approach = smoothstep(0, 0.012, inboundProgress);
    const departure = smoothstep(0.034, 0.09, inboundProgress);
    barrier1Open = smoothstep(0.014, 0.032, inboundProgress);
    truck1Pos = [
      lerp(0.8, 0, departure),
      0,
      inboundProgress < 0.034 ? lerp(23, 21.5, approach) : lerp(21.5, -4, departure),
    ];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (inboundProgress < 0.11) {
    // Continue forward through the warehouse entrance into the turning apron.
    const t = smoothstep(0.09, 0.11, inboundProgress);
    barrier1Open = 1;
    truck1Pos = [0, 0, lerp(-4, -10, t)];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (inboundProgress < 0.145) {
    // Follow a forward semicircle; the cab always points along the path tangent.
    const angle = smoothstep(0.11, 0.145, inboundProgress) * Math.PI;
    barrier1Open = 1;
    truck1Pos = [-4.25 + 4.25 * Math.cos(angle), 0, -10 - 4.25 * Math.sin(angle)];
    truck1Rot = [0, Math.PI + angle, 0];
    wheelRot = (33 + 4.25 * angle) / 0.49;
    dockDoorOpen = smoothstep(0.12, 0.145, inboundProgress);
  } else if (inboundProgress < 0.1667) {
    // Once aligned, reverse straight back to the dock bumpers.
    const t = smoothstep(0.145, 0.1667, inboundProgress);
    isReversing = true;
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, lerp(-10, -17.5, t)];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5 * t) / 0.49;
    dockDoorOpen = 1;
  } else {
    barrier1Open = 1;
    truck1Pos = [-8.5, 0, -17.5];
    truck1Rot = [0, Math.PI * 2, 0];
    wheelRot = (33 + 4.25 * Math.PI - 7.5) / 0.49;
    dockDoorOpen = 1;
    truck1Doors = smoothstep(0.1667, 0.185, inboundProgress);
  }

  // ─── SCENE 2: DOCK INSPECTOR (THE MAN CHECKING GOODS LIST BEFORE FORKLIFT PICK) ───
  truck1Pos = [
    truck1Pos[0] + manualTruckOffset.x,
    truck1Pos[1],
    truck1Pos[2] + manualTruckOffset.z,
  ];
  if (journeyProgress < 0.12) {
    const supplier = supplierJourney(supplierProgress);
    truck1Pos = [supplier.truck.x, 0, supplier.truck.z];
    truck1Rot = [0, supplier.heading, 0];
    wheelRot = supplier.wheels;
  }

  let inspectorPos: [number, number, number] = [-6.6, 1.25, -23.8];
  let inspectorRot: [number, number, number] = [0, -Math.PI / 2, 0]; // facing pallet at X: -8.5
  let inspectProgress = 0;

  if (scrollProgress < 0.1667) {
    // Waiting for truck to dock
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = 0;
  } else if (scrollProgress < 0.22) {
    // Man actively checking goods list manifest, scanning cartons with handheld laser terminal
    inspectorPos = [-6.6, 1.25, -23.8];
    inspectorRot = [0, -Math.PI / 2, 0];
    inspectProgress = smoothstep(0.203, 0.22, scrollProgress);
  } else {
    // GRN verified! Man steps to platform safety buffer and watches forklift pickup
    const stepT = clamp((scrollProgress - 0.22) / 0.025, 0, 1);
    inspectorPos = [lerp(-6.6, -5.8, stepT), 1.25, lerp(-23.8, -22.5, stepT)];
    inspectorRot = [0, lerp(-Math.PI / 2, -Math.PI / 3, stepT), 0];
    inspectProgress = 1;
  }

  // ─── SCENE 2 & 3: FORKLIFT & PALLET KINEMATICS (STARTS ONLY AFTER GOODS LIST IS CHECKED!) ───
  let forkliftPos: [number, number, number] = [-8.5, 0, -30.5];
  let forkliftRot: [number, number, number] = [0, 0, 0];
  const forkLoadOffset = 1.65; // clear the backrest at Z 0.94 by 0.11m
  const palletCarriageOffset = -0.084; // blade top meets the underside of the pallet deck
  const pickupLift = (1.25 - palletCarriageOffset - 0.15) / 2.65;
  const shelfPalletY = 1.65; // shelf deck top 1.67, pallet feet start at local Y 0.02
  const placementLift = (shelfPalletY - palletCarriageOffset - 0.15) / 2.65;
  const raisedLift = (shelfPalletY + 0.15 - palletCarriageOffset - 0.15) / 2.65;
  let forkLiftProgress = 0;
  let palletPos: [number, number, number] = [-8.5, 1.25, -23.8];
  let palletRot: [number, number, number] = [0, 0, 0];

  if (scrollProgress < 0.225) {
    // Goods list is being checked by the inspector: Forklift waits in receiving buffer
    forkliftPos = [-8.5, 0, -30.5];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = 0;
    // Unload only after parking and opening the truck doors.
    const unload = smoothstep(0.187, 0.203, scrollProgress);
    const heading = truck1Rot[1];
    palletPos =
      scrollProgress < 0.1667
        ? [truck1Pos[0] - Math.sin(heading) * 3.3, 0.98, truck1Pos[2] - Math.cos(heading) * 3.3]
        : [-8.5, lerp(0.98, 1.25, unload), lerp(-20.8, -23.8, unload)];
    palletRot = scrollProgress < 0.1667 ? truck1Rot : [0, 0, 0];
  } else if (scrollProgress < 0.255) {
    // AFTER goods list checked: Forklift approaches Dock 02 and slides forks under pallet
    const t = smoothstep(0.225, 0.255, scrollProgress);
    forkliftPos = [-8.5, 0, lerp(-30.5, -25.45, t)];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = lerp(0, pickupLift, smoothstep(0.225, 0.238, scrollProgress)); // carriage elevates to match dock height (Y: 1.25)
    palletPos = [-8.5, 1.25, -23.8];
    palletRot = [0, 0, 0];
  } else if (scrollProgress < 0.275) {
    // Forklift raises forks, lifting pallet off dock platform
    const t = smoothstep(0.255, 0.275, scrollProgress);
    forkliftPos = [-8.5, 0, -25.45];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = lerp(pickupLift, 0.52, t);
    palletPos = [-8.5, 0.15 + forkLiftProgress * 2.65, -23.8];
    palletRot = [0, 0, 0];
  } else if (scrollProgress < 0.287) {
    // Reverse straight until both the pallet and mast clear the dock opening.
    const t = smoothstep(0.275, 0.287, scrollProgress);
    forkliftPos = [-8.5, 0, lerp(-25.45, -31, t)];
    forkliftRot = [0, 0, 0];
    forkLiftProgress = 0.52;
  } else if (scrollProgress < 0.305) {
    // Turn and lower only in the open warehouse apron, away from the platform.
    const t = smoothstep(0.287, 0.305, scrollProgress);
    forkliftPos = [lerp(-8.5, -3.5, t), 0, lerp(-31, -33, t)];
    forkliftRot = [0, Math.PI * t, 0];
    forkLiftProgress = lerp(0.52, 0.12, t);
  } else if (scrollProgress < 0.345) {
    // Forklift transports pallet down the high-bay storage aisle toward Stage 03
    const t = smoothstep(0.305, 0.345, scrollProgress);
    // Smooth aisle lane change with the forklift facing its direction of travel.
    const lateral = t * t * (3 - 2 * t);
    forkliftPos = [lerp(-3.5, 3.8, lateral), 0, lerp(-33, -68, t)];
    const heading = Math.atan2(7.3 * 6 * t * (1 - t), -35);
    forkliftRot = [0, heading, 0];
    forkLiftProgress = 0.12;
    palletPos = [forkliftPos[0], 0.15 + forkLiftProgress * 2.65, forkliftPos[2] - 1.5];
    palletRot = [0, Math.PI, 0];
  } else if (scrollProgress < 0.365) {
    // Forklift arrives at Bay 1 and turns 90 degrees to face Right Storage Rack
    const t = smoothstep(0.345, 0.365, scrollProgress);
    forkliftPos = [lerp(3.8, 4.2, t), 0, -68.0];
    const rotY = lerp(Math.PI, Math.PI / 2, t);
    forkliftRot = [0, rotY, 0];
    forkLiftProgress = 0.12;
    palletPos = [
      forkliftPos[0] + Math.sin(rotY) * 1.5,
      0.15 + forkLiftProgress * 2.65,
      forkliftPos[2] + Math.cos(rotY) * 1.5,
    ];
    palletRot = [0, rotY, 0];
  } else if (scrollProgress < 0.375) {
    // Stop outside the rack and raise the load above the destination shelf.
    forkliftPos = [4.2, 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = lerp(0.12, raisedLift, smoothstep(0.365, 0.375, scrollProgress));
  } else if (scrollProgress < 0.385) {
    // Insert the pallet into the middle bay while keeping the mast level.
    forkliftPos = [lerp(4.2, 6.35, smoothstep(0.375, 0.385, scrollProgress)), 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = raisedLift;
  } else if (scrollProgress < 0.39) {
    // Lower onto the shelf before releasing the load.
    forkliftPos = [6.35, 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = lerp(raisedLift, placementLift, smoothstep(0.385, 0.39, scrollProgress));
  } else {
    // Clear the target rack before turning, then weave through the open gaps
    // in the two inventory rows instead of driving through their frames.
    const clearRack = smoothstep(0.39, 0.415, scrollProgress);
    const forwardTurn = smoothstep(0.415, 0.44, scrollProgress);
    let onwardX = lerp(6.35, 3.5, clearRack);
    let onwardZ = -68;
    if (scrollProgress >= 0.44 && scrollProgress < 0.48) {
      onwardX = 3.5;
      onwardZ = lerp(-68, -90, smoothstep(0.44, 0.48, scrollProgress));
    } else if (scrollProgress < 0.51 && scrollProgress >= 0.48) {
      const gapApproach = smoothstep(0.48, 0.51, scrollProgress);
      onwardX = lerp(3.5, 8, gapApproach);
      onwardZ = lerp(-90, -104, gapApproach);
    } else if (scrollProgress < 0.53 && scrollProgress >= 0.51) {
      onwardX = 8;
      onwardZ = lerp(-104, -112, smoothstep(0.51, 0.53, scrollProgress));
    } else if (scrollProgress < 0.56 && scrollProgress >= 0.53) {
      const laneChange = smoothstep(0.53, 0.56, scrollProgress);
      onwardX = lerp(8, 0, laneChange);
      onwardZ = lerp(-112, -121, laneChange);
    } else if (scrollProgress >= 0.56 && scrollProgress < 0.6) {
      onwardX = 0;
      onwardZ = lerp(-121, -145, smoothstep(0.56, 0.6, scrollProgress));
    } else if (scrollProgress >= 0.6) {
      const assemblyApproach = smoothstep(0.6, 0.625, scrollProgress);
      onwardX = lerp(0, 3.5, assemblyApproach);
      onwardZ = lerp(-145, -157, assemblyApproach);
    }
    forkliftPos = [onwardX, 0, onwardZ];
    forkliftRot = [0, lerp(Math.PI / 2, Math.PI, forwardTurn), 0];
    forkLiftProgress = lerp(placementLift, 0.12, smoothstep(0.415, 0.45, scrollProgress));
    palletPos = [8, shelfPalletY, -68];
    palletRot = [0, Math.PI / 2, 0];
  }

  // A single attachment transform keeps the received pallet locked to the forks
  // through lifting, turns, warehouse transit and rack insertion.
  const palletOnForks = scrollProgress >= 0.255 && scrollProgress < 0.39;
  if (palletOnForks) {
    const heading = forkliftRot[1];
    palletPos = [
      forkliftPos[0] + Math.sin(heading) * forkLoadOffset,
      0.15 + forkLiftProgress * 2.65 + palletCarriageOffset,
      forkliftPos[2] + Math.cos(heading) * forkLoadOffset,
    ];
    palletRot = [...forkliftRot];
  }

  // After putaway, the next warehouse-issued material load travels with the
  // forklift to assembly. The received pallet remains stored in its bin.
  const issuedMaterialVisible = scrollProgress >= 0.415 && scrollProgress < 0.75;
  const issuedHeading = forkliftRot[1];
  const issuedPalletOnForks: [number, number, number] = [
    forkliftPos[0] + Math.sin(issuedHeading) * forkLoadOffset,
    0.15 + forkLiftProgress * 2.65 + palletCarriageOffset,
    forkliftPos[2] + Math.cos(issuedHeading) * forkLoadOffset,
  ];
  const assemblyHandoff = smoothstep(0.625, 0.64, scrollProgress);
  const issuedPalletPos: [number, number, number] = [
    lerp(issuedPalletOnForks[0], 1.8, assemblyHandoff),
    lerp(issuedPalletOnForks[1], 1.05, assemblyHandoff),
    lerp(issuedPalletOnForks[2], -160.5, assemblyHandoff),
  ];
  const issuedPalletRot: [number, number, number] = [0, lerp(issuedHeading, 0, assemblyHandoff), 0];

  // 3. Scene 5: Robotic assembly kinematics (progress 0.64 to 0.76)
  const robotProgress = clamp((scrollProgress - 0.64) / 0.11, 0, 1);

  // One outbound truck: close doors, pull clear, turn into the exit lane,
  // wait for the boom, then depart. All transforms reverse with scrolling.
  const departureDoors = 1 - smoothstep(0.925, 0.938, scrollProgress);
  let truckExitPos: [number, number, number] = [-8.5, 0, -204.5];
  let departureHeading = 0;
  let departureDistance = 0;
  const turnRadius = 4.65;
  const barrier2Open = smoothstep(0.978, 0.986, scrollProgress);
  if (scrollProgress < 0.95) {
    const distance = 7.5 * smoothstep(0.938, 0.95, scrollProgress);
    truckExitPos = [-8.5, 0, -204.5 + distance];
    departureDistance = distance;
  } else if (scrollProgress < 0.965) {
    const angle = Math.PI * smoothstep(0.95, 0.965, scrollProgress);
    truckExitPos = [
      -8.5 + turnRadius * (1 - Math.cos(angle)),
      0,
      -197 + turnRadius * Math.sin(angle),
    ];
    departureHeading = angle;
    departureDistance = 7.5 + turnRadius * angle;
  } else {
    departureHeading = Math.PI;
    const approach = 47 * smoothstep(0.965, 0.98, scrollProgress);
    const exit = 26 * smoothstep(0.986, 1, scrollProgress);
    truckExitPos = [0.8, 0, -197 - approach - exit];
    departureDistance = 7.5 + Math.PI * turnRadius + approach + exit;
  }

  // Show the dispatch loading operation before the doors close. Once loaded,
  // both pallets use truck-local offsets so they travel with the trailer.
  const outboundLoad1 = smoothstep(0.895, 0.91, scrollProgress);
  const outboundLoad2 = smoothstep(0.91, 0.925, scrollProgress);
  const truckLocalPoint = (
    localX: number,
    localY: number,
    localZ: number,
  ): [number, number, number] => [
    truckExitPos[0] + localX * Math.cos(departureHeading) + localZ * Math.sin(departureHeading),
    localY,
    truckExitPos[2] - localX * Math.sin(departureHeading) + localZ * Math.cos(departureHeading),
  ];
  const loadedPallet1 = truckLocalPoint(-0.42, 1.05, -2.8);
  const loadedPallet2 = truckLocalPoint(0.42, 1.05, -0.8);
  const outboundPallet1Pos: [number, number, number] = [
    lerp(-8.5, loadedPallet1[0], outboundLoad1),
    lerp(1.25, loadedPallet1[1], outboundLoad1),
    lerp(-210, loadedPallet1[2], outboundLoad1),
  ];
  const outboundPallet2Pos: [number, number, number] = [
    lerp(-6, loadedPallet2[0], outboundLoad2),
    lerp(1.25, loadedPallet2[1], outboundLoad2),
    lerp(-210, loadedPallet2[2], outboundLoad2),
  ];
  const dispatchLoading = scrollProgress >= 0.89 && scrollProgress < 0.928;
  const activeOutboundPallet = scrollProgress < 0.91 ? outboundPallet1Pos : outboundPallet2Pos;
  const dispatchLoaderPos: [number, number, number] = [
    activeOutboundPallet[0],
    0,
    Math.min(activeOutboundPallet[2] - 1.65, -211.2),
  ];

  return (
    <div className="absolute inset-0 -z-10 bg-[#e7e9e5] overflow-hidden">
      <Canvas
        frameloop="always"
        performance={{ min: 0.65, max: 1, debounce: 250 }}
        camera={{ position: [-6.5, 17.5, 43.5], fov: 48, near: 0.1, far: 4000 }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          alpha: false,
          stencil: false,
          depth: true,
        }}
        dpr={[1, 1.5]}
        shadows
      >
        <color attach="background" args={["#e7e9e5"]} />
        <fog attach="fog" args={["#e7e9e5", 90, 300]} />
        <hemisphereLight args={["#fffaf0", "#7e8580", 0.6]} />

        {/* ─── LIGHTING RIG (DAYLIGHT) ─── */}
        <ambientLight intensity={1.2} color="#ffffff" />
        <directionalLight
          position={[20, 35, 25]}
          intensity={2.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-far={180}
          shadow-camera-left={-30}
          shadow-camera-right={30}
          shadow-camera-top={30}
          shadow-camera-bottom={-30}
          color="#fffbeb"
        />

        {/* Key Operational Luminaires */}
        {/* Gate Entry Perimeter Illumination */}
        <pointLight position={[2, 6, 22]} intensity={3.5} color="#38bdf8" distance={25} />
        {/* Receiving Dock Illumination */}
        <pointLight position={[-4, 7, -22]} intensity={3.5} color="#38bdf8" distance={25} />
        {/* Storage Aisle Illumination */}
        <pointLight position={[-10, 8, -50]} intensity={2.5} color="#06b6d4" distance={35} />
        {/* Inventory High Matrix Illumination */}
        <pointLight position={[10, 12, -120]} intensity={3.0} color="#38bdf8" distance={45} />
        {/* Robotic Workcell Illumination */}
        <pointLight position={[-8, 6, -180]} intensity={2.5} color="#2dd4bf" distance={35} />
        {/* Outbound Dispatch Dock Illumination */}
        <pointLight position={[-4, 7, -210]} intensity={3.5} color="#38bdf8" distance={25} />
        {/* Exit Gate Illumination */}
        <pointLight position={[2, 6, -248]} intensity={3.5} color="#38bdf8" distance={25} />

        <Suspense fallback={null}>
          {/* Nature Environment (Hills & Trees) */}
          <NatureEnvironment />

          {/* Supplier ASN story: sent, carried to security, then opened. */}
          <SupplierAsnEnvelope
            // The inbound scene ends at the receiving-dock keyframe. Keep the
            // envelope timeline local to that scene instead of the whole page.
            progress={supplierProgress}
            visible={journeyProgress < 0.12}
            asn={selectedAsn}
          />

          {/* Camera Controller: Guided trajectory or Free 3D Orbit */}
          {isFreeOrbit ? (
            <OrbitControls
              makeDefault
              maxPolarAngle={Math.PI / 2.05}
              minDistance={3}
              maxDistance={250}
            />
          ) : (
            <JourneyCamera
              stages={stages}
              scrollProgress={scrollProgress}
              overviewProgress={overviewProgress}
              supplierProgress={supplierProgress}
              mouseOffset={mouseOffset}
            />
          )}

          {/* ─── 3D WAREHOUSE ENVIRONMENT OBJECTS ─── */}
          <WarehouseBuilding />

          {/* ─── SCENE 1: INBOUND GATE ENTRY ─── */}
          <GateBarrier
            position={[0, 0, 15]}
            barrierOpenProgress={barrier1Open}
            securitySide="left"
          />

          {/* ─── SCENE 1 & 2: INBOUND LOGISTICS TRUCK (FL-8820) ─── */}
          {/* Drives from the gate to the apron, turns, and backs into the receiving dock. */}
          <LogisticsTruck
            position={truck1Pos}
            rotation={truck1Rot}
            doorsOpenProgress={truck1Doors}
            wheelRotation={wheelRot}
            isReversing={isReversing}
          />

          {/* ─── SCENE 2: INBOUND RECEIVING DOCK & GRN INSPECTION ─── */}
          <LoadingDock
            position={[-8.5, 0, -25]}
            doorOpenProgress={1}
            doorNumber="DOCK 02"
            pickupLane
          />

          {/* Warehouse Inspector: The man checking the goods list before forklift pick */}
          <DockInspector
            position={inspectorPos}
            rotation={inspectorRot}
            inspectionProgress={inspectProgress}
          />

          {/* ─── SCENE 2 & 3: DYNAMIC RECEIVED GOODS PALLET ─── */}
          {/* Truck cargo unloads onto the dock, is received by the worker, then collected by forklift. */}
          <PalletAndCargo
            position={palletPos}
            rotation={palletRot}
            hasCargo={true}
            boxCount={8}
            showQr={scrollProgress >= 0.22}
          />

          {/* ─── SCENE 3 & 4: STORAGE AISLES & INVENTORY MATRIX ─── */}
          {/* Left Rack Row 1 (Facing Inward into Aisle) */}
          <StorageRack
            position={[-7.5, 0, -68]}
            rotation={[0, Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          <StorageRack
            position={[-7.5, 0, -82]}
            rotation={[0, Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          {/* Right Rack Row 1 (Target Aisle - Facing Inward into Aisle) */}
          <StorageRack
            position={[8.0, 0, -68]}
            rotation={[0, -Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          <StorageRack
            position={[8.0, 0, -82]}
            rotation={[0, -Math.PI / 2, 0]}
            bays={3}
            tiers={4}
          />
          {/* High Inventory Overview Rows (Scene 4 Matrix) */}
          <StorageRack position={[-16, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[0, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[16, 0, -108]} bays={4} tiers={4} />
          <StorageRack position={[-8, 0, -125]} bays={4} tiers={4} />
          <StorageRack position={[8, 0, -125]} bays={4} tiers={4} />

          {/* Stocked inventory matrix: use the same pallet/cargo language as
              the receiving aisle so the inventory stage feels like the same
              physical warehouse, not a separate abstract scene. */}
          <PalletAndCargo
            position={[8.0, 1.66, -64.8]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={6}
          />
          <PalletAndCargo
            position={[8.0, 3.46, -71.2]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={8}
          />
          <PalletAndCargo
            position={[-7.5, 1.66, -68]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={8}
          />
          <PalletAndCargo
            position={[-7.5, 3.46, -80]}
            rotation={[0, Math.PI / 2, 0]}
            boxCount={6}
          />
          <PalletAndCargo position={[-16, 1.66, -107.3]} rotation={[0, 0, 0]} boxCount={7} />
          <PalletAndCargo position={[-16, 3.46, -107.3]} rotation={[0, 0, 0]} boxCount={5} />
          <PalletAndCargo position={[0, 1.66, -107.3]} rotation={[0, 0, 0]} boxCount={8} />
          <PalletAndCargo position={[16, 3.46, -107.3]} rotation={[0, 0, 0]} boxCount={6} />
          <PalletAndCargo position={[-8, 1.66, -124.3]} rotation={[0, 0, 0]} boxCount={6} />
          <PalletAndCargo position={[8, 3.46, -124.3]} rotation={[0, 0, 0]} boxCount={8} />

          {/* Putaway Forklift: Approaches Dock 02, picks cargo, drives down aisle, slots pallet into Bin 01 */}
          <WarehouseForklift
            position={forkliftPos}
            rotation={forkliftRot}
            forkLiftProgress={forkLiftProgress}
          />
          {issuedMaterialVisible && (
            <PalletAndCargo
              position={issuedPalletPos}
              rotation={issuedPalletRot}
              hasCargo
              boxCount={6}
              showQr
            />
          )}

          {/* Holographic Laser Scanner & Putaway Verification HUD at Rack Bay 1 */}
          {scrollProgress >= 0.365 && (
            <group position={[7.4, 2.5, -68.0]}>
              {/* Holographic Bin Bounding Box */}
              <mesh rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[1.5, 1.3]} />
                <meshBasicMaterial
                  color={scrollProgress >= 0.39 ? "#10b981" : "#06b6d4"}
                  wireframe
                  transparent
                  opacity={scrollProgress >= 0.39 ? 0.85 : 0.45}
                />
              </mesh>
              {/* Laser Scan Line Sweeping Across Boxes */}
              {scrollProgress < 0.39 && (
                <mesh
                  position={[0.02, Math.sin(scrollProgress * 60) * 0.4, 0]}
                  rotation={[0, -Math.PI / 2, 0]}
                >
                  <planeGeometry args={[1.4, 0.03]} />
                  <meshBasicMaterial color="#22d3ee" transparent opacity={0.9} />
                </mesh>
              )}
              {/* In-Scene 3D Floating Putaway Verification Tag */}
              <Html fullscreen zIndexRange={[45, 0]} style={{ pointerEvents: "none" }}>
                <div className="absolute bottom-6 left-4 max-w-[calc(100vw-2rem)] bg-slate-950/90 border border-emerald-500/70 px-4 py-3 rounded shadow-xl shadow-emerald-500/20 backdrop-blur pointer-events-none text-left sm:bottom-8 sm:left-8">
                  <div className="flex items-center justify-center gap-1.5 font-mono text-[10px] text-emerald-400 font-bold tracking-wider">
                    <span
                      className={`w-2 h-2 rounded-full ${scrollProgress >= 0.39 ? "bg-emerald-400" : "bg-cyan-400 animate-pulse"}`}
                    />
                    {scrollProgress >= 0.39
                      ? "BIN AISLE-04-B1 : STORED ✓"
                      : "PUTAWAY : SLOTTING BIN..."}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                    PLT-77291 • RACK-B-08 • TIER 01
                    {scrollProgress >= 0.39 && (
                      <div className="mt-1 text-emerald-300">INVENTORY UPDATED / AVAILABLE</div>
                    )}
                  </div>
                </div>
              </Html>
            </group>
          )}

          {/* ─── SCENE 5: PRODUCTION ASSEMBLY ─── */}
          {/* Automated Production Line Conveyor */}
          <ConveyorSystem position={[0.35, 0, -165]} length={16} width={1.1} height={0.96} />
          {/* Dual-Robot Automated Assembly & Goods-Box Packaging Station */}
          <PumpAssemblyCell position={[-0.8, 0, -165]} />

          {/* ─── SCENE 6: OUTBOUND DISPATCH DOCK ─── */}
          <LoadingDock position={[-8.5, 0, -212]} doorOpenProgress={1} doorNumber="BAY 06" />
          {/* Outbound Trailer docked and being loaded */}
          <LogisticsTruck
            position={truckExitPos}
            rotation={[0, departureHeading, 0]}
            doorsOpenProgress={departureDoors}
            wheelRotation={departureDistance / 0.49}
          />
          {/* Outbound wrapped pallets are loaded in sequence and then remain
              locked inside the trailer while it travels to gate exit. */}
          <PalletAndCargo position={outboundPallet1Pos} isWrapped boxCount={8} />
          <PalletAndCargo position={outboundPallet2Pos} isWrapped boxCount={8} />
          {dispatchLoading && (
            <WarehouseForklift
              position={dispatchLoaderPos}
              rotation={[0, 0, 0]}
              forkLiftProgress={0.34}
            />
          )}

          {/* ─── SCENE 7: DEPARTURE GATE EXIT ─── */}
          <GateBarrier position={[0, 0, -252]} barrierOpenProgress={barrier2Open} gateType="exit" />
        </Suspense>
      </Canvas>
    </div>
  );
}
