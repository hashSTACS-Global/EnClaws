#!/usr/bin/env bash
set -euo pipefail

# Build and bundle EnClaws into a minimal .app we can open.
# Outputs to dist/EnClaws.app

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_ROOT="$ROOT_DIR/dist/EnClaws.app"
BUILD_ROOT="$ROOT_DIR/apps/macos/.build"
PRODUCT="OpenClaw"
BUNDLE_ID="${BUNDLE_ID:-ai.enclaws.mac.debug}"
PKG_VERSION="$(cd "$ROOT_DIR" && node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")"
BUILD_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BUILD_NUMBER=$(cd "$ROOT_DIR" && git rev-list --count HEAD 2>/dev/null || echo "0")
APP_VERSION="${APP_VERSION:-$PKG_VERSION}"
APP_BUILD="${APP_BUILD:-}"
BUILD_CONFIG="${BUILD_CONFIG:-debug}"
BUILD_ARCHS_VALUE="${BUILD_ARCHS:-$(uname -m)}"
if [[ "${BUILD_ARCHS_VALUE}" == "all" ]]; then
  BUILD_ARCHS_VALUE="arm64 x86_64"
fi
IFS=' ' read -r -a BUILD_ARCHS <<< "$BUILD_ARCHS_VALUE"
PRIMARY_ARCH="${BUILD_ARCHS[0]}"
SPARKLE_PUBLIC_ED_KEY="${SPARKLE_PUBLIC_ED_KEY:-AGCY8w5vHirVfGGDGc8Szc5iuOqupZSh9pMj/Qs67XI=}"
SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-https://raw.githubusercontent.com/hashSTACS-Global/EnClaws/main/appcast.xml}"
AUTO_CHECKS=true
if [[ "$BUNDLE_ID" == *.debug ]]; then
  SPARKLE_FEED_URL=""
  AUTO_CHECKS=false
fi

sparkle_canonical_build_from_version() {
  node --import tsx "$ROOT_DIR/scripts/sparkle-build.ts" canonical-build "$1"
}

build_path_for_arch() {
  echo "$BUILD_ROOT/$1"
}

bin_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/$PRODUCT"
}

sparkle_framework_for_arch() {
  echo "$(build_path_for_arch "$1")/$BUILD_CONFIG/Sparkle.framework"
}

merge_framework_machos() {
  local primary="$1"
  local dest="$2"
  shift 2
  local others=("$@")

  archs_for() {
    /usr/bin/lipo -info "$1" | /usr/bin/sed -E 's/.*are: //; s/.*architecture: //'
  }

  arch_in_list() {
    local needle="$1"
    shift
    for item in "$@"; do
      if [[ "$item" == "$needle" ]]; then
        return 0
      fi
    done
    return 1
  }

  while IFS= read -r -d '' file; do
    if /usr/bin/file "$file" | /usr/bin/grep -q "Mach-O"; then
      local rel="${file#$primary/}"
      local primary_archs
      primary_archs=$(archs_for "$file")
      IFS=' ' read -r -a primary_arch_array <<< "$primary_archs"

      local missing_files=()
      local tmp_dir
      tmp_dir=$(mktemp -d)
      for fw in "${others[@]}"; do
        local other_file="$fw/$rel"
        if [[ ! -f "$other_file" ]]; then
          echo "ERROR: Missing $rel in $fw" >&2
          rm -rf "$tmp_dir"
          exit 1
        fi
        if /usr/bin/file "$other_file" | /usr/bin/grep -q "Mach-O"; then
          local other_archs
          other_archs=$(archs_for "$other_file")
          IFS=' ' read -r -a other_arch_array <<< "$other_archs"
          for arch in "${other_arch_array[@]}"; do
            if ! arch_in_list "$arch" "${primary_arch_array[@]}"; then
              local thin_file="$tmp_dir/$(echo "$rel" | tr '/' '_')-$arch"
              /usr/bin/lipo -thin "$arch" "$other_file" -output "$thin_file"
              missing_files+=("$thin_file")
              primary_arch_array+=("$arch")
            fi
          done
        fi
      done

      if [[ "${#missing_files[@]}" -gt 0 ]]; then
        /usr/bin/lipo -create "$file" "${missing_files[@]}" -output "$dest/$rel"
      fi
      rm -rf "$tmp_dir"
    fi
  done < <(find "$primary" -type f -print0)
}

