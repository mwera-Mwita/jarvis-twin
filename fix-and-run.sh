#!/bin/bash
echo "╔══════════════════════════════════════════════╗"
echo "║     J.A.R.V.I.S. SETUP — KALI LINUX         ║"
echo "╚══════════════════════════════════════════════╝"

# Step 1: Fix apt and install Node.js properly
echo ""
echo "[1/4] Updating package lists..."
sudo apt update --fix-missing -y 2>/dev/null

echo "[2/4] Installing Node.js via NodeSource (recommended for Kali)..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

echo ""
echo "[3/4] Verifying installation..."
node --version
npm --version

echo ""
echo "[4/4] Installing JARVIS dependencies..."
cd "$(dirname "$0")"
npm install

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  DONE! Now:"
echo "║  1. cp .env.example .env"
echo "║  2. nano .env  (add your ANTHROPIC_API_KEY)"
echo "║  3. npm start"
echo "║  4. Open Chrome → http://localhost:3000"
echo "╚══════════════════════════════════════════════╝"
