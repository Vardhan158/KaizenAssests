import { CatmullRomCurve3, Vector3 } from "three";

// Architectural coordinates: first city building's front street, outer avenue,
// front link road, then the existing warehouse gate approach.
const route = new CatmullRomCurve3(
  [
    new Vector3(-96, 0, 22),
    new Vector3(-100, 0, 22),
    new Vector3(-110, 0, 28),
    new Vector3(-110, 0, 44),
    new Vector3(-103, 0, 52),
    new Vector3(-8, 0, 52),
    // Finish exactly at the existing Gate Entry truck start position so the
    // 10–15% supplier handoff does not jump or pause.
    new Vector3(0.8, 0, 45),
    new Vector3(0.8, 0, 23),
  ],
  false,
  "centripetal",
);
export function phase(value: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
export function supplierJourney(progress: number) {
  // Use almost the entire supplier stage so the truck approaches the gate
  // at a calm, readable pace instead of completing the route too quickly.
  const travel = phase(progress, 0.04, 0.96);
  const truck = route.getPointAt(travel);
  const tangent = route.getTangentAt(travel);
  const emergence = phase(progress, 0, 0.12);
  // Keep the ASN with the vehicle through the city approach. Once the truck
  // reaches the gate, hand the document directly to the entry-side guard.
  const handoff = phase(progress, 0.72, 0.9);
  const envelope = new Vector3(-96, 2.8, 17)
    .lerp(new Vector3(truck.x - 2.4, 5.4, truck.z), emergence)
    .lerp(new Vector3(-1.8, 3, 14.1), handoff);
  return {
    truck,
    envelope,
    heading: Math.atan2(tangent.x, tangent.z),
    wheels: (travel * route.getLength()) / 0.49,
    open: phase(progress, 0.76, 0.9),
  };
}
