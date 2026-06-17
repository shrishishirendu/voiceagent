---
name: run-app
description: Starts the Envoy voice agent app. Use when asked to run, launch, or start the app, or when told to bring up the dev server, scheduler, or both.
---

# Run Envoy App

Launches the full Envoy dev environment: kills any process on port 3000, syncs the Prisma DB schema, starts the Next.js web server + scheduler worker, then opens the app in the browser.

## Instructions

### Step 1: Kill any existing process on port 3000

Run in PowerShell:

```powershell
$pid3000 = (netstat -ano | Select-String ":3000 " | Where-Object { $_ -match "LISTENING" } | ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($pid3000) {
  Write-Host "Killing PID $pid3000 on port 3000..."
  taskkill /PID $pid3000 /F
} else {
  Write-Host "Port 3000 is free."
}
```

### Step 2: Sync Prisma schema to SQLite

```powershell
npm run db:push
```

This is idempotent — safe to run every time. It creates or updates `envoy.db` to match `prisma/schema.prisma`.

### Step 3: Start the app in the background

```powershell
npm run dev:all
```

Run this as a background process. It uses `concurrently` to run:
- `npm run dev` — Next.js dev server on port 3000 (shown in blue as `[web]`)
- `npm run scheduler` — standalone scheduler worker (shown in magenta as `[worker]`)

### Step 4: Wait for the server to be ready

Poll `http://localhost:3000` until it returns HTTP 200. Check every 3 seconds, up to ~60 seconds. Read the background task output file to show progress if it's taking long.

```powershell
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep 3
}
```

### Step 5: Open the app in the browser

```powershell
Start-Process "http://localhost:3000"
```

### Step 6: Report status

Tell the user:
- The app is running at **http://localhost:3000**
- Both the **web server** and **scheduler worker** are active
- The scheduler runs every minute and will dispatch queued invoices during configured business hours
- If a `.env` file is missing or `PUBLIC_URL` is not set, remind the user to configure it (needed for Vapi webhooks)
