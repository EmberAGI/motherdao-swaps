import {
  Payments,
  EnvironmentName,
  FIRST_STEP_NAME,
  AgentExecutionStatus,
  Step,
  generateStepId,
  Task,
} from "@nevermined-io/payments";
import { BaseService } from "./base.service.js";
import { TelegramService } from "./telegram.service.js";
import { parseUnits } from "ethers";
import * as path from "path";
import * as fs from "fs/promises";
import { AnyType } from "src/utils.js";

//FIXME: Remove once Nevermined SDK is updated
interface NeverminedStep extends Step {
  did: string;
}
interface NeverminedTask extends Omit<Task, "steps" | "name"> {
  did: string;
}

export class NeverminedService extends BaseService {
  private client: Payments | null = null;
  private paymentPlanDID: string | null = null;
  private agentDID: string | null = null;
  private static instance: NeverminedService;
  private telegramService: TelegramService | null = null;
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
    this.telegramService = TelegramService.getInstance();
    if (!this.client.isLoggedIn) {
      throw new Error("Nevermined client not logged in");
    }
    console.log(
      "[NeverminedService] Nevermined service started on network:",
      this.client.environment
    );
    this.paymentPlanDID = await this.getPaymentPlanDID();
    console.log("[NeverminedService] Payment plan DID: ", this.paymentPlanDID);

    this.agentDID = await this.getAgentDID();
    console.log("[NeverminedService] Agent DID: ", this.agentDID);

    const planBalance = await this.getPlanCreditBalance();
    console.log(`[NeverminedService] Plan balance: ${planBalance}`);

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

