import { ethers } from "ethers";
import axios from "axios";
import { getCollablandApiUrl } from "../utils.js";
import {
  IExecuteUserOpRequest,
  IExecuteUserOpResponse,
  IUserOperationReceipt,
} from "../types.js";
import { WowXYZERC20__factory } from "../contracts/types/index.js";

export interface TokenDeploymentParams {
  name: string;
  symbol: string;
  tokenURI: string;
  creator?: string; // Optional, will use the smart account address if not provided
  platformReferrer?: string; // Optional, will use the smart account address if not provided
}

/**
 * Submits a UserOperation to deploy an ERC-20 token using Collab.Land's API
 * @param params Token deployment parameters
 * @returns Promise resolving to the transaction hash of the deployment
 */
export async function submitTokenDeployment(
  params: TokenDeploymentParams
): Promise<string> {
  try {
    // Create contract interface
    const contract = WowXYZERC20__factory.createInterface();

    // Encode initialization data
    const initData = contract.encodeFunctionData("initialize", [
      params.creator || ethers.ZeroAddress, // Will be replaced with smart account address
      params.platformReferrer || ethers.ZeroAddress, // Will be replaced with smart account address
      params.tokenURI,
      params.name,
      params.symbol,
    ]);

    // Prepare UserOperation payload
    // Note: We're using Base network (chainId: 8453) as that's where Wow.xyz tokens are deployed
    const payload: IExecuteUserOpRequest = {
      target: "0x0000000000000000000000000000000000000000", // Will be replaced with factory address
      calldata: initData,
      value: "0x0", // No ETH value needed for deployment
    };

    // Submit UserOperation
    console.log("Submitting UserOperation for token deployment...");
    const { data } = await axios.post<
      IExecuteUserOpRequest,
      { data: IExecuteUserOpResponse }
    >(
      `${getCollablandApiUrl()}/telegrambot/evm/submitUserOperation?chainId=8453`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
          "X-API-KEY": process.env.COLLABLAND_API_KEY!,
        },
        timeout: 10 * 60 * 1000, // 10 minutes timeout
      }
    );

    console.log("UserOperation submitted:", data);
    const userOpHash = data.userOperationHash;

    // Wait for UserOperation to be included in a block
    console.log("Waiting for UserOperation to be included...");
    const receipt = await waitForUserOperation(userOpHash);

    if (!receipt.success || !receipt.receipt?.transactionHash) {
      throw new Error("Token deployment failed");
    }

    return receipt.receipt.transactionHash;
  } catch (error) {
    console.error("Failed to deploy token:", error);
    throw error;
  }
}

/**
 * Waits for a UserOperation to be included in a block
 * @param userOpHash The hash of the UserOperation to wait for
 * @returns Promise resolving to the UserOperation receipt
 */
async function waitForUserOperation(
  userOpHash: string
): Promise<IUserOperationReceipt> {
  const maxAttempts = 30; // Maximum number of attempts (5 minutes with 10s intervals)
  const interval = 10000; // 10 seconds between attempts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { data } = await axios.get<IUserOperationReceipt>(
        `${getCollablandApiUrl()}/telegrambot/evm/userOperationReceipt?chainId=8453&userOperationHash=${userOpHash}`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
            "X-API-KEY": process.env.COLLABLAND_API_KEY!,
          },
        }
      );

      if (data.receipt?.transactionHash) {
        return data;
      }
    } catch (error) {
      console.warn(`Attempt ${attempt + 1} failed:`, error);
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("UserOperation confirmation timed out");
}
