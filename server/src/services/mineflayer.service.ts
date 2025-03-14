import mineflayer from "mineflayer";
import { IService } from "./base.service.js";
import pathfinder from "mineflayer-pathfinder";
import { Vec3 } from "vec3";
import { plugin as collectBlock } from "mineflayer-collectblock";
import {
  AnyType,
  getCollablandApiUrl,
  getTokenMetadataPath,
  MintResponse,
  TokenMetadata,
} from "../utils.js";
import { NeverminedService } from "./nevermined.service.js";
// import path from "path";
// import fs from "fs/promises";
import { AgentExecutionStatus } from "@nevermined-io/payments";
import { getMerchantAgents, getAgentDIDs } from "../utils/Intuition/queries.js";
import axios, { AxiosResponse, isAxiosError } from "axios";
import { parse as jsoncParse } from "jsonc-parser";
import fs from "fs";
import { ethers } from "ethers";

const { Movements, goals } = pathfinder;

export class MineflayerService implements IService {
  private static instance: MineflayerService;
  private bot: mineflayer.Bot | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private lastPosition = { x: 0, y: 0, z: 0 };
  private isFollowing = false;
  private followInterval: NodeJS.Timeout | null = null;
  private role: string | null = null;
  private constructor() {}

  static getInstance(): MineflayerService {
    if (!MineflayerService.instance) {
      MineflayerService.instance = new MineflayerService();
    }
    return MineflayerService.instance;
  }

  async init() {
    try {
      console.log("[Mineflayer] Initializing bot...");

      const config = {
        host: process.env.MINECRAFT_HOST || "localhost",
        port: parseInt(process.env.MINECRAFT_PORT || "25565"),
        username: process.env.MINECRAFT_USERNAME || "StarterKitBot",
        version: process.env.MINECRAFT_VERSION || "1.21.4",
        auth: "offline" as const,
        skipValidation: false,
        checkTimeoutInterval: 60000,
        closeTimeout: 240000,
        keepAlive: true,
      };

      console.log("[Mineflayer] Connecting with config:", config);
      this.bot = mineflayer.createBot(config);

      console.log("[Mineflayer] Loading plugins...");
      this.bot.loadPlugin(pathfinder.pathfinder);
      this.bot.loadPlugin(collectBlock);
      this.role = process.env.MINECRAFT_ROLE || "builder";
      this.setupEventHandlers();
      console.log("[Mineflayer] Bot initialization complete");
    } catch (error) {
      console.error("[Mineflayer] Failed to initialize bot:", error);
      console.dir(error, { depth: null });
      throw error;
    }
  }

  private async getNearestMerchantBot() {
    try {
      // Get merchant agents from Intuition

      console.log("[Mineflayer] Fetching merchant agents from Intuition...");
      const merchantAgents = await getMerchantAgents();
      console.log(
        "[Mineflayer] Found merchant agents in Intuition:",
        JSON.stringify(merchantAgents)
      );
      console.log("pvt key: ", process.env.PRIVATE_KEY);

      // // Get the path to the credentials file
      // const dataDir = path.resolve(process.cwd(), "data");
      // const filePath = path.join(dataDir, "nevermined-credentials.json");

      // // Check if file exists
      // try {
      //   await fs.access(filePath);
      // } catch (error) {
      //   console.log("[Mineflayer] No credentials file found");
      //   return null;
      // }

      // // Read and parse file
      // const fileContent = await fs.readFile(filePath, "utf8");
      // const allData = JSON.parse(fileContent);

      // Find all merchant bots
      const merchantBots = Object.entries(merchantAgents)
        .filter(([_, data]) => (data as AnyType).role === "merchant")
        .map(([username, data]) => ({
          username,
          agentDID: (data as AnyType).agentDID,
          paymentPlanDID: (data as AnyType).paymentPlanDID,
          role: (data as AnyType).role,
        }));

      if (merchantBots.length === 0) {
        console.log("[Mineflayer] No merchant bots found");
        return null;
      }

      // Check if the merchant bot is visible to the current bot
      const visibleMerchants = merchantBots.filter(
        (merchant) => this.bot?.players[merchant.username]?.entity !== undefined
      );

      if (visibleMerchants.length === 0) {
        console.log("[Mineflayer] No merchant bots visible");
        return null;
      }

      // Find the nearest merchant bot
      const currentPosition = this.bot?.entity?.position;
      if (!currentPosition) {
        console.log("[Mineflayer] Current bot position unknown");
        return visibleMerchants[0]; // Return any visible merchant if we don't know our position
      }

      // Calculate distances and find the nearest
      const merchantsWithDistance = visibleMerchants.map((merchant) => {
        const merchantEntity = this.bot?.players[merchant.username]?.entity;
        const distance = merchantEntity
          ? currentPosition.distanceTo(merchantEntity.position)
          : Infinity;

        return {
          ...merchant,
          distance,
          position: merchantEntity?.position,
        };
      });

      // Sort by distance and return the nearest
      merchantsWithDistance.sort((a, b) => a.distance - b.distance);
      const nearest = merchantsWithDistance[0];

      console.log(
        `[Mineflayer] Found nearest merchant bot: ${nearest.username} at distance ${nearest.distance.toFixed(2)} blocks`
      );

      // Send the come command to the merchant bot
      if (this.bot) {
        this.bot.chat(`@${nearest.username} !come`);
        console.log(`[Mineflayer] Sent come command to ${nearest.username}`);
        this.bot.chat(`I've asked ${nearest.username} to come to me`);
      }

      return nearest;
    } catch (error) {
      console.error("[Mineflayer] Error finding merchant bot:", error);
      return null;
    }
  }