  /**
   * Gets or creates a payment plan DID (Decentralized Identifier) for the Nevermined service.
   *
   * @returns Promise<string> The payment plan DID
   * @throws Error if Nevermined service is not started
   *
   * @description
   * This method handles the payment plan DID in the following way:
   * 1. First checks if a DID exists in environment variables
   * 2. If not, creates a new payment plan with the following parameters:
   *    - Name: "PaymentPlan:::[bot_username]"
   *    - Description: Custom description with bot username
   *    - Price: 1 USDC (using 6 decimals)
   *    - Token: USDC on Arbitrum Sepolia testnet
   *    - Credits: 100 per plan
   * 3. Saves the new DID to .env file for persistence
   *
   * The payment plan is required for the Nevermined agent to process requests
   * and handle payments from users.
   *
   * TODO: Make payment plan details dynamic so agents can set their own terms in the future
   *
   * @example
   * ```typescript
   * const neverminedService = NeverminedService.getInstance();
   * const paymentPlanDID = await neverminedService.getPaymentPlanDID();
   * ```
   */
  public async getPaymentPlanDID(): Promise<string> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    if (process.env.NEVERMINED_PAYMENT_PLAN_DID) {
      this.paymentPlanDID = process.env.NEVERMINED_PAYMENT_PLAN_DID;
      console.log("Payment plan DID exists: ", this.paymentPlanDID);
      return process.env.NEVERMINED_PAYMENT_PLAN_DID;
    }
    try {
      console.log("Creating payment plan...");
      const botInfo = await this.telegramService?.getBotInfo();
      console.log("Bot info: ", botInfo);
      const paymentPlan = await this.client.createCreditsPlan({
        name: `PaymentPlan:::${botInfo?.username ?? "<unknown>"}`,
        description: `Payment plan to access the agent ${botInfo?.username ?? "<unknown>"}`,
        price: parseUnits("1", 6), //1 USDC per plan
        tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", //USDC on Arbitrum Sepolia, change to mainnet USDC on production
        amountOfCredits: 100,
      });
      console.log("[NeverminedService] Payment plan created:", paymentPlan);
      this.paymentPlanDID = paymentPlan.did;
    } catch (e) {
      console.log("[NeverminedService] Error creating payment plan:", e);
    }
    try {
      //try saving to .env
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const envPath = path.join(__dirname, "..", "..", "..", ".env");
      const envFile = await fs.readFile(envPath, { encoding: "utf-8" });
      const newEnv = envFile.replace(
        /NEVERMINED_PAYMENT_PLAN_DID=.*/,
        `NEVERMINED_PAYMENT_PLAN_DID=${this.paymentPlanDID}`
      );
      if (newEnv !== envFile) {
        await fs.writeFile(envPath, newEnv);
      } else {
        await fs.appendFile(
          envPath,
          `\nNEVERMINED_PAYMENT_PLAN_DID=${this.paymentPlanDID}`
        );
      }
      console.log(
        `[NeverminedService] Saved payment plan DID to .env (Location: ${envPath})`
      );
    } catch (e) {
      console.warn("[NeverminedService] Failed to save payment plan to .env");
    }
    return this.paymentPlanDID!;
  }

  /**
   * Gets or creates an agent DID (Decentralized Identifier) for the Nevermined service.
   *
   * @returns Promise<string> The agent DID
   * @throws Error if Nevermined service is not started
   *
   * @description
   * This method handles the agent DID in the following way:
   * 1. First checks if a DID exists in environment variables
   * 2. If not, creates a new agent with the following parameters:
   *    - Name: "Agent:::[bot_username]"
   *    - Description: Custom description with bot username
   *    - Plan DID: Uses the payment plan DID from getPaymentPlanDID()
   *    - Service charge type: "dynamic"
   *    - Uses AI Hub: true
   * 3. Saves the new DID to .env file for persistence
   *
   * The agent DID is required for the Nevermined service to process requests
   * and handle interactions with users.
   *
   * @example
   * ```typescript
   * const neverminedService = NeverminedService.getInstance();
   * const agentDID = await neverminedService.getAgentDID();
   * ```
   */
  public async getAgentDID(): Promise<string> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    if (process.env.NEVERMINED_AGENT_DID) {
      this.agentDID = process.env.NEVERMINED_AGENT_DID;
      console.log("Agent DID exists: ", this.agentDID);
      return process.env.NEVERMINED_AGENT_DID;
    }
    console.log("Creating agent...");
    try {
      const botInfo = await this.telegramService?.getBotInfo();

      const agent = await this.client.createAgent({
        name: `Agent:::${botInfo?.username ?? "<unknown>"}`,
        description: `Agent ${botInfo?.username ?? "<unknown>"}`,
        planDID: await this.getPaymentPlanDID(),
        serviceChargeType: "dynamic",
        usesAIHub: true,
      });

      console.log("[NeverminedService] Agent created:", agent);
      this.agentDID = agent.did;
    } catch (e) {
      console.log("[NeverminedService] Error creating agent:", e);
    }
    try {
      //try saving to .env
      const __dirname = path.dirname(new URL(import.meta.url).pathname);
      const envPath = path.join(__dirname, "..", "..", "..", ".env");
      const envFile = await fs.readFile(envPath, { encoding: "utf-8" });
      const newEnv = envFile.replace(
        /NEVERMINED_AGENT_DID=.*/,
        `NEVERMINED_AGENT_DID=${this.agentDID}`
      );
      if (newEnv !== envFile) {
        await fs.writeFile(envPath, newEnv);
      } else {
        await fs.appendFile(envPath, `\nNEVERMINED_AGENT_DID=${this.agentDID}`);
      }
      console.log(
        `[NeverminedService] Saved agent DID to .env (Location: ${envPath})`
      );
    } catch (e) {
      console.warn("[NeverminedService] Failed to save agent to .env");
    }
    return this.agentDID!;
  }

  private processQuery(payments: Payments) {
    return async (data: AnyType) => {
      const eventData = JSON.parse(data);
      console.log("[NeverminedService] Event data: ", eventData);
      // await this.telegramService?.bot.api.sendMessage(
      //   "-4729581369",
      //   `Event data: ${JSON.stringify(eventData)}`
      // );
      const step = (await payments.query.getStep(
        eventData.step_id
      )) as NeverminedStep;
      console.log("[NeverminedService] Step: ", step);
      await payments.query.logTask({
        level: "info",
        task_id: step.task_id,
        message: `Processing step ${step.name}...`,
      });
      switch (step.name) {
        case FIRST_STEP_NAME: {
          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            message: `Step received ${step.name}, creating the additional steps...`,
          });
          console.log("[NeverminedService] Step received ", step);
          const fetchDataStepId = generateStepId();
          const encryptDataStepId = generateStepId();

          const steps = [
            {
              step_id: fetchDataStepId,
              task_id: step.task_id,
              predecessor: step.step_id, // "fetchData" follows "init"
              name: "fetchData",
              is_last: false,
            },
            {
              step_id: encryptDataStepId,
              task_id: step.task_id,
              predecessor: fetchDataStepId, // "encryptData" follows "fetchData"
              name: "encryptData",
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
            level: createResult.status === 201 ? "info" : "error",
            message:
              createResult.status === 201
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
        case "fetchData": {
          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            step_id: step.step_id,
            task_status: AgentExecutionStatus.In_Progress,
            message: `Step received ${step.name}, fetching data...`,
          });
          // await this.telegramService?.bot.api.sendMessage(
          //   "-4729581369",
          //   `Step received ${step.name}, fetching data...`
          // );
          const mockData = step.input_query ?? `step-1-mock-data-${Date.now()}`;
          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            step_id: step.step_id,
            task_status: AgentExecutionStatus.In_Progress,
            message: `Data fetched: ${mockData}`,
          });
          console.log(
            "[NeverminedService] Data fetched: ",
            mockData,
            step.task_id,
            step.step_id
          );
          await payments.query.updateStep(step.did, {
            ...step,
            step_status: AgentExecutionStatus.Completed,
            output: mockData,
            cost: 3,
          });
          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            task_status: AgentExecutionStatus.In_Progress,
            message: `Step 1 completed, data fetched`,
          });
          // await this.telegramService?.bot.api.sendMessage(
          //   "-4729581369",
          //   `Step 1 completed, data fetched`
          // );
          return;
        }
        case "encryptData": {
          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            step_id: step.step_id,
            task_status: AgentExecutionStatus.In_Progress,
            message: `Step received ${step.name}, encrypting data...`,
          });
          console.log(
            "[NeverminedService] Step received encrypting data...",
            step.task_id,
            step.step_id
          );

          const encryptedData = this.encryptData(step.input_query);

          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            step_id: step.step_id,
            task_status: AgentExecutionStatus.In_Progress,
            message: `Data encrypted: ${encryptedData}`,
          });
          console.log(
            "[NeverminedService] Data encrypted: ",
            encryptedData,
            step.task_id,
            step.step_id
          );

          await payments.query.updateStep(step.did, {
            ...step,
            step_status: AgentExecutionStatus.Completed,
            output: encryptedData,
            cost: 2,
            is_last: true,
          });

          await payments.query.logTask({
            level: "info",
            task_id: step.task_id,
            task_status: AgentExecutionStatus.Completed,
            message: `Step 2, data fetched and encrypted`,
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
    };
  }

  public async getPlanCreditBalance(
    //FIXME: Remove after demo, should be dynamic
    planDID = "did:nv:95933c24a7f3c181b62b2ee91d7b7e6ec0fce5430a0fd19f4cf5c4dc864efb6d"
  ): Promise<bigint> {
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
      return balance.balance;
    }
    return balance.balance;
  }

  public async purchasePlan(
    //FIXME: Remove after demo, should be dynamic
    planDID: string
  ): Promise<bigint> {
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
      return balance.balance;
    } else {
      console.log("Already subscribed to plan: ", planDID);
      return balance.balance;
    }
  }

  public async submitTask(
    //FIXME: Remove after demo, should be dynamic
    agentDID = "did:nv:ed26319e8551d5578b09563c3261df7cd4e3b1f4130434d04478a036c29e4403",
    planDID = "did:nv:95933c24a7f3c181b62b2ee91d7b7e6ec0fce5430a0fd19f4cf5c4dc864efb6d",
    query = `hello-demo-agent-${Date.now()}`,
    callback?: (data: string) => Promise<void>
  ): Promise<void> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    console.log(
      `[NeverminedService] Submitting task: agentDID: ${agentDID}, planDID: ${planDID}, query: ${query}`
    );
    const balance = await this.getPlanCreditBalance(planDID);
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
    const { data } = await this.client.query.createTask(
      agentDID,
      {
        query,
      },
      accessConfig,
      taskCallback
    );
    console.log(`Task sent to agent: ${JSON.stringify(data)}`);
    return data;
  }

  public async submitTaskDynamically(
    agentDID: string,
    planDID: string,
    query = `hello-demo-agent-${Date.now()}`,
    callback?: (data: string) => Promise<void>,
    resultCallback?: (result: {
      task_id: string;
      task_status: string;
      output: string;
      input_query: string;
      cost: number;
    }) => Promise<void>
  ): Promise<void> {
    if (!this.client) {
      throw new Error("NeverminedService not started");
    }
    console.log(
      `[NeverminedService] Submitting task: agentDID: ${agentDID}, planDID: ${planDID}, query: ${query}`
    );
    const balance = await this.getPlanCreditBalance(planDID);
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

        if (parsedData.task_status === "Completed") {
          const result = (await this.client?.query.getTaskWithSteps(
            agentDID,
            parsedData.task_id,
            accessConfig
          )) || {
            output: "No result",
          };

          // Safely handle the Axios response
          const resultData = "data" in result ? result.data : result;
          console.log("Task results:", Object.keys(resultData));

          const output = {
            task_id: resultData.task.task_id,
            task_status: resultData.task.task_status,
            output: resultData.task.output,
            input_query: resultData.task.input_query,
            cost: resultData.task.cost,
          };

          // Call the resultCallback if provided
          if (resultCallback) {
            await resultCallback(output);
          }
        }

        console.dir(parsedData, { depth: null });
      });
    const { data } = await this.client.query.createTask(
      agentDID,
      {
        query,
      },
      accessConfig,
      taskCallback
    );
    console.log(`Task sent to agent: ${JSON.stringify(data)}`);
    return data;
  }

  /**
   * Encrypts data using a simple hex encoding
   * @param data - The data to encrypt
   * @returns The encrypted data in hex format
   */
  private encryptData(data: string): string {
    return Buffer.from(data, "utf-8").toString("hex");
  }

  /**
   * Decrypts hex encoded data back to original string
   * @internal - Reserved for future use
   * @param encryptedData - The hex encoded data to decrypt
   * @returns The decrypted data as string
   */
  // @ts-expect-error Method will be used in future implementation
  private decryptData(encryptedData: string): string {
    return Buffer.from(encryptedData, "hex").toString("utf-8");
  }
}
