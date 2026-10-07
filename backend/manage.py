#!/usr/bin/env python
"""
AMS/WMS Backend Management CLI wrapper script.
Provides familiar `python manage.py runserver`, `migrate`, and `test` commands for FastAPI & Alembic.
"""
import os
import sys
import subprocess


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "runserver"

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    business_service_dir = os.path.join(backend_dir, "business-service")

    if command in ("runserver", "server"):
        port = 8000
        host = "127.0.0.1"

        for idx, arg in enumerate(sys.argv):
            if arg == "--port" and idx + 1 < len(sys.argv):
                port = int(sys.argv[idx + 1])
            elif arg == "--host" and idx + 1 < len(sys.argv):
                host = sys.argv[idx + 1]
            elif ":" in arg and not arg.startswith("-"):
                # e.g. python manage.py runserver 8000 or 127.0.0.1:8000
                parts = arg.split(":")
                if len(parts) == 2:
                    host, port = parts[0], int(parts[1])
                elif parts[0].isdigit():
                    port = int(parts[0])

        display_host = "localhost" if host == "0.0.0.0" else host
        print(f"Starting AMS/WMS Business Service FastAPI server:")
        print(f"  -> Server: http://{display_host}:{port}")
        print(f"  -> Docs:   http://{display_host}:{port}/docs")
        sys.path.insert(0, business_service_dir)
        os.chdir(business_service_dir)
        import uvicorn

        uvicorn.run("app.main:app", host=host, port=port, reload=True, app_dir=business_service_dir)

    elif command in ("migrate", "makemigrations"):
        print("Running Alembic migrations...")
        ini_path = os.path.join(business_service_dir, "alembic.ini")
        cmd = [sys.executable, "-c", f"import sys; from alembic.config import main; sys.exit(main(argv=['-c', r'{ini_path}', 'upgrade', 'head']))"]
        subprocess.run(cmd, cwd=business_service_dir)

    elif command in ("test", "pytest"):
        print("Running test suite...")
        cmd = [sys.executable, "-m", "pytest"] + sys.argv[2:]
        subprocess.run(cmd, cwd=business_service_dir)

    elif command == "flush":
        print("!!! WARNING: THIS WILL PERMANENTLY DELETE ALL BUSINESS DATA !!!")
        confirm = input("Are you sure you want to proceed? (yes/no): ")
        if confirm.lower() == 'yes':
            print("Wiping business data...")
            cmd = [sys.executable, "scripts/wipe_business_data.py", "--force"]
            subprocess.run(cmd, cwd=business_service_dir)
            print("\nBusiness data wiped.")
            print("\nNote: Auth data was NOT wiped. To wipe auth data, use:")
            print("  psql -h localhost -p 5432 -U ams_auth -d ams_auth -f auth-service/wipe_auth_data.sql")
        else:
            print("Operation cancelled.")

    else:
        print(f"Unknown command: '{command}'")
        print("\nAvailable commands:")
        print("  python manage.py runserver  - Starts the FastAPI Uvicorn dev server")
        print("  python manage.py migrate    - Runs Alembic database migrations")
        print("  python manage.py flush      - Wipes all data from the business database")
        print("  python manage.py test       - Runs Pytest test suite")
        sys.exit(1)


if __name__ == "__main__":
    main()
