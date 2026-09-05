#!/usr/bin/env bash
# ==============================================================================
# Azure Virtual Machine Automated Setup Script for Chaos Demo
# Target OS: Ubuntu 22.04 LTS / 24.04 LTS
# ==============================================================================

set -euo pipefail

echo "===================================================================="
echo " Starting Chaos Engineering Stack Setup on Azure VM"
echo "===================================================================="

# 1. Update system & install prerequisite packages
echo "[1/6] Installing system dependencies..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg lsb-release git ufw

# 2. Install official Docker Engine & Docker Compose plugin
if ! command -v docker &>/dev/null; then
  echo "[2/6] Installing Docker CE and Docker Compose..."
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=\"$(dpkg --print-architecture)\" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    \"$(. /etc/os-release && echo \"$VERSION_CODENAME\")\" stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
else
  echo "[2/6] Docker is already installed."
fi

# 3. Configure Host Firewall (Rely on Azure Network Security Group)
echo "[3/6] Ensuring host firewall allows Docker bridge forwarding..."
sudo ufw disable || true

# 4. Prepare Environment Configuration
echo "[4/6] Setting up environment configuration..."
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "Copied .env.example to .env"
  else
    cat <<EOF > .env
NODE_ENV=production
MONGODB_DATABASE=acme
CHECKOUT_PORT=3001
PAYMENT_PROVIDER_PORT=3002
CHAOS_WEB_PORT=3000
PROMETHEUS_PORT=9090
GRAFANA_PORT=3003
EOF
  fi
fi

# 5. Build and start all 6 Docker containers
echo "[5/6] Starting all microservices via Docker Compose..."
sudo docker network create chaos-net 2>/dev/null || true
sudo docker compose down --remove-orphans || true
sudo docker compose up -d

# 6. Wait for MongoDB to become healthy and seed 500,000 orders
echo "[6/6] Waiting for MongoDB container healthcheck..."
for i in {1..30}; do
  if sudo docker compose exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping').ok" 2>/dev/null | grep -q "1"; then
    echo "MongoDB is healthy!"
    break
  fi
  echo "Waiting for MongoDB... ($i/30)"
  sleep 3
done

echo "Checking if database requires seeding (500k orders)..."
ORDER_COUNT=$(sudo docker compose exec -T mongodb mongosh --quiet --eval "db.getSiblingDB('acme').orders.countDocuments()" 2>/dev/null || echo "0")

if [ "$ORDER_COUNT" -lt 1000 ]; then
  echo "Seeding 500,000 unindexed orders for the COLLSCAN demonstration..."
  sudo docker cp "$(pwd)/scripts" chaos-checkout:/app/scripts
  sudo docker compose exec -T -e MONGODB_URI=mongodb://mongodb:27017/acme checkout node /app/scripts/seed.js
else
  echo "Database already contains $ORDER_COUNT orders. Skipping seed."
fi

# Get Public IP
PUBLIC_IP=$(curl -s -m 5 ifconfig.me || curl -s -m 5 icanhazip.com || echo "<YOUR_VM_PUBLIC_IP>")

echo ""
echo "===================================================================="
echo " ✅ Chaos Engineering Stack is Successfully Deployed!"
echo "===================================================================="
echo " Dashboard (Chaos Web):     http://${PUBLIC_IP}:3000"
echo " Grafana Observability:     http://${PUBLIC_IP}:3003 (anonymous admin)"
echo " Checkout API Health:       http://${PUBLIC_IP}:3001/health"
echo " Payment Provider Health:   http://${PUBLIC_IP}:3002/health"
echo "===================================================================="
