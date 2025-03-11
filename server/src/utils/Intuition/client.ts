import { configureClient, createServerClient } from "@0xintuition/graphql";
import { Multivault } from "@0xintuition/protocol";

import { publicClient, walletClient } from "./wallet/client.js";
import { config } from "./env.js";

export const multiVault = new Multivault({
  // Ignoring type mismatch between viem versions:
  // - @0xintuition/protocol uses viem@2.22.6
  // - Project uses viem@2.23.2
  // This is safe as the runtime functionality is compatible
  // @ts-expect-error - Type mismatch between viem versions
  publicClient,
  // @ts-expect-error - Type mismatch between viem versions
  walletClient,
});

export function getGqlClient() {
  configureClient({ apiUrl: config.intuitionApiUrl });
  return createServerClient({});
}
