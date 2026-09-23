import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const PROVIDER_HOSTS = new Set(['api.spotify.com', 'accounts.spotify.com', 'itunes.apple.com']);
const deniedV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) deniedV4.addSubnet(network, prefix, 'ipv4');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const deniedV6 = new BlockList();
for (const [network, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['2620:4f:8000::', 48], ['3fff::', 20],
] as const) deniedV6.addSubnet(network, prefix, 'ipv6');

export function isPublicProviderAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !deniedV4.check(address, 'ipv4');
  // Positive global-unicast allowlisting also excludes IPv4-mapped, translation,
  // link-local, unique-local, multicast, unspecified and other reserved formats.
  return family === 6 && globalV6.check(address, 'ipv6') && !deniedV6.check(address, 'ipv6');
}

export type ProviderResolver = (hostname: string) => Promise<LookupAddress[]>;

export function createProviderLookup(
  resolve: ProviderResolver = hostname => lookup(hostname, { all: true, verbatim: true }),
): LookupFunction {
  return (hostname, options, callback) => {
    const reject = (cause?: unknown) => {
      const error = new Error('Provider DNS destination rejected') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      if (cause instanceof Error) error.cause = cause;
      callback(error, '', 0);
    };
    if (!PROVIDER_HOSTS.has(hostname)) {
      reject();
      return;
    }
    // This is the socket's own lookup, not a check followed by another lookup.
    // Return only the exact addresses vetted here to pin this connection.
    Promise.resolve().then(() => resolve(hostname)).then(addresses => {
      if (!addresses.length || addresses.length > 64
        || addresses.some(item => !isPublicProviderAddress(item.address) || item.family !== isIP(item.address))) {
        reject();
        return;
      }
      const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
      const selected = family ? addresses.filter(item => item.family === family) : addresses;
      if (!selected.length) {
        reject();
        return;
      }
      if (options.all) callback(null, selected.map(item => ({ address: item.address, family: item.family })));
      else callback(null, selected[0].address, selected[0].family);
    }, reject);
  };
}
