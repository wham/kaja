import { endpointLabel } from "./knownServers";
import { GrpcMark } from "./protocolMarks";

// A gRPC server Kaja knows the address of, so naming it is enough to reflect it.
export interface KnownGrpcServer {
  name: string;
  address: string;
  mark: (props: { size?: number; className?: string }) => React.ReactNode;
}

export const knownGrpcServers: KnownGrpcServer[] = [{ name: "grpcb.in", address: "grpcb.in:9000", mark: GrpcMark }];

// The host and port, however the address was spelled: "dns:///grpcb.in:9000" and
// "GRPCB.IN:9000" are the same server, but grpcb.in:9001 is its TLS twin, not it.
function canonicalAddress(value: string): string {
  return value
    .trim()
    .replace(/^(dns|grpc|passthrough):\/*/i, "")
    .split("/")[0]
    .toLowerCase();
}

export function knownGrpcServerFor(url: string): KnownGrpcServer | undefined {
  const canonical = canonicalAddress(url);
  if (!canonical) return undefined;
  return knownGrpcServers.find((server) => canonicalAddress(server.address) === canonical);
}

export function matchingGrpcServers(query: string): KnownGrpcServer[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return knownGrpcServers;
  return knownGrpcServers.filter((server) => (server.name + " " + endpointLabel(server.address)).toLowerCase().includes(needle));
}
