---
name: run-app
description: Starts the Envoy demo3.0-UI voice agent app. Use when asked to run, launch, or start the app, or when told to bring up the dev server, scheduler, or both.
---

# Run Envoy demo3.0-UI App

Launches the full demo3.0-UI dev environment: kills any process on port 3010, syncs the Prisma DB schema, starts the Next.js web server + scheduler worker, then opens the app in the browser.

Note: this app runs on port **3010**, deliberately different from `demo2.0`'s port 3000, so both can run side by side without colliding. This skill does not start the ngrok tunnel — that's a separate manual step (`npm run tunnel`) only needed when testing real Vapi/Twilio calls, not for everyday UI viewing.

## Instructions

### Step 1: Kill any existing process on port 3010

Run in PowerShell:

```powershell
$pid3010 = (netstat -ano | Select-String ":3010 " | Where-Object { $_ -match "LISTENING" } | ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($pid3010) {
  Write-Host "Killing PID $pid3010 on port 3010..."
  taskkill /PID $pid3010 /F
} else {
  Write-Host "Port 3010 is free."
}
```

### Step 2: Sync Prisma schema to SQLite

```powershell
npm run db:push
```

This is idempotent — safe to run every time. It creates or updates `envoy-demo3.db` to match `prisma/schema.prisma`.

### Step 3: Start the app in the background

```powershell
npm run dev:all
```

Run this as a background process. It uses `concurrently` to run:
- `npm run dev` — Next.js dev server on port 3010 (shown in blue as `[web]`)
- `npm run scheduler` — standalone scheduler worker (shown in magenta as `[worker]`)

### Step 4: Wait for the server to be ready

Poll `http://localhost:3010` until it returns HTTP 200. Check every 3 seconds, up to ~60 seconds. Read the background task output file to show progress if it's taking long.

```powershell
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  try {
    $r = Invoke-WebRequest -Uri http://localhost:3010 -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
  Start-Sleep 3
}
```

### Step 5: Open the app in the browser

```powershell
Start-Process "http://localhost:3010/app/dashboard"
```

### Step 6: Report status

Tell the user:
- The app is running at **http://localhost:3010** (dashboard at `/app/dashboard`)
- Both the **web server** and **scheduler worker** are active
- The scheduler runs every minute and will dispatch queued invoices during configured business hours
- If a `.env` file is missing or `PUBLIC_URL` is not set, remind the user to configure it (needed for Vapi webhooks — only required for real call testing, see the `tunnel` command)
- Only one of `demo2.0` / `demo3.0-UI` should be actively dialing real calls at a time — they currently share one ngrok tunnel