echo "📦 Ensuring deps (pnpm install)"
(cd "$ROOT_DIR" && pnpm install --no-frozen-lockfile --config.node-linker=hoisted)

if [[ -z "${APP_BUILD:-}" ]]; then
  APP_BUILD="$GIT_BUILD_NUMBER"
  if [[ "$APP_VERSION" =~ ^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}([.-].*)?$ ]]; then
    CANONICAL_BUILD="$(sparkle_canonical_build_from_version "$APP_VERSION")" || {
      echo "ERROR: Failed to derive canonical Sparkle APP_BUILD from APP_VERSION '$APP_VERSION'." >&2
      exit 1
    }
    if [[ "$CANONICAL_BUILD" =~ ^[0-9]+$ ]] && (( CANONICAL_BUILD > APP_BUILD )); then
      APP_BUILD="$CANONICAL_BUILD"
    fi
  fi
fi

if [[ "$AUTO_CHECKS" == "true" && ! "$APP_BUILD" =~ ^[0-9]+$ ]]; then
  echo "ERROR: APP_BUILD must be numeric for Sparkle compare (CFBundleVersion). Got: $APP_BUILD" >&2
  exit 1
fi

if [[ "${SKIP_TSC:-0}" != "1" ]]; then
  echo "📦 Building JS (pnpm build)"
  (cd "$ROOT_DIR" && pnpm build)
else
  echo "📦 Skipping JS build (SKIP_TSC=1)"
fi

if [[ "${SKIP_UI_BUILD:-0}" != "1" ]]; then
  echo "🖥  Building Control UI (ui:build)"
  (cd "$ROOT_DIR" && node scripts/ui.js build)
else
  echo "🖥  Skipping Control UI build (SKIP_UI_BUILD=1)"
fi

cd "$ROOT_DIR/apps/macos"

echo "🔨 Building $PRODUCT ($BUILD_CONFIG) [${BUILD_ARCHS[*]}]"
for arch in "${BUILD_ARCHS[@]}"; do
  BUILD_PATH="$(build_path_for_arch "$arch")"
  swift build -c "$BUILD_CONFIG" --product "$PRODUCT" --build-path "$BUILD_PATH" --arch "$arch" -Xlinker -rpath -Xlinker @executable_path/../Frameworks
done

BIN_PRIMARY="$(bin_for_arch "$PRIMARY_ARCH")"
echo "pkg: binary $BIN_PRIMARY" >&2
echo "🧹 Cleaning old app bundle"
rm -rf "$APP_ROOT"
mkdir -p "$APP_ROOT/Contents/MacOS"
mkdir -p "$APP_ROOT/Contents/Resources"
mkdir -p "$APP_ROOT/Contents/Frameworks"

echo "📄 Copying Info.plist template"
INFO_PLIST_SRC="$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources/Info.plist"
if [ ! -f "$INFO_PLIST_SRC" ]; then
  echo "ERROR: Info.plist template missing at $INFO_PLIST_SRC" >&2
  exit 1
fi
cp "$INFO_PLIST_SRC" "$APP_ROOT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${BUNDLE_ID}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${APP_VERSION}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${APP_BUILD}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :OpenClawBuildTimestamp ${BUILD_TS}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :OpenClawGitCommit ${GIT_COMMIT}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :SUFeedURL ${SPARKLE_FEED_URL}" "$APP_ROOT/Contents/Info.plist" \
  || /usr/libexec/PlistBuddy -c "Add :SUFeedURL string ${SPARKLE_FEED_URL}" "$APP_ROOT/Contents/Info.plist" || true
/usr/libexec/PlistBuddy -c "Set :SUPublicEDKey ${SPARKLE_PUBLIC_ED_KEY}" "$APP_ROOT/Contents/Info.plist" \
  || /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string ${SPARKLE_PUBLIC_ED_KEY}" "$APP_ROOT/Contents/Info.plist" || true
if /usr/libexec/PlistBuddy -c "Set :SUEnableAutomaticChecks ${AUTO_CHECKS}" "$APP_ROOT/Contents/Info.plist"; then
  true
else
  /usr/libexec/PlistBuddy -c "Add :SUEnableAutomaticChecks bool ${AUTO_CHECKS}" "$APP_ROOT/Contents/Info.plist" || true
fi

