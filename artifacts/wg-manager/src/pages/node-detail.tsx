import Layout from "@/components/layout";
import { 
  useGetNode, 
  useListClients, 
  useDeleteNode, 
  useStartWireguard, 
  useStopWireguard, 
  useRestartWireguard,
  useStatusWireguard,
  useUninstallWireguard,
  useCreateClient,
  useDeleteClient,
  useUpdateNodeSsh,
  useTestNodeConnection,
  getListNodesQueryKey,
  getGetNodeQueryKey,
  getListClientsQueryKey
} from "@workspace/api-client-react";
import { useLocation, Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Play, Square, RotateCw, Activity, Trash2, Shield, Plus, Settings, Key, QrCode, Download, Lock, KeyRound, Pencil, Terminal, CheckCircle2, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { TerminalBox } from "@/components/terminal-box";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-500/10 text-green-500 border border-green-500/20">RUNNING</span>;
    case 'stopped':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">STOPPED</span>;
    case 'not_installed':
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">UNINSTALLED</span>;
    default:
      return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-500/10 text-red-500 border border-red-500/20">UNKNOWN</span>;
  }
}

function AuthMethodBadge({ method }: { method: string }) {
  if (method === "private_key") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
        <KeyRound className="w-3 h-3" /> PRIVATE KEY
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground border border-border font-mono">
      <Lock className="w-3 h-3" /> PASSWORD
    </span>
  );
}

