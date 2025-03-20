import {
  Payments,
  EnvironmentName,
  AgentExecutionStatus,
  Step,
  Task,
  FIRST_STEP_NAME,
  generateStepId,
  CreateTaskResultDto,
} from "@nevermined-io/payments";
import { BaseService } from "./base.service.js";
// import { TelegramService } from "./telegram.service.js";
import { parseUnits } from "ethers";
import * as path from "path";
import * as fs from "fs/promises";
import { AnyType } from "../utils.js";
import { getAgentDIDs } from "../utils/Intuition/queries.js";
import { MineflayerService } from "./mineflayer.service.js";
import { EmberGrpcClient } from "@emberai/sdk-typescript";

//FIXME: Remove once Nevermined SDK is updated
interface NeverminedStep extends Step {
  did: string;
}
interface NeverminedTask extends Omit<Task, "steps" | "name"> {
  did: string;
}

interface DIDsResult {
  success: boolean;
  data?: {
    agentDID: string;
    paymentPlanDID: string;
    testTokenPlanDID?: string;
  };
  error?: string;
}

export class NeverminedService extends BaseService {
  private client: Payments | null = null;
  private paymentPlanDID: string | null = null;
  private agentDID: string | null = null;
  private testTokenPlanDID: string | null = null;
  private static instance: NeverminedService;
  private mineflayerService: MineflayerService | null = null;

  // Validate that the bot info is properly initialized
  private async validateBotInfo(): Promise<string> {
    const botInfo = await this.mineflayerService?.getBotInfo();
    if (!botInfo || !botInfo.username || botInfo.username === "unknown") {
      throw new Error(
        "[NeverminedService] Bot information not properly initialized"
      );
    }
    return botInfo.username;
  }

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (!process.env.NEVERMINED_API_KEY) {
      throw new Error("NEVERMINED_API_KEY must be defined");
    }

    this.client = Payments.getInstance({
      environment:
        (process.env.NEVERMINED_ENVIRONMENT as EnvironmentName) ?? "testing",
      nvmApiKey: process.env.NEVERMINED_API_KEY!,
    });

    this.mineflayerService = MineflayerService.getInstance();

    // Wait for Mineflayer to be properly initialized
    const maxRetries = 5;
    const retryDelay = 5000; // 5 seconds