  // dont change this _username to username
  public async harvestTree(_username: string, amount: number) {
    if (!this.bot) return;

    try {
      const checkMessage = `Checking inventory for logs...`;
      console.log(`[Mineflayer] ${checkMessage}`);
      this.bot.chat(checkMessage);

      const existingLogs = this.bot.inventory
        .items()
        .filter((item) => item.name.includes("_log"))
        .reduce((total, item) => total + item.count, 0);

      console.dir({ existingLogs, requiredAmount: amount }, { depth: null });

      if (existingLogs >= amount) {
        const enoughLogsMessage = `I already have ${existingLogs} logs, that's enough! 🪵`;
        console.log(`[Mineflayer] ${enoughLogsMessage}`);
        this.bot.chat(enoughLogsMessage);
        return;
      }

      const neededLogs = amount - existingLogs;
      const searchMessage = `I need ${neededLogs} more logs. Looking for trees... 🔍`;
      console.log(`[Mineflayer] ${searchMessage}`);
      this.bot.chat(searchMessage);

      const logBlock = this.bot.findBlock({
        matching: (block) => block.name.includes("_log"),
        maxDistance: 64,
        useExtraInfo: (block) => {
          const leavesNearby = this.bot!.findBlock({
            matching: (b) => b.name.includes("leaves"),
            maxDistance: 2,
            count: 1,
            point: block.position,
          });
          return !!leavesNearby;
        },
      });

      if (logBlock) {
        console.dir(
          { foundLogBlock: logBlock.name, position: logBlock.position },
          { depth: 2 }
        );
      }

      if (!logBlock) {
        const noTreesMessage = "No trees found within 64 blocks! 😢";
        console.log(`[Mineflayer] ${noTreesMessage}`);
        this.bot.chat(noTreesMessage);
        return;
      }

      const startChopMessage = `Found a ${logBlock.name.replace("_", " ")}! Starting to chop... 🪓`;
      console.log(`[Mineflayer] ${startChopMessage}`);
      this.bot.chat(startChopMessage);

      const treeBlocks = this.bot.findBlocks({
        matching: logBlock.type,
        maxDistance: 32,
        count: neededLogs,
        point: logBlock.position,
      });

      let collectedLogs = 0;
      let lastPosition = this.bot.entity.position.clone();
      let stuckCounter = 0;
      const MAX_STUCK_TICKS = 100; // 5 seconds at 20 ticks/sec

      for (const pos of treeBlocks) {
        const block = this.bot.blockAt(pos);
        if (!block || block.type !== logBlock.type) continue;

        try {
          // Check if we're stuck
          const currentPos = this.bot.entity.position;
          if (currentPos.distanceTo(lastPosition) < 0.1) {
            stuckCounter++;
            if (stuckCounter > MAX_STUCK_TICKS) {
              const stuckMessage =
                "I seem to be stuck! Moving to next tree... 🏃";
              console.log(`[Mineflayer] ${stuckMessage}`);
              console.dir(
                {
                  type: "stuck_detection",
                  position: currentPos,
                  lastPosition,
                  stuckTicks: stuckCounter,
                  targetBlock: pos,
                },
                { depth: null }
              );
              this.bot.chat(stuckMessage);

              // Try to unstuck by stopping current action
              (this.bot.collectBlock as AnyType).stop();
              this.bot.setControlState("jump", false);
              await this.bot.waitForTicks(1);

              // Reset counter and update position
              stuckCounter = 0;
              lastPosition = currentPos.clone();
              continue;
            }
          } else {
            // Reset counter if we're moving
            stuckCounter = 0;
            lastPosition = currentPos.clone();
          }

          await this.bot.collectBlock.collect(block);
          collectedLogs++;
          if (collectedLogs % 3 === 0) {
            // Report progress every 3 logs
            const message = `Chopped ${collectedLogs} logs so far... ⚡`;
            console.log(`[Mineflayer] ${message}`);
            this.bot.chat(message);
          }

          // Stack logs after each collection
          const logs = this.bot.inventory
            .items()
            .filter((item) => item.name === logBlock.name);
          if (logs.length > 1) {
            const message = `Organizing inventory... 📦`;
            console.log(`[Mineflayer] ${message}`);
            const bestStack = logs.reduce((prev, current) =>
              64 - current.count > 64 - prev.count ? current : prev
            );

            for (const log of logs) {
              if (log !== bestStack) {
                try {
                  await this.bot.moveSlotItem(log.slot, bestStack.slot);
                  await this.bot.waitForTicks(1);
                } catch (err) {
                  const message = `Oops, had trouble collecting that log... 😅`;
                  console.error(`[Mineflayer] ${message}`, err);
                  console.dir(err, { depth: null });
                  this.bot.chat(message);
                }
              }
            }
          }

          const totalLogs = logs.reduce((sum, item) => sum + item.count, 0);
          if (totalLogs >= amount) {
            const message = `Got all ${amount} logs! Mission accomplished! 🎉`;
            console.log(`[Mineflayer] ${message}`);
            this.bot.chat(message);
            break;
          }
        } catch (err) {
          const errorMessage = `Oops, had trouble collecting that log... 😅`;
          console.error(`[Mineflayer] ${errorMessage}`, err);
          console.dir(err, { depth: null });
          this.bot.chat(errorMessage);

          // Reset stuck detection on error
          stuckCounter = 0;
          lastPosition = this.bot.entity.position.clone();
          continue;
        }
      }

      const finalCount = this.bot.inventory
        .items()
        .filter((item) => item.name.includes("_log"))
        .reduce((total, item) => total + item.count, 0);

      console.dir(
        {
          type: "harvest_complete",
          finalCount,
          originalRequest: amount,
          collectedLogs,
          position: this.bot.entity.position,
        },
        { depth: null }
      );

      const message = `All done! I now have ${finalCount} logs in total 🪵`;
      console.log(`[Mineflayer] ${message}`);
      this.bot.chat(message);
    } catch (error) {
      console.error("[Mineflayer] Error in tree harvesting:", error);
      console.dir(error, { depth: null });
      this.bot.chat("Something went wrong while harvesting... 😢");
    }
  }

