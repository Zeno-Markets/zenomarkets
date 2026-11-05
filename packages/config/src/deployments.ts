import type { Address } from "@zeno/types";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, type ChainId } from "./chains.js";

export interface ContractAddresses {
  marketRegistry: Address;
  oracleRouter: Address;
  vault: Address;
  collateralManager: Address;
  feeManager: Address;
  buybackModule: Address;
  riskManager: Address;
  optionsEngine: Address;
  optionMarket: Address;
  optionPositionManager: Address;
  perpsEngine: Address;
  perpPositionManager: Address;
  /// Absent on deployments made before limit orders (`[1.1.0-testnet]` and earlier); the SDK
  /// reports limit orders as unavailable there instead of calling a contract that lacks them.
  perpOrderManager?: Address;
  /// Absent on deployments made before `[1.3.0]`: the loss buffer that pays a liquidated position's
  /// shortfall (Phase 7, clearing).
  insuranceFund?: Address;
  /// Absent before `[1.3.0]`: account-level margin, other collateral and portfolio margin.
  crossMargin?: Address;
  /// Absent before `[1.3.0]`: creates subaccounts.
  subaccountFactory?: Address;
  /// Absent before `[1.3.0]`: request-for-quote and block trades for perps.
  rfqManager?: Address;
  liquidationEngine: Address;
  fundingManager: Address;
  priceValidator: Address;
  settlementToken: Address;
  /// Credit stack (Phase 9). All absent until `DeployCreditStack.s.sol` is broadcast.
  creditOracle?: Address;
  creditRegistry?: Address;
  creditRouter?: Address;
  creditVault?: Address;
  creditPairTslaUsdg?: Address;
}

/// Contracts a deployment may not have, because they were added after it was made. They are absent
/// from the recorded literal below until a deployment includes them, but `ZENO_ADDRESSES` may
/// still supply them (a local or fresh deployment).
export const OPTIONAL_CONTRACTS = ["perpOrderManager", "insuranceFund", "crossMargin", "subaccountFactory", "rfqManager", "creditOracle", "creditRegistry", "creditRouter", "creditVault", "creditPairTslaUsdg"] as const satisfies ReadonlyArray<keyof ContractAddresses>;

/// Mirrors `packages/contracts/deployments/robinhood_testnet.json`. Kept as a checked-in
/// literal rather than read from disk at build time — there is no deploy-to-config sync step
/// yet, so this must be updated by hand whenever that file changes (see CHANGELOG entry for
/// the deploy that produced it).
const robinhoodTestnetAddresses: ContractAddresses = {
  marketRegistry: "0x29009e3c695774f5E3456727B60492a2Fbf0e3aE",
  oracleRouter: "0x94FA602D8406c372A34A56813AEd1aC2992A7EC6",
  vault: "0x20031081CE9d25C3AfF39eBc34a57a6fD7b80593",
  collateralManager: "0x4Ff6f2C76dad406C649BDA30b781fd321B395b40",
  feeManager: "0x1e86A6f583281b05899941E8b89a8F3622133E9A",
  buybackModule: "0x520dd861f9838D1f3a4737117828503891Ff173a",
  riskManager: "0x3275158C0c981FFDD1581C4E22acb423318cfE18",
  optionsEngine: "0x3B7686389B0f56d076A31B587Ff2F8abC4C1866D",
  optionMarket: "0x711f637b0f4e007fB4E03C980ceA3E1AF4C18a33",
  optionPositionManager: "0x4eeF5CF8f3F467866723520E5EF6fc47ef0DDa02",
  perpsEngine: "0xb83016d4782EBDD668730AC71cb66718D39c01aa",
  perpPositionManager: "0xB1110f9DD61d6916889549633a996D00FC15f2B8",
  liquidationEngine: "0xE6193931A7aaB15229F60779f6eE0A3907B99AB8",
  fundingManager: "0x3CD180DbB69b406B6fc630BA3554D9d182C9D719",
  priceValidator: "0x812d78fAb024FF32543f212eA4ada0C25cfd9e2B",
  settlementToken: "0x85d50080A2A84b37Fb2563feF1Ea5403c71E1B58",
  perpOrderManager: "0xFA826c2e05100F9C1f43d33073090542aE22655D",
  insuranceFund: "0x9c173177Ed5178e3758D1Cd310e471d1205c3787",
  crossMargin: "0x2A168739F23a3571d0c543d4e2dB3a298af098B4",
  subaccountFactory: "0x02B357a2b3e2b7b1F675E1FE985bf33FC30f3946",
  rfqManager: "0xcA30d962A3d14762c6b0fCa2c7722e10B58C3fb3",
  creditOracle: "0x1C9feDb75f5AfE3461525F8DCc71760d1296C711",
  creditRegistry: "0x2D77B550E56cfc8ea20B91524174a776E89B5242",
  creditRouter: "0x16956F32a92c4532f57157fb244B84b5157E3b24",
  creditVault: "0x0F42eD9679EAc017ef8096b9C508bCC8F2A17843",
  creditPairTslaUsdg: "0xE18153B0cf1a98EE1EA8E067a3F5c38c00E2DDbd",
};

