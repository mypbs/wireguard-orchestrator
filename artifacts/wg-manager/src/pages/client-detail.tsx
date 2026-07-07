import Layout from "@/components/layout";
import { 
  useGetClient, 
  useGetClientConfig, 
  useGetClientQr,
  useGetNode,
  useDeleteClient,
  getListClientsQueryKey,
  getGetNodeQueryKey,
  getGetClientQueryKey,
  getGetClientConfigQueryKey,
  getGetClientQrQueryKey,
} from "@workspace/api-client-react";
import { useLocation, Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Download, Trash2, Key, Network, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

export default function ClientDetail() {
  const params = useParams();
  const nodeId = parseInt(params.nodeId || "0", 10);
  const clientId = parseInt(params.clientId || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: node } = useGetNode(nodeId, { query: { queryKey: getGetNodeQueryKey(nodeId), enabled: !!nodeId } });
  const { data: client, isLoading: clientLoading } = useGetClient(nodeId, clientId, { query: { queryKey: getGetClientQueryKey(nodeId, clientId), enabled: !!nodeId && !!clientId } });
  const { data: configData, isError: configError } = useGetClientConfig(nodeId, clientId, { query: { queryKey: getGetClientConfigQueryKey(nodeId, clientId), enabled: !!nodeId && !!clientId, retry: false } });
  const { data: qrData, isError: qrError } = useGetClientQr(nodeId, clientId, { query: { queryKey: getGetClientQrQueryKey(nodeId, clientId), enabled: !!nodeId && !!clientId, retry: false } });
  
  const deleteClient = useDeleteClient();

  const handleDownload = () => {
    if (!configData?.config || !client) return;
    const blob = new Blob([configData.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name}.conf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = () => {
    deleteClient.mutate({ nodeId, clientId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListClientsQueryKey(nodeId) });
        setLocation(`/nodes/${nodeId}`);
      }
    });
  };

  if (clientLoading) {
    return (
      <Layout>
        <Skeleton className="h-10 w-64 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }

  if (!client) {
    return (
      <Layout>
        <div className="p-8 text-center text-muted-foreground font-mono">Client not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link href={`/nodes/${nodeId}`} className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            BACK TO {node?.name?.toUpperCase() || 'NODE'}
          </Link>
          <h1 className="text-3xl font-mono font-bold tracking-tight text-primary">{client.name}</h1>
          <p className="text-muted-foreground font-mono text-sm mt-2">Client Configuration</p>
        </div>
        
        <div className="flex space-x-2">
          <ConfirmationDialog
            title="Delete Client"
            description={`Are you sure you want to revoke access for ${client.name}? The client will be disconnected immediately.`}
            actionText="DELETE"
            destructive
            onConfirm={handleDelete}
            trigger={
              <Button variant="outline" className="font-mono text-xs font-bold tracking-wider border-destructive/30 text-destructive hover:bg-destructive/10">
                <Trash2 className="w-4 h-4 mr-2" />
                REVOKE
              </Button>
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-mono font-bold mb-6 tracking-tight flex items-center">
              <Key className="w-5 h-5 mr-2 text-primary" />
              IDENTIFICATION
            </h2>
            <div className="space-y-4 font-mono text-sm">
              <div>
                <span className="text-xs text-muted-foreground uppercase block mb-1">Assigned IP Address</span>
                <span className="bg-secondary px-2 py-1 rounded text-primary font-bold inline-flex items-center">
                  <Network className="w-3 h-3 mr-2" />
                  {client.allowedIps.split('/')[0]}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase block mb-1">Public Key</span>
                <span className="break-all">{client.publicKey}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground uppercase block mb-1">Created At</span>
                <span>{new Date(client.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-mono font-bold tracking-tight">CONFIGURATION FILE</h2>
              {!configError && (
                <Button 
                  onClick={handleDownload} 
                  variant="outline" 
                  size="sm" 
                  className="font-mono text-xs font-bold tracking-wider"
                  disabled={!configData}
                >
                  <Download className="w-4 h-4 mr-2" />
                  DOWNLOAD .CONF
                </Button>
              )}
            </div>
            {configError ? (
              <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <div className="font-mono text-xs text-yellow-400 leading-relaxed">
                  <p className="font-bold mb-1">IMPORTED CLIENT — CONFIG UNAVAILABLE</p>
                  <p>This client was imported from an existing WireGuard node. The private key only exists on the client device and was never stored here, so the config file and QR code can't be regenerated.</p>
                  <p className="mt-2">The existing config on the device still works — no action needed.</p>
                </div>
              </div>
            ) : (
              <div className="bg-[#0a0a0a] rounded-md p-4 overflow-x-auto border border-border">
                <pre className="text-xs font-mono text-gray-300">
                  {configData?.config || "Loading configuration..."}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="bg-card border border-border rounded-lg p-6 flex flex-col items-center">
            <h2 className="text-lg font-mono font-bold mb-2 tracking-tight w-full text-center">MOBILE SETUP</h2>
            <p className="text-xs font-mono text-muted-foreground text-center mb-6">Scan from WireGuard app</p>
            
            <div className="bg-white p-4 rounded-xl shadow-sm mb-6 inline-block">
              {qrError ? (
                <div className="w-48 h-48 flex flex-col items-center justify-center bg-gray-100 gap-2 p-4">
                  <AlertTriangle className="w-8 h-8 text-yellow-500" />
                  <span className="font-mono text-xs text-gray-500 text-center leading-tight">Private key not stored — use existing device config</span>
                </div>
              ) : qrData?.qrBase64 ? (
                <img 
                  src={`data:image/png;base64,${qrData.qrBase64}`} 
                  alt="WireGuard QR Code" 
                  className="w-48 h-48 object-contain"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center bg-gray-100 text-gray-400 font-mono text-xs">
                  Loading QR...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
