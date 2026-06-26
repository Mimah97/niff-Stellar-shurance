/**
 * Network manifest — single source of truth for contract addresses.
 * Pulled from contracts/deployment-registry.json so docs and the app
 * never drift from the backend deployment registry.
 */
import registry from './deployment-registry.json'

export type Network = 'testnet' | 'mainnet' | 'futurenet'

export interface ContractEntry {
  name: string
  contractId: string
  expectedWasmHash: string
  expectedVersion?: string
  deployedVersion?: string
  deployedAt: string
  stellarExpertUrl: string
}

const EXPLORER: Record<Network, string> = {
  testnet: 'https://stellar.expert/explorer/testnet/contract',
  mainnet: 'https://stellar.expert/explorer/public/contract',
  futurenet: 'https://stellar.expert/explorer/futurenet/contract',
}

export function getContracts(network: Network): ContractEntry[] {
  const networkEntry = registry.networks[network]
  if (!networkEntry) return []
  return networkEntry.contracts.map((c) => ({
    name: c.name,
    contractId: c.contractId,
    expectedWasmHash: c.expectedWasmHash,
    expectedVersion: (c as { expectedVersion?: string }).expectedVersion ?? undefined,
    deployedVersion: (c as { deployedVersion?: string }).deployedVersion ?? undefined,
    deployedAt: c.deployedAt,
    stellarExpertUrl: `${EXPLORER[network]}/${c.contractId}`,
  }))
}

/**
 * Returns the deployed semantic version for the primary "niffyinsure" contract
 * on the given network. Falls back to expectedVersion if deployedVersion is
 * empty, and then to undefined if neither is set.
 */
export function getPrimaryContractVersion(network: Network): string | undefined {
  const contracts = getContracts(network)
  const primary = contracts.find((c) => c.name === 'niffyinsure') ?? contracts[0]
  if (!primary) return undefined
  const version = primary.deployedVersion || primary.expectedVersion
  // Skip placeholder values that were never filled in
  if (!version || version.startsWith('${')) return undefined
  return version
}
