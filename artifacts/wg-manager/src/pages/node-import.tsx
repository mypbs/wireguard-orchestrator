import Layout from "@/components/layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetNode,
  useTestNodeConnection,
  useImportWireguard,
  getGetNodeQueryKey,
} from "@workspace/api-client-react";
import { useLocation, Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Terminal, CheckCircle2, XCircle, Download } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const formSchema = z.object({});

export default function NodeImport() {
  const params = useParams();
  const nodeId = parseInt(params.nodeId || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [connectionSuccess, setConnectionSuccess] = useState<boolean | null>(null);
  const [importOutput, setImportOutput] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<boolean | null>(null);

  const { data: node } = useGetNode(nodeId, { query: { queryKey: getGetNodeQueryKey(nodeId), enabled: !!nodeId } });
  const testConnection = useTestNodeConnection();
  const importWg = useImportWireguard();

  const handleTestConnection = () => {
    setTestOutput(null);
    setConnectionSuccess(null);
    testConnection.mutate({ nodeId }, {
      onSuccess: (res) => {
        setConnectionSuccess(res.success);
        setTestOutput(res.message);
      },
      onError: (err: any) => {
        setConnectionSuccess(false);
        setTestOutput(err?.message || "Connection failed");
      },
    });
  };

  const handleImport = () => {
    setImportOutput(null);
    setImportSuccess(null);
    importWg.mutate({ nodeId }, {
      onSuccess: (res) => {
        setImportSuccess(res.success);
        if (res.success) {
          const lines = [
            `✓ ${res.message}`,
            res.wireguardInterface ? `Interface  : ${res.wireguardInterface}` : null,
            res.wireguardPort     ? `Port       : ${res.wireguardPort}` : null,
            res.wireguardSubnet   ? `Subnet     : ${res.wireguardSubnet}` : null,
            res.wireguardStatus   ? `Status     : ${res.wireguardStatus.toUpperCase()}` : null,
            res.importedClientCount !== null && res.importedClientCount !== undefined
              ? `Clients imported: ${res.importedClientCount} of ${res.existingPeerCount ?? 0} peer(s) found`
              : null,
          ].filter(Boolean).join("\n");
          setImportOutput(lines);
          queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
          setTimeout(() => setLocation(`/nodes/${nodeId}`), 3000);
        } else {
          setImportOutput(`✗ ${res.message}`);
        }
      },
      onError: (err: any) => {
        setImportSuccess(false);
        setImportOutput(err?.message || "Import failed");
      },
    });
  };

  return (
    <Layout>
      <div className="mb-6">
        <Link href={`/nodes/${nodeId}`} className="inline-flex items-center text-sm font-mono text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          BACK TO NODE
        </Link>
        <h1 className="text-3xl font-mono font-bold tracking-tight">IMPORT WIREGUARD CONFIG</h1>
        <p className="text-muted-foreground mt-1">
          Read the existing WireGuard setup from <span className="font-mono font-medium">{node?.name}</span> and register it without reinstalling.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="font-mono font-bold mb-4 flex items-center">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center mr-2 text-xs">1</span>
              PRE-FLIGHT CHECK
            </h2>
            <p className="text-sm font-mono text-muted-foreground mb-4">
              Verify SSH access before reading the node configuration.
            </p>
            <Button
              onClick={handleTestConnection}
              variant="outline"
              className="font-mono text-xs font-bold tracking-wider"
              disabled={testConnection.isPending}
            >
              <Terminal className="w-4 h-4 mr-2" />
              {testConnection.isPending ? "TESTING..." : "TEST CONNECTION"}
            </Button>

            {connectionSuccess !== null && (
              <div className={`mt-4 p-3 rounded border font-mono text-sm flex items-start ${
                connectionSuccess
                  ? "bg-green-500/10 border-green-500/20 text-green-500"
                  : "bg-destructive/10 border-destructive/20 text-destructive"
              }`}>
                {connectionSuccess
                  ? <CheckCircle2 className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />}
                <span>{testOutput}</span>
              </div>
            )}
          </div>

          <div className={`bg-card border border-border rounded-lg p-6 transition-opacity ${connectionSuccess ? "opacity-100" : "opacity-50 pointer-events-none"}`}>
            <h2 className="font-mono font-bold mb-4 flex items-center">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center mr-2 text-xs">2</span>
              IMPORT CONFIGURATION
            </h2>
            <p className="text-sm font-mono text-muted-foreground mb-4">
              Reads <span className="font-mono">/etc/wireguard/*.conf</span>, imports the server keys, port, subnet, and all existing peers as clients. Imported clients show in the node's client list — their VPN still works, but the QR code and config file can't be regenerated (the private key only lives on the device).
            </p>
            <Button
              onClick={handleImport}
              className="w-full font-mono font-bold text-xs uppercase tracking-wider"
              disabled={importWg.isPending || !connectionSuccess}
            >
              <Download className="w-4 h-4 mr-2" />
              {importWg.isPending ? "IMPORTING..." : "IMPORT FROM NODE"}
            </Button>
          </div>
        </div>

        <div>
          <h3 className="font-mono font-bold text-sm text-muted-foreground uppercase tracking-wider mb-2">Import Log</h3>
          <div className="bg-[#0a0a0a] border border-border rounded-md overflow-hidden flex flex-col h-[360px]">
            <div className="flex items-center px-4 py-2 border-b border-border/50 bg-black/40">
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
              </div>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              {importOutput ? (
                <pre className={`text-xs font-mono whitespace-pre-wrap break-words ${importSuccess ? "text-green-400" : "text-red-400"}`}>
                  {importOutput}
                  {importSuccess && "\n\nRedirecting to node page..."}
                </pre>
              ) : (
                <pre className="text-xs font-mono text-gray-500">
                  Waiting for import...
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
