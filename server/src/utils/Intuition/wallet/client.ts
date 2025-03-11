import { Address, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { getPrivateKey } from "./get-private-key.js";
import { config } from "../env.js";

const getNetwork = () => {
  const { network } = config;

  switch (network) {
    case "base":
      return base;
    case "baseSepolia":
      return baseSepolia;
    default:
      return baseSepolia;
  }
};

export const publicClient = createPublicClient({
  chain: getNetwork(),
  transport: http(),
  pollingInterval: 4000,
  name: "Intuition Wallet Client",
});

export const walletClient = createWalletClient({
  account: privateKeyToAccount(getPrivateKey() as Address),
  chain: getNetwork(),
  transport: http(),
  pollingInterval: 4000,
  name: "Intuition Wallet Client",
});
