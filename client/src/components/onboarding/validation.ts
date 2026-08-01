// Doc 27 Đợt 5 / W5-E — gap F3: pure field validators for the onboarding
// wizard (kept free of React/tRPC imports so they are unit-testable).

// Machine code: alphanumeric start, then letters/digits/._- (matches existing
// codes like "AOI-LINE1-01" / "SN-xxx"), max 50 (server limit).
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// IPv4 (each octet 0-255) OR a hostname label sequence (edge deployments
// sometimes address machines by mDNS/DNS name).
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_RE = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

export function isValidMachineCode(code: string): boolean {
  const c = code.trim();
  return c.length > 0 && c.length <= 50 && CODE_RE.test(c);
}

export function isValidAddress(addr: string): boolean {
  const a = addr.trim();
  if (a.length === 0) return false;
  // Anything made only of digits and dots is being typed as an IP — hold it to
  // strict IPv4 so typos like "256.1.1.1" or "192.168.1" are caught instead of
  // slipping through as technically-valid all-numeric hostnames.
  if (/^[\d.]+$/.test(a)) return IPV4_RE.test(a);
  return HOSTNAME_RE.test(a);
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}