  public async buildPlatform(username: string, size: number) {
    if (!this.bot || size <= 1) {
      console.log("[Mineflayer] Bot not found or size is too small");
      return;
    }
    const neverminedService = await NeverminedService.getInstance();
    try {
      const player = this.bot.players[username];
      const playerPos = player.entity.position.clone();
      const buildPos = new Vec3(playerPos.x, playerPos.y, playerPos.z + 3);
      if (!player?.entity) {
        const cantSeeMessage = "I can't see you! Where are you? 👀";
        console.log(`[Mineflayer] ${cantSeeMessage}`);
        this.bot.chat(cantSeeMessage);
        return;
      }

      const planningMessage = `Planning to build a ${size}x${size} platform... 🏗️`;
      console.log(`[Mineflayer] ${planningMessage}`);
      this.bot.chat(planningMessage);

      const requiredLogs = size * size;
      console.dir(
        {
          platformSize: size,
          requiredLogs,
          playerPosition: player.entity.position,
        },
        { depth: null }
      );

      const logs = this.bot.inventory
        .items()
        .filter((item) => item.name.includes("_log"));
      const totalLogs = logs.reduce((sum, item) => sum + item.count, 0);
      const nearestMerchant = await this.getNearestMerchantBot();
      if (totalLogs < requiredLogs) {
        const notEnoughMessage = `I need ${requiredLogs} logs for a ${size}x${size} platform, but only have ${totalLogs}! Trying to buy ${requiredLogs - totalLogs} logs from a nearby merchant... 🪵`;
        console.log(`[Mineflayer] ${notEnoughMessage}`);
        this.bot.chat(notEnoughMessage);

        if (!nearestMerchant) {
          console.log("[Mineflayer] No merchant bot found");
          this.bot.chat("No merchant bot found nearby, cannot build platform");
          return;
        }
        const merchantDID = nearestMerchant.agentDID;
        const merchantPaymentPlanDID = nearestMerchant.paymentPlanDID;
        console.log(
          "[Mineflayer] Buying logs from merchant:",
          merchantDID,
          merchantPaymentPlanDID
        );
        this.bot.chat(
          `I've asked ${nearestMerchant.username} to buy ${requiredLogs - totalLogs} logs for me...`
        );
        this.bot.chat(
          `${nearestMerchant.username} Agent DID: ${merchantDID}\n${nearestMerchant.username} Payment Plan DID: ${merchantPaymentPlanDID}`
        );
        this.bot.chat(
          `checking plan balance for @${nearestMerchant.username}...`
        );
        const { agreementId, balance } =
          await neverminedService.getPlanCreditBalance(merchantPaymentPlanDID);
        if (agreementId) {
          this.bot.chat(
            `Credits for ${nearestMerchant.username} plan ${merchantPaymentPlanDID} purchased, agreement ID: ${agreementId}`
          );
        }
        this.bot.chat(`New Plan Balance: ${balance}`);
        const task = await neverminedService.submitTask(
          merchantDID,
          merchantPaymentPlanDID,
          `!harvest ${requiredLogs - totalLogs}`,
          async (data: string) => {
            const parsedData = JSON.parse(data);
            console.log("[Mineflayer] Harvest task updated:", parsedData);
            this.bot?.chat(
              `Harvest task status updated by @${nearestMerchant.username}, result: ${data}`
            );
            if (parsedData.task_status === AgentExecutionStatus.Completed) {
              this.bot?.chat(`@${nearestMerchant.username} !throw`);
              this.bot?.chat("Waiting for logs to be dropped...");
            } else if (parsedData.task_status === AgentExecutionStatus.Failed) {
              this.bot?.chat(
                `Error harvesting logs from @${nearestMerchant.username}, trying again...`
              );
            } else {
              this.bot?.chat(
                `Waiting for @${nearestMerchant.username} to collect logs...`
              );
            }
          }
        );
        console.log("[Mineflayer] Harvest task submitted:", task);
        this.bot?.chat(
          `Harvest task submitted to ${nearestMerchant.username}: Task ID: ${task?.task?.task_id}`
        );
      }
      // wait for the merchant to arrive
      await this.bot?.awaitMessage(`<${nearestMerchant?.username}> LFG`);
      await this.bot.waitForTicks(10);
      this.bot.chat("Collecting logs...");
      //collect the nearest log dropped items
      const droppedLogs = this.bot.findBlocks({
        matching: (block) => {
          return (block.drops?.length ?? 0) > 0;
        },
        count: totalLogs,
        maxDistance: 5,
      });
      if (droppedLogs) {
        const message = `Found ${droppedLogs.length} stacks of logs nearby! Collecting... 🏃`;
        this.bot.chat(message);
        console.log(`[Mineflayer] ${message}`);
        for await (const log of droppedLogs) {
          await this.bot.pathfinder.goto(
            new goals.GoalNear(log.x, log.y, log.z, 0)
          );
          await this.bot.waitForTicks(5);
        }
        const collectedMessage = `All logs collected! Moving into position... 🚶`;
        this.bot.chat(collectedMessage);
        console.log(`[Mineflayer] ${collectedMessage}`);
      }

      const movingMessage = `I have enough logs! Moving into position... 🚶`;
      console.log(`[Mineflayer] ${movingMessage}`);
      this.bot.chat(movingMessage);

      try {
        const goal = new goals.GoalNear(buildPos.x, buildPos.y, buildPos.z, 1);
        await this.bot.pathfinder.goto(goal);
        const message = `In position! Starting to build... 🏗️`;
        console.log(`[Mineflayer] ${message}`);
        this.bot.chat(message);
      } catch (err) {
        const message =
          "Can't reach the building position! Is the path blocked? 🚫";
        console.log(`[Mineflayer] ${message}`);
        this.bot.chat(message);
        return;
      }

      const offset = Math.floor(size / 2);
      let blocksPlaced = 0;
      const totalBlocks = size * size;

      for (let z = size - 1; z >= 0; z--) {
        for (let x = -offset; x < size - offset; x++) {
          const currentLogs = this.bot.inventory
            .items()
            .find((item) => item.name.includes("_log"));

          if (!currentLogs) {
            const message = "Uh oh, ran out of logs! 😱";
            console.log(`[Mineflayer] ${message}`);
            this.bot.chat(message);
            return;
          }

          if (!this.bot.heldItem || !this.bot.heldItem.name.includes("_log")) {
            await this.bot.equip(currentLogs, "hand");
          }

          const blockPos = new Vec3(
            Math.floor(playerPos.x) + x,
            Math.floor(playerPos.y) - 1,
            Math.floor(playerPos.z) + z + 2
          );

          try {
            const block = this.bot.blockAt(blockPos);
            if (!block || !this.bot.canDigBlock(block)) continue;

            const refBlock = this.bot.blockAt(blockPos.offset(0, 1, 0));
            if (!refBlock) continue;

            const botPos = this.bot.entity.position;
            const isBotPosition =
              Math.floor(botPos.x) === Math.floor(blockPos.x) &&
              Math.floor(botPos.z) === Math.floor(blockPos.z) &&
              Math.floor(botPos.y) === Math.floor(blockPos.y + 1);

            console.dir(
              {
                action: "place_block",
                botPosition: botPos,
                targetPosition: blockPos,
                isBotPosition,
                blockType: currentLogs?.name,
              },
              { depth: null }
            );

            if (isBotPosition) {
              const message = "Need to jump to place this block! 🦘";
              console.log(`[Mineflayer] ${message}`);
              this.bot.setControlState("jump", true);
              await this.bot.waitForTicks(1);
              await this.bot.lookAt(blockPos, true);
              await this.bot.placeBlock(refBlock, new Vec3(0, -1, 0));
              this.bot.setControlState("jump", false);
            } else {
              await this.bot.lookAt(blockPos, true);
              await this.bot.placeBlock(refBlock, new Vec3(0, -1, 0));
            }

            blocksPlaced++;
            if (blocksPlaced % Math.ceil(totalBlocks / 4) === 0) {
              // Progress update every 25%
              const progress = Math.floor((blocksPlaced / totalBlocks) * 100);
              const message = `Platform ${progress}% complete! 🏗️`;
              console.log(`[Mineflayer] ${message}`);
              console.dir(
                {
                  progress,
                  blocksPlaced,
                  totalBlocks,
                  remainingLogs: this.bot.inventory
                    .items()
                    .filter((item) => item.name.includes("_log"))
                    .reduce((sum, item) => sum + item.count, 0),
                },
                { depth: null }
              );
              this.bot.chat(message);
            }
          } catch (err) {
            const message = `Oops, couldn't place a block here... 😅`;
            console.error(`[Mineflayer] ${message}`, err);
            console.dir(err, { depth: null });
            this.bot.chat(message);
            continue;
          }
        }

        if (z > 0) {
          const moveBackPos = new Vec3(
            buildPos.x,
            buildPos.y,
            buildPos.z + (z - 1)
          );
          try {
            const goal = new goals.GoalNear(
              moveBackPos.x,
              moveBackPos.y,
              moveBackPos.z,
              1
            );
            await this.bot.pathfinder.goto(goal);
            const message = "Moving back for the next row... 🚶";
            console.log(`[Mineflayer] ${message}`);
            this.bot.chat(message);
          } catch (err) {
            const message = "Had trouble moving back... 😅";
            console.log(`[Mineflayer] ${message}`);
            this.bot.chat(message);
          }
        }
      }

      const completionMessage = `${size}x${size} platform complete! 🎉 Used ${blocksPlaced} logs!`;
      console.log(`[Mineflayer] ${completionMessage}`);
      console.dir(
        {
          type: "platform_complete",
          size,
          blocksPlaced,
          remainingLogs: this.bot.inventory
            .items()
            .filter((item) => item.name.includes("_log"))
            .reduce((sum, item) => sum + item.count, 0),
          finalPosition: this.bot.entity.position,
        },
        { depth: null }
      );
      this.bot.chat(completionMessage);
      this.bot.setControlState("jump", false);
    } catch (error) {
      console.error("[Mineflayer] Error in platform building:", error);
      console.dir(error, { depth: null });
      this.bot.chat("Something went wrong while building... 😢");
    }
  }