/// Mainnet, filled in by `node scripts/record-deployment.mjs robinhood_mainnet` after the V1.0 `DeployAll`
/// (docs/RELEASES.md). Zero until then, and a zero stack is not recorded below, so mainnet has no deployment yet.
const robinhoodMainnetAddresses: ContractAddresses = {
  marketRegistry: "0xd728BCe3a3bAF160147D2A5456a5299DcFa8ADE7",
  oracleRouter: "0xe87B0980cb36D4f1aAA46e77452DDbd09CEcDb68",
  vault: "0x47CA1A365Db33f8B0949289437aD635bbFb8b70F",
  collateralManager: "0x7D47f07b26fc40D2a87D95CfB2415d412f2FeEC5",
  feeManager: "0x5B05191A243e6125f131A8B792674Dd92e9282Ce",
  buybackModule: "0x30F4C9B5EA37d9b0c647654bD410206365725344",
  riskManager: "0x9633f0A62aDe86764886dA87139e71D01fe2aE72",
  optionsEngine: "0xA58fc1027E05A9eE7c2b60d9A22EeD4aed3860b5",
  optionMarket: "0x88d4C1a40da70a9416Ca48198569d812C69730bE",
  optionPositionManager: "0xfc1e89210720139612D137408B13B8721c622960",
  perpsEngine: "0x7dF4000Ef3f272023DEd68E0c5eD96CF4216f6De",
  perpPositionManager: "0xAEbd3A0098A82b3aC0d522e401C7aBe755DEDf21",
  liquidationEngine: "0xAed63EB0EFE1839CD56596e5575B587808cb9011",
  fundingManager: "0x6A88F7e5234Bf09e00B9221f56F329dd49949422",
  priceValidator: "0x1abAd9cdD8F929898f3a392E55a8fdeaC510Ab33",
  settlementToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  perpOrderManager: "0xD8293EB2Cb1f61aF63403b3Cf6Df58641bC2C303",
  insuranceFund: "0x12FBe78ceE9bbBD74824726D6c0F3BB29C0f72d7",
  crossMargin: "0xCe1a2e2844327A1882625d5C72CCfc0a48Df9F7A",
  subaccountFactory: "0x0e630D147E8A9bCBCcE36ACDD43BF56A41bf3ffD",
  rfqManager: "0x1e35eeA680CB2B0b1FA0455be168D3c1E4E694D9",
  creditOracle: "0xEf9acbae2aAa3ED00A8F15Bc04E7723636E0C509",
  creditRegistry: "0x9d08f569aA50899f3694ac4823AdA84f1aEd2a61",
  creditRouter: "0x14c077595218619193B234aA88e662Db78c73a6b",
  creditVault: "0x268e08fE25664B5ed2C782dAc77F76d3b6612784",
  creditPairTslaUsdg: "0xbfB24E468fd1ec9006CBd7bA93eb5b25B8Cf922a",
};

/// The code behind each proxy of a chain's deployment, and the empty UUPS placeholder `DeployAll` also deploys.
/// Every contract in the stack is an upgradeable proxy, so a reader who checks a contract on the explorer needs
/// both addresses: the proxy that holds the state and the implementation that holds the code. The core stack
/// mirrors `packages/contracts/deployments/<network>.implementations.json`; the credit implementations were read
/// from each proxy's EIP-1967 slot (`cast implementation`), and the placeholder from the `DeployAll` broadcast.
export interface ImplementationRecord {
  implementations: Partial<Record<keyof ContractAddresses, Address>>;
  upgradePlaceholder?: Address;
}

