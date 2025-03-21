import { Bot, webhookCallback } from "grammy";
import { BaseService } from "./base.service.js";
import { ElizaService } from "./eliza.service.js";
import {
  AnyType,
  getCollablandApiUrl,
  getTokenMetadataPath,
  MintResponse,
  TokenMetadata,
} from "../utils.js";
import fs from "fs";
import axios, { AxiosResponse, isAxiosError } from "axios";
import { parse as jsoncParse } from "jsonc-parser";
import path, { resolve } from "path";
import { keccak256, getBytes, toUtf8Bytes } from "ethers";
import { TwitterService } from "./twitter.service.js";
import { NgrokService } from "./ngrok.service.js";
import { NeverminedService } from "./nevermined.service.js";
import {
  getAtom,
  findRelevantAgents,
  groupAgentsByFunction,
  getAgentNeverminedData,
} from "../utils/Intuition/queries.js";

// hack to avoid 400 errors sending params back to telegram. not even close to perfect
const htmlEscape = (_key: AnyType, val: AnyType) => {
  if (typeof val === "string") {
    return val
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"); // single quote
  }
  return val;
};

const __dirname = path.dirname(new URL(import.meta.url).pathname);
export class TelegramService extends BaseService {
  private static instance: TelegramService;
  public bot: Bot;
  private webhookUrl: string;
  private elizaService: ElizaService;
  private nGrokService: NgrokService;
  private twitterService?: TwitterService;
  private neverminedService?: NeverminedService;