echo "🚚 Copying binary"
cp "$BIN_PRIMARY" "$APP_ROOT/Contents/MacOS/EnClaws"
if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
  BIN_INPUTS=()
  for arch in "${BUILD_ARCHS[@]}"; do
    BIN_INPUTS+=("$(bin_for_arch "$arch")")
  done
  /usr/bin/lipo -create "${BIN_INPUTS[@]}" -output "$APP_ROOT/Contents/MacOS/EnClaws"
fi
chmod +x "$APP_ROOT/Contents/MacOS/EnClaws"
# SwiftPM outputs ad-hoc signed binaries; strip the signature before install_name_tool to avoid warnings.
/usr/bin/codesign --remove-signature "$APP_ROOT/Contents/MacOS/EnClaws" 2>/dev/null || true

SPARKLE_FRAMEWORK_PRIMARY="$(sparkle_framework_for_arch "$PRIMARY_ARCH")"
if [ -d "$SPARKLE_FRAMEWORK_PRIMARY" ]; then
  echo "✨ Embedding Sparkle.framework"
  cp -R "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/"
  if [[ "${#BUILD_ARCHS[@]}" -gt 1 ]]; then
    OTHER_FRAMEWORKS=()
    for arch in "${BUILD_ARCHS[@]}"; do
      if [[ "$arch" == "$PRIMARY_ARCH" ]]; then
        continue
      fi
      OTHER_FRAMEWORKS+=("$(sparkle_framework_for_arch "$arch")")
    done
    merge_framework_machos "$SPARKLE_FRAMEWORK_PRIMARY" "$APP_ROOT/Contents/Frameworks/Sparkle.framework" "${OTHER_FRAMEWORKS[@]}"
  fi
  chmod -R a+rX "$APP_ROOT/Contents/Frameworks/Sparkle.framework"
fi

echo "📦 Copying Swift 6.2 compatibility libraries"
SWIFT_COMPAT_LIB="$(xcode-select -p)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-6.2/macosx/libswiftCompatibilitySpan.dylib"
if [ -f "$SWIFT_COMPAT_LIB" ]; then
  cp "$SWIFT_COMPAT_LIB" "$APP_ROOT/Contents/Frameworks/"
  chmod +x "$APP_ROOT/Contents/Frameworks/libswiftCompatibilitySpan.dylib"
else
  echo "WARN: Swift compatibility library not found at $SWIFT_COMPAT_LIB (continuing)" >&2
fi

echo "🖼  Copying app icon"
cp "$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources/EnClaws.icns" "$APP_ROOT/Contents/Resources/EnClaws.icns"

echo "📦 Copying device model resources"
rm -rf "$APP_ROOT/Contents/Resources/DeviceModels"
cp -R "$ROOT_DIR/apps/macos/Sources/OpenClaw/Resources/DeviceModels" "$APP_ROOT/Contents/Resources/DeviceModels"

echo "📦 Copying model catalog"
MODEL_CATALOG_SRC="$ROOT_DIR/node_modules/@mariozechner/pi-ai/dist/models.generated.js"
MODEL_CATALOG_DEST="$APP_ROOT/Contents/Resources/models.generated.js"
if [ -f "$MODEL_CATALOG_SRC" ]; then
  cp "$MODEL_CATALOG_SRC" "$MODEL_CATALOG_DEST"
else
  echo "WARN: model catalog missing at $MODEL_CATALOG_SRC (continuing)" >&2
fi

echo "📦 Copying OpenClawKit resources"
OPENCLAWKIT_BUNDLE="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG/OpenClawKit_OpenClawKit.bundle"
if [ -d "$OPENCLAWKIT_BUNDLE" ]; then
  rm -rf "$APP_ROOT/Contents/Resources/OpenClawKit_OpenClawKit.bundle"
  cp -R "$OPENCLAWKIT_BUNDLE" "$APP_ROOT/Contents/Resources/OpenClawKit_OpenClawKit.bundle"
else
  echo "WARN: OpenClawKit resource bundle not found at $OPENCLAWKIT_BUNDLE (continuing)" >&2
fi

echo "📦 Copying Textual resources"
TEXTUAL_BUNDLE_DIR="$(build_path_for_arch "$PRIMARY_ARCH")/$BUILD_CONFIG"
TEXTUAL_BUNDLE=""
for candidate in \
  "$TEXTUAL_BUNDLE_DIR/textual_Textual.bundle" \
  "$TEXTUAL_BUNDLE_DIR/Textual_Textual.bundle"
do
  if [ -d "$candidate" ]; then
    TEXTUAL_BUNDLE="$candidate"
    break
  fi
