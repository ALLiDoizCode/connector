#!/bin/bash
set -euo pipefail

# TigerBeetle Native Installation for macOS
# Installs TigerBeetle binary for development (no Docker required)

TIGERBEETLE_VERSION="0.16.68"
INSTALL_DIR="${HOME}/.local/bin"
DATA_DIR="${HOME}/.tigerbeetle/data"

echo "========================================"
echo "  TigerBeetle macOS Native Installer"
echo "========================================"
echo ""
echo "Version: ${TIGERBEETLE_VERSION}"
echo "Install directory: ${INSTALL_DIR}"
echo "Data directory: ${DATA_DIR}"
echo ""

# Detect architecture (for display only - TigerBeetle uses universal binary)
ARCH=$(uname -m)
echo "Detected architecture: $ARCH"
echo ""

# Download TigerBeetle binary (universal binary works on both Apple Silicon and Intel)
echo "📦 Downloading TigerBeetle ${TIGERBEETLE_VERSION}..."
DOWNLOAD_URL="https://github.com/tigerbeetle/tigerbeetle/releases/download/${TIGERBEETLE_VERSION}/tigerbeetle-universal-macos.zip"
TMP_DIR=$(mktemp -d)
cd "$TMP_DIR"

if ! curl -Lo tigerbeetle.zip "$DOWNLOAD_URL"; then
  echo "❌ Download failed. Check version or network connection."
  exit 1
fi

echo "✅ Downloaded successfully"
echo ""

# Extract and install
echo "📂 Extracting and installing..."
unzip -q tigerbeetle.zip

# Create install directory if needed
mkdir -p "$INSTALL_DIR"

# Install to user directory (no sudo needed)
mv tigerbeetle "$INSTALL_DIR/tigerbeetle"
chmod +x "$INSTALL_DIR/tigerbeetle"
echo "✅ TigerBeetle installed to $INSTALL_DIR/tigerbeetle"
echo ""

# Create data directory
echo "📁 Creating data directory..."
mkdir -p "$DATA_DIR"
echo "✅ Data directory created: $DATA_DIR"
echo ""

# Format initial database
echo "🗄️  Formatting initial database..."
"$INSTALL_DIR/tigerbeetle" format \
  --cluster=0 \
  --replica=0 \
  --replica-count=1 \
  "$DATA_DIR/0_0.tigerbeetle" 2>&1 | grep -E "(warning|info|formatted)"

echo "✅ Database formatted"
echo ""

# Verify installation
echo "🔍 Verifying installation..."
INSTALLED_VERSION=$("$INSTALL_DIR/tigerbeetle" version | head -n1)
echo "✅ TigerBeetle installed: $INSTALLED_VERSION"
echo ""

# Cleanup
cd - > /dev/null
rm -rf "$TMP_DIR"

echo "========================================"
echo "  ✅ Installation Complete!"
echo "========================================"
echo ""
echo "⚠️  Important: Add to PATH if not already present:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
echo ""
echo "Add to your shell profile (~/.zshrc or ~/.bash_profile):"
echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
echo ""
echo "To start TigerBeetle manually:"
echo "  tigerbeetle start --addresses=127.0.0.1:3000 $DATA_DIR/0_0.tigerbeetle"
echo ""
echo "To start with the project:"
echo "  npm run dev"
echo ""
echo "Data location: $DATA_DIR"
echo ""
