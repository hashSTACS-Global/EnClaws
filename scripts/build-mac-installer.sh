#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Build a self-contained macOS EnClaws installer (pure Node.js, no Swift GUI).
# Produces a DMG containing EnClaws.app (lightweight launcher) that bundles
# Node.js + all JS code + production dependencies + skills-pack.
#
# Usage:
#   bash scripts/build-mac-installer.sh
#   bash scripts/build-mac-installer.sh --skip-build
#   NODE_VERSION=22.16.0 bash scripts/build-mac-installer.sh
#
# Environment:
#   NODE_VERSION     Node.js version to bundle (default: 22.16.0)
#   BUILD_ARCHS      Target architecture: arm64 or x86_64 (default: current machine)
#   SKIP_BUILD       Set to 1 to skip pnpm build (use existing dist/)
#   SKIP_DMG         Set to 1 to skip DMG creation (just build the .app)
#   SKIP_DMG_STYLE   Set to 1 to skip Finder styling (for headless CI)
# ---------------------------------------------------------------------------

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PKG_VERSION="$(node -p "require('$ROOT_DIR/package.json').version" 2>/dev/null || echo "0.0.0")"
NODE_VERSION="${NODE_VERSION:-22.16.0}"
BUILD_ARCH="${BUILD_ARCHS:-$(uname -m)}"
SKIP_BUILD="${SKIP_BUILD:-0}"
OUTPUT_DIR="$ROOT_DIR/dist"

echo ""
echo "  EnClaws macOS Installer Builder"
echo "  Version: $PKG_VERSION | Node: $NODE_VERSION | Arch: $BUILD_ARCH"
echo ""

# Map architecture to Node.js download name
if [[ "$BUILD_ARCH" == "x86_64" ]]; then
  NODE_PLATFORM="darwin-x64"
else
  NODE_PLATFORM="darwin-arm64"
fi

# ---------------------------------------------------------------------------
# Step 1: Install dependencies & build
# ---------------------------------------------------------------------------

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "[*] Installing dependencies..."
  (cd "$ROOT_DIR" && pnpm install --frozen-lockfile --config.node-linker=hoisted)

  echo "[*] Building JS..."
  (cd "$ROOT_DIR" && pnpm build)

  echo "[*] Building UI..."
  (cd "$ROOT_DIR" && node scripts/ui.js build)
  if [ ! -f "$ROOT_DIR/dist/control-ui/index.html" ]; then
    echo "ERROR: Control UI build failed — dist/control-ui/index.html not found" >&2
    exit 1
  fi

  echo "[OK] Build complete"
else
  echo "[*] Skipping build (SKIP_BUILD=1)"
fi

# ---------------------------------------------------------------------------
# Step 2: Download Node.js
# ---------------------------------------------------------------------------

NODE_TAR_NAME="node-v${NODE_VERSION}-${NODE_PLATFORM}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR_NAME}"
NODE_CACHE_DIR="$ROOT_DIR/.node-cache"
NODE_TAR_PATH="$NODE_CACHE_DIR/$NODE_TAR_NAME"

mkdir -p "$NODE_CACHE_DIR"
if [ ! -f "$NODE_TAR_PATH" ]; then
  echo "[*] Downloading Node.js v${NODE_VERSION} (${NODE_PLATFORM})..."
  curl -fsSL "$NODE_URL" -o "$NODE_TAR_PATH"
  echo "[OK] Downloaded"
else
  echo "[OK] Node.js already cached"
fi

# ---------------------------------------------------------------------------
# Step 3: Create .app bundle structure
# ---------------------------------------------------------------------------

APP_NAME="EnClaws"
APP_ROOT="$OUTPUT_DIR/${APP_NAME}.app"
APP_CONTENTS="$APP_ROOT/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"

echo "[*] Creating app bundle..."
rm -rf "$APP_ROOT"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"

# ---------------------------------------------------------------------------
# Step 3a: Write Info.plist
# ---------------------------------------------------------------------------

