import { Router, type Response } from "express";
import { db, nodesTable, clientsTable } from "@workspace/db";
import { eq, count, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth.js";
import { testSshConnection, sshExec } from "../lib/ssh.js";
import { buildSshOpts } from "../lib/node-ssh.js";
import {
  installAndConfigureWireguard,
  importWireguardConfig,
  wireguardServiceAction,
  uninstallWireguard,
  checkWireguardLive,
} from "../lib/wireguard.js";

const router = Router();

function decryptPassword(enc: string): string {
  return Buffer.from(enc, "base64").toString("utf8");
}

function encryptPassword(pwd: string): string {
  return Buffer.from(pwd, "utf8").toString("base64");
}

function encryptKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64");
}

function decryptKey(enc: string): string {
  return Buffer.from(enc, "base64").toString("utf8");
}


async function getNodeOrFail(nodeId: number, res: Response) {
  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));
  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return null;
  }
  return node;
}

function nodeToResponse(node: typeof nodesTable.$inferSelect, clientCount: number, wireguardStatus?: string) {
  return {
    id: node.id,
    name: node.name,
    ipAddress: node.ipAddress,
    sshUser: node.sshUser,
    sshPort: node.sshPort,
    sshAuthMethod: node.sshAuthMethod as "password" | "private_key",
    wireguardPort: node.wireguardPort,
    wireguardStatus: (wireguardStatus ?? node.wireguardStatus) as "not_installed" | "stopped" | "running" | "unknown",
    wireguardInterface: node.wireguardInterface,
    clientCount,
    createdAt: node.createdAt.toISOString(),
  };
}

