# Windows / PowerShell setup

## Recommended project location

Do not run the project inside OneDrive when possible. OneDrive, antivirus software and an active Node process can lock files under `node_modules`, causing `EPERM` errors.

Recommended directory:

```powershell
New-Item -ItemType Directory -Force C:\dev | Out-Null
Copy-Item -Recurse -Force ".\football-ai-platform-mvp" "C:\dev\football-ai-platform-mvp"
Set-Location "C:\dev\football-ai-platform-mvp"
```

## Automated clean install

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-clean-install.ps1
```

The script:

- stops running Node processes;
- removes a partial `node_modules` directory;
- replaces any legacy private-registry URL in `package-lock.json`;
- selects the public npm registry;
- verifies the npm cache;
- installs packages;
- generates Prisma Client.

## Manual clean install

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
npm config set registry https://registry.npmjs.org/ --location=project
npm config delete proxy --location=project
npm config delete https-proxy --location=project
npm cache verify
npm install --registry=https://registry.npmjs.org/
npm run db:generate
```

If `node_modules` cannot be removed:

```powershell
cmd /c "rmdir /s /q node_modules"
```

## MySQL

The local commands require MySQL 8 to be running and the database credentials in `.env` to be valid.

Default `.env` connection:

```dotenv
DATABASE_URL="mysql://football:football_password@localhost:3306/football_ai"
```

Create the user and database, or change `DATABASE_URL` to an existing MySQL account. Then run:

```powershell
npm run db:push
npm run db:seed
npm run worker -- generate
npm run dev
```

Alternatively, start MySQL through Docker Desktop:

```powershell
docker compose up -d mysql
npm run db:push
npm run db:seed
npm run worker -- generate
npm run dev
```

## Why `prisma` and `tsx` were not recognized

Both commands are local development dependencies. Their executables are installed into `node_modules/.bin` by `npm install`. If installation fails or stops early, npm scripts cannot find them.
