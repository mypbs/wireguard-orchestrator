import { Router, type Response } from "express";
import { db, nodesTable, clientsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { sshExec } from "../lib/ssh.js";
import { buildSshOpts } from "../lib/node-ssh.js";
import { addPeerToServer, removePeerFromServer, buildClientConfig } from "../lib/wireguard.js";
import QRCode from "qrcode";

const router = Router();

async function getNodeOrFail(nodeId: number, res: Response) {
  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return null;
  }
  return node;
}

router.get("/nodes/:nodeId/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const clients = await db
      .select({
        id: clientsTable.id,
        nodeId: clientsTable.nodeId,
        name: clientsTable.name,
        publicKey: clientsTable.publicKey,
        allowedIps: clientsTable.allowedIps,
        createdAt: clientsTable.createdAt,
      })
      .from(clientsTable)
      .where(eq(clientsTable.nodeId, nodeId));

    res.json(clients.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "listClients failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/clients", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    if (!node.serverPublicKey) {
      res.status(400).json({ error: "WireGuard is not set up on this node" });
      return;
    }

    const { name } = req.body as { name?: string };
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }

    const ssh = buildSshOpts(node);

    const keyResult = await sshExec(ssh, "sudo bash -c 'priv=$(wg genkey); printf \"%s\\n\" \"$priv\"; printf \"%s\\n\" \"$priv\" | wg pubkey; wg genpsk'", 15000);
    req.log.info({ stdout: keyResult.stdout, stderr: keyResult.stderr, code: keyResult.code }, "keygen result");
    const keyLines = keyResult.stdout.trim().split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (keyLines.length < 3) {
      req.log.warn({ keyLines, stdout: keyResult.stdout, stderr: keyResult.stderr }, "keygen produced fewer than 3 lines");
      res.status(500).json({ error: "Failed to generate client keys" });
      return;
    }
    const [clientPrivateKey, clientPublicKey, presharedKey] = keyLines;

    const existingClients = await db
      .select({ allowedIps: clientsTable.allowedIps })
      .from(clientsTable)
      .where(eq(clientsTable.nodeId, nodeId));

    const usedOctets = existingClients.map(c => {
      const match = c.allowedIps.match(/\.(\d+)\/\d+$/);
      return match ? parseInt(match[1]) : 0;
    });
    const subnetBase = node.wireguardSubnet.replace(/\.\d+\/\d+$/, "");
    let nextOctet = 2;
    while (usedOctets.includes(nextOctet)) nextOctet++;
    const clientIp = `${subnetBase}.${nextOctet}`;
    const allowedIps = `${clientIp}/32`;

    const addResult = await addPeerToServer(ssh, node.wireguardInterface, clientPublicKey, presharedKey, allowedIps);
    req.log.info({ success: addResult.success, output: addResult.output }, "addPeerToServer result");
    if (!addResult.success) {
      req.log.warn({ output: addResult.output }, "addPeerToServer failed");
      res.status(500).json({ error: "Failed to add peer: " + addResult.output });
      return;
    }

    const [client] = await db.insert(clientsTable).values({
      nodeId,
      name,
      publicKey: clientPublicKey,
      privateKey: clientPrivateKey,
      presharedKey,
      allowedIps,
    }).returning();

    res.status(201).json({
      id: client.id,
      nodeId: client.nodeId,
      name: client.name,
      publicKey: client.publicKey,
      allowedIps: client.allowedIps,
      createdAt: client.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "createClient failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nodes/:nodeId/clients/:clientId", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const clientId = parseInt(String(req.params.clientId));

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.nodeId, nodeId)));

    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    res.json({
      id: client.id, nodeId: client.nodeId, name: client.name,
      publicKey: client.publicKey, allowedIps: client.allowedIps,
      createdAt: client.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "getClient failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/nodes/:nodeId/clients/:clientId", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const clientId = parseInt(String(req.params.clientId));

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.nodeId, nodeId)));

    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const ssh = buildSshOpts(node);
    await removePeerFromServer(ssh, node.wireguardInterface, client.publicKey);
    await db.delete(clientsTable).where(eq(clientsTable.id, clientId));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteClient failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nodes/:nodeId/clients/:clientId/config", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const clientId = parseInt(String(req.params.clientId));

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.nodeId, nodeId)));

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    if (!client.privateKey) {
      res.status(409).json({ error: "Config unavailable — this client was imported from an existing node and its private key is not stored on the server. The client device's existing config still works." });
      return;
    }

    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;
    if (!node.serverPublicKey) { res.status(400).json({ error: "Node has no server key" }); return; }

    const config = buildClientConfig({
      clientPrivateKey: client.privateKey,
      clientAddress: client.allowedIps.replace("/32", ""),
      serverPublicKey: node.serverPublicKey,
      presharedKey: client.presharedKey,
      serverEndpoint: node.ipAddress,
      serverPort: node.wireguardPort,
    });

    res.json({ config });
  } catch (err) {
    req.log.error({ err }, "getClientConfig failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nodes/:nodeId/clients/:clientId/qr", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const clientId = parseInt(String(req.params.clientId));

    const [client] = await db
      .select()
      .from(clientsTable)
      .where(and(eq(clientsTable.id, clientId), eq(clientsTable.nodeId, nodeId)));

    if (!client) { res.status(404).json({ error: "Client not found" }); return; }

    if (!client.privateKey) {
      res.status(409).json({ error: "QR unavailable — this client was imported and its private key is not stored. The client device's existing config still works." });
      return;
    }

    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;
    if (!node.serverPublicKey) { res.status(400).json({ error: "Node has no server key" }); return; }

    const config = buildClientConfig({
      clientPrivateKey: client.privateKey,
      clientAddress: client.allowedIps.replace("/32", ""),
      serverPublicKey: node.serverPublicKey,
      presharedKey: client.presharedKey,
      serverEndpoint: node.ipAddress,
      serverPort: node.wireguardPort,
    });

    const qrDataUrl = await QRCode.toDataURL(config, { width: 400 });
    const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    res.json({ qrBase64 });
  } catch (err) {
    req.log.error({ err }, "getClientQr failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
