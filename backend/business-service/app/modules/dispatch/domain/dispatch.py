from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
import uuid

class DispatchStatus(str, Enum):
    DRAFT = "DRAFT"
    STOCK_RESERVED = "STOCK_RESERVED"
    PICKING_IN_PROGRESS = "PICKING_IN_PROGRESS"
    PICKED = "PICKED"
    PACKING_IN_PROGRESS = "PACKING_IN_PROGRESS"
    PACKED = "PACKED"
    DRIVER_ALLOCATED = "DRIVER_ALLOCATED"
    VEHICLE_ALLOCATED = "VEHICLE_ALLOCATED"
    ROUTE_ASSIGNED = "ROUTE_ASSIGNED"
    LOADING_STARTED = "LOADING_STARTED"
    LOADING_VERIFIED = "LOADING_VERIFIED"
    READY_FOR_GATE_EXIT = "READY_FOR_GATE_EXIT"
    DISPATCHED = "DISPATCHED"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"
    RETURNED = "RETURNED"

@dataclass
class DispatchItem:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    material_code: str = ""
    material_name: str = ""
    quantity_ordered: float = 0.0
    quantity_available: float = 0.0
    quantity_reserved: float = 0.0
    quantity_picked: float = 0.0
    quantity_packed: float = 0.0
    quantity_loaded: float = 0.0
    quantity_pending: float = 0.0
    uom: str = "PCS"
    batch: str | None = None
    bin: str | None = None
    status: str = "PENDING"

