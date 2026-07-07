import { sshExec, type SshConnectOptions } from "./ssh.js";

export interface WgSetupOptions {
  port: number;
  iface: string;
  subnet: string;
}

export async function installAndConfigureWireguard(
  ssh: SshConnectOptions,
  opts: WgSetupOptions
): Promise<{ success: boolean; message: string; output: string; privateKey?: string; publicKey?: string }> {
  const { port, iface, subnet } = opts;
  const serverIp = subnet.replace(/\.\d+\/\d+$/, ".1");

  try {
    // Step 1: install WireGuard packages (no quotes in this script, safe to use bash -c directly)
    const installScript = `export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && apt-get install -y -qq wireguard wireguard-tools iptables`;
    const installResult = await sshExec(ssh, `sudo bash -c '${installScript}'`, 120000);
    if (installResult.code !== 0) {
      return { success: false, message: "Failed to install WireGuard packages", output: installResult.stdout + installResult.stderr };
    }

    // Step 2: generate server keys — base64-encoded to avoid quoting issues
    const keyGenScript = `priv=$(wg genkey)\necho "PRIVKEY=$priv"\necho "PUBKEY=$(echo "$priv" | wg pubkey)"`;
    const keyGenEncoded = Buffer.from(keyGenScript).toString("base64");
    const keyResult = await sshExec(ssh, `echo ${keyGenEncoded} | base64 -d | sudo bash`, 15000);
    const privMatch = keyResult.stdout.match(/PRIVKEY=(.+)/);
    const pubMatch = keyResult.stdout.match(/PUBKEY=(.+)/);
    if (!privMatch || !pubMatch) {
      return { success: false, message: "Failed to generate WireGuard keys", output: keyResult.stdout + keyResult.stderr };
    }
    const privateKey = privMatch[1].trim();
    const publicKey = pubMatch[1].trim();

    // Step 3: write config and start service — base64-encoded to avoid ALL quoting issues
    // (PostUp/PostDown contain awk single-quotes that would break any bash -c '...' wrapper)
    const configScript = `
set -e
mkdir -p /etc/wireguard
printf '%s\\n' '${privateKey}' > /etc/wireguard/${iface}.key
chmod 600 /etc/wireguard/${iface}.key
cat > /etc/wireguard/${iface}.conf << 'WGEOF'
[Interface]
PrivateKey = ${privateKey}
Address = ${serverIp}/24
ListenPort = ${port}
PostUp = iptables -A FORWARD -i ${iface} -j ACCEPT; iptables -t nat -A POSTROUTING -o $(ip route show default | awk '/default/{print $5}') -j MASQUERADE
PostDown = iptables -D FORWARD -i ${iface} -j ACCEPT; iptables -t nat -D POSTROUTING -o $(ip route show default | awk '/default/{print $5}') -j MASQUERADE
WGEOF
printf 'net.ipv4.ip_forward=1\\n' > /etc/sysctl.d/99-wireguard.conf
sysctl -p /etc/sysctl.d/99-wireguard.conf
if command -v ufw > /dev/null 2>&1 && ufw status | grep -q 'Status: active'; then
  ufw allow ${port}/udp comment WireGuard
  ufw reload
  echo "UFW: opened port ${port}/udp"
else
  echo "UFW: not active, skipping"
fi
systemctl enable --now wg-quick@${iface}
echo "WireGuard setup complete"
`.trim();

    const configEncoded = Buffer.from(configScript).toString("base64");
    const configResult = await sshExec(ssh, `echo ${configEncoded} | base64 -d | sudo bash`, 60000);
    const output = installResult.stdout + "\n" + configResult.stdout + configResult.stderr;

    if (configResult.code !== 0) {
      return { success: false, message: "WireGuard configuration failed", output };
    }
    return { success: true, message: "WireGuard installed and configured", output, privateKey, publicKey };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : String(err), output: "" };
  }
}

