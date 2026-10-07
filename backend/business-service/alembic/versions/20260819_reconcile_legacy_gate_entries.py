"""Reconcile legacy approved gate entries with their ASN.

Revision ID: 20260819_gate_reconcile
Revises: 20260819_gate_asn
"""

from alembic import op


revision = "20260819_gate_reconcile"
down_revision = "20260819_gate_asn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Older gate entries were approved before gate_entry.asn_id existed. Link only
    # an unambiguous PO + vehicle match; ambiguous records remain untouched for
    # manual review instead of being attached to the wrong shipment.
    op.execute(
        """
        WITH matches AS (
            SELECT gate.id AS gate_entry_id, MIN(shipment.id::text)::uuid AS asn_id
            FROM gate_entry AS gate
            JOIN asn AS shipment
              ON UPPER(TRIM(shipment.po_number)) = UPPER(TRIM(gate.po_number))
             AND REGEXP_REPLACE(UPPER(COALESCE(shipment.vehicle_number, '')), '[^A-Z0-9]', '', 'g')
                 = REGEXP_REPLACE(UPPER(COALESCE(gate.vehicle_number, '')), '[^A-Z0-9]', '', 'g')
            WHERE gate.asn_id IS NULL
              AND gate.status IN ('APPROVED', 'GATE_ENTRY_APPROVED')
            GROUP BY gate.id
            HAVING COUNT(*) = 1
        )
        UPDATE gate_entry AS gate
           SET asn_id = matches.asn_id,
               status = 'AWAITING_DOCK',
               updated_at = CURRENT_TIMESTAMP
          FROM matches
         WHERE gate.id = matches.gate_entry_id
        """
    )
    op.execute(
        """
        UPDATE asn AS shipment
           SET status = 'GATE_ENTRY_APPROVED'
          FROM gate_entry AS gate
         WHERE gate.asn_id = shipment.id
           AND gate.status = 'AWAITING_DOCK'
           AND shipment.status IN ('DRAFT', 'SUBMITTED', 'APPROVED')
        """
    )


def downgrade() -> None:
    # This migration repairs operational data. Reverting it could detach the ASN
    # after downstream warehouse work has started, so downgrade is intentionally
    # non-destructive.
    pass