done
if [ -z "$TEXTUAL_BUNDLE" ]; then
  TEXTUAL_BUNDLE="$(find "$BUILD_ROOT" -type d \( -name "textual_Textual.bundle" -o -name "Textual_Textual.bundle" \) -print -quit)"
fi
if [ -n "$TEXTUAL_BUNDLE" ] && [ -d "$TEXTUAL_BUNDLE" ]; then
  rm -rf "$APP_ROOT/Contents/Resources/$(basename "$TEXTUAL_BUNDLE")"
  cp -R "$TEXTUAL_BUNDLE" "$APP_ROOT/Contents/Resources/"
else
  if [[ "${ALLOW_MISSING_TEXTUAL_BUNDLE:-0}" == "1" ]]; then
    echo "WARN: Textual resource bundle not found (continuing due to ALLOW_MISSING_TEXTUAL_BUNDLE=1)" >&2
  else
    echo "ERROR: Textual resource bundle not found. Set ALLOW_MISSING_TEXTUAL_BUNDLE=1 to bypass." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Bundle Node.js runtime into the .app
# ---------------------------------------------------------------------------

NODE_VERSION="${NODE_VERSION:-22.16.0}"
BUNDLE_NODE_ARCH="${BUILD_ARCHS[0]}"
if [[ "$BUNDLE_NODE_ARCH" == "x86_64" ]]; then
  NODE_PLATFORM="darwin-x64"
else
  NODE_PLATFORM="darwin-arm64"
fi

NODE_TAR_NAME="node-v${NODE_VERSION}-${NODE_PLATFORM}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TAR_NAME}"
NODE_CACHE_DIR="$ROOT_DIR/.node-cache"
NODE_TAR_PATH="$NODE_CACHE_DIR/$NODE_TAR_NAME"
NODE_DEST="$APP_ROOT/Contents/Resources/node"

mkdir -p "$NODE_CACHE_DIR"
if [ ! -f "$NODE_TAR_PATH" ]; then
  echo "📦 Downloading Node.js v${NODE_VERSION} (${NODE_PLATFORM})..."
  curl -fsSL "$NODE_URL" -o "$NODE_TAR_PATH"
fi

echo "📦 Bundling Node.js into app..."
mkdir -p "$NODE_DEST"
tar -xzf "$NODE_TAR_PATH" --strip-components=1 -C "$NODE_DEST"
rm -rf "$NODE_DEST/include" "$NODE_DEST/share" "$NODE_DEST/lib/node_modules/npm/docs" \
       "$NODE_DEST/lib/node_modules/npm/man" "$NODE_DEST/CHANGELOG.md" "$NODE_DEST/README.md"
echo "[OK] Bundled Node.js v${NODE_VERSION} (${NODE_PLATFORM})"

# ---------------------------------------------------------------------------
# Bundle JS application code into the .app
# ---------------------------------------------------------------------------

RESOURCES="$APP_ROOT/Contents/Resources"

echo "📦 Bundling JS application code..."

cp "$ROOT_DIR/enclaws.mjs" "$RESOURCES/enclaws.mjs"
cp "$ROOT_DIR/.env.example" "$RESOURCES/.env.example"

for dir in dist extensions skills assets; do
  if [ -d "$ROOT_DIR/$dir" ]; then
    # Exclude .app bundles to prevent nesting (dist/ may contain EnClaws.app from earlier build)
    rsync -a --exclude='*.app' "$ROOT_DIR/$dir/" "$RESOURCES/$dir/"
    echo "    Copied $dir/"
  else
    echo "WARN: Missing directory: $dir/" >&2
  fi
done

if [ -d "$ROOT_DIR/scripts" ]; then
  cp -R "$ROOT_DIR/scripts" "$RESOURCES/scripts"
  echo "    Copied scripts/"
fi

TEMPLATES_SRC="$ROOT_DIR/docs/reference/templates"
TEMPLATES_DEST="$RESOURCES/docs/reference/templates"
if [ -d "$TEMPLATES_SRC" ]; then
  mkdir -p "$(dirname "$TEMPLATES_DEST")"
  cp -R "$TEMPLATES_SRC" "$TEMPLATES_DEST"
  echo "    Copied docs/reference/templates/"
else
  echo "WARN: Missing directory: docs/reference/templates/ (agent bootstrap will fail)" >&2
fi