cat > "$APP_CONTENTS/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>EnClaws</string>
    <key>CFBundleDisplayName</key>
    <string>EnClaws</string>
    <key>CFBundleIdentifier</key>
    <string>ai.enclaws.mac</string>
    <key>CFBundleVersion</key>
    <string>${PKG_VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${PKG_VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>enclaws-launcher</string>
    <key>CFBundleIconFile</key>
    <string>EnClaws</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# ---------------------------------------------------------------------------
# Step 3b: Write launcher script (double-click to start gateway + open browser)
# ---------------------------------------------------------------------------

cat > "$APP_MACOS/enclaws-launcher" << 'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
NODE="$DIR/node/bin/node"
ENTRY="$DIR/enclaws.mjs"
PORT="${ENCLAWS_GATEWAY_PORT:-18888}"
PID_FILE="$HOME/.enclaws/gateway.pid"

LOADING="$DIR/loading.html"

# If gateway is already running, just open dashboard and exit
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  open "http://localhost:$PORT"
  exit 0
fi
if curl -s -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
  open "http://localhost:$PORT"
  exit 0
fi

# Show loading page immediately (gateway not ready yet)
open "file://${LOADING}?port=${PORT}"

# Create symlink to /usr/local/bin so "enclaws" works in terminal
CLI="$DIR/enclaws"
if [ ! -L /usr/local/bin/enclaws ] || [ "$(readlink /usr/local/bin/enclaws)" != "$CLI" ]; then
  if ln -sf "$CLI" /usr/local/bin/enclaws 2>/dev/null; then
    true
  else
    # No permission — ask user to authorize via macOS password dialog
    ESCAPED_CLI=$(printf '%s' "$CLI" | sed "s/'/'\\\\''/g")
    osascript -e "do shell script \"mkdir -p /usr/local/bin && ln -sf '${ESCAPED_CLI}' /usr/local/bin/enclaws\" with administrator privileges" 2>/dev/null || true
  fi
fi

# Run postinstall if first launch
if [ ! -f "$HOME/.enclaws/.env" ]; then
  "$NODE" "$DIR/scripts/postinstall.js" 2>/dev/null || true
fi

# Start gateway as detached background process
# Launcher exits immediately so clicking the icon again works
mkdir -p "$HOME/.enclaws"
nohup "$NODE" "$ENTRY" gateway --port "$PORT" --no-open </dev/null >"$HOME/.enclaws/gateway.log" 2>&1 &
GATEWAY_PID=$!
echo "$GATEWAY_PID" > "$PID_FILE"
LAUNCHER

chmod +x "$APP_MACOS/enclaws-launcher"

# ---------------------------------------------------------------------------
# Step 3b-2: Write loading.html (shown while gateway starts)
# ---------------------------------------------------------------------------

cat > "$APP_RESOURCES/loading.html" << 'LOADING'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>EnClaws</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0a0e27 0%, #1a1040 50%, #0d1b3e 100%);
    color: #fff;
    font-family: -apple-system, "PingFang SC", sans-serif;
  }
  .spinner {
    width: 48px; height: 48px;
    border: 4px solid rgba(255,255,255,0.15);
    border-top-color: #a78bfa;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 28px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h1 { font-size: 22px; font-weight: 500; margin-bottom: 10px; }
  p { font-size: 14px; color: rgba(255,255,255,0.5); }
  .status { margin-top: 24px; font-size: 13px; color: rgba(255,255,255,0.35); }
</style>
</head>
<body>
  <div class="spinner"></div>
  <h1>EnClaws 正在启动...</h1>
  <p>网关启动后将自动跳转控制面板</p>
  <div class="status" id="status">正在连接...</div>
<script>
  const params = new URLSearchParams(window.location.search);
  const port = params.get('port') || 18888;
  const url = `http://localhost:${port}`;
  let attempts = 0;
  function check() {
    attempts++;
    document.getElementById('status').textContent = `第 ${attempts} 次检测...`;
    fetch(url, { mode: 'no-cors' })
      .then(() => { window.location.href = url; })
      .catch(() => { setTimeout(check, 1500); });
  }
  check();
</script>
</body>
</html>
LOADING

# ---------------------------------------------------------------------------
# Step 3c: Write CLI wrapper (for terminal: enclaws gateway)
# ---------------------------------------------------------------------------

cat > "$APP_RESOURCES/enclaws" << 'CLI'
#!/usr/bin/env bash
# Resolve symlinks so this works from /usr/local/bin/enclaws -> .app/Contents/Resources/enclaws
SELF="$0"
if [ -L "$SELF" ]; then
  SELF="$(readlink "$SELF")"
  # Handle relative symlinks
  if [[ "$SELF" != /* ]]; then
    SELF="$(cd "$(dirname "$0")" && pwd)/$SELF"
  fi
fi
DIR="$(cd "$(dirname "$SELF")" && pwd)"
NODE="$DIR/node/bin/node"
ENTRY="$DIR/enclaws.mjs"

# Run postinstall if first launch
if [ ! -f "$HOME/.enclaws/.env" ]; then
  "$NODE" "$DIR/scripts/postinstall.js" 2>/dev/null || true
fi

exec "$NODE" "$ENTRY" "$@"
CLI

chmod +x "$APP_RESOURCES/enclaws"

# ---------------------------------------------------------------------------
# Step 3d: Copy icon
# ---------------------------------------------------------------------------

ICON_SRC="$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources/EnClaws.icns"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$APP_RESOURCES/EnClaws.icns"
  echo "[OK] Icon copied"
else
  echo "[!] Icon not found at $ICON_SRC"
fi

# ---------------------------------------------------------------------------
# Step 4: Bundle Node.js
# ---------------------------------------------------------------------------

NODE_DEST="$APP_RESOURCES/node"
echo "[*] Bundling Node.js..."
mkdir -p "$NODE_DEST"
tar -xzf "$NODE_TAR_PATH" --strip-components=1 -C "$NODE_DEST"
# Clean up unnecessary files
rm -rf "$NODE_DEST/include" "$NODE_DEST/share" \
       "$NODE_DEST/lib/node_modules/npm/docs" \
       "$NODE_DEST/lib/node_modules/npm/man" \
       "$NODE_DEST/CHANGELOG.md" "$NODE_DEST/README.md"
echo "[OK] Bundled Node.js v${NODE_VERSION}"

# ---------------------------------------------------------------------------
# Step 5: Bundle JS application code
# ---------------------------------------------------------------------------

echo "[*] Bundling application code..."

# Main entry point
cp "$ROOT_DIR/enclaws.mjs" "$APP_RESOURCES/enclaws.mjs"

# Application directories (exclude .app to prevent nesting)
for dir in dist extensions skills assets; do
  if [ -d "$ROOT_DIR/$dir" ]; then
    rsync -a --exclude='*.app' "$ROOT_DIR/$dir/" "$APP_RESOURCES/$dir/"
    echo "    Copied $dir/"
  else
    echo "    [!] Missing: $dir/"
  fi
done

# Scripts (needed for postinstall.js)
if [ -d "$ROOT_DIR/scripts" ]; then
  rsync -a "$ROOT_DIR/scripts/" "$APP_RESOURCES/scripts/"
  echo "    Copied scripts/"
fi

# .env template (needed by postinstall.js to create ~/.enclaws/.env)
cp "$ROOT_DIR/.env.example" "$APP_RESOURCES/.env.example"
echo "    Copied .env.example"

# Workspace templates
TEMPLATES_SRC="$ROOT_DIR/docs/reference/templates"
if [ -d "$TEMPLATES_SRC" ]; then
  mkdir -p "$APP_RESOURCES/docs/reference"
  cp -R "$TEMPLATES_SRC" "$APP_RESOURCES/docs/reference/templates"
  echo "    Copied docs/reference/templates/"
fi

# ---------------------------------------------------------------------------
# Step 6: Bundle skills-pack
# ---------------------------------------------------------------------------

SKILL_PACK_DIR="$APP_RESOURCES/skills-pack"
SKILL_PACK_GIT_URL="https://github.com/hashSTACS-Global/feishu-skills.git"

if [ -d "$ROOT_DIR/skills-pack/.git" ]; then
  echo "[*] Copying existing skills-pack..."
  cp -R "$ROOT_DIR/skills-pack" "$SKILL_PACK_DIR"
else
  echo "[*] Cloning skills-pack..."
  git clone --depth 1 "$SKILL_PACK_GIT_URL" "$SKILL_PACK_DIR"
fi
rm -rf "$SKILL_PACK_DIR/.git"
echo "[OK] Skills-pack bundled"

# ---------------------------------------------------------------------------
# Step 7: Install production dependencies
# ---------------------------------------------------------------------------

echo "[*] Generating production package.json..."
# Use the system node/npm (not the bundled one) for install — the bundled node
# may be a different architecture (e.g. x86_64 bundle built on arm64 runner).
SYSTEM_NODE="$(command -v node)"
SYSTEM_NPM="$(command -v npm)"

"$SYSTEM_NODE" --input-type=commonjs -e "
  var fs = require('fs');
  var pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
  var prod = {
    name: pkg.name,
    version: pkg.version,
    type: pkg.type,
    main: pkg.main,
    bin: pkg.bin,
    dependencies: pkg.dependencies
  };
  if (pkg.optionalDependencies) prod.optionalDependencies = pkg.optionalDependencies;
  fs.writeFileSync(process.argv[2], JSON.stringify(prod, null, 2));
" "$ROOT_DIR/package.json" "$APP_RESOURCES/package.json"

echo "[*] Installing production dependencies (this may take a few minutes)..."
# Set target architecture for native modules (sharp, koffi, node-pty etc.)
# This ensures prebuilt binaries match the target arch, not the runner arch.
if [[ "$BUILD_ARCH" == "x86_64" ]]; then
  TARGET_NPM_ARCH="x64"
else
  TARGET_NPM_ARCH="arm64"
fi
(cd "$APP_RESOURCES" && npm_config_arch="$TARGET_NPM_ARCH" npm_config_platform="darwin" \
  "$SYSTEM_NPM" install --omit=dev --no-audit --no-fund --no-update-notifier)
echo "[OK] Dependencies installed (target: darwin-${TARGET_NPM_ARCH})"

# ---------------------------------------------------------------------------
# Step 8: Clean up bundle
# ---------------------------------------------------------------------------

echo "[*] Cleaning up..."
CLEAN_NAMES=("*.md" "CHANGELOG*" "HISTORY*" ".github" "test" "tests" "__tests__" \
  "example" "examples" ".travis.yml" ".eslintrc*" ".prettierrc*" "tsconfig.json" "*.map")
for name in "${CLEAN_NAMES[@]}"; do
  find "$APP_RESOURCES/node_modules" -maxdepth 3 -name "$name" -exec rm -rf {} + 2>/dev/null || true
done

# Remove non-target-arch platform binaries from koffi
KOFFI_BUILD="$APP_RESOURCES/node_modules/koffi/build/koffi"
KOFFI_KEEP="darwin_${TARGET_NPM_ARCH}"
if [ -d "$KOFFI_BUILD" ]; then
  find "$KOFFI_BUILD" -maxdepth 1 -type d ! -name "$KOFFI_KEEP" ! -name "koffi" -exec rm -rf {} +
  rm -rf "$APP_RESOURCES/node_modules/koffi/src"
  echo "[OK] Removed non-macOS koffi binaries"
fi

# Remove large unnecessary directories
rm -rf "$APP_RESOURCES/node_modules/pdfjs-dist/legacy"
rm -rf "$APP_RESOURCES/node_modules/echarts/dist"

BUNDLE_SIZE=$(du -sm "$APP_RESOURCES" | awk '{print $1}')
echo "[OK] Bundle cleaned (${BUNDLE_SIZE} MB)"

# ---------------------------------------------------------------------------
# Step 9: Ad-hoc sign the app bundle
# ---------------------------------------------------------------------------

echo "[*] Signing app bundle (ad-hoc)..."
codesign --force --deep --sign - "$APP_ROOT" 2>/dev/null || echo "[!] Signing skipped"
# Wait for codesign to fully release file handles before creating DMG
sync
sleep 2

# ---------------------------------------------------------------------------
# Step 10: Create DMG
# ---------------------------------------------------------------------------

if [[ "${SKIP_DMG:-0}" != "1" ]]; then
  DMG_PATH="$OUTPUT_DIR/EnClaws-${PKG_VERSION}-${BUILD_ARCH}.dmg"
  echo "[*] Creating DMG: $DMG_PATH"

  # Detach any leftover mounts from previous runs
  hdiutil detach "/Volumes/EnClaws" 2>/dev/null || true
  # Remove stale DMG files that may hold locks
  rm -f "$OUTPUT_DIR"/EnClaws-*-*.dmg

  # Use a temp directory outside of dist/ to avoid any file contention
  DMG_TEMP="$(mktemp -d /tmp/enclaws-dmg.XXXXXX)"
  # Use ditto instead of cp -R (preserves extended attrs, more reliable on macOS)
  ditto "$APP_ROOT" "$DMG_TEMP/EnClaws.app"
  ln -s /Applications "$DMG_TEMP/Applications"

  # Create lzma-compressed read-only DMG directly (ULMO = smaller than UDZO/zlib)
  hdiutil create -volname "EnClaws" -srcfolder "$DMG_TEMP" -ov -format ULMO "$DMG_PATH"

  rm -rf "$DMG_TEMP"

  DMG_SIZE=$(du -sm "$DMG_PATH" | awk '{print $1}')
  echo ""
  echo "  Build complete!"
  echo "  DMG: $DMG_PATH"
  echo "  Size: ${DMG_SIZE} MB"
  echo ""
else
  echo "[*] Skipping DMG (SKIP_DMG=1)"
  echo ""
  echo "  Build complete!"
  echo "  App: $APP_ROOT"
  echo ""
fi
