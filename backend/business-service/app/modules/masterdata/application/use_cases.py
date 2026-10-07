"""
Supplier Application Use Cases.
"""
from app.modules.masterdata.application.repository import SupplierRepositoryProtocol
from app.modules.masterdata.domain.supplier import Supplier, SupplierStatus


class CreateSupplierUseCase:
    def __init__(self, repo: SupplierRepositoryProtocol):
        self.repo = repo

    async def execute(
        self,
        supplier_code: str,
        supplier_name: str,
        category: str = "General",
        contact_person: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        address: str | None = None,
        gst_number: str | None = None,
        payment_terms: str | None = "NET30",
        bank_details: str | None = None,
    ) -> Supplier:
        existing = await self.repo.get_by_code(supplier_code)
        if existing:
            raise ValueError(f"Supplier with code '{supplier_code}' already exists")

        supplier = Supplier.create(
            supplier_code=supplier_code,
            supplier_name=supplier_name,
            category=category,
            contact_person=contact_person,
            email=email,
            phone=phone,
            address=address,
            gst_number=gst_number,
            payment_terms=payment_terms,
            bank_details=bank_details,
        )
        return await self.repo.save(supplier)


class UpdateSupplierUseCase:
    def __init__(self, repo: SupplierRepositoryProtocol):
        self.repo = repo

    async def execute(
        self,
        supplier_id: str,
        supplier_name: str | None = None,
        category: str | None = None,
        contact_person: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        address: str | None = None,
        gst_number: str | None = None,
        payment_terms: str | None = None,
        bank_details: str | None = None,
        status: str | None = None,
    ) -> Supplier:
        supplier = await self.repo.get_by_id(supplier_id)
        if not supplier:
            raise ValueError(f"Supplier '{supplier_id}' not found")

        status_enum = SupplierStatus(status) if status else None
        supplier.update_info(
            supplier_name=supplier_name,
            category=category,
            contact_person=contact_person,
            email=email,
            phone=phone,
            address=address,
            gst_number=gst_number,
            payment_terms=payment_terms,
            bank_details=bank_details,
            status=status_enum,
        )
        return await self.repo.save(supplier)


class GetSupplierUseCase:
    def __init__(self, repo: SupplierRepositoryProtocol):
        self.repo = repo

    async def execute(self, supplier_id: str) -> Supplier:
        supplier = await self.repo.get_by_id(supplier_id)
        if not supplier:
            raise ValueError(f"Supplier '{supplier_id}' not found")
        return supplier


class ListSuppliersUseCase:
    def __init__(self, repo: SupplierRepositoryProtocol):
        self.repo = repo

    async def execute(
        self,
        category: str | None = None,
        status: str | None = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Supplier], int]:
        return await self.repo.list_all(category=category, status=status, skip=skip, limit=limit)