    // Wait for Mineflayer to be properly initialized
    for (let i = 0; i < maxRetries; i++) {
      try {
        const botInfo = await this.mineflayerService?.getBotInfo();
        if (botInfo && botInfo.username && botInfo.username !== "unknown") {
          console.log(
            "[NeverminedService] Mineflayer bot initialized successfully:",
            botInfo.username
          );
          break;
        }
        if (i === maxRetries - 1) {
          throw new Error("Max retries reached waiting for bot initialization");
        }
        console.log(
          `[NeverminedService] Waiting for bot initialization... (attempt ${i + 1}/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } catch (error) {
        if (i === maxRetries - 1) {
          throw new Error(
            `Failed to initialize Nevermined service: ${error.message}`
          );
        }
        console.log(
          `[NeverminedService] Retry attempt ${i + 1}/${maxRetries} failed:`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    if (!this.client.isLoggedIn) {
      throw new Error("Nevermined client not logged in");
    }

    console.log(
      "[NeverminedService] Nevermined service started on network:",
      this.client.environment
    );

    // Try to load DIDs from file first
    const loadedDIDs = await this.loadDIDsFromFile();
    if (loadedDIDs.success && loadedDIDs.data) {
      console.log("[NeverminedService] Loaded DIDs from file");
      this.paymentPlanDID = loadedDIDs.data.paymentPlanDID;
      this.agentDID = loadedDIDs.data.agentDID;
      this.testTokenPlanDID = loadedDIDs.data.testTokenPlanDID || null;
      console.log(
        "[NeverminedService] Loaded testTokenPlanDID from file:",
        this.testTokenPlanDID
      );
    } else {
      console.log(`[NeverminedService] Creating new DIDs: ${loadedDIDs.error}`);
      const botUsername = await this.validateBotInfo();

      // Get DIDs from Intuition
      console.log(
        `[NeverminedService] Fetching DIDs from Intuition for ${botUsername}`
      );
      const agentDIDs = await getAgentDIDs(botUsername);
      console.log("[NeverminedService] Intuition returned DIDs:", agentDIDs);

      this.paymentPlanDID = agentDIDs.planDID;
      this.agentDID = agentDIDs.agentDID;
      this.testTokenPlanDID = agentDIDs.testTokenPlanDID;

      console.log("[NeverminedService] DIDs assigned:", {
        paymentPlanDID: this.paymentPlanDID,
        agentDID: this.agentDID,
        testTokenPlanDID: this.testTokenPlanDID,
      });

      // Save DIDs to file for persistence
      await this.saveDIDsToFile();
    }

    console.log("[NeverminedService] Payment plan DID: ", this.paymentPlanDID);
    console.log("[NeverminedService] Agent DID: ", this.agentDID);
    console.log(
      "[NeverminedService] Test Token Plan DID: ",
      this.testTokenPlanDID
    );

    await this.client.query.subscribe(this.processQuery(this.client), {
      getPendingEventsOnSubscribe: false,
      joinAccountRoom: false,
      joinAgentRooms: [this.agentDID!],
      subscribeEventTypes: ["step-updated"],
    });
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client = null;
    }
  }

  public static getInstance() {
    if (!NeverminedService.instance) {
      NeverminedService.instance = new NeverminedService();
    }
    return NeverminedService.instance;
  }

  public getClient(): Payments {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    return this.client;
  }

  public async getPaymentPlanDID(): Promise<string> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }

    // Check if we have a DID in the data directory for this bot
    const loadedDIDs = await this.loadDIDsFromFile();
    if (loadedDIDs.success && loadedDIDs.data?.paymentPlanDID) {
      this.paymentPlanDID = loadedDIDs.data.paymentPlanDID;
      console.log(
        "[NeverminedService] Using payment plan DID from data file:",
        this.paymentPlanDID
      );
      return this.paymentPlanDID;
    }

    // Create a new payment plan with a unique name based on bot username and timestamp
    try {
      console.log("[NeverminedService] Creating new payment plan...");
      const botInfo = await this.mineflayerService?.getBotInfo();
      if (!botInfo || !botInfo.username || botInfo.username === "unknown") {
        throw new Error(
          "[NeverminedService] Bot information not properly initialized"
        );
      }
      const uniqueId = `${botInfo.username}-${Date.now()}`;
      console.log("[NeverminedService] Bot info:", botInfo);

      const paymentPlan = await this.client.createCreditsPlan({
        name: `PaymentPlan:::${uniqueId}`,
        description: `Payment plan to access the agent ${botInfo?.username ?? "<unknown>"}`,
        price: parseUnits("1", 6), //1 USDC per plan
        tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", //USDC on Arbitrum Sepolia
        amountOfCredits: 1,
      });

      console.log("[NeverminedService] Payment plan created:", paymentPlan);
      this.paymentPlanDID = paymentPlan.did;

      // Save to data file
      await this.saveDIDsToFile();

      return this.paymentPlanDID!;
    } catch (e) {
      console.error("[NeverminedService] Error creating payment plan:", e);
      throw e;
    }
  }

  public async getAgentDID(): Promise<string> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }

    // Check if we have a DID in the data directory for this bot
    const loadedDIDs = await this.loadDIDsFromFile();
    if (loadedDIDs.success && loadedDIDs.data?.agentDID) {
      this.agentDID = loadedDIDs.data.agentDID;
      console.log(
        "[NeverminedService] Using agent DID from data file:",
        this.agentDID
      );
      return this.agentDID;
    }

    // Create a new agent with a unique name
    try {
      console.log("[NeverminedService] Creating new agent...");
      const botInfo = await this.mineflayerService?.getBotInfo();
      if (!botInfo || !botInfo.username || botInfo.username === "unknown") {
        throw new Error(
          "[NeverminedService] Bot information not properly initialized"
        );
      }
      const uniqueId = `${botInfo.username}-${Date.now()}`;

      const agent = await this.client.createAgent({
        name: `Agent:::${uniqueId}`,
        description: `Agent ${botInfo?.username ?? "<unknown>"}`,
        planDID: await this.getPaymentPlanDID(),
        serviceChargeType: "fixed",
        amountOfCredits: 1,
        usesAIHub: true,
      });

      console.log("[NeverminedService] Agent created:", agent);
      this.agentDID = agent.did;

      // Save to data file
      await this.saveDIDsToFile();

      return this.agentDID!;
    } catch (e) {
      console.error("[NeverminedService] Error creating agent:", e);
      throw e;
    }
  }

  private processQuery(payments: Payments) {
    return async (data: AnyType) => {
      try {
        const eventData = data;
        console.log("[NeverminedService] Event data: ", eventData);

        const step = (await payments.query.getStep(
          eventData.step_id
        )) as NeverminedStep;
        console.log("[NeverminedService] Step: ", step);

        await payments.query.logTask({
          level: "info",
          task_id: step.task_id,
          message: `Processing step ${step.name}...`,
        });

        const inputQuery = step.input_query;
        console.log("[NeverminedService] Input query: ", inputQuery);

        switch (step.name) {
          case FIRST_STEP_NAME: {
            await payments.query.logTask({
              level: "info",
              task_id: step.task_id,
              message: `Step received ${step.name}, creating the additional steps...`,
            });
            console.log("[NeverminedService] Step received ", step);
            const swapStepId = generateStepId();

            const steps = [
              {
                step_id: swapStepId,
                task_id: step.task_id,
                name: "swap",
                is_last: true,
              },
            ];
            console.log("[NeverminedService] Steps to be created: ", steps);
            const createResult = await payments.query.createSteps(
              step.did,
              step.task_id,
              { steps }
            );

            await payments.query.logTask({
              task_id: step.task_id,
              level: createResult.success ? "info" : "error",
              message: createResult.success
                ? "Steps created successfully."
                : `Error creating steps: ${JSON.stringify(createResult.data)}`,
            });
            // await this.telegramService?.bot.api.sendMessage(
            //   "-4729581369",
            //   `Steps created successfully.`
            // );

            await payments.query.updateStep(step.did, {
              ...step,
              step_status: AgentExecutionStatus.Completed,
              output: step.input_query,
            });
            return;
          }

          case "swap": {
            const payload = JSON.parse(step.input_query) as {
              amount: string;
              from_token: string;
              from_chain_id: string;
              to_token: string;
              to_chain_id: string;
              sender: string;
            };
            await payments.query.logTask({
              level: "info",
              task_id: step.task_id,
              step_id: step.step_id,
              task_status: AgentExecutionStatus.In_Progress,
              message: `Data fetched: ${JSON.stringify(payload)}`,
            });

            console.log(
              "[NeverminedService] EMBER_ENDPOINT: ",
              process.env.EMBER_ENDPOINT
            );

            const client = new EmberGrpcClient(
              process.env.EMBER_ENDPOINT || "grpc.api.emberai.xyz:50051"
            );

            const swapTokenRequest = {
              orderType: "MARKET_BUY",
              baseToken: {
                address: payload.from_token,
                chainId: payload.from_chain_id,
              },
              quoteToken: {
                address: payload.to_token,
                chainId: payload.to_chain_id,
              },
              amount: payload.amount,
              recipient: payload.sender,
            };
            const response = await client.swapTokens(swapTokenRequest);

            if (response.status === 2) {
              console.log(
                "[NeverminedService] Swap validation failed before transaction creation:",
                JSON.stringify({
                  status: response.status,
                  taskId: step.task_id,
                  stepId: step.step_id,
                  request: swapTokenRequest,
                  response: response,
                })
              );

              // early return to avoid transaction creation
              return;
            }

            console.log(
              "[NeverminedService] Ember swap transaction created: ",
              JSON.stringify(response),
              step.task_id,
              step.step_id
            );
            await payments.query.updateStep(step.did, {
              ...step,
              step_status: AgentExecutionStatus.Completed,
              output: JSON.stringify(response),
            });
            return;
          }
          default: {
            await payments.query.logTask({
              level: "info",
              task_id: step.task_id,
              message: `Unknown step ${step.name}, Skipping...`,
            });
            // await this.telegramService?.bot.api.sendMessage(
            //   "-4729581369",
            //   `Unknown step ${step.name}, Skipping...`
            // );
            return;
          }
        }
      } catch (error) {
        console.error("[NeverminedService] Error processing query:", error);
        const eventData = JSON.parse(data);
        const step = (await payments.query.getStep(
          eventData.step_id
        )) as NeverminedStep;
        await payments.query.logTask({
          level: "error",
          task_id: step.task_id,
          message: `Error processing query: ${error}`,
        });
        await payments.query.updateStep(step.did, {
          ...step,
          step_status: AgentExecutionStatus.Failed,
          output: `Error processing query: ${error}`,
          is_last: true,
        });
      }
    };
  }

  public async getPlanCreditBalance(
    planDID: string
  ): Promise<{ agreementId?: string; balance: bigint }> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    const balance = await this.client.getPlanBalance(planDID);
    console.log(`Plan: ${planDID}\nBalance: ${JSON.stringify(balance)}`);
    if (!balance.isSubscriptor || balance.balance === BigInt(0)) {
      console.log("Not subscribed to plan, or plan exhausted: ", planDID);
      console.log("Subscribing...");
      const agreement = await this.client.orderPlan(planDID);
      console.log("Subscribed, Agreement: ", agreement);
      const balance = await this.client.getPlanBalance(planDID);
      console.log(`Plan: ${planDID}\nBalance:, ${JSON.stringify(balance)}`);
      return { agreementId: agreement.agreementId, balance: balance.balance };
    }
    return { agreementId: undefined, balance: balance.balance };
  }

  public async submitTask(
    agentDID: string,
    planDID: string,
    query: string,
    callback?: (data: string) => Promise<void>
  ): Promise<CreateTaskResultDto | undefined> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    console.log(
      `[NeverminedService] Submitting task: agentDID: ${agentDID}, planDID: ${planDID}, query: ${query}`
    );
    const { balance } = await this.getPlanCreditBalance(planDID);
    console.log(`Plan: ${planDID}\nBalance: ${JSON.stringify(balance)}`);
    if (balance <= BigInt(0)) {
      throw new Error("Insufficient balance");
    }
    const accessConfig =
      await this.client.query.getServiceAccessConfig(agentDID);
    console.log(
      `[NeverminedService] Access config: ${JSON.stringify(accessConfig)}`
    );
    const taskCallback =
      callback ??
      (async (data: string) => {
        console.log(`Received data:`);
        const parsedData = JSON.parse(data) as NeverminedTask;
        console.dir(parsedData, { depth: null });
      });
    const { success, data, error } = await this.client.query.createTask(
      agentDID,
      {
        name: "harvest",
        input_query: query,
        //@ts-expect-error custom input
        query: query,
      },
      accessConfig,
      taskCallback
    );
    if (!success) {
      console.error("Failed to create task", error);
      throw new Error("Failed to create task");
    }
    console.log(`Task sent to agent: ${JSON.stringify(data)}`);
    return data;
  }

  public async submitTaskWithTestToken(
    agentDID: string,
    query: string,
    callback?: (data: string) => Promise<void>
  ): Promise<CreateTaskResultDto | undefined> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }

    if (!this.testTokenPlanDID) {
      console.error("[NeverminedService] No test token plan DID available");
      throw new Error("No test token plan DID available");
    }

    console.log(
      `[NeverminedService] Submitting task with test token plan: ${this.testTokenPlanDID}`
    );
    return this.submitTask(agentDID, this.testTokenPlanDID, query, callback);
  }

  private async saveDIDsToFile(): Promise<void> {
    try {
      const dataDir = path.resolve(process.cwd(), "data");
      await fs.mkdir(dataDir, { recursive: true });
      const filePath = path.join(dataDir, "nevermined-credentials.json");

      // Get bot username to use as key
      const botInfo = await this.mineflayerService?.getBotInfo();
      const botUsername = botInfo?.username ?? "unknown";

      // Try to read existing file first
      let existingData: Record<
        string,
        {
          agentDID: string;
          paymentPlanDID: string;
          testTokenPlanDID?: string;
          role: string;
        }
      > = {};
      try {
        const existingContent = await fs.readFile(filePath, "utf8");
        existingData = JSON.parse(existingContent);
      } catch (error) {
        // File doesn't exist or is invalid, start with empty object
      }

      // Update with this bot's DIDs
      existingData[botUsername] = {
        agentDID: this.agentDID!,
        paymentPlanDID: this.paymentPlanDID!,
        ...(this.testTokenPlanDID && {
          testTokenPlanDID: this.testTokenPlanDID,
        }),
        role: botInfo?.role ?? "merchant",
      };

      // Write back to file
      await fs.writeFile(
        filePath,
        JSON.stringify(existingData, null, 2),
        "utf8"
      );
      console.log(
        `[NeverminedService] Saved DIDs for ${botUsername} to ${filePath}`
      );
    } catch (error) {
      console.error("[NeverminedService] Error saving DIDs to file:", error);
    }
  }

  private async loadDIDsFromFile(): Promise<DIDsResult> {
    try {
      // Early validation of bot info
      let botUsername: string;
      try {
        botUsername = await this.validateBotInfo();
      } catch (error) {
        return {
          success: false,
          error: `Bot validation failed: ${error.message}`,
        };
      }

      const dataDir = path.resolve(process.cwd(), "data");
      console.log("[NeverminedService] Data directory:", dataDir);
      const filePath = path.join(dataDir, "nevermined-credentials.json");

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch (error) {
        return {
          success: false,
          error: "Credentials file not found",
        };
      }

      // Read and parse file
      const fileContent = await fs.readFile(filePath, "utf8");
      const allData = JSON.parse(fileContent);

      // Get this bot's DIDs
      const botData = allData[botUsername];
      if (!botData || !botData.agentDID || !botData.paymentPlanDID) {
        return {
          success: false,
          error: `No valid DIDs found for bot ${botUsername}`,
        };
      }

      console.log(`[NeverminedService] Found DIDs for bot ${botUsername}`);
      return {
        success: true,
        data: {
          agentDID: botData.agentDID,
          paymentPlanDID: botData.paymentPlanDID,
          testTokenPlanDID: botData.testTokenPlanDID,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Unexpected error: ${error.message}`,
      };
    }
  }

  public async checkHealth(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Check if client is initialized and logged in
      if (!this.client || !this.client.isLoggedIn) {
        return {
          healthy: false,
          details: "Nevermined client not initialized or not logged in",
        };
      }

      // Check if bot info is available
      const botInfo = await this.mineflayerService?.getBotInfo();
      if (!botInfo || !botInfo.username || botInfo.username === "unknown") {
        return {
          healthy: false,
          details: "Bot not properly initialized",
        };
      }

      // Check if DIDs are loaded
      if (!this.paymentPlanDID || !this.agentDID) {
        return {
          healthy: false,
          details: "DIDs not properly loaded",
        };
      }

      return {
        healthy: true,
        details: `Service healthy - Bot: ${botInfo.username}, PaymentPlanDID: ${this.paymentPlanDID}, AgentDID: ${this.agentDID}${
          this.testTokenPlanDID
            ? `, TestTokenPlanDID: ${this.testTokenPlanDID}`
            : ""
        }`,
      };
    } catch (error) {
      return {
        healthy: false,
        details: `Health check failed: ${error.message}`,
      };
    }
  }
}
