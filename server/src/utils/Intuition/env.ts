import { getPrivateKey } from "./wallet/get-private-key.js";

function getConfig() {
  const env = process.env.NODE_ENV || "development";

  const baseConfig = {
    appName: "agent-registration-service",
    privateKey: getPrivateKey(),
  };

  const envConfigs = {
    development: {
      intuitionApiUrl: "https://dev.base-sepolia.intuition-api.com/v1/graphql",
      network: "baseSepolia",
    },
    test: {
      intuitionApiUrl: "https://dev.base-sepolia.intuition-api.com/v1/graphql",
      network: "baseSepolia",
    },
    production: {
      intuitionApiUrl: "https://dev.base.intuition-api.com/v1/graphql",
      network: "base",
    },
  };

  return {
    ...baseConfig,
    ...envConfigs[env as keyof typeof envConfigs],
  };
}

export const config = getConfig();
