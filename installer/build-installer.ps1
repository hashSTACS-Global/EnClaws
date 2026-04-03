<#
.SYNOPSIS
    Build the EnClaws Windows offline installer EXE.

.DESCRIPTION
    Downloads portable Node.js 22, prepares the application bundle with all
    production dependencies, and compiles an Inno Setup installer.

.PARAMETER NodeVersion
    Node.js version to bundle (default: 22.16.0).

.PARAMETER Registry
    npm registry URL. Useful for Chinese mirrors (e.g. https://registry.npmmirror.com).

.PARAMETER SkipBuild
    Skip `pnpm build && pnpm ui:build`. Use when dist/ is already up-to-date.

.PARAMETER InnoSetupPath
    Path to the Inno Setup compiler (iscc.exe). Auto-detected if installed.

.EXAMPLE
    .\build-installer.ps1
    .\build-installer.ps1 -Registry https://registry.npmmirror.com
    .\build-installer.ps1 -SkipBuild -NodeVersion 22.16.0
#>

param(
    [string]$NodeVersion = "22.16.0",
    [string]$Registry = "",
    [switch]$SkipBuild,
    [string]$InnoSetupPath = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # Speed up Invoke-WebRequest

# Helper: write text as UTF-8 without BOM (PS5 -Encoding UTF8 adds BOM which breaks JSON.parse)
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, $script:Utf8NoBom)
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$InstallerDir = $PSScriptRoot
$NodePortableDir = Join-Path $InstallerDir "node-portable"
$AppBundleDir = Join-Path $InstallerDir "app-bundle"
$OutputDir = Join-Path $InstallerDir "Output"

Write-Host ""
Write-Host "  EnClaws Installer Builder" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Step 0: Read version from package.json
# ---------------------------------------------------------------------------

$PackageJson = Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
$AppVersion = $PackageJson.version
Write-Host "[*] Version: $AppVersion" -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Step 1: Download portable Node.js
# ---------------------------------------------------------------------------

$NodeZipName = "node-v${NodeVersion}-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/v${NodeVersion}/${NodeZipName}"
$NodeZipPath = Join-Path $InstallerDir $NodeZipName
$NodeExtractDir = Join-Path $InstallerDir "node-v${NodeVersion}-win-x64"

if (Test-Path $NodePortableDir) {
    # Check if the bundled version matches
    $existingVersion = $null
    try {
        $existingVersion = (& (Join-Path $NodePortableDir "node.exe") -v 2>$null).Trim()
    } catch {}

    if ($existingVersion -eq "v${NodeVersion}") {
        Write-Host "[OK] Node.js v${NodeVersion} already present" -ForegroundColor Green
    } else {
        Write-Host "[*] Replacing existing Node.js ($existingVersion -> v${NodeVersion})..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $NodePortableDir
    }
}

if (-not (Test-Path $NodePortableDir)) {
    if (-not (Test-Path $NodeZipPath)) {
        Write-Host "[*] Downloading Node.js v${NodeVersion} portable..." -ForegroundColor Yellow
        Write-Host "    $NodeUrl" -ForegroundColor Gray
        Invoke-WebRequest -Uri $NodeUrl -OutFile $NodeZipPath -UseBasicParsing
        Write-Host "[OK] Downloaded" -ForegroundColor Green
    } else {
        Write-Host "[OK] Node.js zip already cached" -ForegroundColor Green
    }

    Write-Host "[*] Extracting Node.js..." -ForegroundColor Yellow
    Expand-Archive -Path $NodeZipPath -DestinationPath $InstallerDir -Force
    Rename-Item $NodeExtractDir $NodePortableDir
    Write-Host "[OK] Node.js extracted to node-portable/" -ForegroundColor Green
}

# Verify node works
$nodeExe = Join-Path $NodePortableDir "node.exe"
$nodeVer = (& $nodeExe -v).Trim()
Write-Host "[OK] Bundled Node.js: $nodeVer" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 2: Build EnClaws (optional)
# ---------------------------------------------------------------------------

if (-not $SkipBuild) {
    Write-Host "[*] Building EnClaws..." -ForegroundColor Yellow
    Push-Location $ProjectRoot
    try {
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }

        pnpm ui:build
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[!] UI build failed; continuing (CLI will still work)" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
    Write-Host "[OK] Build complete" -ForegroundColor Green
} else {
    Write-Host "[*] Skipping build (--SkipBuild)" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Step 2b: Prepare skill pack (clone feishu-skills)
# ---------------------------------------------------------------------------

$SkillPackDir = Join-Path $ProjectRoot "skills-pack"
$SkillPackGitUrl = "https://github.com/hashSTACS-Global/feishu-skills.git"

if (Test-Path (Join-Path $SkillPackDir ".git")) {
    Write-Host "[*] skills-pack/ exists, pulling latest..." -ForegroundColor Yellow
    Push-Location $SkillPackDir
    try {
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[!] git pull failed; using existing skills-pack/" -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[*] Cloning feishu-skills into skills-pack/..." -ForegroundColor Yellow
    if (Test-Path $SkillPackDir) { Remove-Item -Recurse -Force $SkillPackDir }
    git clone --depth 1 $SkillPackGitUrl $SkillPackDir
    if ($LASTEXITCODE -ne 0) { throw "git clone feishu-skills failed" }
}
Write-Host "[OK] Skill pack ready" -ForegroundColor Green

# ---------------------------------------------------------------------------
# Step 3: Prepare app bundle
# ---------------------------------------------------------------------------

Write-Host "[*] Preparing app bundle..." -ForegroundColor Yellow

if (Test-Path $AppBundleDir) {
    # Use robocopy to handle long paths that exceed Windows MAX_PATH (260 chars)
    $emptyDir = Join-Path $env:TEMP "enclaws-empty-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $emptyDir | Out-Null
    robocopy $emptyDir $AppBundleDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -Force $emptyDir
    Remove-Item -Force $AppBundleDir
}
New-Item -ItemType Directory -Force -Path $AppBundleDir | Out-Null

# Copy application files
$filesToCopy = @(
    @{ Src = "enclaws.mjs"; Dest = "enclaws.mjs" }
)
foreach ($f in $filesToCopy) {
    $src = Join-Path $ProjectRoot $f.Src
    $dest = Join-Path $AppBundleDir $f.Dest
    if (Test-Path $src) {
        Copy-Item $src $dest
    } else {
        Write-Host "[!] Missing: $($f.Src)" -ForegroundColor Yellow
    }
}

# Copy directories
$dirsToCopy = @("dist", "extensions", "skills", "skills-pack", "assets", "scripts")
foreach ($d in $dirsToCopy) {
    $src = Join-Path $ProjectRoot $d
    $dest = Join-Path $AppBundleDir $d
    if (Test-Path $src) {
        # Use robocopy to handle long paths that exceed Windows MAX_PATH (260 chars)
        robocopy $src $dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
        Write-Host "    Copied $d/" -ForegroundColor Gray
    } else {
        Write-Host "[!] Missing directory: $d/" -ForegroundColor Yellow
    }
}

# Workspace bootstrap templates (runtime reads docs/reference/templates via resolveWorkspaceTemplateDir).
# Not included in dist/; npm publish includes docs/, but the Windows bundle must copy them explicitly.
$templatesSrc = Join-Path $ProjectRoot "docs\reference\templates"
$templatesDest = Join-Path $AppBundleDir "docs\reference\templates"
if (Test-Path $templatesSrc) {
    New-Item -ItemType Directory -Force -Path (Split-Path $templatesDest -Parent) | Out-Null
    Copy-Item $templatesSrc $templatesDest -Recurse -Force
    Write-Host "    Copied docs/reference/templates/" -ForegroundColor Gray
} else {
    Write-Host "[!] Missing directory: docs/reference/templates/ (agent bootstrap will fail)" -ForegroundColor Yellow
}

# Generate a trimmed package.json for production install
Write-Host "[*] Generating production package.json..." -ForegroundColor Yellow
$prodPkg = [ordered]@{
    name         = $PackageJson.name
    version      = $PackageJson.version
    type         = $PackageJson.type
    main         = $PackageJson.main
    bin          = $PackageJson.bin
    dependencies = $PackageJson.dependencies
}
if ($PackageJson.optionalDependencies) {
    $prodPkg.optionalDependencies = $PackageJson.optionalDependencies
}
$prodPkgJson = $prodPkg | ConvertTo-Json -Depth 10
Write-Utf8NoBom -Path (Join-Path $AppBundleDir "package.json") -Content $prodPkgJson

# ---------------------------------------------------------------------------
# Step 4: Install production dependencies into the bundle
# ---------------------------------------------------------------------------

Write-Host "[*] Installing production dependencies..." -ForegroundColor Yellow
Write-Host "    This may take a few minutes." -ForegroundColor Gray

$npmCli = Join-Path $NodePortableDir "node_modules\npm\bin\npm-cli.js"
$npmArgs = @(
    $npmCli,
    "install",
    "--omit=dev",
    "--production",
    "--no-audit",
    "--no-fund",
    "--no-update-notifier"
)
if (-not [string]::IsNullOrWhiteSpace($Registry)) {
    $npmArgs += "--registry=$Registry"
    Write-Host "    Using registry: $Registry" -ForegroundColor Gray
}

Push-Location $AppBundleDir
try {
    & $nodeExe @npmArgs
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}
Write-Host "[OK] Dependencies installed" -ForegroundColor Green

# Patch @mariozechner/pi-coding-agent exports for Jiti CJS compatibility.
# Jiti converts ESM imports to CJS require(), but this package only defines
# an "import" condition in its exports map. Adding "default" as a fallback
# lets require() resolve the same entry point.
$piPkgPath = Join-Path $AppBundleDir "node_modules\@mariozechner\pi-coding-agent\package.json"
if (Test-Path $piPkgPath) {
    Write-Host "[*] Patching pi-coding-agent exports for CJS compat..." -ForegroundColor Yellow
    $piPkgRaw = Get-Content $piPkgPath -Raw | ConvertFrom-Json
    if ($piPkgRaw.exports -and $piPkgRaw.exports.'.') {
        $piPkgRaw.exports.'.'  | Add-Member -NotePropertyName "default" -NotePropertyValue $piPkgRaw.exports.'.'.import -Force
        if ($piPkgRaw.exports.'./hooks') {
            $piPkgRaw.exports.'./hooks' | Add-Member -NotePropertyName "default" -NotePropertyValue $piPkgRaw.exports.'./hooks'.import -Force
        }
        Write-Utf8NoBom -Path $piPkgPath -Content ($piPkgRaw | ConvertTo-Json -Depth 10)
        Write-Host "[OK] Patched pi-coding-agent exports" -ForegroundColor Green
    }
}

# Remove unnecessary files to reduce bundle size
Write-Host "[*] Cleaning up bundle..." -ForegroundColor Yellow
# Patterns for both flat packages (node_modules/pkg/) and scoped packages (node_modules/@scope/pkg/)
$cleanNames = @("*.md", "CHANGELOG*", "HISTORY*", ".github", "test", "tests",
    "__tests__", "example", "examples", ".travis.yml", ".eslintrc*", ".prettierrc*", "tsconfig.json",
    "*.map")
$cleanPatterns = @()
foreach ($name in $cleanNames) {
    $cleanPatterns += "node_modules\*\$name"
    $cleanPatterns += "node_modules\@*\*\$name"
}
foreach ($pat in $cleanPatterns) {
    $fullPat = Join-Path $AppBundleDir $pat
    Get-Item $fullPat -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "[OK] Cleaned up bundle" -ForegroundColor Green

# Remove non-Windows platform binaries from koffi (saves ~74 MB)
Write-Host "[*] Removing non-Windows platform binaries..." -ForegroundColor Yellow
$koffiBuildDir = Join-Path $AppBundleDir "node_modules\koffi\build\koffi"
if (Test-Path $koffiBuildDir) {
    Get-ChildItem $koffiBuildDir -Directory | Where-Object { $_.Name -notlike "win32_*" } |
        ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
    # Also remove koffi/src (not needed at runtime)
    $koffiSrc = Join-Path $AppBundleDir "node_modules\koffi\src"
    if (Test-Path $koffiSrc) { Remove-Item $koffiSrc -Recurse -Force }
    Write-Host "[OK] Removed non-Windows koffi binaries" -ForegroundColor Green
}

# Remove pdfjs-dist/legacy (duplicate of build/, saves ~20 MB)
$pdfjsLegacy = Join-Path $AppBundleDir "node_modules\pdfjs-dist\legacy"
if (Test-Path $pdfjsLegacy) {
    Remove-Item $pdfjsLegacy -Recurse -Force
    Write-Host "[OK] Removed pdfjs-dist/legacy" -ForegroundColor Green
}

# Remove echarts/dist (lib/ is sufficient for Node.js, saves ~49 MB)
$echartsDist = Join-Path $AppBundleDir "node_modules\echarts\dist"
if (Test-Path $echartsDist) {
    Remove-Item $echartsDist -Recurse -Force
    Write-Host "[OK] Removed echarts/dist" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Step 4b: Pack node_modules into a single tar archive
# ---------------------------------------------------------------------------
# Inno Setup extracting 32000+ small files is extremely slow on NTFS.
# Packing into a single .tar lets Inno handle just 1 file; postinstall.js
# extracts it using the bundled Node.js + Windows built-in tar command.

$nmDir = Join-Path $AppBundleDir "node_modules"
if (Test-Path $nmDir) {
    Write-Host "[*] Packing node_modules into tar archive..." -ForegroundColor Yellow
    Push-Location $AppBundleDir
    try {
        tar -cf node_modules.tar node_modules
        if ($LASTEXITCODE -ne 0) { throw "tar -cf failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    $tarSize = [math]::Round((Get-Item (Join-Path $AppBundleDir "node_modules.tar")).Length / 1MB, 1)
    Write-Host "[OK] node_modules.tar created (${tarSize} MB)" -ForegroundColor Green

    # Remove the original node_modules directory (use robocopy trick for long paths)
    Write-Host "[*] Removing original node_modules directory..." -ForegroundColor Yellow
    $emptyDir2 = Join-Path $env:TEMP "enclaws-empty-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $emptyDir2 | Out-Null
    robocopy $emptyDir2 $nmDir /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    Remove-Item -Force $emptyDir2
    Remove-Item -Force $nmDir
    Write-Host "[OK] node_modules directory removed (tar only)" -ForegroundColor Green
}

# Calculate bundle size
$bundleSize = (Get-ChildItem $AppBundleDir -Recurse | Measure-Object -Property Length -Sum).Sum
$bundleSizeMB = [math]::Round($bundleSize / 1MB, 1)
$nodeSize = (Get-ChildItem $NodePortableDir -Recurse | Measure-Object -Property Length -Sum).Sum
$nodeSizeMB = [math]::Round($nodeSize / 1MB, 1)
Write-Host "[*] Bundle size: ${bundleSizeMB} MB (app) + ${nodeSizeMB} MB (Node.js)" -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Step 5: Compile Inno Setup installer
# ---------------------------------------------------------------------------

# Find Inno Setup compiler
if ([string]::IsNullOrWhiteSpace($InnoSetupPath)) {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "D:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "D:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) {
            $InnoSetupPath = $c
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($InnoSetupPath) -or -not (Test-Path $InnoSetupPath)) {
    Write-Host ""
    Write-Host "[!] Inno Setup compiler (ISCC.exe) not found." -ForegroundColor Red
    Write-Host "    Install Inno Setup 6 from: https://jrsoftware.org/isdl.php" -ForegroundColor Yellow
    Write-Host "    Or pass -InnoSetupPath to specify the location." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "    The app bundle is ready at: $AppBundleDir" -ForegroundColor Cyan
    Write-Host "    You can compile manually: iscc /DAppVersion=$AppVersion enclaws-setup.iss" -ForegroundColor Cyan
    exit 1
}

Write-Host "[*] Compiling installer with Inno Setup..." -ForegroundColor Yellow
Write-Host "    Compiler: $InnoSetupPath" -ForegroundColor Gray

$issPath = Join-Path $InstallerDir "enclaws-setup.iss"
& $InnoSetupPath /DAppVersion="$AppVersion" $issPath
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compilation failed with exit code $LASTEXITCODE"
}

$exePath = Join-Path $OutputDir "EnClaws-Setup-${AppVersion}.exe"
if (Test-Path $exePath) {
    $exeSize = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
    Write-Host ""
    Write-Host "  Build complete!" -ForegroundColor Green
    Write-Host "  Installer: $exePath" -ForegroundColor Cyan
    Write-Host "  Size: ${exeSize} MB" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "[!] Expected output not found: $exePath" -ForegroundColor Red
    exit 1
}
