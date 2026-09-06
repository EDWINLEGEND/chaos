# Azure VM Deployment Guide for Chaos

This guide walks you through deploying the complete Chaos Engineering & Observability monorepo on an **Azure Virtual Machine** using Docker Compose.

---

## 🏗️ Architecture Overview

On a single Azure VM, you run all 6 containerized services in an isolated bridge network:

| Component | Container | Port | Role |
| :--- | :--- | :--- | :--- |
| **Chaos Web** | `chaos-web` | **3000** | Apple OLED dark control room dashboard |
| **Grafana** | `chaos-grafana` | **3003** | Live operational metrics & latency charts |
| **Checkout Service** | `chaos-checkout` | **3001** | Order processing microservice & chaos target |
| **Payment Provider** | `chaos-payment-provider` | **3002** | Mock gateway & webhook sender |
| **MongoDB 7.0** | `chaos-mongodb` | **27017** | Stores orders (seeded with 500k documents) |
| **Prometheus** | `chaos-prometheus` | **9090** | Time-series metrics scraper |

---

## 📋 Step 1: Provision the Azure VM

### Option A: Using Azure CLI (Fastest)

Run these commands on your local machine or in [Azure Cloud Shell](https://shell.azure.com):

```bash
# 1. Create a Resource Group
az group create --name chaos-hackathon-rg --location eastus

# 2. Create the Virtual Machine (Ubuntu 24.04 LTS, Standard_B2s or Standard_B4ms)
az vm create \
  --resource-group chaos-hackathon-rg \
  --name chaos-vm \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username azureuser \
  --generate-ssh-keys

# 3. Open Required Inbound Ports in the Network Security Group (NSG)
az vm open-port --resource-group chaos-hackathon-rg --name chaos-vm --port 22 --priority 1000
az vm open-port --resource-group chaos-hackathon-rg --name chaos-vm --port 3000 --priority 1010
az vm open-port --resource-group chaos-hackathon-rg --name chaos-vm --port 3003 --priority 1020
az vm open-port --resource-group chaos-hackathon-rg --name chaos-vm --port 80 --priority 1030
az vm open-port --resource-group chaos-hackathon-rg --name chaos-vm --port 443 --priority 1040

# 4. Get the Public IP Address
az vm show -d -g chaos-hackathon-rg -n chaos-vm --query publicIps -o tsv
```

> **Recommended VM Size**:
> - `Standard_B2s` (2 vCPU, 4GB RAM) — ~$30/month (or pennies per hour)
> - `Standard_B4ms` (4 vCPU, 16GB RAM) — ~$120/month (ideal for heavy concurrent webhook bursts)

---

### Option B: Using the Azure Portal UI

1. Go to **Virtual Machines** → **Create** → **Azure virtual machine**.
2. **Resource Group**: Create new `chaos-hackathon-rg`.
3. **Image**: `Ubuntu Server 24.04 LTS - x64 Gen2`.
4. **Size**: `Standard_B2s` (2 vCPUs, 4 GiB memory).
5. **Authentication**: SSH public key (or password).
6. **Networking**: Under **Inbound port rules**, allow `SSH (22)` and `HTTP (80)`.
7. Once created, navigate to **Networking** → **Add inbound port rule**:
   - **Port 3000**: Name `Allow-Chaos-Web` (Protocol: TCP)
   - **Port 3003**: Name `Allow-Grafana` (Protocol: TCP)
8. Copy the **Public IP address** of the VM.

---

## 🚀 Step 2: Deploy the Stack on the VM

### 1. SSH into the Azure VM

```bash
ssh azureuser@<YOUR_VM_PUBLIC_IP>
```

### 2. Clone the Repository & Run Setup

```bash
# Clone the repository
git clone https://github.com/EDWINLEGEND/chaos.git
cd chaos

# Run the automated deployment script
chmod +x deploy/azure-vm-setup.sh
./deploy/azure-vm-setup.sh
```

### What `deploy/azure-vm-setup.sh` does automatically:
1. Installs Docker CE and Docker Compose plugin.
2. Configures UFW firewall for ports 22, 80, 443, 3000, and 3003.
3. Generates `.env` from `.env.example`.
4. Executes `docker compose up -d --build` for all 6 containers.
5. Verifies MongoDB health and seeds **500,000 orders** with no supporting index on the duplicate-check query shape.

---

## 🌐 Step 3: Access the Live Deployment

Once the script completes, open your browser:

- **Chaos Control Center**: `http://<YOUR_VM_PUBLIC_IP>:3000`
- **Grafana Observability**: `http://<YOUR_VM_PUBLIC_IP>:3003` (anonymous admin enabled)
- **Checkout Health API**: `http://<YOUR_VM_PUBLIC_IP>:3001/health`
- **Payment Provider Health**: `http://<YOUR_VM_PUBLIC_IP>:3002/health`

---

## 🛠️ Common Operations & Maintenance

### Check Container Status
```bash
sudo docker compose ps
```

### View Live Service Logs
```bash
# View all logs
sudo docker compose logs -f

# View only checkout service
sudo docker compose logs -f checkout
```

### Re-seed or Reset Database
```bash
# Verify record count
sudo docker compose exec mongodb mongosh --quiet --eval "db.getSiblingDB('acme').orders.countDocuments()"

# Force re-seed
sudo docker compose run --rm -e FORCE_SEED=true checkout pnpm seed
```

### Updating After Code Changes
```bash
git pull
sudo docker compose up -d --build
```

---

## 💡 Cost Saving Tip: Deallocate When Inactive

When you are not presenting or testing, stop the VM so you are not charged compute costs:

```bash
# Stop & deallocate compute charges
az vm deallocate --resource-group chaos-hackathon-rg --name chaos-vm

# Start it back up before your demo (takes ~60 seconds)
az vm start --resource-group chaos-hackathon-rg --name chaos-vm
```
Containers will automatically restart on boot due to `restart: unless-stopped`.
