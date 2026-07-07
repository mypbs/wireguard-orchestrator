# Chris's WireGuard Web Orchestrator

**Complete Self Contained WireGuard VPN Management System**

A self-hosted web dashboard for managing WireGuard VPN exit nodes from a central control plane. SSH into your VPS nodes, install WireGuard, and manage all your clients and QR codes from one web interface.

---

## Deploy on Your VPS (Docker)

You don't need a GitHub account. Just run these commands on any VPS with Docker installed:

```bash
# 1. Download the project
wget https://github.com/mypbs/chris-wireguard-web-orchestrator/archive/refs/heads/main.zip
unzip main.zip
cd chris-wireguard-web-orchestrator-main

# 2. Generate a secret key
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env

# 3. Build and start
docker compose up -d --build
```

Then open **http://your-vps-ip:8899** in your browser. You'll be prompted to create an admin account on first visit.

The first build takes about 3–5 minutes — it's compiling everything inside Docker.

---

## AI-Assisted Deployment

Prefer letting an AI coding tool handle the install for you? Copy the prompt below and paste it into Claude Code, Gemini CLI, OpenCode, Grok Build, or any other AI terminal assistant. It gives the AI everything it needs to deploy, verify, and troubleshoot the app on your VPS without you typing individual commands.

<details>
<summary><strong>📋 Click to expand — copy this prompt into your AI tool</strong></summary>

```
I want to deploy "Chris's WireGuard Web Orchestrator" on this VPS using Docker.
Please handle the full installation, verify it's working, and fix any issues that come up.

## What it is
A self-hosted web dashboard that manages WireGuard VPN nodes over SSH.
Source: https://github.com/mypbs/chris-wireguard-web-orchestrator

## Installation steps

1. Check that Docker and Docker Compose are installed. If not, install Docker Engine
   and the docker-compose-plugin for this OS before continuing.

2. Download and extract the project:
     wget https://github.com/mypbs/chris-wireguard-web-orchestrator/archive/refs/heads/main.zip
     unzip main.zip
     cd chris-wireguard-web-orchestrator-main

3. Generate a session secret and write the .env file:
     echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env

4. Build and start the containers (first build takes 3–5 min):
     docker compose up -d --build

5. Verify both containers are running:
     docker compose ps
   Both "app" and "db" should show status "Up".

6. Check the app logs for startup errors:
     docker compose logs app --tail=50

## Ports
- The dashboard runs on port 8899 on the host (http://this-server-ip:8899)
- Port 8899 must be open in the firewall/security group
- Check with: ss -tlnp | grep 8899
- For UFW: ufw allow 8899/tcp
- For firewalld: firewall-cmd --permanent --add-port=8899/tcp && firewall-cmd --reload
- For iptables: iptables -I INPUT -p tcp --dport 8899 -j ACCEPT
- If this is a cloud VPS (AWS, Hetzner, DigitalOcean, Vultr, Linode, etc.) also check
  the provider's external firewall/security group rules — they're separate from the OS firewall.

## To change the port
Edit docker-compose.yml before running docker compose up. Change the first number:
     ports:
       - "9090:3000"   # replaces 8899 with 9090 — never change 3000

## First-run setup
On the first visit to http://server-ip:8899, the app shows a setup page to create
the admin account. After that, login is required for all access.

## Common problems and fixes

Problem: docker compose up fails with "permission denied"
Fix: Add current user to docker group: usermod -aG docker $USER && newgrp docker

Problem: Port 8899 unreachable from browser even though containers are up
Fix: Check OS firewall (ufw, firewalld, iptables) AND the cloud provider's
security group/firewall rules — both layers must allow TCP 8899.

Problem: App container exits immediately
Fix: Run `docker compose logs app` to see the error. Most likely causes:
  - Missing .env file (SESSION_SECRET not set)
  - Database not ready yet (run `docker compose up -d --build` again)

Problem: "relation does not exist" database errors in logs
Fix: The app runs migrations on startup. If the db container wasn't ready,
restart: docker compose restart app

Problem: Existing install — want to update to latest version
Fix (run from the parent directory of the installation, e.g. ~):
  cp chris-wireguard-web-orchestrator-main/.env .env.bak
  wget https://github.com/mypbs/chris-wireguard-web-orchestrator/archive/refs/heads/main.zip
  unzip -o main.zip
  cp .env.bak chris-wireguard-web-orchestrator-main/.env
  cd chris-wireguard-web-orchestrator-main
  docker compose up -d --build

## After a successful install
Confirm by opening http://[server-ip]:8899 in a browser. The setup or login page
should load. If it doesn't load, run: curl -s -o /dev/null -w "%{http_code}" http://localhost:8899
It should return 200. If it returns nothing, the app isn't running — check logs.
```