export async function addPeerToServer(
  ssh: SshConnectOptions,
  iface: string,
  clientPublicKey: string,
  presharedKey: string,
  clientAllowedIp: string
): Promise<{ success: boolean; output: string }> {
  const script = [
    `if wg show ${iface} > /dev/null 2>&1; then`,
    `  printf '%s\\n' '${presharedKey}' > /tmp/.wg_psk`,
    `  chmod 600 /tmp/.wg_psk`,
    `  wg set ${iface} peer ${clientPublicKey} preshared-key /tmp/.wg_psk allowed-ips ${clientAllowedIp}`,
    `  wg-quick save ${iface}`,
    `  rm -f /tmp/.wg_psk`,
    `  echo "peer added live"`,
    `else`,
    `  printf '\\n[Peer]\\nPublicKey = ${clientPublicKey}\\nPresharedKey = ${presharedKey}\\nAllowedIPs = ${clientAllowedIp}\\n' >> /etc/wireguard/${iface}.conf`,
    `  echo "peer written to config"`,
    `fi`,
  ].join("\n");
  const encoded = Buffer.from(script).toString("base64");
  try {
    const result = await sshExec(ssh, `echo ${encoded} | base64 -d | sudo bash`, 30000);
    return { success: result.code === 0, output: result.stdout + result.stderr };
  } catch (err: unknown) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function removePeerFromServer(
  ssh: SshConnectOptions,
  iface: string,
  clientPublicKey: string
): Promise<{ success: boolean; output: string }> {
  const cmd = `sudo wg set ${iface} peer ${clientPublicKey} remove && sudo wg-quick save ${iface}`;
  try {
    const result = await sshExec(ssh, `sudo bash -c '${cmd}'`, 30000);
    return { success: result.code === 0, output: result.stdout + result.stderr };
  } catch (err: unknown) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function wireguardServiceAction(
  ssh: SshConnectOptions,
  iface: string,
  action: "start" | "stop" | "restart"
): Promise<{ success: boolean; output: string }> {
  const cmd = `sudo systemctl ${action} wg-quick@${iface}`;
  try {
    const result = await sshExec(ssh, cmd, 30000);
    return { success: result.code === 0, output: result.stdout + result.stderr };
  } catch (err: unknown) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function uninstallWireguard(
  ssh: SshConnectOptions,
  iface: string
): Promise<{ success: boolean; output: string }> {
  const cmd = `sudo systemctl stop wg-quick@${iface} || true && sudo systemctl disable wg-quick@${iface} || true && sudo rm -f /etc/wireguard/${iface}.conf /etc/wireguard/${iface}.key`;
  try {
    const result = await sshExec(ssh, `sudo bash -c '${cmd}'`, 30000);
    return { success: result.code === 0, output: result.stdout + result.stderr };
  } catch (err: unknown) {
    return { success: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkWireguardLive(
  ssh: SshConnectOptions,
  iface: string
): Promise<"running" | "stopped"> {
  try {
    const result = await sshExec(ssh, `systemctl is-active wg-quick@${iface}`, 5000);
    return result.stdout.trim() === "active" ? "running" : "stopped";
  } catch {
    return "stopped";
  }
}

export async function generateKeys(ssh: SshConnectOptions): Promise<{ privateKey: string; publicKey: string; presharedKey: string }> {
  const result = await sshExec(ssh, "wg genkey | tee /dev/stderr | wg pubkey && wg genpsk", 15000);
  const lines = result.stderr.split("\n").concat(result.stdout.split("\n")).map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error("Failed to generate WireGuard keys: " + result.stdout + result.stderr);
  return { privateKey: lines[0], publicKey: lines[1], presharedKey: lines[2] };
}

export async function generateServerKeys(ssh: SshConnectOptions): Promise<{ privateKey: string; publicKey: string }> {
  const result = await sshExec(ssh, "priv=$(wg genkey); echo \"$priv\"; echo \"$priv\" | wg pubkey", 15000);
  const lines = result.stdout.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("Failed to generate server keys");
  return { privateKey: lines[0], publicKey: lines[1] };
}

export async function importWireguardConfig(ssh: SshConnectOptions): Promise<{
  success: boolean;
  message: string;
  privateKey?: string;
  publicKey?: string;
  iface?: string;
  port?: number;
  subnet?: string;
  wireguardStatus?: "running" | "stopped";
  existingPeerCount?: number;
  peers?: Array<{ publicKey: string; presharedKey: string; allowedIps: string; name: string | null }>;
}> {
  const importScript = `
set -e
CONF_FILE=$(ls /etc/wireguard/*.conf 2>/dev/null | head -1)
if [ -z "$CONF_FILE" ]; then echo "RESULT=NO_CONF"; exit 1; fi
IFACE=$(basename "$CONF_FILE" .conf)
echo "IFACE=$IFACE"
PRIV=$(grep -m1 '^PrivateKey' "$CONF_FILE" | awk '{print $3}')
if [ -z "$PRIV" ]; then echo "RESULT=NO_KEY"; exit 1; fi
echo "PRIVKEY=$PRIV"
PUB=$(printf '%s' "$PRIV" | wg pubkey)
echo "PUBKEY=$PUB"
PORT=$(grep -m1 '^ListenPort' "$CONF_FILE" | awk '{print $3}')
if [ -z "$PORT" ]; then PORT=51820; fi
echo "PORT=$PORT"
ADDR=$(grep -m1 '^Address' "$CONF_FILE" | awk '{print $3}')
echo "ADDR=$ADDR"
PEERS=$(grep -c '^\\[Peer\\]' "$CONF_FILE" 2>/dev/null || echo 0)
echo "PEERS=$PEERS"
if systemctl is-active "wg-quick@$IFACE" > /dev/null 2>&1; then echo "RUNNING=1"; else echo "RUNNING=0"; fi
awk '
BEGIN { in_peer=0; pub=""; psk=""; ips=""; nm="" }
/^[[:space:]]*#/ && !in_peer { sub(/^[[:space:]]*#[[:space:]]*/,""); nm=$0; next }
/^\\[Peer\\]/ { if (in_peer && pub!="") printf "PEER|%s|%s|%s|%s\\n", pub, psk, ips, nm; in_peer=1; pub=""; psk=""; ips=""; nm=""; next }
/^\\[/ && !/Peer/ { if (in_peer && pub!="") printf "PEER|%s|%s|%s|%s\\n", pub, psk, ips, nm; in_peer=0; nm=""; next }
in_peer && /^PublicKey[[:space:]]*=/ { pub=$3; next }
in_peer && /^PresharedKey[[:space:]]*=/ { psk=$3; next }
in_peer && /^AllowedIPs[[:space:]]*=/ { gsub(/,.*/,"",$3); ips=$3; next }
END { if (in_peer && pub!="") printf "PEER|%s|%s|%s|%s\\n", pub, psk, ips, nm }
' "$CONF_FILE"
`.trim();

  try {
    const encoded = Buffer.from(importScript).toString("base64");
    const result = await sshExec(ssh, `echo ${encoded} | base64 -d | sudo bash`, 20000);

    if (result.code !== 0) {
      if (result.stdout.includes("RESULT=NO_CONF")) {
        return { success: false, message: "No WireGuard config file found in /etc/wireguard/" };
      }
      if (result.stdout.includes("RESULT=NO_KEY")) {
        return { success: false, message: "Could not read PrivateKey from WireGuard config" };
      }
      return { success: false, message: "Failed to read WireGuard config: " + (result.stderr || result.stdout) };
    }

    const get = (key: string) => result.stdout.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
    const iface = get("IFACE");
    const privateKey = get("PRIVKEY");
    const publicKey = get("PUBKEY");
    const port = parseInt(get("PORT") ?? "51820", 10);
    const addr = get("ADDR") ?? "";
    const existingPeerCount = parseInt(get("PEERS") ?? "0", 10);
    const wireguardStatus = get("RUNNING") === "1" ? "running" : "stopped";

    if (!iface || !privateKey || !publicKey) {
      return { success: false, message: "Could not parse WireGuard configuration — missing required fields" };
    }

    const addrMatch = addr.match(/^(\d+\.\d+\.\d+)\.\d+\/(\d+)$/);
    const subnet = addrMatch ? `${addrMatch[1]}.0/${addrMatch[2]}` : "10.8.0.0/24";

    const peers = result.stdout.split("\n")
      .filter(l => l.startsWith("PEER|"))
      .map((l, i) => {
        const parts = l.split("|");
        return {
          publicKey: parts[1] ?? "",
          presharedKey: parts[2] ?? "",
          allowedIps: parts[3] ?? "",
          name: parts[4]?.trim() || null,
        };
      })
      .filter(p => p.publicKey.length > 0);

    return {
      success: true,
      message: `Imported ${iface} on port ${port} — ${wireguardStatus}, ${existingPeerCount} existing peer(s)`,
      privateKey,
      publicKey,
      iface,
      port,
      subnet,
      wireguardStatus,
      existingPeerCount,
      peers,
    };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export function buildClientConfig(params: {
  clientPrivateKey: string;
  clientAddress: string;
  serverPublicKey: string;
  presharedKey: string;
  serverEndpoint: string;
  serverPort: number;
  dns?: string;
}): string {
  return `[Interface]
PrivateKey = ${params.clientPrivateKey}
Address = ${params.clientAddress}/32
DNS = ${params.dns ?? "9.9.9.9, 1.1.1.1"}

[Peer]
PublicKey = ${params.serverPublicKey}
PresharedKey = ${params.presharedKey}
Endpoint = ${params.serverEndpoint}:${params.serverPort}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
}