@dataclass
class DispatchOrder:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    dispatch_number: str = field(default_factory=lambda: f"FG-DISP-{datetime.now().year}-{uuid.uuid4().hex[:6].upper()}")
    order_number: str = ""
    customer_name: str = ""
    warehouse_id: str = "WH-01"
    dispatch_type: str | None = "Standard"
    status: DispatchStatus = DispatchStatus.DRAFT
    items: list[DispatchItem] = field(default_factory=list)
    driver_id: str | None = None
    vehicle_id: str | None = None
    route_code: str | None = None
    delivery_address: str | None = None
    destination: str | None = None
    scheduled_date: datetime | None = None
    expected_delivery_date: datetime | None = None
    priority: str = "Normal"
    contact_person: str | None = None
    contact_phone: str | None = None
    delivery_instructions: str | None = None
    transport_mode: str | None = "Road"
    transport_type: str | None = "Full Truckload"
    transporter: str | None = None
    notes: str | None = None
    current_location: str | None = None
    distance_travelled_km: float = 0.0
    remaining_distance_km: float = 0.0
    eta_minutes: float = 0.0
    route_path: str | None = None
    route_deviation: str | None = None
    driver_status: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    recorded_events: list[object] = field(default_factory=list, repr=False)

    @classmethod
    def create(
        cls,
        order_number: str,
        customer_name: str,
        warehouse_id: str = "WH-01",
        dispatch_type: str | None = "Standard",
        items: list[DispatchItem] | None = None,
        delivery_address: str | None = None,
        destination: str | None = None,
        scheduled_date: datetime | None = None,
        expected_delivery_date: datetime | None = None,
        priority: str = "Normal",
        contact_person: str | None = None,
        contact_phone: str | None = None,
        delivery_instructions: str | None = None,
        transport_mode: str | None = "Road",
        transport_type: str | None = "Full Truckload",
        transporter: str | None = None,
        notes: str | None = None,
        dispatch_id: str | None = None,
        dispatch_number: str | None = None,
    ) -> DispatchOrder:
        if not order_number:
            raise ValueError("Order number is required for dispatch order")
        if not customer_name:
            raise ValueError("Customer name is required for dispatch order")
        
        order = cls(
            id=dispatch_id or str(uuid.uuid4()),
            dispatch_number=dispatch_number or f"FG-DISP-{datetime.now().year}-{uuid.uuid4().hex[:6].upper()}",
            order_number=order_number,
            customer_name=customer_name,
            warehouse_id=warehouse_id,
            dispatch_type=dispatch_type,
            items=items or [],
            status=DispatchStatus.DRAFT,
            delivery_address=delivery_address,
            destination=destination,
            scheduled_date=scheduled_date,
            expected_delivery_date=expected_delivery_date,
            priority=priority,
            contact_person=contact_person,
            contact_phone=contact_phone,
            delivery_instructions=delivery_instructions,
            transport_mode=transport_mode,
            transport_type=transport_type,
            transporter=transporter,
            notes=notes,
        )
        return order

    def reserve_stock(self) -> None:
        for item in self.items:
            qty_to_reserve = item.quantity_ordered
            if item.quantity_available < qty_to_reserve:
                raise ValueError(
                    f"Insufficient stock for {item.material_code} ({item.material_name}). "
                    f"Available: {item.quantity_available}, Required: {qty_to_reserve}"
                )
            item.quantity_reserved = qty_to_reserve
            item.quantity_available = max(0.0, item.quantity_available - qty_to_reserve)
            item.status = "RESERVED"
        self.status = DispatchStatus.STOCK_RESERVED
        self.updated_at = datetime.now(timezone.utc)

    def start_picking(self) -> None:
        self.status = DispatchStatus.PICKING_IN_PROGRESS
        self.updated_at = datetime.now(timezone.utc)

    def pick_items(self, picked_items_data: list[dict]) -> None:
        if self.status != DispatchStatus.PICKING_IN_PROGRESS:
            raise ValueError("Dispatch must be in picking before items can be picked")
        seen: set[str] = set()
        for p in picked_items_data:
            item_id = p.get("id") or p.get("material_code")
            if not item_id or item_id in seen:
                raise ValueError("Each dispatch item may be picked only once per request")
            seen.add(item_id)
            qty = float(p.get("quantity_picked", 0.0))
            if qty < 0:
                raise ValueError("Picked quantity cannot be negative")
            for item in self.items:
                if item.id == item_id or item.material_code == item_id:
                    if qty > item.quantity_reserved:
                        raise ValueError(f"Picked quantity exceeds reserved quantity for {item.material_code}")
                    item.quantity_picked = qty
                    item.status = "PICKED"
                    break
            else:
                raise ValueError(f"Item {item_id} does not belong to this dispatch")
        if any(item.quantity_picked != item.quantity_reserved for item in self.items):
            raise ValueError("All reserved dispatch quantities must be picked before packing")
        self.status = DispatchStatus.PICKED
        self.updated_at = datetime.now(timezone.utc)

    def start_packing(self) -> None:
        self.status = DispatchStatus.PACKING_IN_PROGRESS
        self.updated_at = datetime.now(timezone.utc)

    def pack_items(self, packed_items_data: list[dict]) -> None:
        if self.status != DispatchStatus.PACKING_IN_PROGRESS:
            raise ValueError("Dispatch must be in packing before items can be packed")
        for p in packed_items_data:
            item_id = p.get("id") or p.get("material_code")
            qty = float(p.get("quantity_packed", 0.0))
            for item in self.items:
                if item.id == item_id or item.material_code == item_id:
                    if qty != item.quantity_picked:
                        raise ValueError(f"Packed quantity must equal picked quantity for {item.material_code}")
                    item.quantity_packed = qty
                    item.status = "PACKED"
                    break
            else:
                raise ValueError(f"Item {item_id} does not belong to this dispatch")
        if any(item.quantity_packed != item.quantity_picked for item in self.items):
            raise ValueError("All picked quantities must be packed before loading")
        self.status = DispatchStatus.PACKED
        self.updated_at = datetime.now(timezone.utc)

    def allocate_driver(self, driver_id: str) -> None:
        self.driver_id = driver_id
        self.status = DispatchStatus.DRIVER_ALLOCATED
        self.updated_at = datetime.now(timezone.utc)

    def allocate_vehicle(self, vehicle_id: str) -> None:
        self.vehicle_id = vehicle_id
        self.status = DispatchStatus.VEHICLE_ALLOCATED
        self.updated_at = datetime.now(timezone.utc)

    def assign_route(self, route_code: str) -> None:
        self.route_code = route_code
        self.status = DispatchStatus.ROUTE_ASSIGNED
        self.updated_at = datetime.now(timezone.utc)

    def start_loading(self) -> None:
        self.status = DispatchStatus.LOADING_STARTED
        self.updated_at = datetime.now(timezone.utc)

    def verify_loading(self) -> None:
        for item in self.items:
            item.quantity_loaded = float(item.quantity_packed or item.quantity_ordered)
            item.status = "LOADED"
        self.status = DispatchStatus.LOADING_VERIFIED
        self.updated_at = datetime.now(timezone.utc)

    def verify_final(self) -> None:
        self.status = DispatchStatus.READY_FOR_GATE_EXIT
        self.updated_at = datetime.now(timezone.utc)

    def dispatch(self) -> None:
        for item in self.items:
            item.status = "DISPATCHED"
        self.status = DispatchStatus.DISPATCHED
        self.updated_at = datetime.now(timezone.utc)

    def transit(self) -> None:
        self.status = DispatchStatus.IN_TRANSIT
        self.updated_at = datetime.now(timezone.utc)

    def deliver(self) -> None:
        self.status = DispatchStatus.DELIVERED
        self.updated_at = datetime.now(timezone.utc)

    def close(self) -> None:
        self.status = DispatchStatus.CLOSED
        self.updated_at = datetime.now(timezone.utc)

    def cancel(self) -> None:
        self.status = DispatchStatus.CANCELLED
        self.updated_at = datetime.now(timezone.utc)

    def return_order(self) -> None:
        self.status = DispatchStatus.RETURNED
        self.updated_at = datetime.now(timezone.utc)