export default function NodeDetail() {
  const params = useParams();
  const nodeId = parseInt(params.nodeId || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [output, setOutput] = useState<string | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false);
  const [isEditSshOpen, setIsEditSshOpen] = useState(false);

  const [sshTestResult, setSshTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [editMethod, setEditMethod] = useState<"password" | "private_key">("password");
  const [editUser, setEditUser] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editPrivateKey, setEditPrivateKey] = useState("");
  const [editError, setEditError] = useState("");

  const { data: node, isLoading: nodeLoading } = useGetNode(nodeId, { query: { queryKey: getGetNodeQueryKey(nodeId), enabled: !!nodeId } });
  const { data: clients, isLoading: clientsLoading } = useListClients(nodeId, { query: { queryKey: getListClientsQueryKey(nodeId), enabled: !!nodeId } });

  const deleteNode = useDeleteNode();
  const startWg = useStartWireguard();
  const stopWg = useStopWireguard();
  const restartWg = useRestartWireguard();
  const statusWg = useStatusWireguard();
  const uninstallWg = useUninstallWireguard();
  const createClient = useCreateClient();
  const deleteClient = useDeleteClient();
  const updateSsh = useUpdateNodeSsh();
  const testConnection = useTestNodeConnection();

  const openEditSsh = () => {
    if (!node) return;
    setEditMethod(node.sshAuthMethod as "password" | "private_key");
    setEditUser(node.sshUser);
    setEditPort(String(node.sshPort));
    setEditPassword("");
    setEditPrivateKey("");
    setEditError("");
    setSshTestResult(null);
    setIsEditSshOpen(true);
  };

  const handleSaveEditSsh = () => {
    setEditError("");
    if (!editUser.trim()) { setEditError("SSH user is required"); return; }
    if (editMethod === "password" && !editPassword) { setEditError("Password is required"); return; }
    if (editMethod === "private_key" && !editPrivateKey.trim()) { setEditError("Private key is required"); return; }

    updateSsh.mutate({
      nodeId,
      data: {
        sshAuthMethod: editMethod,
        sshUser: editUser,
        sshPort: editPort ? parseInt(editPort) : undefined,
        sshPassword: editMethod === "password" ? editPassword : undefined,
        sshPrivateKey: editMethod === "private_key" ? editPrivateKey : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
        setIsEditSshOpen(false);
      },
      onError: (err: any) => {
        setEditError(err?.message || "Failed to update SSH credentials");
      }
    });
  };

  const handleDeleteNode = () => {
    deleteNode.mutate({ nodeId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
        setLocation("/dashboard");
      }
    });
  };

  const handleControlAction = (mutation: any) => {
    setOutput(null);
    mutation.mutate({ nodeId }, {
      onSuccess: (res: any) => {
        queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
        if (res?.output) setOutput(res.output);
      },
      onError: (err: any) => {
        setOutput(err?.message || "An error occurred");
      }
    });
  };

  const handleCreateClient = () => {
    if (!newClientName) return;
    createClient.mutate({ nodeId, data: { name: newClientName } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey(nodeId) });
        queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
        setNewClientName("");
        setIsClientDialogOpen(false);
      }
    });
  };

  const handleDeleteClient = (clientId: number) => {
    deleteClient.mutate({ nodeId, clientId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey(nodeId) });
        queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
      }
    });
  };

  if (nodeLoading) {
    return (
      <Layout>
        <Skeleton className="h-10 w-64 mb-8" />
        <Skeleton className="h-64 w-full" />
      </Layout>
    );
  }

  if (!node) {
    return (
      <Layout>
        <div className="p-8 text-center text-muted-foreground font-mono">Node not found</div>
      </Layout>
    );
  }

  const isInstalled = node.wireguardStatus !== 'not_installed';
  const isRunning = node.wireguardStatus === 'running';

  return (
    <Layout>
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link href="/dashboard" className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            BACK TO DASHBOARD
          </Link>
          <div className="flex items-center space-x-4">
            <h1 className="text-3xl font-mono font-bold tracking-tight">{node.name}</h1>
            <StatusBadge status={node.wireguardStatus} />
          </div>
          <p className="text-muted-foreground font-mono text-sm mt-2">{node.ipAddress}</p>
        </div>
        
        <div className="flex items-center space-x-2">
          {!isInstalled && (
            <>
              <Link href={`/nodes/${nodeId}/import`}>
                <Button variant="outline" className="font-mono text-xs font-bold tracking-wider">
                  <Download className="w-4 h-4 mr-2" />
                  IMPORT CONFIG
                </Button>
              </Link>
              <Link href={`/nodes/${nodeId}/setup`}>
                <Button className="font-mono text-xs font-bold tracking-wider">
                  <Settings className="w-4 h-4 mr-2" />
                  SETUP WIREGUARD
                </Button>
              </Link>
            </>
          )}
          <ConfirmationDialog
            title="Delete Node"
            description="Are you sure? This will remove the node from the dashboard but will NOT uninstall WireGuard from the server."
            actionText="DELETE NODE"
            destructive
            onConfirm={handleDeleteNode}
            trigger={
              <Button variant="outline" size="icon" className="border-destructive/30 text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4" />
              </Button>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="bg-card border border-border rounded-lg p-6 lg:col-span-2">
          <h2 className="text-lg font-mono font-bold mb-4 tracking-tight flex items-center">
            <Shield className="w-5 h-5 mr-2 text-primary" />
            WIREGUARD CONTROLS
          </h2>
          
          {isInstalled ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-xs font-mono text-muted-foreground uppercase block mb-1">Interface</span>
                  <span className="font-mono font-medium">{node.wireguardInterface || "wg0"}</span>
                </div>
                <div>
                  <span className="text-xs font-mono text-muted-foreground uppercase block mb-1">Port</span>
                  <span className="font-mono font-medium">{node.wireguardPort || "51820"}</span>
                </div>
                <div className="col-span-2 flex justify-end flex-wrap gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="font-mono text-xs tracking-wider border-green-500/30 text-green-500 hover:bg-green-500/10"
                    onClick={() => handleControlAction(startWg)}
                    disabled={isRunning || startWg.isPending}
                  >
                    <Play className="w-3 h-3 mr-2" /> START
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="font-mono text-xs tracking-wider border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => handleControlAction(stopWg)}
                    disabled={!isRunning || stopWg.isPending}
                  >
                    <Square className="w-3 h-3 mr-2" /> STOP
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="font-mono text-xs tracking-wider"
                    onClick={() => handleControlAction(restartWg)}
                    disabled={restartWg.isPending}
                  >
                    <RotateCw className={`w-3 h-3 mr-2 ${restartWg.isPending ? 'animate-spin' : ''}`} /> RESTART
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="font-mono text-xs tracking-wider border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                    onClick={() => handleControlAction(statusWg)}
                    disabled={statusWg.isPending}
                  >
                    <Activity className={`w-3 h-3 mr-2 ${statusWg.isPending ? 'animate-pulse' : ''}`} /> STATUS
                  </Button>
                </div>
              </div>

              <TerminalBox output={output} />

              <div className="pt-4 border-t border-border mt-4 flex justify-between items-center">
                <Link href={`/nodes/${nodeId}/setup`}>
                  <Button variant="outline" size="sm" className="font-mono text-xs tracking-wider border-muted-foreground/30 text-muted-foreground hover:bg-muted/10">
                    <Settings className="w-3 h-3 mr-2" /> Re-setup WireGuard
                  </Button>
                </Link>
                <ConfirmationDialog
                  title="Uninstall WireGuard"
                  description={`This will completely remove WireGuard and all client configs from ${node.name}. This action cannot be undone.`}
                  actionText="UNINSTALL"
                  destructive
                  onConfirm={() => handleControlAction(uninstallWg)}
                  trigger={
                    <Button variant="outline" size="sm" className="font-mono text-xs text-destructive border-destructive/20 hover:bg-destructive/10">
                      Uninstall WireGuard
                    </Button>
                  }
                />
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Shield className="w-12 h-12 text-muted-foreground opacity-30 mx-auto mb-4" />
              <p className="text-muted-foreground font-mono text-sm mb-4">WireGuard is not currently installed on this node.</p>
              <div className="flex items-center justify-center gap-3">
                <Link href={`/nodes/${nodeId}/import`}>
                  <Button variant="outline" className="font-mono text-xs tracking-wider">
                    <Download className="w-4 h-4 mr-2" />
                    IMPORT EXISTING CONFIG
                  </Button>
                </Link>
                <Link href={`/nodes/${nodeId}/setup`}>
                  <Button className="font-mono text-xs tracking-wider">
                    <Settings className="w-4 h-4 mr-2" />
                    FRESH INSTALL
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-mono font-bold tracking-tight">NODE DETAILS</h2>
            <Button
              variant="ghost"
              size="sm"
              className="font-mono text-xs text-muted-foreground hover:text-foreground h-7 px-2"
              onClick={openEditSsh}
            >
              <Pencil className="w-3 h-3 mr-1" /> EDIT SSH
            </Button>
          </div>
          <div className="space-y-4 font-mono text-sm">
            <div>
              <span className="text-xs text-muted-foreground uppercase block">IP Address</span>
              <span>{node.ipAddress}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase block">SSH User</span>
              <span>{node.sshUser}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase block">SSH Port</span>
              <span>{node.sshPort}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase block mb-1">Auth Method</span>
              <AuthMethodBadge method={node.sshAuthMethod} />
            </div>
            <div>
              <span className="text-xs text-muted-foreground uppercase block">Created At</span>
              <span>{new Date(node.createdAt).toLocaleString()}</span>
            </div>
            <div className="pt-2 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                className="w-full font-mono text-xs font-bold tracking-wider"
                disabled={testConnection.isPending}
                onClick={() => {
                  setSshTestResult(null);
                  testConnection.mutate({ nodeId }, {
                    onSuccess: (res) => setSshTestResult({ success: res.success, message: res.message }),
                    onError: (err: any) => setSshTestResult({ success: false, message: err?.message || "Connection failed" }),
                  });
                }}
              >
                <Terminal className="w-3 h-3 mr-2" />
                {testConnection.isPending ? "TESTING..." : "TEST SSH CONNECTION"}
              </Button>
              {sshTestResult !== null && (
                <div className={`mt-2 p-2 rounded border font-mono text-xs flex items-start gap-2 ${
                  sshTestResult.success
                    ? "bg-green-500/10 border-green-500/20 text-green-500"
                    : "bg-destructive/10 border-destructive/20 text-destructive"
                }`}>
                  {sshTestResult.success
                    ? <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                    : <XCircle className="w-3 h-3 shrink-0 mt-0.5" />}
                  {sshTestResult.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-end mb-4">
        <h2 className="text-xl font-mono font-bold tracking-tight">CLIENTS</h2>
        <Dialog open={isClientDialogOpen} onOpenChange={setIsClientDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="font-mono text-xs tracking-wider" disabled={!isInstalled}>
              <Plus className="w-4 h-4 mr-2" /> ADD CLIENT
            </Button>
          </DialogTrigger>
          <DialogContent className="border-border">
            <DialogHeader>
              <DialogTitle className="font-mono">NEW CLIENT</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Client Name</Label>
                <Input 
                  className="font-mono" 
                  placeholder="e.g. jdoe-macbook" 
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                className="font-mono text-xs font-bold tracking-wider"
                onClick={handleCreateClient}
                disabled={!newClientName || createClient.isPending}
              >
                {createClient.isPending ? "CREATING..." : "CREATE CLIENT"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {!isInstalled ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm">
            Install WireGuard to manage clients.
          </div>
        ) : clientsLoading ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm animate-pulse">
            Loading clients...
          </div>
        ) : clients?.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground font-mono text-sm">
            No clients found. Add one to get started.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="font-mono text-xs font-semibold text-muted-foreground uppercase px-4 py-3">Name</th>
                <th className="font-mono text-xs font-semibold text-muted-foreground uppercase px-4 py-3">IP Address</th>
                <th className="font-mono text-xs font-semibold text-muted-foreground uppercase px-4 py-3">Public Key</th>
                <th className="font-mono text-xs font-semibold text-muted-foreground uppercase px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-mono text-sm">
              {clients?.map((client) => (
                <tr key={client.id} className="border-b border-border hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-3 font-bold text-primary">
                    <Link href={`/nodes/${nodeId}/clients/${client.id}`} className="hover:underline">
                      {client.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{client.allowedIps.split('/')[0]}</td>
                  <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]" title={client.publicKey}>
                    {client.publicKey.substring(0, 16)}...
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link href={`/nodes/${nodeId}/clients/${client.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <QrCode className="w-4 h-4" />
                      </Button>
                    </Link>
                    <ConfirmationDialog
                      title="Delete Client"
                      description={`Revoke access for ${client.name}? This will remove their configuration from the server.`}
                      actionText="DELETE"
                      destructive
                      onConfirm={() => handleDeleteClient(client.id)}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit SSH Dialog */}
      <Dialog open={isEditSshOpen} onOpenChange={setIsEditSshOpen}>
        <DialogContent className="border-border max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">EDIT SSH CREDENTIALS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">SSH User</Label>
                <Input className="font-mono" value={editUser} onChange={e => setEditUser(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">SSH Port</Label>
                <Input className="font-mono" type="number" value={editPort} onChange={e => setEditPort(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase text-muted-foreground block">Auth Method</Label>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEditMethod("password")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-bold tracking-wider transition-colors",
                    editMethod === "password"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  <Lock className="w-3 h-3" /> PASSWORD
                </button>
                <button
                  type="button"
                  onClick={() => setEditMethod("private_key")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-xs font-mono font-bold tracking-wider transition-colors border-l border-border",
                    editMethod === "private_key"
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted/30"
                  )}
                >
                  <KeyRound className="w-3 h-3" /> PRIVATE KEY
                </button>
              </div>
            </div>

            {editMethod === "password" ? (
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">New Password</Label>
                <Input
                  type="password"
                  className="font-mono"
                  placeholder="Enter new password"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                />
                <p className="text-xs text-muted-foreground font-mono">Leave blank to keep existing password.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="font-mono text-xs uppercase text-muted-foreground">Private Key (PEM)</Label>
                <Textarea
                  className="font-mono text-xs h-32 resize-none"
                  placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                  value={editPrivateKey}
                  onChange={e => setEditPrivateKey(e.target.value)}
                />
                <p className="text-xs text-muted-foreground font-mono">Key is stored securely and never shown.</p>
              </div>
            )}

            {editError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive font-mono">
                {editError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="font-mono text-xs" onClick={() => setIsEditSshOpen(false)}>
              CANCEL
            </Button>
            <Button
              className="font-mono text-xs font-bold tracking-wider"
              onClick={handleSaveEditSsh}
              disabled={updateSsh.isPending}
            >
              {updateSsh.isPending ? "SAVING..." : "SAVE CHANGES"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