</details>

---

## What You Get

- **Node management** — add VPS nodes via SSH credentials
- **Remote WireGuard install** — installs and configures WireGuard on your nodes over SSH
- **Client management** — add/remove clients, download `.conf` files and scan QR codes
- **Controls per node** — start, stop, restart, uninstall WireGuard
- **Login protected** — single admin account with session-based auth
- **Auto database setup** — no manual database config needed

---

## Can the Manager Server Also Be an Exit Node?

Yes. You don't need a separate VPS just to run the dashboard. The same machine running the manager can also serve as a WireGuard exit point.

To set it up, just add the manager server as a node in the dashboard using its own **public IP address**. The manager will SSH into itself, install WireGuard on the host, and manage it the same way it manages any remote node.

Your server ends up running both:

```
Your VPS
├── Docker: Chris's WireGuard Web Orchestrator  →  port 8899
└── Host:   WireGuard exit node          →  port 51820
```

Clients connect to WireGuard on port 51820. The dashboard runs separately on port 8899. They don't interfere with each other.

> **Note:** Docker and WireGuard both manage `iptables` rules. If VPN clients lose internet access after Docker restarts, run `systemctl restart wg-quick@wg0` on the host to restore routing.

---

## Requirements

**On the machine running the dashboard:**
- Docker + Docker Compose installed
- Port 8899 open in your firewall (or change the port — see below)

**On each WireGuard exit node:**
- SSH access (password auth supported)
- Passwordless sudo for: `apt`, `wg`, `systemctl`, `iptables`, `ip`

Sudoers example for each exit node:

```
your-ssh-user ALL=(ALL) NOPASSWD: /usr/bin/apt*, /usr/bin/wg*, /usr/sbin/wg-quick*, /bin/systemctl*, /sbin/iptables*, /sbin/ip*
```

---

## Change the Port

Edit `docker-compose.yml` and change the first number (the host port):

```yaml
ports:
  - "8899:3000"   # default — access via http://your-vps-ip:8899
```

For example, to run on port 9090 instead:

```yaml
ports:
  - "9090:3000"   # access via http://your-vps-ip:9090
```

The second number (`3000`) is internal to the container — never change that.

---

## Updating

Run these from the **parent directory** of your installation (e.g. `~`, wherever you originally ran `unzip`):

```bash
# 1. Save your existing .env before anything else
cp chris-wireguard-web-orchestrator-main/.env .env.bak

# 2. Download and overwrite the installation files
wget https://github.com/mypbs/chris-wireguard-web-orchestrator/archive/refs/heads/main.zip
unzip -o main.zip

# 3. Restore your saved .env (unzip -o would have wiped it)
cp .env.bak chris-wireguard-web-orchestrator-main/.env

# 4. Rebuild and restart
cd chris-wireguard-web-orchestrator-main
docker compose up -d --build
```

Your database data is safe — it lives in a Docker volume that `docker compose up --build` never touches.

---

## Backup Your Data

Postgres data is stored in a Docker volume. To back it up:

```bash
docker compose exec db pg_dump -U wgmanager wgmanager > backup.sql
```

To restore:

```bash
cat backup.sql | docker compose exec -T db psql -U wgmanager wgmanager
```

---

## For Developers

Clone the repo and see `replit.md` for the full developer guide (stack, architecture decisions, local dev setup).
