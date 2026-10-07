# AMS/WMS Frontend Information

## 1) Main frontend folder

Project root:

- D:\ams-wms-platform

Main frontend folder:

- D:\ams-wms-platform\frontend

## 2) Frontend architecture

This workspace contains:

- frontend/
  - Main React + Vite frontend app
  - Contains routes, pages, components, and shared utilities

## 3) Frontend technology stack

Framework:

- React

Build tool:

- Vite

Language:

- TypeScript

Routing:

- TanStack Router

State/data:

- TanStack Query

UI styling:

- Tailwind CSS

Component library:

- Radix UI + custom components

## 4) Main app entry

Package file:

- D:\ams-wms-platform\frontend\package.json

Main source folder:

- D:\ams-wms-platform\frontend\src

Main route entry:

- D:\ams-wms-platform\frontend\src/router.tsx

App shell:

- D:\ams-wms-platform\frontend\src/routes/__root.tsx

## 5) Start the frontend locally

Open PowerShell and run:

```powershell
cd D:\ams-wms-platform\frontend
npm install
npm run dev
```

Then open the local app URL shown in the terminal, usually:

- http://localhost:8080

## 6) Useful frontend scripts

From the frontend folder:

```powershell
npm run dev
npm run build
npm run preview
npm run lint
```

## 7) App behavior and purpose

This frontend is a warehouse management system UI for workflows such as:

- arrival management
- gate entry
- dock assignment
- receiving flows
- notifications and dashboards

The project includes route files under:

- D:\ams-wms-platform\frontend\src\routes

## 8) Backend integration

The frontend talks to the backend service on:

- http://localhost:8000

The API client is likely configured in:

- D:\ams-wms-platform\frontend\src\lib\api-client.ts

## 9) Quick summary

- Main frontend folder: D:\ams-wms-platform\frontend
- Start command: npm run dev
- Local URL: http://localhost:8080
- Stack: React + TypeScript + Vite + Tailwind + TanStack Router + React Query

## 10) Notes

If the app does not start, make sure Node dependencies are installed and the project folder is correct:

```powershell
cd D:\ams-wms-platform\frontend
npm install
npm run dev
```

If you want, I can also create a combined backend + frontend setup guide in one file for the whole project.