  private constructor(webhookUrl?: string) {
    super();
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error("TELEGRAM_BOT_TOKEN is required");
    }
    if (webhookUrl != null) {
      this.webhookUrl = `${webhookUrl}/telegram/webhook`;
    }
    this.bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    this.elizaService = ElizaService.getInstance(this.bot);
    this.neverminedService = NeverminedService.getInstance();
  }

  public static getInstance(webhookUrl?: string): TelegramService {
    if (!TelegramService.instance) {
      TelegramService.instance = new TelegramService(webhookUrl);
    }
    return TelegramService.instance;
  }

  public async setWebhook(webhookUrl: string): Promise<void> {
    this.webhookUrl = `${webhookUrl}/telegram/webhook`;
    await this.bot.api.setWebhook(this.webhookUrl);
    console.log("Telegram webhook set:", this.webhookUrl);
  }

  public getWebhookCallback() {
    return webhookCallback(this.bot, "express", {
      timeoutMilliseconds: 10 * 60 * 1000,
      onTimeout: "return",
    });
  }

  public async start(): Promise<void> {
    const client = axios.create({
      baseURL: getCollablandApiUrl(),
      headers: {
        "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
        "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN || "",
        "Content-Type": "application/json",
      },
      timeout: 5 * 60 * 1000,
    });
    try {
      //all command descriptions can be added here
      this.bot.api.setMyCommands([
        {
          command: "start",
          description: "Add any hello world functionality to your bot",
        },
        { command: "mint", description: "Mint a token on Wow.xyz" },
        { command: "eliza", description: "Talk to the AI agent" },
        { command: "lit", description: "Execute a Lit action" },
        { command: "nevermined", description: "Execute a Nevermined action" },
        { command: "intuition", description: "Fetch an Intuition atom" },
        {
          command: "execute",
          description:
            "Find an agent, subscribe to its plans, submit a task to it, usage /execute <task_name> <additional_query>",
        },
        {
          command: "fetch_agent_info",
          description:
            "Fetch agent Nevermined info, usage /fetch_agent_info <agent_name>",
        },
        {
          command: "find_agents",
          description: "Find agents by function, usage /find_agents <function>",
        },
        {
          command: "purchase_plan",
          description:
            "Purchase a plan on Nevermined, usage /command <plan_did>",
        },
        {
          command: "submit_task",
          description:
            "Submit a task to an agent's plan on Nevermined, usage /command <agent_did> <plan_did>",
        },
        {
          command: "nvm_balance",
          description: "Get the plan balance on Nevermined",
        },
      ]);
      // all command handlers can be registered here
      this.bot.command("start", async (ctx) => {
        try {
          await ctx.reply("Hello!");
        } catch (error) {
          console.error("Error in start command:", error);
          await ctx.reply("❌ Failed to send welcome message");
        }
      });

      this.bot.command("nvm_balance", async (ctx) => {
        try {
          const chatId = ctx.chat?.id;
          console.log("Chat ID:", chatId);
          const balance = await this.neverminedService?.getPlanCreditBalance();
          await ctx.reply(`💰 Plan balance: ${balance} credits`);
        } catch (error) {
          console.error("Error in nvm_balance command:", error);
          await ctx.reply("❌ Failed to fetch Nevermined plan balance");
        }
      });

      this.bot.command("purchase_plan", async (ctx) => {
        try {
          const planDID = ctx.message?.text.split(" ")[1] ?? "";
          if (!planDID) {
            await ctx.reply(
              "Please provide a plan DID. Usage: /purchase_plan <plan_did>"
            );
            return;
          }

          await ctx.reply(`🔄 Purchasing plan: ${planDID}`);
          const balance = await this.neverminedService?.purchasePlan(planDID);

          if (!balance) {
            throw new Error("Failed to purchase plan");
          }

          await ctx.reply(
            `✅ Plan purchased successfully! ${balance} credits remaining`
          );
        } catch (error) {
          console.error("Error in purchase_plan command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to purchase plan"}`
          );
        }
      });

      this.bot.command("submit_task", async (ctx) => {
        try {
          const agentDID = ctx.message?.text.split(" ")[1] ?? "";
          const planDID = ctx.message?.text.split(" ")[2] ?? "";

          if (!agentDID || !planDID) {
            await ctx.reply("Usage: /submit_task <agent_did> <plan_did>");
            return;
          }

          await ctx.reply(
            `🔄 Submitting task to agent:\nAgent DID: ${agentDID}\nPlan DID: ${planDID}`
          );

          const query = `hello-demo-agent-${Date.now()}`;
          await this.neverminedService?.submitTaskDynamically(
            agentDID,
            planDID,
            query,
            undefined,
            async (result: unknown) => {
              let formattedResult = result;
              // Try to parse and format if result is JSON string
              try {
                if (typeof result === "string") {
                  formattedResult = JSON.parse(result);
                }
                await ctx.reply(
                  `✅ Task completed!\n\nResult:\n<pre><code>${JSON.stringify(formattedResult, null, 2)}</code></pre>`,
                  { parse_mode: "HTML" }
                );
              } catch {
                // If parsing fails, send as plain text
                await ctx.reply(`✅ Task completed!\n\nResult: ${result}`);
              }
            }
          );
        } catch (error) {
          console.error("Error in submit_task command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to submit task"}`
          );
        }
      });

      this.bot.command("intuition", async (ctx) => {
        try {
          const atomId = ctx.message?.text.split(" ")[1] ?? "";

          if (!atomId || isNaN(parseInt(atomId))) {
            await ctx.reply(
              "Please provide a valid atom ID. Usage: /intuition <atom_id>"
            );
            return;
          }

          await ctx.reply(`🔍 Fetching Intuition atom: ${atomId}`);
          const atom = await getAtom(parseInt(atomId));

          if (!atom) {
            throw new Error("Atom not found");
          }

          await ctx.reply(
            `✨ Atom details:\n<pre><code>${JSON.stringify(atom, null, 2)}</code></pre>`,
            { parse_mode: "HTML" }
          );
        } catch (error) {
          console.error("Error in intuition command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to fetch atom"}`
          );
        }
      });

      this.bot.command("execute", async (ctx) => {
        const taskName = ctx.message?.text.split(" ")[1] ?? "";
        const query = ctx.message?.text.split(" ")[2] ?? "";
        if (!query) {
          await ctx.reply(
            "Please provide a query. Usage: /execute <task_name> <query>"
          );
          return;
        }
        if (!taskName) {
          await ctx.reply(
            "Please provide a task name. Usage: /execute <task_name>"
          );
          return;
        }

        try {
          // Step 1: Find relevant agents for the task
          await ctx.reply(
            `🔍 Searching for agents that can handle: ${taskName}`
          );
          const agents = await findRelevantAgents(taskName);

          if (agents.length === 0) {
            await ctx.reply("❌ No agents found that can handle this task.");
            return;
          }

          // Display found agents grouped by function
          const grouped = groupAgentsByFunction(agents);
          let message = `✨ Found ${agents.length} relevant agents:\n\n`;
          grouped.forEach((agents, func) => {
            message += `🔹 ${func}:\n`;
            agents.forEach((agent) => {
              message += `  • ${agent.name}\n`;
            });
            message += "\n";
          });
          await ctx.reply(message);

          // Step 2: Fetch Nevermined info for each agent and filter valid ones
          await ctx.reply("🔄 Verifying agent credentials...");
          const validAgents = [];

          for (const agent of agents) {
            const agentInfo = await getAgentNeverminedData(agent.name);
            if (agentInfo.agentId && agentInfo.planId) {
              validAgents.push({
                ...agent,
                neverminedInfo: agentInfo,
              });
            }
          }

          if (validAgents.length === 0) {
            await ctx.reply(
              "❌ No agents found with valid Nevermined credentials."
            );
            return;
          }

          // Step 3: Select the first valid agent (you could implement different selection strategies)
          const selectedAgent = validAgents[0];
          await ctx.reply(
            `🤖 Selected agent: ${selectedAgent.name}\n` +
              `📝 Description: ${selectedAgent.description || "No description available"}\n` +
              `🎯 Primary function: ${selectedAgent.primaryFunction || "Unknown"}`
          );

          // Step 4: Purchase the agent's plan
          await ctx.reply("💳 Purchasing agent's plan...");
          const planDID = selectedAgent.neverminedInfo.planId!;
          const agentDID = selectedAgent.neverminedInfo.agentId!;

          const purchaseBalance =
            await this.neverminedService?.purchasePlan(planDID);
          if (!purchaseBalance) {
            throw new Error("Failed to purchase plan");
          }
          await ctx.reply(
            `✅ Plan purchased successfully! ${purchaseBalance} credits remaining`
          );

          // Step 5: Submit the task
          await ctx.reply("📤 Submitting task to agent...");

          await this.neverminedService?.submitTaskDynamically(
            agentDID,
            planDID,
            query,
            undefined,
            async (result) => {
              await ctx.reply(
                `🤖 Task Results:\n\n` +
                  `📝 Input: ${result.input_query}\n` +
                  `✨ Output: ${result.output}\n` +
                  `💰 Cost: ${result.cost} Credits`
              );
            }
          );
        } catch (error) {
          console.error("Error in execute command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "An unexpected error occurred"}`
          );
        }
      });

      this.bot.command("fetch_agent_info", async (ctx) => {
        try {
          const agentName = ctx.message?.text.split(" ")[1] ?? "";

          if (!agentName) {
            await ctx.reply(
              "Please provide an agent name. Usage: /fetch_agent_info <agent_name>"
            );
            return;
          }

          await ctx.reply(`🔍 Fetching agent info: ${agentName}`);
          const agentInfo = await getAgentNeverminedData(agentName);

          if (!agentInfo) {
            throw new Error("Agent not found");
          }

          await ctx.reply(
            `✨ Agent Details:\n` +
              `🤖 Name: ${agentInfo.name}\n` +
              `🆔 Agent ID: ${agentInfo.agentId || "Not found"}\n` +
              `📋 Plan ID: ${agentInfo.planId || "Not found"}\n` +
              `📝 Description: ${agentInfo.description || "No description available"}`
          );
        } catch (error) {
          console.error("Error in fetch_agent_info command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to fetch agent info"}`
          );
        }
      });

      this.bot.command("find_agents", async (ctx) => {
        try {
          const query = ctx.message?.text.split(" ")[1] ?? "";

          if (!query) {
            await ctx.reply(
              "Please provide a search query. Usage: /find_agents <function>"
            );
            return;
          }

          await ctx.reply(`🔍 Searching for agents with function: ${query}`);
          const agents = await findRelevantAgents(query);

          if (agents.length === 0) {
            await ctx.reply("❌ No agents found matching your query");
            return;
          }

          const grouped = groupAgentsByFunction(agents);
          let message = `✨ Found ${agents.length} relevant agents:\n\n`;

          grouped.forEach((agents, func) => {
            message += `🔹 ${func}:\n`;
            agents.forEach((agent) => {
              message += `  • ${agent.name}\n`;
            });
            message += "\n";
          });

          await ctx.reply(message);
        } catch (error) {
          console.error("Error in find_agents command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to search for agents"}`
          );
        }
      });

      this.bot.command("nevermined", async (ctx) => {
        try {
          const query = ctx.message?.text.split(" ")[1] ?? "";
          const chatId = ctx.chat?.id;
          console.log("Query:", query);
          console.log("Chat ID:", chatId);

          const agentDID =
            "did:nv:ed26319e8551d5578b09563c3261df7cd4e3b1f4130434d04478a036c29e4403";
          const planDID =
            "did:nv:95933c24a7f3c181b62b2ee91d7b7e6ec0fce5430a0fd19f4cf5c4dc864efb6d";

          await ctx.reply(
            `🤖 Submitting Nevermined task:\nAgent DID: ${agentDID}\nPlan DID: ${planDID}`
          );

          const initBalance =
            await this.neverminedService?.getPlanCreditBalance(planDID);
          await ctx.reply(`💰 Initial plan credit balance: ${initBalance}`);

          const finalBalance =
            await this.neverminedService?.getPlanCreditBalance(planDID);
          await ctx.reply(`💰 Final plan credit balance: ${finalBalance}`);
        } catch (error) {
          console.error("Error in nevermined command:", error);
          await ctx.reply(
            `❌ Error: ${error.message || "Failed to execute Nevermined task"}`
          );
        }
      });
      this.bot.catch(async (error) => {
        console.error("Telegram bot error:", error);
      });
      await this.elizaService.start();
      // required when starting server for telegram webooks
      this.nGrokService = await NgrokService.getInstance();
      try {
        // try starting the twitter service
        this.twitterService = await TwitterService.getInstance();
        await this.twitterService?.start();
        console.log(
          "Twitter Bot Profile:",
          JSON.stringify(this.twitterService.me, null, 2)
        );
      } catch (err) {
        console.log(
          "[WARN] [telegram.service] Unable to use twitter. Functionality will be disabled",
          err
        );
      }

      this.bot.command("mint", async (ctx) => {
        try {
          ctx.reply("Minting your token...");
          const tokenPath = getTokenMetadataPath();
          const tokenInfo = jsoncParse(
            fs.readFileSync(tokenPath, "utf8")
          ) as TokenMetadata;
          console.log("TokenInfoToMint", tokenInfo);
          console.log("Hitting Collab.Land APIs to mint token...");
          const { data: _tokenData } = await client.post<
            AnyType,
            AxiosResponse<MintResponse>
          >(`/telegrambot/evm/mint?chainId=8453`, {
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            metadata: {
              description: tokenInfo.description ?? "",
              website_link: tokenInfo.websiteLink ?? "",
              twitter: tokenInfo.twitter ?? "",
              discord: tokenInfo.discord ?? "",
              telegram: tokenInfo.telegram ?? "",
              media: tokenInfo.image ?? "",
              nsfw: tokenInfo.nsfw ?? false,
            },
          });
          console.log("Mint response from Collab.Land:");
          console.dir(_tokenData, { depth: null });
          const tokenData = _tokenData.response.contract.fungible;
          await ctx.reply(
            `Your token has been minted on wow.xyz 🥳
Token details:
<pre><code class="language-json">${JSON.stringify(tokenData, null, 2)}</code></pre>

You can view the token page below (it takes a few minutes to be visible)`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    {
                      text: "View Wow.xyz Token Page",
                      url: `https://wow.xyz/${tokenData.address}`,
                    },
                  ],
                ],
              },
              parse_mode: "HTML",
            }
          );
          if (this.twitterService) {
            const twitterBotInfo = this.twitterService.me;
            const twitterClient = this.twitterService.getScraper();
            const ngrokURL = this.nGrokService.getUrl();
            await ctx.reply(
              `🐦 Posting a tweet about the new token...\n\n` +
                `Twitter account details:\n<pre lang="json"><code>${JSON.stringify(
                  twitterBotInfo,
                  null,
                  2
                )}</code></pre>`,
              {
                parse_mode: "HTML",
              }
            );
            const claimURL = `${process.env.NEXT_PUBLIC_HOSTNAME}/claim/${tokenData.address}`;
            const botUsername = twitterBotInfo?.username;
            console.log("botUsername:", botUsername);
            console.log("claimURL:", claimURL);
            const slug =
              Buffer.from(claimURL).toString("base64url") +
              ":" +
              Buffer.from(botUsername!).toString("base64url");
            console.log("slug:", slug);
            const cardURL = `${ngrokURL}/auth/twitter/card/${slug}/index.html`;
            console.log("cardURL:", cardURL);
            const twtRes = await twitterClient.sendTweet(
              `I just minted a token on Base using Wow!\nThe ticker is $${tokenData.symbol}\nClaim early alpha here: ${cardURL}`
            );
            if (twtRes.ok) {
              const tweetId = (await twtRes.json()) as AnyType;
              console.log("Tweet posted successfully:", tweetId);
              const tweetURL = `https://twitter.com/${twitterBotInfo?.username}/status/${tweetId?.data?.create_tweet?.tweet_results?.result?.rest_id}`;
              console.log("Tweet URL:", tweetURL);
              await ctx.reply(
                `Tweet posted successfully!\n\n` +
                  `🎉 Tweet details: ${tweetURL}`,
                {
                  parse_mode: "HTML",
                }
              );
            } else {
              console.error("Failed to post tweet:", await twtRes.json());
              await ctx.reply("Failed to post tweet");
            }
          }
        } catch (error) {
          if (isAxiosError(error)) {
            console.error("Failed to mint token:", error.response?.data);
          } else {
            console.error("Failed to mint token:", error);
          }
          ctx.reply("Failed to mint token");
        }
      });
      this.bot.command("lit", async (ctx) => {
        try {
          const action = ctx.match;
          console.log("action:", action);
          const actionHashes = JSON.parse(
            (
              await fs.readFileSync(
                resolve(
                  __dirname,
                  "..",
                  "..",
                  "..",
                  "lit-actions",
                  "actions",
                  `ipfs.json`
                )
              )
            ).toString()
          );
          console.log("actionHashes:", actionHashes);
          const actionHash = actionHashes[action];
          console.log("actionHash:", actionHash);
          if (!actionHash) {
            ctx.reply(`Action not found: ${action}`);
            return;
          }
          // ! NOTE: You can send any jsParams you want here, it depends on your Lit action code
          let jsParams;
          // ! NOTE: You can change the chainId to any chain you want to execute the action on
          const chainId = 8453;
          switch (action) {
            case "hello-action": {
              // ! NOTE: The message to sign can be any normal message, or raw TX
              // ! In order to sign EIP-191 message, you need to encode it properly, Lit protocol does raw signatures
              const messageToSign =
                ctx.from?.username ?? ctx.from?.first_name ?? "";
              const messageToSignDigest = keccak256(toUtf8Bytes(messageToSign));
              jsParams = {
                helloName: messageToSign,
                toSign: Array.from(getBytes(messageToSignDigest)),
              };
              break;
            }
            case "decrypt-action": {
              const toEncrypt = `encrypt-decrypt-test-${new Date().toUTCString()}`;
              ctx.reply(`Invoking encrypt action with ${toEncrypt}`);
              const { data } = await client.post(
                `/telegrambot/executeLitActionUsingPKP?chainId=${chainId}`,
                {
                  actionIpfs: actionHashes["encrypt-action"].IpfsHash,
                  actionJsParams: {
                    toEncrypt,
                  },
                }
              );
              console.log("encrypt response ", data);
              const { ciphertext, dataToEncryptHash } = JSON.parse(
                data.response.response
              );
              jsParams = {
                ciphertext,
                dataToEncryptHash,
                chain: "base",
              };
              break;
            }
            case "encrypt-action": {
              const message =
                ctx.from?.username ?? ctx.from?.first_name ?? "test data";
              jsParams = {
                toEncrypt: `${message}-${new Date().toUTCString()}`,
              };
              break;
            }
            default: {
              // they typed something random or a dev forgot to update this list
              ctx.reply(`Action not handled: ${action}`);
              return;
            }
          }
          await ctx.reply(
            "Executing action..." +
              `\n\nAction Hash: <code>${actionHash.IpfsHash}</code>\n\nParams:\n<pre lang="json"><code>${JSON.stringify(
                jsParams,
                htmlEscape,
                2
              )}</code></pre>`,
            {
              parse_mode: "HTML",
            }
          );
          console.log(
            `[telegram.service] executing lit action with hash ${actionHash.IpfsHash} on chain ${chainId}`
          );
          const { data } = await client.post(
            `/telegrambot/executeLitActionUsingPKP?chainId=${chainId}`,
            {
              actionIpfs: actionHash.IpfsHash,
              actionJsParams: jsParams,
            }
          );
          console.log(
            `Action with hash ${actionHash.IpfsHash} executed on Lit Nodes 🔥`
          );
          console.log("Result:", data);
          ctx.reply(
            `Action executed on Lit Nodes 🔥\n\n` +
              `Action: <code>${actionHash.IpfsHash}</code>\n` +
              `Result:\n<pre lang="json"><code>${JSON.stringify(
                data,
                null,
                2
              )}</code></pre>`,
            {
              parse_mode: "HTML",
            }
          );
        } catch (error) {
          if (isAxiosError(error)) {
            console.error(
              "Failed to execute Lit action:",
              error.response?.data
            );
            ctx.reply(
              "Failed to execute Lit action" +
                `\n\nError: <pre lang="json"><code>${JSON.stringify(
                  error.response?.data,
                  null,
                  2
                )}</code></pre>`,
              {
                parse_mode: "HTML",
              }
            );
          } else {
            console.error("Failed to execute Lit action:", error);
            ctx.reply(
              "Failed to execute Lit action" +
                `\n\nError: <pre lang="json"><code>${JSON.stringify(
                  error?.message,
                  null,
                  2
                )}</code></pre>`,
              {
                parse_mode: "HTML",
              }
            );
          }
        }
      });
    } catch (error) {
      console.error("Failed to start Telegram bot:", error);
      throw error;
    }
  }

  public getBotInfo() {
    return this.bot.api.getMe();
  }

  public async stop(): Promise<void> {
    try {
      await this.bot.api.deleteWebhook();
    } catch (error) {
      console.error("Error stopping Telegram bot:", error);
    }
  }
}