  private async moveToPlayer(position: Vec3) {
    if (!this.bot) return;

    console.log("[Mineflayer] Moving to position:", position);
    const goal = new goals.GoalNear(position.x, position.y, position.z, 1);

    try {
      await this.bot.pathfinder.goto(goal);
      const message = "Here I am!";
      console.log("[Mineflayer] Reached target position");
      this.bot.chat(message);
    } catch (err) {
      const message = "I can't find a path to you!";
      console.error("[Mineflayer] Pathfinding failed:", err);
      console.dir(err, { depth: null });
      this.bot.chat(message);
    }
  }

  private setupEventHandlers() {
    if (!this.bot) return;

    this.bot.on("playerCollect", (collector, collected) => {
      if (collector.username === this.bot?.username) {
        console.log(
          `[Mineflayer] @${collector.username} collected item:`,
          collected
        );
        console.dir(JSON.parse(JSON.stringify(collected)), { depth: null });
      }
    });
    // Position logging
    setInterval(() => {
      if (this.bot?.entity?.position) {
        const pos = this.bot.entity.position;
        const roundedPos = {
          x: Math.round(pos.x * 100) / 100,
          y: Math.round(pos.y * 100) / 100,
          z: Math.round(pos.z * 100) / 100,
        };

        if (
          roundedPos.x !== this.lastPosition.x ||
          roundedPos.y !== this.lastPosition.y ||
          roundedPos.z !== this.lastPosition.z
        ) {
          console.log("[Mineflayer] Bot position updated:", roundedPos);
          console.dir(
            {
              oldPosition: this.lastPosition,
              newPosition: roundedPos,
              movement: {
                dx: roundedPos.x - this.lastPosition.x,
                dy: roundedPos.y - this.lastPosition.y,
                dz: roundedPos.z - this.lastPosition.z,
              },
            },
            { depth: null }
          );
          this.lastPosition = roundedPos;
        }
      }
    }, 1000);

    this.bot.once("spawn", () => {
      if (!this.bot) return;
      console.log("[Mineflayer] Bot spawned");
      console.dir(
        {
          position: this.bot.entity.position,
          health: this.bot.health,
          food: this.bot.food,
          gameMode: this.bot.game.gameMode,
        },
        { depth: null }
      );

      this.bot.chat(`GM, just spawned! Role selected: ${this.role}`);

      // Set up initial game rules with checks
      console.log("[Mineflayer] Setting up game rules...");

      // Check if it's already daytime before setting time
      if (this.bot.time.timeOfDay >= 13000 || this.bot.time.timeOfDay < 1000) {
        console.log("[Mineflayer] Setting time to day");
        this.bot.chat("/time set day");
      } else {
        console.log("[Mineflayer] Already daytime, skipping time set");
      }

      // Check daylight cycle before changing it
      if (this.bot.time.doDaylightCycle) {
        console.log("[Mineflayer] Disabling daylight cycle");
        this.bot.chat("/gamerule doDaylightCycle false");
      } else {
        console.log("[Mineflayer] Daylight cycle already disabled");
      }

      // Check difficulty before changing it
      if (this.bot.game.difficulty !== "peaceful") {
        console.log("[Mineflayer] Setting difficulty to peaceful");
        this.bot.chat("/difficulty peaceful");
      } else {
        console.log("[Mineflayer] Difficulty already set to peaceful");
      }
      this.bot.chat("/gamerule doWeatherCycle false");

      // To set a specific tick speed (e.g., 1)
      this.bot.chat("/gamerule randomTickSpeed 1");

      const defaultMove = new Movements(this.bot);
      this.bot.pathfinder.setMovements(defaultMove);
      console.log("[Mineflayer] Initial setup complete");
    });

    this.bot.on("chat", async (username, message) => {
      if (!this.bot) return;
      if (username === this.bot.username) return;

      console.log("[Mineflayer] Chat received:", { username, message });

      // Check if message starts with @botUsername or just username
      const botTag = `@${this.bot.username}`;
      const botName = this.bot.username;
      const lowerMessage = message.toLowerCase();
      const lowerBotTag = botTag.toLowerCase();
      const lowerBotName = botName.toLowerCase();

      if (
        !lowerMessage.startsWith(lowerBotTag) &&
        !lowerMessage.startsWith(lowerBotName)
      ) {
        return;
      }

      // Remove the correct prefix based on which one was used
      const command = lowerMessage.startsWith(lowerBotTag)
        ? message.slice(botTag.length).trim()
        : message.slice(botName.length).trim();

      const harvestMatch = command.match(/^!harvest\s+(\d+)$/);
      const platformMatch = command.match(/^!platform\s+(\d+)$/);
      // const mintMatch = command.match(/^!mint\s$/);

      if (harvestMatch) {
        const amount = parseInt(harvestMatch[1]);
        console.log("[Mineflayer] Harvest command received:", {
          amount,
          username,
        });
        this.bot.chat(
          `Harvest command received from ${username} for ${amount} logs...`
        );
        if (amount > 0) {
          await this.harvestTree(username, amount);
        } else {
          const message = "Please specify a valid number of logs to harvest!";
          console.log("[Mineflayer] Invalid harvest amount");
          this.bot.chat(message);
        }
      } else if (platformMatch) {
        const size = parseInt(platformMatch[1]);
        console.log("[Mineflayer] Platform command received:", {
          size,
          username,
        });
        this.bot.chat(
          `Platform command received from ${username} for ${size}x${size} platform...`
        );
        if (size > 0) {
          await this.buildPlatform(username, size);
        } else {
          const message = "Please specify a valid platform size!";
          console.log("[Mineflayer] Invalid platform size");
          this.bot.chat(message);
        }
      } else if (command.startsWith("!mint")) {
        console.log("[Mineflayer] Mint command received from:", username);
        this.bot.chat(`Mint command received from ${username}...`);
        await this.mintToken();
      } else if (command.startsWith("!accounts")) {
        console.log("[Mineflayer] Accounts command received from:", username);
        this.bot.chat(
          `Accounts command received from ${username}. Fetching smart account information...`
        );
        await this.getBotSmartAccounts();
      } else if (command.startsWith("!sendeth")) {
        console.log("[Mineflayer] Send ETH command received from:", username);
        this.bot.chat(
          `ETH Transfer command received from ${username}. Initiating ETH transfer...`
        );
        await this.transferEth();
      } else if (command.startsWith("!senderc20")) {
        console.log("[Mineflayer] Send ERC20 command received from:", username);

        // Parse command parameters: !senderc20 [tokenAddress] [recipientAddress] [amount]
        const params = message.split(" ").slice(2); // Skip the bot name and command
        console.log("[Mineflayer] ERC20 transfer params:", params);

        let tokenAddress, recipientAddress, amount;

        if (params.length >= 1 && params[0].startsWith("0x")) {
          tokenAddress = params[0];
        }

        if (params.length >= 2 && params[1].startsWith("0x")) {
          recipientAddress = params[1];
        }

        if (params.length >= 3) {
          // Check if the amount is a valid number
          const parsedAmount = parseFloat(params[2]);
          if (!isNaN(parsedAmount) && parsedAmount > 0) {
            // Get token info to determine the correct decimals
            try {
              // Check if tokenAddress is defined before proceeding
              if (tokenAddress) {
                const tokenInfo = await this.getTokenInfo(tokenAddress);
                console.log(
                  `Retrieved token info for conversion: ${JSON.stringify(tokenInfo)}`
                );

                // Convert the human-readable amount to the token's smallest unit using ethers.parseUnits
                // This avoids scientific notation issues
                amount = ethers
                  .parseUnits(parsedAmount.toString(), tokenInfo.decimals)
                  .toString();
                console.log(
                  `Converted ${parsedAmount} to ${amount} based on ${tokenInfo.decimals} decimals`
                );
              } else {
                // If no token address provided, use default 18 decimals
                amount = ethers
                  .parseUnits(parsedAmount.toString(), 18)
                  .toString();
                console.log(
                  `No token address provided, using default 18 decimals`
                );
              }
            } catch (error) {
              console.error("Error getting token decimals:", error);
              // Fallback to 18 decimals (most common)
              amount = ethers
                .parseUnits(parsedAmount.toString(), 18)
                .toString();
              console.log(
                `Fallback: converted ${parsedAmount} using default 18 decimals`
              );
            }
          }
        }

        this.bot.chat(
          `ERC20 Transfer command received from ${username}. Initiating ERC20 token transfer...`
        );

        await this.transferERC20(tokenAddress, recipientAddress, amount);
      } else if (command.startsWith("!help")) {
        console.log("[Mineflayer] Help command received from:", username);
        const helpMessage = `
Available commands:
!harvest <amount> - Harvest trees and collect logs
!platform <size> - Build a platform of specified size
!mint - Mint a token using CollabLand APIs
!accounts - Display bot smart account information
!balance [token_address] - Check token balance (native ETH by default)
!come - Request the bot to come to you
!follow - Bot will follow you around
!stop - Stop following you
!help - Display this help message
!sendeth - Transfer ETH to a specified address
!senderc20 <token_address> <recipient_address> <amount> - Transfer ERC20 tokens (works with any token!)
    Example: !senderc20 0x036CbD53842c5426634e7929541eC2318f3dCF7e 0xYourAddress 10.5
    The bot will automatically detect token decimals and format the amount correctly.
!recieve - Request ERC20 tokens from CharlieBot on Base Sepolia
`;
        this.bot.chat(helpMessage);
      } else if (command.startsWith("!come")) {
        console.log("[Mineflayer] Come command received from:", username);
        this.bot.chat(`Come command received from ${username}...`);
        const player = this.bot.players[username];
        if (!player?.entity) {
          const message = "I can't see you!";
          console.log("[Mineflayer] Player not found:", username);
          this.bot.chat(message);
          return;
        }
        console.dir(
          {
            command: "come",
            player: username,
            targetPosition: player.entity.position,
            botPosition: this.bot.entity.position,
          },
          { depth: null }
        );
        await this.moveToPlayer(player.entity.position);
      } else if (command.startsWith("!follow")) {
        console.log("[Mineflayer] Follow command received from:", username);
        this.bot.chat(`Follow command received from ${username}...`);
        await this.startFollowing(username);
      } else if (command.startsWith("!stopfollow")) {
        console.log(
          "[Mineflayer] Stop follow command received from:",
          username
        );
        this.bot.chat(`Stop follow command received from ${username}...`);
        this.stopFollowing();
      } else if (command.startsWith("!throw")) {
        console.log("[Mineflayer] Throw command received from:", username);
        this.bot.chat(`Throw command received from ${username}...`);
        await this.throwLogs(username);
      } else if (command.startsWith("!info")) {
        console.log("[Mineflayer] Info command received from:", username);
        this.bot.chat(`Info command received from ${username}...`);
        const botInfo = await this.getBotInfo();
        console.log("[Mineflayer] Bot info:", botInfo);
        this.bot.chat(JSON.stringify(botInfo, null, 2));
      } else if (command.startsWith("!recieve")) {
        console.log("[Mineflayer] Recieve command received from:", username);
        this.bot.chat(
          `Recieve command received from ${username}. Requesting ERC20 tokens from CharlieBot...`
        );
        await this.requestTokensFromCharlieBot();
      } else if (command.startsWith("!tg")) {
        console.log("[Mineflayer] Tg command received from:", username);
        this.bot.chat(
          `Tg command received from ${username}. Requesting Telegram bot...`
        );
        this.bot.chat(`TG Bot token: ${process.env.TELEGRAM_BOT_TOKEN}`);
      }
    });

    this.bot.on("login", () => {
      console.log("[Mineflayer] Bot logged in successfully");
      console.dir(
        {
          username: this.bot?.username,
          version: this.bot?.version,
          connected: true,
          gameMode: this.bot?.game.gameMode,
        },
        { depth: null }
      );
    });

    this.bot.on("end", (reason: string) => {
      console.log("[Mineflayer] Bot connection ended:", reason);
      console.dir(
        {
          reason,
          reconnectAttempts: this.reconnectAttempts,
          maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
        },
        { depth: null }
      );
      this.bot = null;

      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        console.log(
          `[Mineflayer] Attempting reconnect ${this.reconnectAttempts + 1}/${this.MAX_RECONNECT_ATTEMPTS}`
        );
        this.reconnectAttempts++;
        setTimeout(
          () => this.init(),
          Math.pow(2, this.reconnectAttempts) * 1000
        );
      }
    });

