import { memo, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { Html } from "@react-three/drei";
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

interface JourneyCanvasProps {
  stages: JourneyStage[];
  activeIndex: number;
  scrollProgress: number; // 0 to 1
  overviewProgress?: number;
  mouseOffset: { x: number; y: number };
  onSelectStage: (index: number) => void;
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
  scrollProgress,
  overviewProgress = 1,
  mouseOffset,
  onSelectStage,
}: JourneyCanvasProps) {
  // ─── STAGE PROGRESS CALCULATIONS ───

  // Inbound truck: forward approach, apron turn, rear docking, then receiving.
  let truck1Pos: [number, number, number] = [0.8, 0, 20.5];
  let truck1Rot: [number, number, number] = [0, Math.PI, 0];
  let barrier1Open = 0;
  let dockDoorOpen = 0;
  let truck1Doors = 0;
  let wheelRot = 0;
  let isReversing = false;

  if (scrollProgress < 0.09) {
    // Approach the stop line, wait for security clearance, then pass the raised boom.
    const approach = smoothstep(0, 0.012, scrollProgress);
    const departure = smoothstep(0.034, 0.09, scrollProgress);
    barrier1Open = smoothstep(0.014, 0.032, scrollProgress);
    truck1Pos = [
      lerp(0.8, 0, departure),
      0,
      scrollProgress < 0.034 ? lerp(23, 21.5, approach) : lerp(21.5, -4, departure),
    ];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (scrollProgress < 0.11) {
    // Continue forward through the warehouse entrance into the turning apron.
    const t = smoothstep(0.09, 0.11, scrollProgress);
    barrier1Open = 1;
    truck1Pos = [0, 0, lerp(-4, -10, t)];
    truck1Rot = [0, Math.PI, 0];
    wheelRot = (23 - truck1Pos[2]) / 0.49;
  } else if (scrollProgress < 0.145) {
    // Follow a forward semicircle; the cab always points along the path tangent.
    const angle = smoothstep(0.11, 0.145, scrollProgress) * Math.PI;
    barrier1Open = 1;
    truck1Pos = [-4.25 + 4.25 * Math.cos(angle), 0, -10 - 4.25 * Math.sin(angle)];
    truck1Rot = [0, Math.PI + angle, 0];
    wheelRot = (33 + 4.25 * angle) / 0.49;
    dockDoorOpen = smoothstep(0.12, 0.145, scrollProgress);
  } else if (scrollProgress < 0.1667) {
    // Once aligned, reverse straight back to the dock bumpers.
    const t = smoothstep(0.145, 0.1667, scrollProgress);
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
    truck1Doors = smoothstep(0.1667, 0.185, scrollProgress);
  }

  // ─── SCENE 2: DOCK INSPECTOR (THE MAN CHECKING GOODS LIST BEFORE FORKLIFT PICK) ───
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
    // Leave this same pallet in its bin. Withdraw fully before lowering the forks.
    forkliftPos = [lerp(6.35, 4.2, smoothstep(0.39, 0.41, scrollProgress)), 0, -68];
    forkliftRot = [0, Math.PI / 2, 0];
    forkLiftProgress = lerp(placementLift, 0.12, smoothstep(0.41, 0.425, scrollProgress));
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

  // 3. Scene 5: Robotic assembly kinematics (progress 0.64 to 0.76)
  const robotProgress = clamp((scrollProgress - 0.64) / 0.11, 0, 1);

  // 4. Scene 7: Outbound departure truck driving through exit gate (progress 0.86 to 1.0)
  let truckExitPos: [number, number, number] = [0.8, 0, -244];
  let barrier2Open = 0;

  if (scrollProgress < 0.86) {
    truckExitPos = [0.8, 0, -244];
    barrier2Open = 0;
  } else if (scrollProgress < 0.9) {
    const t = (scrollProgress - 0.86) / 0.04;
    barrier2Open = t;
    truckExitPos = [0.8, 0, -244 - t * 2];
  } else {
    const t = clamp((scrollProgress - 0.9) / 0.1, 0, 1);
    barrier2Open = 1;
    truckExitPos = [0.8, 0, -246 - t * 20]; // drives out through exit barrier
  }

  return (
    <div className="absolute inset-0 -z-10 bg-sky-400 overflow-hidden">
      <Canvas
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
        <color attach="background" args={["#38bdf8"]} />
        <fog attach="fog" args={["#7dd3fc", 90, 300]} />

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

          {/* Continuous Camera Trajectory Controller */}
          <JourneyCamera
            stages={stages}
            scrollProgress={scrollProgress}
            overviewProgress={overviewProgress}
            mouseOffset={mouseOffset}
          />

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
          <PalletAndCargo position={palletPos} rotation={palletRot} hasCargo={true} boxCount={8} />

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

          {scrollProgress >= 0.225 && scrollProgress < 0.365 && (
            <Html
              position={[palletPos[0], palletPos[1] + 1.8, palletPos[2]]}
              center
              distanceFactor={12}
              zIndexRange={[40, 0]}
            >
              <div className="pointer-events-none whitespace-nowrap rounded border border-cyan-400/60 bg-slate-950/90 px-3 py-2 text-center font-mono text-[10px] text-cyan-300">
                <div>
                  {palletOnForks ? "TRANSPORTING TO INVENTORY" : "PICKING UP RECEIVED GOODS"}
                </div>
                <div className="mt-1 text-slate-300">PLT-77291 / AISLE-04 / RACK-B-08 / BIN B1</div>
              </div>
            </Html>
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
              <Html center distanceFactor={14} zIndexRange={[45, 0]}>
                <div className="bg-slate-950/90 border border-emerald-500/70 px-2.5 py-1.5 rounded shadow-xl shadow-emerald-500/20 backdrop-blur pointer-events-none whitespace-nowrap text-center">
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
          <LogisticsTruck position={[-8.5, 0, -204.5]} rotation={[0, 0, 0]} doorsOpenProgress={1} />
          {/* Outbound Wrapped Pallets ready for trailer */}
          <PalletAndCargo position={[-8.5, 1.25, -210]} isWrapped={true} boxCount={8} />
          <PalletAndCargo position={[-6.0, 1.25, -210]} isWrapped={true} boxCount={8} />

          {/* ─── SCENE 7: DEPARTURE GATE EXIT ─── */}
          <GateBarrier position={[0, 0, -252]} barrierOpenProgress={barrier2Open} />
          <LogisticsTruck
            position={truckExitPos}
            rotation={[0, Math.PI, 0]}
            doorsOpenProgress={0}
            wheelRotation={scrollProgress * 40}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