router.get("/nodes", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodes = await db.select().from(nodesTable);
    const clientCounts = await db
      .select({ nodeId: clientsTable.nodeId, cnt: count() })
      .from(clientsTable)
      .groupBy(clientsTable.nodeId);
    const countMap = new Map(clientCounts.map(r => [r.nodeId, Number(r.cnt)]));

    const liveStatuses = await Promise.all(nodes.map(async (n) => {
      if (!n.serverPublicKey || !n.wireguardInterface) {
        return { id: n.id, status: "not_installed" as const };
      }
      const status = await checkWireguardLive(buildSshOpts(n), n.wireguardInterface);
      db.update(nodesTable).set({ wireguardStatus: status }).where(eq(nodesTable.id, n.id)).catch(() => {});
      return { id: n.id, status };
    }));
    const statusMap = new Map(liveStatuses.map(r => [r.id, r.status]));

    res.json(nodes.map(n => nodeToResponse(n, countMap.get(n.id) ?? 0, statusMap.get(n.id))));
  } catch (err) {
    req.log.error({ err }, "listNodes failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes", requireAuth, async (req, res): Promise<void> => {
  try {
    const { name, ipAddress, sshUser, sshPassword, sshPrivateKey, sshPort, sshAuthMethod } = req.body as {
      name?: string; ipAddress?: string; sshUser?: string;
      sshPassword?: string; sshPrivateKey?: string;
      sshPort?: number; sshAuthMethod?: string;
    };
    if (!name || !ipAddress || !sshUser) {
      res.status(400).json({ error: "name, ipAddress, sshUser required" });
      return;
    }
    const method = sshAuthMethod === "private_key" ? "private_key" : "password";
    if (method === "password" && !sshPassword) {
      res.status(400).json({ error: "sshPassword required for password auth" });
      return;
    }
    if (method === "private_key" && !sshPrivateKey) {
      res.status(400).json({ error: "sshPrivateKey required for private_key auth" });
      return;
    }

    const [node] = await db.insert(nodesTable).values({
      name,
      ipAddress,
      sshUser,
      sshPort: sshPort ?? 22,
      sshAuthMethod: method,
      sshPasswordEncrypted: method === "password" ? encryptPassword(sshPassword!) : null,
      sshPrivateKeyEncrypted: method === "private_key" ? encryptKey(sshPrivateKey!) : null,
    }).returning();

    res.status(201).json(nodeToResponse(node, 0));
  } catch (err) {
    req.log.error({ err }, "createNode failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/nodes/:nodeId", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const [clientCountRow] = await db.select({ cnt: count() }).from(clientsTable).where(eq(clientsTable.nodeId, nodeId));

    let liveStatus = node.wireguardStatus;
    if (node.serverPublicKey && node.wireguardInterface) {
      liveStatus = await checkWireguardLive(buildSshOpts(node), node.wireguardInterface);
      db.update(nodesTable).set({ wireguardStatus: liveStatus }).where(eq(nodesTable.id, nodeId)).catch(() => {});
    }

    res.json(nodeToResponse(node, Number(clientCountRow?.cnt ?? 0), liveStatus));
  } catch (err) {
    req.log.error({ err }, "getNode failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/nodes/:nodeId", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const { sshAuthMethod, sshUser, sshPort, sshPassword, sshPrivateKey } = req.body as {
      sshAuthMethod?: string; sshUser?: string; sshPort?: number;
      sshPassword?: string; sshPrivateKey?: string;
    };

    const method = sshAuthMethod === "private_key" ? "private_key"
      : sshAuthMethod === "password" ? "password"
      : node.sshAuthMethod;

    if (method === "password" && sshAuthMethod === "password" && !sshPassword) {
      res.status(400).json({ error: "sshPassword required when switching to password auth" });
      return;
    }
    if (method === "private_key" && sshAuthMethod === "private_key" && !sshPrivateKey) {
      res.status(400).json({ error: "sshPrivateKey required when switching to private_key auth" });
      return;
    }

    const updates: Partial<typeof nodesTable.$inferInsert> = { sshAuthMethod: method };
    if (sshUser) updates.sshUser = sshUser;
    if (sshPort) updates.sshPort = sshPort;
    if (method === "password" && sshPassword) {
      updates.sshPasswordEncrypted = encryptPassword(sshPassword);
      updates.sshPrivateKeyEncrypted = null;
    }
    if (method === "private_key" && sshPrivateKey) {
      updates.sshPrivateKeyEncrypted = encryptKey(sshPrivateKey);
      updates.sshPasswordEncrypted = null;
    }

    const [updated] = await db.update(nodesTable).set(updates).where(eq(nodesTable.id, nodeId)).returning();
    const [clientCountRow] = await db.select({ cnt: count() }).from(clientsTable).where(eq(clientsTable.nodeId, nodeId));

    res.json(nodeToResponse(updated, Number(clientCountRow?.cnt ?? 0)));
  } catch (err) {
    req.log.error({ err }, "updateNodeSsh failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/nodes/:nodeId", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    await db.delete(nodesTable).where(eq(nodesTable.id, nodeId));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "deleteNode failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/test-connection", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await testSshConnection(buildSshOpts(node));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "testNodeConnection failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/setup-wireguard", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const { port = 51820, interface: iface = "wg0", subnet = "10.0.0.0/24" } = req.body as {
      port?: number; interface?: string; subnet?: string;
    };

    const result = await installAndConfigureWireguard(buildSshOpts(node), { port, iface, subnet });

    if (result.success && result.privateKey && result.publicKey) {
      await db.update(nodesTable).set({
        wireguardPort: port,
        wireguardInterface: iface,
        wireguardSubnet: subnet,
        wireguardStatus: "running",
        serverPublicKey: result.publicKey,
        serverPrivateKey: result.privateKey,
      }).where(eq(nodesTable.id, nodeId));
    }

    res.json({ success: result.success, message: result.message, output: result.output });
  } catch (err) {
    req.log.error({ err }, "setupWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/import-wireguard", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await importWireguardConfig(buildSshOpts(node));

    let importedClientCount = 0;

    if (result.success && result.privateKey && result.publicKey && result.iface) {
      await db.update(nodesTable).set({
        wireguardStatus: result.wireguardStatus ?? "stopped",
        wireguardInterface: result.iface,
        wireguardPort: result.port ?? 51820,
        wireguardSubnet: result.subnet,
        serverPublicKey: result.publicKey,
        serverPrivateKey: Buffer.from(result.privateKey).toString("base64"),
      }).where(eq(nodesTable.id, nodeId));

      if (result.peers && result.peers.length > 0) {
        for (let i = 0; i < result.peers.length; i++) {
          const peer = result.peers[i];
          if (!peer.publicKey) continue;
          const existing = await db.select({ id: clientsTable.id })
            .from(clientsTable)
            .where(and(eq(clientsTable.nodeId, nodeId), eq(clientsTable.publicKey, peer.publicKey)));
          if (existing.length === 0) {
            await db.insert(clientsTable).values({
              nodeId,
              name: peer.name?.trim() || `Imported Client ${i + 1}`,
              publicKey: peer.publicKey,
              privateKey: "",
              presharedKey: peer.presharedKey,
              allowedIps: peer.allowedIps,
            });
            importedClientCount++;
          }
        }
      }
    }

    res.json({
      success: result.success,
      message: result.message,
      wireguardInterface: result.iface ?? null,
      wireguardPort: result.port ?? null,
      wireguardSubnet: result.subnet ?? null,
      wireguardStatus: result.wireguardStatus ?? null,
      existingPeerCount: result.existingPeerCount ?? null,
      importedClientCount,
    });
  } catch (err) {
    req.log.error({ err }, "importWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/wireguard/status", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await sshExec(buildSshOpts(node), `sudo systemctl status wg-quick@${node.wireguardInterface} --no-pager && sudo systemctl is-enabled wg-quick@${node.wireguardInterface} && echo "Boot: enabled"`, 15000);
    const output = result.stdout + result.stderr;
    res.json({ success: result.code === 0, message: result.code === 0 ? "Status retrieved" : "Status check failed", output });
  } catch (err) {
    req.log.error({ err }, "statusWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/wireguard/start", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await wireguardServiceAction(buildSshOpts(node), node.wireguardInterface, "start");
    if (result.success) {
      await db.update(nodesTable).set({ wireguardStatus: "running" }).where(eq(nodesTable.id, nodeId));
    }
    res.json({ success: result.success, message: result.success ? "WireGuard started" : "Failed to start", output: result.output });
  } catch (err) {
    req.log.error({ err }, "startWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/wireguard/stop", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await wireguardServiceAction(buildSshOpts(node), node.wireguardInterface, "stop");
    if (result.success) {
      await db.update(nodesTable).set({ wireguardStatus: "stopped" }).where(eq(nodesTable.id, nodeId));
    }
    res.json({ success: result.success, message: result.success ? "WireGuard stopped" : "Failed to stop", output: result.output });
  } catch (err) {
    req.log.error({ err }, "stopWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/nodes/:nodeId/wireguard/restart", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await wireguardServiceAction(buildSshOpts(node), node.wireguardInterface, "restart");
    if (result.success) {
      await db.update(nodesTable).set({ wireguardStatus: "running" }).where(eq(nodesTable.id, nodeId));
    }
    res.json({ success: result.success, message: result.success ? "WireGuard restarted" : "Failed to restart", output: result.output });
  } catch (err) {
    req.log.error({ err }, "restartWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/nodes/:nodeId/wireguard", requireAuth, async (req, res): Promise<void> => {
  try {
    const nodeId = parseInt(String(req.params.nodeId));
    const node = await getNodeOrFail(nodeId, res);
    if (!node) return;

    const result = await uninstallWireguard(buildSshOpts(node), node.wireguardInterface);
    if (result.success) {
      await db.update(nodesTable).set({
        wireguardStatus: "not_installed",
        serverPublicKey: null,
        serverPrivateKey: null,
      }).where(eq(nodesTable.id, nodeId));
      await db.delete(clientsTable).where(eq(clientsTable.nodeId, nodeId));
    }
    res.json({ success: result.success, message: result.success ? "WireGuard uninstalled" : "Failed to uninstall", output: result.output });
  } catch (err) {
    req.log.error({ err }, "uninstallWireguard failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