const robinhoodTestnetImplementations: ImplementationRecord = {
  implementations: {
    buybackModule: "0x2E04Ba351294b7c9ED15218e0b80501529eF1d14",
    collateralManager: "0xF9DB4E9Ac5d57B2769f3B94452a19512a4f746f1",
    creditPairTslaUsdg: "0x6ae856103056EB6EeADBdD0DCe0220B11Ef1cc62",
    creditRegistry: "0x6158328D440D87E6E88612Df3F6b73bdE27Be822",
    creditRouter: "0x9C2C0EAca3c240027e97C86CD564E104cE1C30AA",
    creditVault: "0x04dDe611a0D65614CBF8c8fE673e9d515d525e5E",
    crossMargin: "0x6D216750b15edD72Ab6b1e4a30E4f9E8A49E832a",
    feeManager: "0x349650518BB3D12975EC941C2A0f233b3034CC17",
    fundingManager: "0x4571ae9fBe1a96cE6a86CaBaA888dd8d8E394ec4",
    insuranceFund: "0xF89800FD419e4bbd80c5f81F77499271617Fa565",
    liquidationEngine: "0x61F273aa9000FA44AF7be8dbfFB635A68E815Cdb",
    marketRegistry: "0x08b60BB7A919775A123c5DD14f018B39F27FA938",
    optionMarket: "0x53F4645a88b1C8F5C5CbB1D7eDFB96bB08c301e5",
    optionPositionManager: "0x37caEfBE0e73c3B8A7503E85615BCA5C07f05521",
    optionsEngine: "0xD412730959A795cF39D7B4F1d2232815e1a6758f",
    oracleRouter: "0xc0c89C6E499E291072de41C799631d0aC570aB76",
    perpOrderManager: "0x21B475bDB64764E169aae4C15CDfdBa7B7f5fF3E",
    perpPositionManager: "0x6e0b3B755b8BA3540f11fff59ef3138751e26FC7",
    perpsEngine: "0x140A7b11c21602D28e2e9d78D4160c643f1a6802",
    priceValidator: "0x059Af608d9aD4D7B686a8eA15a4761E36ef68e65",
    rfqManager: "0xe28ce93605aa3887eC5ad3089B6D244f1c5b3f05",
    riskManager: "0x4303CaA3929C2348254c2C1de15c90B824E4d247",
    subaccountFactory: "0x7D4fb242a14A30100363622C8C8D2fE6D1e57263",
    vault: "0x3D92CE20133f5681e83B32f12BfB398723d7EdDA",
  },
  upgradePlaceholder: "0x769d0D6e0DD40811f66bDdB66a2B40deA85A6F8E",
};

/// Filled in with `robinhoodMainnetAddresses` above, by the same command.
const robinhoodMainnetImplementations: ImplementationRecord = {
  implementations: {
    buybackModule: "0xa921d67e2a994F20Cb5765C52D36FBaa13d53162",
    collateralManager: "0x3f76ec1188A21dDd5B1F86A9887e9d964f85573c",
    creditPairTslaUsdg: "0x62eacCc64e44B9F16D6bfC16eF8BD75e471d389a",
    creditRegistry: "0xf7daa9bf0E3D074a0939beFD454749c8d04c231f",
    creditRouter: "0x6e59d5fB073318628AEa2Da973aEd9a7f2630133",
    creditVault: "0x5Eaa14d6D57730B449C4B2BFfE9257e618609668",
    crossMargin: "0x20031081CE9d25C3AfF39eBc34a57a6fD7b80593",
    feeManager: "0xd340777D83Cf2CC8DE0f253ffba4a3cDb5cbC76e",
    fundingManager: "0x769d0D6e0DD40811f66bDdB66a2B40deA85A6F8E",
    insuranceFund: "0x4Ff6f2C76dad406C649BDA30b781fd321B395b40",
    liquidationEngine: "0x812d78fAb024FF32543f212eA4ada0C25cfd9e2B",
    marketRegistry: "0xD7f062360Ed97424129fDFf805cF6e8562a3521f",
    optionMarket: "0x06dBcADbF4FB7bbE2B2e160d1Cd026a004a00926",
    optionPositionManager: "0x389fC6E94d898DfB1D5c375B7f065Eb36c86FA29",
    optionsEngine: "0x29009e3c695774f5E3456727B60492a2Fbf0e3aE",
    oracleRouter: "0xa8c04bfD23184F356b55CcA46379737154Ca6304",
    perpOrderManager: "0x85d50080A2A84b37Fb2563feF1Ea5403c71E1B58",
    perpPositionManager: "0xeA8F895FBFa3DdebD103A86cc50c9e43316F2851",
    perpsEngine: "0x520dd861f9838D1f3a4737117828503891Ff173a",
    priceValidator: "0x5C0f0c3EB0cd0be9030eE87554DAC92fBeb83cb5",
    rfqManager: "0x94FA602D8406c372A34A56813AEd1aC2992A7EC6",
    riskManager: "0x1b09aD9E472fd67B86fB20049942FbE1e3F780a1",
    subaccountFactory: "0x1e86A6f583281b05899941E8b89a8F3622133E9A",
    vault: "0x96e34D2E2Af6bBe96191136237455372182c95B7",
  },
  upgradePlaceholder: "0xC798A88474118c3B1a08C5d84189AcaBdFf472de",
};

