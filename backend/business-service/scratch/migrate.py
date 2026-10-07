import asyncio
import asyncpg

async def run_migration():
    conn = await asyncpg.connect('postgresql://ams_business:ams_business@localhost:5432/ams_business')
    try:
        # Add the column if it doesn't exist
        print("Adding batch_number column...")
        try:
            await conn.execute('ALTER TABLE putaway_task ADD COLUMN batch_number VARCHAR(128);')
        except asyncpg.exceptions.DuplicateColumnError:
            print("Column batch_number already exists.")

        # Drop the old constraint
        print("Dropping old constraint...")
        try:
            await conn.execute('ALTER TABLE putaway_task DROP CONSTRAINT uq_putaway_task_grn_item;')
        except Exception as e:
            print(f"Could not drop constraint: {e}")

        # Add the new constraint
        print("Adding new constraint...")
        try:
            await conn.execute('ALTER TABLE putaway_task ADD CONSTRAINT uq_putaway_task_grn_item_batch UNIQUE (grn_id, item_code, batch_number);')
        except Exception as e:
            print(f"Could not add constraint: {e}")

        print("Migration complete!")
    finally:
        await conn.close()

if __name__ == '__main__':
    asyncio.run(run_migration())