# ---------------------------------------------------------------------------
# Bundle skills-pack
# ---------------------------------------------------------------------------

SKILL_PACK_DIR="$RESOURCES/skills-pack"
SKILL_PACK_GIT_URL="https://github.com/hashSTACS-Global/feishu-skills.git"

if [ -d "$ROOT_DIR/skills-pack/.git" ]; then
  echo "📦 Copying existing skills-pack..."
  cp -R "$ROOT_DIR/skills-pack" "$SKILL_PACK_DIR"
else
  echo "📦 Cloning skills-pack..."
  git clone --depth 1 "$SKILL_PACK_GIT_URL" "$SKILL_PACK_DIR"
fi
rm -rf "$SKILL_PACK_DIR/.git"
echo "[OK] Skills-pack bundled"

# ---------------------------------------------------------------------------
# Install production dependencies into the bundle
# ---------------------------------------------------------------------------

echo "📦 Generating production package.json..."
NODE_BIN="$NODE_DEST/bin/node"

"$NODE_BIN" --input-type=commonjs -e "
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
" "$ROOT_DIR/package.json" "$RESOURCES/package.json"

# Use system npm (not the bundled one) with explicit arch/platform so that
# native optional dependencies (e.g. @snazzah/davey-darwin-arm64) are resolved
# correctly regardless of which Node binary was bundled.
# This mirrors the approach in build-mac-installer.sh.
if [[ "$PRIMARY_ARCH" == "x86_64" ]]; then
  TARGET_NPM_ARCH="x64"
else
  TARGET_NPM_ARCH="arm64"
fi

# Prefer system npm so that native optional deps (e.g. @snazzah/davey-darwin-arm64)
# are resolved correctly via npm_config_arch/platform.
# Fall back to the bundled npm only if system npm is unavailable.
SYSTEM_NPM="$(command -v npm 2>/dev/null || true)"

echo "📦 Installing production dependencies (target: darwin-${TARGET_NPM_ARCH})..."
if [[ -n "$SYSTEM_NPM" ]]; then
  (cd "$RESOURCES" && npm_config_arch="$TARGET_NPM_ARCH" npm_config_platform="darwin" \
    "$SYSTEM_NPM" install --omit=dev --no-audit --no-fund --no-update-notifier)
else
  echo "WARN: system npm not found, falling back to bundled npm" >&2
  NPM_CLI="$NODE_DEST/lib/node_modules/npm/bin/npm-cli.js"
  (cd "$RESOURCES" && npm_config_arch="$TARGET_NPM_ARCH" npm_config_platform="darwin" \
    "$NODE_BIN" "$NPM_CLI" install --omit=dev --no-audit --no-fund --no-update-notifier)
fi
echo "[OK] Dependencies installed (darwin-${TARGET_NPM_ARCH})"

echo "📦 Cleaning up bundle..."
CLEAN_NAMES=("*.md" "CHANGELOG*" "HISTORY*" ".github" "test" "tests" "__tests__" \
  "example" "examples" ".travis.yml" ".eslintrc*" ".prettierrc*" "tsconfig.json" "*.map" "doc" "docs")
for name in "${CLEAN_NAMES[@]}"; do
  find "$RESOURCES/node_modules" -maxdepth 3 -name "$name" -exec rm -rf {} + 2>/dev/null || true
done

KOFFI_BUILD="$RESOURCES/node_modules/koffi/build/koffi"
if [ -d "$KOFFI_BUILD" ]; then
  find "$KOFFI_BUILD" -maxdepth 1 -type d ! -name "darwin_*" ! -name "koffi" -exec rm -rf {} +
  rm -rf "$RESOURCES/node_modules/koffi/src"
  echo "[OK] Removed non-macOS koffi binaries"
fi

rm -rf "$RESOURCES/node_modules/pdfjs-dist/legacy"
rm -rf "$RESOURCES/node_modules/echarts/dist"

BUNDLE_SIZE=$(du -sm "$RESOURCES" | awk '{print $1}')
echo "[OK] Bundle size: ${BUNDLE_SIZE} MB"

echo "⏹  Stopping any running EnClaws"
killall -q EnClaws 2>/dev/null || true

echo "🔏 Signing bundle (auto-selects signing identity if SIGN_IDENTITY is unset)"
"$ROOT_DIR/scripts/codesign-mac-app.sh" "$APP_ROOT"

echo "✅ EnClaws bundle ready at $APP_ROOT"