/// A stack is recorded once its vault has an address: the mainnet literals stay zero until V1.0 fills them.
const isRecorded = (addresses: ContractAddresses) => !/^0x0{40}$/.test(addresses.vault);

/// A network appears here once its stack is deployed. Mainnet joins at ZENOMARKETS V1.0.
export const implementationRecords: Partial<Record<ChainId, ImplementationRecord>> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetImplementations,
  ...(isRecorded(robinhoodMainnetAddresses) ? { [ROBINHOOD_MAINNET_CHAIN_ID]: robinhoodMainnetImplementations } : {}),
};

export const deployments: Partial<Record<ChainId, ContractAddresses>> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetAddresses,
  ...(isRecorded(robinhoodMainnetAddresses) ? { [ROBINHOOD_MAINNET_CHAIN_ID]: robinhoodMainnetAddresses } : {}),
};

/// Whether `chainId` has a recorded deployment (the network switch only offers those).
export function hasDeployment(chainId: ChainId): boolean {
  return deployments[chainId] !== undefined;
}

export function addressesForChain(chainId: ChainId): ContractAddresses {
  const addresses = deployments[chainId];
  if (!addresses) {
    throw new Error(`@zeno/config: no deployment recorded for chain ${chainId}`);
  }
  return addresses;
}

/// The recorded deployment for `chainId`, with any addresses in the `ZENO_ADDRESSES`
/// environment variable (a JSON object of `ContractAddresses` keys) replacing the recorded ones
/// for those contracts only. This lets backend services and staging point at a fresh deployment
/// (a redeploy, a local Anvil node) without editing checked-in code. Unknown keys and malformed
/// addresses are rejected rather than silently ignored — a typo here would otherwise send
/// requests to the wrong contract.
export function resolveAddresses(
  chainId: ChainId,
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): ContractAddresses {
  const recorded = addressesForChain(chainId);
  const raw = env.ZENO_ADDRESSES;
  if (!raw) return recorded;

  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("@zeno/config: ZENO_ADDRESSES is not valid JSON");
  }

  const resolved = { ...recorded };
  for (const [key, value] of Object.entries(overrides)) {
    const known = key in recorded || (OPTIONAL_CONTRACTS as readonly string[]).includes(key);
    if (!known) throw new Error(`@zeno/config: ZENO_ADDRESSES has unknown contract "${key}"`);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`@zeno/config: ZENO_ADDRESSES.${key} is not an address`);
    }
    resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}

/// The protocol token of a chain, once it launches (ZENO, the same day as mainnet: ZENOMARKETS V1.0).
/// `ZenoBuybackModule` takes it through `setProtocolToken`. A web build may set it with
/// `NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS` and `_SYMBOL` (deploy/vps-deploy.sh: zeno.env's `PROTOCOL_TOKEN_*`).
export const protocolTokens: Partial<Record<ChainId, { address: Address; symbol: string }>> = {};