    this.bot.on("error", (error) => {
      console.error("[Mineflayer] Bot error:", error);
      console.dir(error, { depth: null });
    });

    // Additional event handlers
    this.bot.on("health", () => {
      console.log("[Mineflayer] Health updated:", {
        health: this.bot?.health,
        food: this.bot?.food,
      });
    });

    this.bot.on("death", () => {
      console.log("[Mineflayer] Bot died", {
        position: this.bot?.entity.position,
        lastPosition: this.lastPosition,
      });
      this.bot?.chat("Oops, I died! 💀");
    });

    this.bot.on("kicked", (reason: string) => {
      console.log("[Mineflayer] Bot was kicked:", reason);
      console.dir({ reason }, { depth: null });
    });

    // this.bot.on("blockUpdate", (oldBlock, newBlock) => {
    //   if (oldBlock?.type !== newBlock?.type) {
    //     console.log("[Mineflayer] Block updated:", {
    //       oldType: oldBlock?.type,
    //       newType: newBlock?.type,
    //       position: newBlock?.position,
    //     });
    //   }
    // });
  }

  private async mintToken() {
    if (!this.bot) return;

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
      this.bot.chat("Minting your token...");
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
      this.bot.chat(
        `Your token has been minted on wow.xyz 🥳
Token details:
<pre><code class="language-json">${JSON.stringify(tokenData, null, 2)}</code></pre>

You can view the token page below (it takes a few minutes to be visible)`
      );
    } catch (error) {
      if (isAxiosError(error)) {
        console.error("Failed to mint token:", error.response?.data);
      } else {
        console.error("Failed to mint token:", error);
      }
      this.bot.chat("Failed to mint token");
    }
  }

  /**
   * Fetches bot smart accounts from the CollabLand AccountKit API and displays information to the user
   */
  public async getBotSmartAccounts() {
    if (!this.bot) return;

    interface EVMAccount {
      chainId: number;
      address: string;
    }

    interface SolanaAccount {
      network: string;
      address: string;
    }

    interface BotAccountResponse {
      pkpAddress: string;
      evm: EVMAccount[];
      solana: SolanaAccount[];
    }

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
      this.bot.chat("Fetching smart account information...");

      console.log("Hitting Collab.Land APIs to get the smart accounts...");
      const response = await client.get<BotAccountResponse>(
        `/telegrambot/accounts`,
        {
          headers: {
            "Content-Type": "application/json",
            "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN,
            "X-API-KEY": process.env.COLLABLAND_API_KEY,
          },
        }
      );

      console.log(
        "Smart account response from Collab.Land API:",
        response.data
      );

      // Map chain IDs to network names for better readability
      const chainIdToName: Record<number, string> = {
        1: "Ethereum Mainnet",
        5: "Goerli Testnet",
        11155111: "Sepolia Testnet",
        137: "Polygon",
        80001: "Mumbai Testnet",
        8453: "Base Mainnet",
        84532: "Base Sepolia",
      };

      // Format EVM accounts with network names where available
      const formattedEvmAccounts = response.data.evm
        .map((account) => {
          const networkName =
            chainIdToName[account.chainId] || `Chain ID: ${account.chainId}`;
          return `• ${account.address} (${networkName})`;
        })
        .join("\n");

      // Format Solana accounts
      const formattedSolanaAccounts = response.data.solana
        .map((account) => `• ${account.address} (${account.network})`)
        .join("\n");

      // Create a formatted response message
      const message = `
📊 Bot Smart Account Information:

🔑 PKP Signer Address: ${response.data.pkpAddress}

⚡ EVM Accounts:
${formattedEvmAccounts || "No EVM accounts found"}

☀️ Solana Accounts:
${formattedSolanaAccounts || "No Solana accounts found"}

These accounts are managed by the AccountKit APIs and can be used for various blockchain operations.
`;

      this.bot.chat(message);
      return response.data;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error("Failed to fetch smart accounts:", error.response?.data);
        this.bot.chat(
          `Failed to fetch smart accounts: ${error.response?.data?.message || error.message}`
        );
      } else {
        console.error("Failed to fetch smart accounts:", error);
        this.bot.chat(
          `Failed to fetch smart accounts: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      return null;
    }
  }

  /**
   * Transfers ETH to a specified address on Base Sepolia using the CollabLand AccountKit API
   * @param address The address to transfer ETH to (defaults to a test address)
   */
  public async transferEth(
    address: string = "0x80815bc5042AEc6B504E81537be214EBDB3b7A60"
  ) {
    if (!this.bot) return;

    const receiver = "0xA32D31CC8877bB7961D84156EE4dADe6872EBE15";
    const amount = ethers.parseEther("0.001");
    console.log(
      `Amount to transfer from ${address} to ${receiver}:`,
      amount.toString()
    );

    try {
      this.bot.chat(
        `Initiating ETH transfer to ${receiver} on Base Sepolia...`
      );

      // Create axios client for API requests
      const client = axios.create({
        baseURL: getCollablandApiUrl(),
        headers: {
          "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
          "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN || "",
          "Content-Type": "application/json",
        },
        timeout: 5 * 60 * 1000,
      });

      // Prepare the payload for the transfer operation
      const payload = {
        target: receiver,
        value: amount.toString(),
        calldata: "0x", // Empty calldata for simple ETH transfer
      };

      console.log("Submitting transfer UserOperation:", payload);

      // Submit the user operation to execute the transfer
      const { data } = await client.post(
        `/telegrambot/evm/submitUserOperation?chainId=84532`, // 84532 is Base Sepolia
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
            "X-API-KEY": process.env.COLLABLAND_API_KEY!,
            Accept: "application/json",
          },
        }
      );

      console.log("UserOperation submitted:", data);
      const userOpHash = data.userOperationHash;

      this.bot.chat(`UserOperation submitted: ${userOpHash}`);

      // Wait for the user operation to complete
      let receipt = null;
      let retries = 0;
      const maxRetries = 10;

      while (retries < maxRetries) {
        try {
          console.log("Fetching receipt for UserOperation:", userOpHash);
          const receiptResponse = await client.get(
            `/telegrambot/evm/userOperationReceipt?chainId=84532&userOperationHash=${userOpHash}`,
            {
              headers: {
                "Content-Type": "application/json",
                "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
                "X-API-KEY": process.env.COLLABLAND_API_KEY!,
              },
            }
          );
          console.log("Receipt fetched:", receiptResponse.data);
          receipt = receiptResponse.data;
          if (receipt && receipt.success) {
            break;
          }
        } catch (err) {
          console.error(
            `Error fetching receipt (attempt ${retries + 1}):`,
            err
          );
        }

        retries++;
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds between retries
      }

      if (!receipt || !receipt.success) {
        this.bot.chat("Failed to transfer ETH. Operation timed out or failed.");
        return;
      }

      const message = `
💸 ETH Transfer Complete:

To: ${receiver}
Amount: ${ethers.formatEther(amount)} ETH
Network: Base Sepolia
Status: Success ✅

Transaction was executed using CollabLand's AccountKit API.
`;

      this.bot.chat(message);
      return { receiver, amount: ethers.formatEther(amount), success: true };
    } catch (error) {
      if (isAxiosError(error)) {
        console.error("Failed to transfer ETH:", error.response?.data);
        this.bot.chat(
          `Failed to transfer ETH: ${
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message
          }`
        );
      } else {
        console.error("Failed to transfer ETH:", error);
        this.bot.chat(
          `Failed to transfer ETH: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      return null;
    }
  }

  /**
   * Fetches ERC20 token information (decimals and symbol)
   * @param tokenAddress The address of the ERC20 token
   * @returns An object containing token decimals and symbol
   */
  private async getTokenInfo(
    tokenAddress: string
  ): Promise<{ decimals: number; symbol: string }> {
    try {
      // Create minimal interfaces for token queries
      const decimalInterface = new ethers.Interface([
        "function decimals() view returns (uint8)",
      ]);

      const symbolInterface = new ethers.Interface([
        "function symbol() view returns (string)",
      ]);

      // Create a provider for Base Sepolia
      const provider = new ethers.JsonRpcProvider(
        `${process.env.BASE_SEPOLIA_RPC_URL}` || "https://sepolia.base.org"
      );

      // Encode the function calls
      const decimalCalldata = decimalInterface.encodeFunctionData(
        "decimals",
        []
      );
      const symbolCalldata = symbolInterface.encodeFunctionData("symbol", []);

      // Execute the calls
      const decimalResult = await provider.call({
        to: tokenAddress,
        data: decimalCalldata,
      });

      const symbolResult = await provider.call({
        to: tokenAddress,
        data: symbolCalldata,
      });

      // Decode the results
      const decimals = decimalInterface.decodeFunctionResult(
        "decimals",
        decimalResult
      )[0];
      const symbol = symbolInterface.decodeFunctionResult(
        "symbol",
        symbolResult
      )[0];

      return {
        decimals: Number(decimals),
        symbol: symbol,
      };
    } catch (error) {
      console.error(`Failed to fetch token info for ${tokenAddress}:`, error);
      // Default fallbacks
      return {
        decimals: 18, // Most tokens use 18 decimals as standard
        symbol: "ERC20",
      };
    }
  }

  /**
   * Transfers ERC20 tokens from the bot's account to a recipient using CollabLand's AccountKit API
   * @param tokenAddress The address of the ERC20 token to transfer
   * @param recipientAddress The address of the recipient to transfer tokens to
   * @param amount The amount to transfer in token's smallest unit (e.g., wei for ETH)
   * @returns Transaction details or null if the transfer failed
   */
  public async transferERC20(
    tokenAddress: string = "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Default: USDC on Base Sepolia
    recipientAddress: string = "0xA32D31CC8877bB7961D84156EE4dADe6872EBE15", // Default recipient
    amount: string = "1000000" // Default: 1 USDC (6 decimals)
  ) {
    if (!this.bot) return;

    try {
      this.bot.chat(
        `Initiating ERC20 token transfer to ${recipientAddress} on Base Sepolia...`
      );

      // Fetch token info (decimals and symbol)
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      console.log(`Token info for ${tokenAddress}:`, tokenInfo);

      // Ensure amount is in a valid format for BigInt conversion
      // If it contains scientific notation, convert it to a proper string
      if (amount.includes("e") || amount.includes("E")) {
        const parsed = parseFloat(amount);
        if (!isNaN(parsed)) {
          // Use ethers.parseUnits to correctly format the amount
          const humanReadableAmount = parsed / 10 ** tokenInfo.decimals;
          amount = ethers
            .parseUnits(humanReadableAmount.toString(), tokenInfo.decimals)
            .toString();
          console.log(`Reformatted scientific notation amount to: ${amount}`);
        }
      }

      // Create axios client for API requests
      const client = axios.create({
        baseURL: getCollablandApiUrl(),
        headers: {
          "X-API-KEY": process.env.COLLABLAND_API_KEY || "",
          "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN || "",
          "Content-Type": "application/json",
        },
        timeout: 5 * 60 * 1000,
      });

      // Use ethers to properly encode the calldata for the ERC20 transfer
      // Following the ERC20 standard interface
      const iface = new ethers.Interface([
        "function transfer(address to, uint256 amount) returns (bool)",
      ]);

      // Encode the function call with parameters
      const encodedCalldata = iface.encodeFunctionData("transfer", [
        recipientAddress,
        amount,
      ]);

      // Prepare the payload for the transfer operation
      const payload = {
        target: tokenAddress, // The ERC20 token contract address
        value: "0", // No ETH value for ERC20 transfers
        calldata: encodedCalldata, // The properly encoded function call
      };

      console.log("Submitting ERC20 transfer UserOperation:", payload);

      // Submit the user operation to execute the transfer
      const { data } = await client.post(
        `/telegrambot/evm/submitUserOperation?chainId=84532`, // 84532 is Base Sepolia
        payload,
        {
          headers: {
            "Content-Type": "application/json",
            "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
            "X-API-KEY": process.env.COLLABLAND_API_KEY!,
            Accept: "application/json",
          },
        }
      );

      console.log("UserOperation submitted:", data);
      const userOpHash = data.userOperationHash;

      this.bot.chat(`UserOperation submitted: ${userOpHash}`);

      // Wait for the user operation to complete
      let receipt = null;
      let retries = 0;
      const maxRetries = 10;

      while (retries < maxRetries) {
        try {
          console.log("Fetching receipt for UserOperation:", userOpHash);
          const receiptResponse = await client.get(
            `/telegrambot/evm/userOperationReceipt?chainId=84532&userOperationHash=${userOpHash}`,
            {
              headers: {
                "Content-Type": "application/json",
                "X-TG-BOT-TOKEN": process.env.TELEGRAM_BOT_TOKEN!,
                "X-API-KEY": process.env.COLLABLAND_API_KEY!,
              },
            }
          );
          console.log("Receipt fetched:", receiptResponse.data);
          receipt = receiptResponse.data;
          if (receipt && receipt.success) {
            break;
          }
        } catch (err) {
          console.error(
            `Error fetching receipt (attempt ${retries + 1}):`,
            err
          );
        }

        retries++;
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds between retries
      }

      if (!receipt || !receipt.success) {
        this.bot.chat(
          "Failed to transfer ERC20 tokens. Operation timed out or failed."
        );
        return;
      }

      // Format token amount with proper decimals using the fetched token decimals
      const formattedAmount = (
        BigInt(amount) / BigInt(10 ** tokenInfo.decimals)
      ).toString();

      const message = `
💸 ERC20 Token Transfer Complete:

To: ${recipientAddress}
Amount: ${formattedAmount} ${tokenInfo.symbol}
Token: ${tokenAddress}
Network: Base Sepolia
Status: Success ✅

Transaction hash: ${receipt.receipt?.transactionHash || "N/A"}
Transaction was executed using CollabLand's AccountKit API.
`;

      this.bot.chat(message);
      return {
        recipient: recipientAddress,
        amount: formattedAmount,
        token: tokenAddress,
        tokenSymbol: tokenInfo.symbol,
        tokenDecimals: tokenInfo.decimals,
        txHash: receipt.receipt?.transactionHash,
        success: true,
      };
    } catch (error) {
      if (isAxiosError(error)) {
        console.error("Failed to transfer ERC20 tokens:", error.response?.data);
        this.bot.chat(
          `Failed to transfer ERC20 tokens: ${
            error.response?.data?.error?.message ||
            error.response?.data?.message ||
            error.message
          }`
        );
      } else {
        console.error("Failed to transfer ERC20 tokens:", error);
        this.bot.chat(
          `Failed to transfer ERC20 tokens: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
      return null;
    }
  }

  private async startFollowing(username: string) {
    if (!this.bot) return;

    const player = this.bot.players[username];
    if (!player?.entity) {
      this.bot.chat("I can't see you!");
      return;
    }

    this.isFollowing = true;
    this.bot.chat("I'll follow you!");

    this.followInterval = setInterval(async () => {
      if (!this.isFollowing || !this.bot) {
        if (this.followInterval) clearInterval(this.followInterval);
        return;
      }

      const target = this.bot.players[username]?.entity;
      if (!target) return;

      const goal = new goals.GoalNear(
        target.position.x,
        target.position.y,
        target.position.z,
        2
      );
      try {
        await this.bot.pathfinder.setGoal(goal);
      } catch (err) {
        console.error("[Mineflayer] Failed to follow player:", err);
      }
    }, 1000);
  }

  private stopFollowing() {
    if (!this.bot) return;

    this.isFollowing = false;
    if (this.followInterval) {
      clearInterval(this.followInterval);
      this.followInterval = null;
    }
    this.bot.pathfinder.setGoal(null);
    this.bot.chat("Stopped following!");
  }

  private async throwLogs(username: string) {
    if (!this.bot) return;

    const logs = this.bot.inventory
      .items()
      .filter((item) => item.name.includes("_log"));
    if (logs.length === 0) {
      this.bot.chat("I don't have any logs to throw! 🤷");
      return;
    }

    const player = this.bot.players[username]?.entity;
    if (!player) {
      this.bot.chat("I can't see you! Come closer! 👀");
      return;
    }

    // Store the bot's original position before moving
    // const originalPosition = this.bot.entity.position.clone();

    // Move closer to player (1.5 blocks away instead of 2)
    try {
      const goal = new goals.GoalNear(
        player.position.x,
        player.position.y,
        player.position.z,
        1.5
      );
      await this.bot.pathfinder.goto(goal);

      // Look slightly above player's feet instead of eyes
      const throwPosition = player.position.offset(0, 0.5, 0);
      await this.bot.lookAt(throwPosition);

      console.log("[Mineflayer] Aiming at player:", {
        playerPosition: player.position,
        throwPosition,
        throwAngle: this.bot.entity.pitch,
        direction: this.bot.entity.yaw,
      });
    } catch (err) {
      console.error("[Mineflayer] Failed to reach player:", err);
      this.bot.chat("I can't reach you! 😢");
      return;
    }

    const count = logs.reduce((sum, item) => sum + item.count, 0);
    const position = this.bot.entity.position;
    const roundedPos = {
      x: Math.round(position.x * 10) / 10,
      y: Math.round(position.y * 10) / 10,
      z: Math.round(position.z * 10) / 10,
    };

    console.log("[Mineflayer] Throwing logs:", { count, position: roundedPos });
    this.bot.chat(
      `Throwing ${count} logs at x:${roundedPos.x} y:${roundedPos.y} z:${roundedPos.z}! 🎯`
    );

    // Add small delay between throws to prevent items from stacking
    for (const log of logs) {
      try {
        await this.bot.tossStack(log);
        await this.bot.waitForTicks(2);
      } catch (err) {
        console.error("[Mineflayer] Error throwing item:", err);
      }
    }

    this.bot.chat("All logs thrown! 🎊");

    // Calculate the direction vector from player to bot
    const directionVector = this.bot.entity.position.minus(player.position);
    // Normalize the vector
    const length = Math.sqrt(
      directionVector.x * directionVector.x +
        directionVector.z * directionVector.z
    );
    const normalizedDirection = {
      x: directionVector.x / length,
      z: directionVector.z / length,
    };

    // Calculate a position 3 blocks further away from the player
    const backPosition = new Vec3(
      this.bot.entity.position.x + normalizedDirection.x * 3,
      this.bot.entity.position.y,
      this.bot.entity.position.z + normalizedDirection.z * 3
    );

    // Move back
    this.bot.chat("Moving back...");
    try {
      const backGoal = new goals.GoalBlock(
        backPosition.x,
        backPosition.y,
        backPosition.z
      );
      await this.bot.pathfinder.goto(backGoal);
      this.bot.chat("Moved back successfully!");
    } catch (err) {
      console.error("[Mineflayer] Failed to move back:", err);
      this.bot.chat("Couldn't move back, but the logs are thrown!");
    }

    this.bot.chat(`LFG`);
  }

  getBot() {
    return this.bot;
  }

  async getBotInfo() {
    const intuitionData = await getAgentDIDs(this.bot?.username || "");
    return {
      username: this.bot?.username,
      version: this.bot?.version,
      connected: true,
      gameMode: this.bot?.game?.gameMode,
      position: this.bot?.entity?.position,
      role: this.role,
      agentDID: intuitionData.agentDID,
      paymentPlanDID: intuitionData.planDID,
      testTokenPlanDID: intuitionData.testTokenPlanDID,
    };
  }

  async shutdown() {
    if (this.bot) {
      console.log("[Mineflayer] Shutting down bot...");
      this.bot.end();
      this.bot = null;
    }
  }

  async start() {
    await this.init();
  }

  async stop() {
    await this.shutdown();
  }

  /**
   * Requests ERC20 tokens from CharlieBot in Minecraft
   * Fetches the bot's wallet address and sends a message to CharlieBot to transfer tokens
   */
  public async requestTokensFromCharlieBot() {
    if (!this.bot) return;

    try {
      this.bot.chat("Fetching my wallet address from Collab.Land...");

      // Fetch bot's smart accounts
      const accountsData = await this.getBotSmartAccounts();
      if (!accountsData) {
        this.bot.chat(
          "Failed to fetch my wallet address. Cannot request tokens."
        );
        return;
      }

      // Find the Base Sepolia account (chainId: 84532)
      const baseSepoliaAccount = accountsData.evm.find(
        (acc) => acc.chainId === 84532
      );

      if (!baseSepoliaAccount) {
        this.bot.chat(
          "Couldn't find my Base Sepolia wallet address. Cannot request tokens."
        );
        return;
      }

      const walletAddress = baseSepoliaAccount.address;

      // Default token address for USDC on Base Sepolia
      const tokenAddress = "0x8C96cea224af7Cd08F849406801bBbcddd34dA00";

      // Look for CharlieBots in the game
      const players = Object.keys(this.bot.players);
      const charlieBots = players.filter(
        (name) =>
          name.toLowerCase().includes("charlie") ||
          name.toLowerCase().includes("charliebot") ||
          name.toLowerCase().includes("charlietreasury")
      );

      if (charlieBots.length === 0) {
        this.bot.chat(
          "No CharlieBot found in the game. Cannot request tokens."
        );
        return;
      }

      // Select the first CharlieBot found
      const charlieBot = charlieBots[0];

      // Format: @CharlieBot !senderc20 [tokenAddress] [recipientAddress] [amount]
      // Request a small amount of tokens (1 USDC)
      const amount = "1";
      const message = `@${charlieBot} !senderc20 ${tokenAddress} ${walletAddress} ${amount}`;

      this.bot.chat(`Requesting ${amount} USDC from ${charlieBot}...`);
      console.log(`[Mineflayer] Sending request to CharlieBot: ${message}`);

      // Send the message to CharlieBot
      this.bot.chat(message);

      this.bot.chat(
        `Request sent to ${charlieBot}! Waiting for token transfer...`
      );

      return {
        charlieBot,
        walletAddress,
        tokenAddress,
        amount,
      };
    } catch (error) {
      console.error("Failed to request tokens from CharlieBot:", error);
      this.bot.chat(
        `Failed to request tokens: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return null;
    }
  }
}
