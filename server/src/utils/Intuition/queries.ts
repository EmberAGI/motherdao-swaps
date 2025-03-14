import { getGqlClient } from "./client.js";

export interface EventQuery {
  location?: string;
  time?: string;
  date_range_start?: string;
  date_range_end?: string;
  time_of_day?: string;
  time_range_start?: string;
  time_range_end?: string;
  event_type?: string;
  category?: string;
  subcategory?: string;
  attendees?: number | null;
  accessibility?: string;
  keywords?: string[];
  preferences?: string[];
  exclusions?: string[];
  format?: string;
  duration?: string;
  language?: string;
  original_query?: string;
}

// Type definitions based on Intuition's GraphQL schema
export interface AtomValue {
  person?: {
    name: string;
    image: string;
    description: string;
    url: string;
  };
  thing?: {
    name: string;
    image: string;
    description: string;
    url: string;
  };
  organization?: {
    name: string;
    image: string;
    description: string;
    url: string;
  };
}

export interface AtomCreator {
  id: string;
  label: string;
  image: string;
}

export interface AtomVault {
  position_count: number;
  total_shares: string;
  current_share_price: string;
  positions_aggregate: {
    aggregate: {
      count: number;
      sum: {
        shares: string;
      };
    };
  };
}

export interface Atom {
  data: string;
  id: string;
  image: string;
  label: string;
  emoji: string;
  type: string;
  creator: AtomCreator;
  value: AtomValue;
  block_number: number;
  block_timestamp: string;
  transaction_hash: string;
  creator_id: string;
  vault_id: string;
  wallet_id: string;
  vault: AtomVault;
}

export interface AtomResponse {
  atom: Atom;
}

// Triple related interfaces
export interface Triple {
  id: string;
  subject: {
    data: string;
    id: string;
    image: string;
    label: string;
    emoji: string;
    type: string;
    creator: {
      label: string;
      image: string;
      id: string;
      atom_id: string;
      type: string;
    };
    value: AtomValue;
  };
  predicate: {
    data: string;
    id: string;
    image: string;
    label: string;
    emoji: string;
    type: string;
    creator: {
      label: string;
      image: string;
      id: string;
      atom_id: string;
      type: string;
    };
    value: AtomValue;
  };
  object: {
    data: string;
    id: string;
    image: string;
    label: string;
    emoji: string;
    type: string;
    creator: {
      label: string;
      image: string;
      id: string;
      atom_id: string;
      type: string;
    };
    value: AtomValue;
  };
  block_number: number;
  block_timestamp: string;
  transaction_hash: string;
  creator_id: string;
  vault_id: string;
  counter_vault_id: string;
  vault: {
    id: string;
    total_shares: string;
    current_share_price: string;
    position_count: number;
    atom: {
      id: string;
      label: string;
    };
  };
  counter_vault: {
    id: string;
    total_shares: string;
    current_share_price: string;
    position_count: number;
    atom: {
      id: string;
      label: string;
    };
  };
}

export interface TripleResponse {
  triples: Triple[];
}

/**
 * Represents an agent with their relevant information
 */
export interface AgentInfo {
  id: string;
  name: string;
  label: string;
  image?: string;
  description?: string;
  primaryFunction?: string;
  type: string;
}

/**
 * Extracts agent information from a triple where the agent is the subject
 * @param triple - The triple containing agent information
 * @returns AgentInfo object with relevant agent details
 */
function extractAgentFromTriple(triple: Triple): AgentInfo {
  const subject = triple.subject;
  const object = triple.object;

  return {
    id: subject.id,
    name: subject.value.thing?.name || subject.label,
    label: subject.label,
    image: subject.image,
    description: subject.value.thing?.description,
    primaryFunction: object.value.thing?.name || object.label,
    type: subject.type,
  };
}

/**
 * Finds agents based on their primary function matching a pattern
 * @param functionPattern - Pattern to match against primary functions (e.g., '%villain%')
 * @returns Promise resolving to array of matching agents
 */
export async function findAgentsByFunction(
  functionPattern: string
): Promise<AgentInfo[]> {
  const response = await getTriples("hasRole", functionPattern);

  // Filter out duplicates by agent ID
  const uniqueAgents = new Map<string, AgentInfo>();

  response.triples.forEach((triple) => {
    const agentInfo = extractAgentFromTriple(triple);
    if (!uniqueAgents.has(agentInfo.id)) {
      uniqueAgents.set(agentInfo.id, agentInfo);
    }
  });

  return Array.from(uniqueAgents.values());
}

/**
 * Finds agents who handle specific types of cases/situations
 * @param situation - The situation/case type to search for (e.g., 'villain', 'cybercrime')
 * @returns Promise resolving to array of relevant agents
 */
export async function findRelevantAgents(
  situation: string
): Promise<AgentInfo[]> {
  // Search for agents whose primary function involves handling the situation
  const directMatches = await findAgentsByFunction(`%${situation}%`);

  // Could expand this to include other relevant triples/relationships
  // For example, agents with related skills or experience

  return directMatches;
}

/**
 * Groups agents by their primary functions
 * @param agents - Array of agent information
 * @returns Map of function to array of agents
 */
export function groupAgentsByFunction(
  agents: AgentInfo[]
): Map<string, AgentInfo[]> {
  const groupedAgents = new Map<string, AgentInfo[]>();

  agents.forEach((agent) => {
    const func = agent.primaryFunction || "unknown";
    if (!groupedAgents.has(func)) {
      groupedAgents.set(func, []);
    }
    groupedAgents.get(func)?.push(agent);
  });

  return groupedAgents;
}

/**
 * Fetches detailed information about a specific atom by its ID
 * @param atomId - The numeric ID of the atom to fetch
 * @returns Promise resolving to the atom data
 */
export async function getAtom(atomId: number): Promise<AtomResponse> {
  const client = getGqlClient();

  const query = `
    query GetAtom($id: numeric!) {
      atom(id: $id) {
        data
        id
        image
        label
        emoji
        type
        creator {
          id
          label
          image
        }
        value {
          person {
            name
            image
            description
            url
          }
          thing {
            name
            image
            description
            url
          }
          organization {
            name
            image
            description
            url
          }
        }
        block_number
        block_timestamp
        transaction_hash
        creator_id
        vault_id
        wallet_id
        vault {
          position_count
          total_shares
          current_share_price
          positions_aggregate {
            aggregate {
              count
              sum {
                shares
              }
            }
          }
        }
      }
    }
  `;

  const response = await client.request<AtomResponse>(query, { id: atomId });
  console.log("atom response: ", response);
  return response;
}

/**
 * Fetches triples where the predicate name matches exactly and object name matches a pattern
 * @param predicateName - Exact name of the predicate to match (e.g. 'primaryFunction')
 * @param objectPattern - SQL LIKE pattern to match against object names (e.g. '%politician%')
 * @returns Promise resolving to matching triples
 */
export async function getTriples(
  predicateName: string,
  objectPattern: string
): Promise<TripleResponse> {
  const client = getGqlClient();

  const query = `
    query GetTriples($where: triples_bool_exp!) {
      triples(where: $where) {
        id
        subject {
          data
          id
          image
          label
          emoji
          type
          creator {
            label
            image
            id
            atom_id
            type
          }
          value {
            person {
              name
              image
              description
              url
            }
            thing {
              name
              image
              description
              url
            }
            organization {
              name
              image
              description
              url
            }
          }
        }
        predicate {
          data
          id
          image
          label
          emoji
          type
          creator {
            label
            image
            id
            atom_id
            type
          }
          value {
            person {
              name
              image
              description
              url
            }
            thing {
              name
              image
              description
              url
            }
            organization {
              name
              image
              description
              url
            }
          }
        }
        object {
          data
          id
          image
          label
          emoji
          type
          creator {
            label
            image
            id
            atom_id
            type
          }
          value {
            person {
              name
              image
              description
              url
            }
            thing {
              name
              image
              description
              url
            }
            organization {
              name
              image
              description
              url
            }
          }
        }
        block_number
        block_timestamp
        transaction_hash
        creator_id
        vault_id
        counter_vault_id
        vault {
          id
          total_shares
          current_share_price
          position_count
          atom {
            id
            label
          }
        }
        counter_vault {
          id
          total_shares
          current_share_price
          position_count
          atom {
            id
            label
          }
        }
      }
    }
  `;

  const variables = {
    where: {
      predicate: {
        value: {
          thing: {
            name: { _eq: predicateName },
          },
        },
      },
      object: {
        value: {
          thing: {
            name: { _ilike: objectPattern },
          },
        },
      },
    },
  };

  const response = await client.request<TripleResponse>(query, variables);
  return response;
}

export interface AgentNeverminedIds {
  agentId?: string;
  planId?: string;
  name: string;
  description?: string;
  allTriples: Triple[];
}

/**
 * Fetches all triples related to an agent by name, including Nevermined IDs
 * @param agentName - The name of the agent to search for
 * @returns Promise resolving to agent's Nevermined IDs and all related triples
 */
export async function getAgentNeverminedData(
  agentName: string
): Promise<AgentNeverminedIds> {
  const client = getGqlClient();

  // First, find the agent atom by name
  const query = `
    query GetTriples($where: triples_bool_exp!) {
      triples(where: $where) {
        id
        subject {
          data
          id
          image
          label
          emoji
          type
          creator {
            label
            image
            id
            atom_id
            type
          }
          value {
            thing {
              name
              description
            }
          }
        }
        predicate {
          data
          id
          label
          type
          value {
            thing {
              name
            }
          }
        }
        object {
          data
          id
          label
          type
          value {
            thing {
              name
              description
            }
          }
        }
      }
    }
  `;

  // Find all triples where the agent is the subject
  const variables = {
    where: {
      subject: {
        value: {
          thing: {
            name: { _eq: agentName },
          },
        },
      },
    },
  };

  const response = await client.request<TripleResponse>(query, variables);
  const triples = response.triples;

  // Initialize result
  const result: AgentNeverminedIds = {
    name: agentName,
    allTriples: triples,
  };

  // Extract relevant information from triples
  triples.forEach((triple) => {
    const predicateName = triple.predicate.value.thing?.name;

    // Set description if found
    if (!result.description && triple.subject.value.thing?.description) {
      result.description = triple.subject.value.thing.description;
    }

    // Look for Nevermined-specific predicates
    switch (predicateName) {
      case "neverminedAgentId":
        result.agentId = triple.object.value.thing?.name;
        break;
      case "neverminedPlanId":
        result.planId = triple.object.value.thing?.name;
        break;
    }
  });

  console.log("result: ", result);

  return result;
}

// Example usage:
// const agentData = await getAgentNeverminedData("Alice");
// console.log("Nevermined Agent ID:", agentData.agentId);
// console.log("Nevermined Plan ID:", agentData.planId);
// console.log("All triples:", agentData.allTriples);

/**
 * Interface for structured event data
 */
export interface EventInfo {
  name: string;
  url?: string;
  description?: string;
  location?: string;
  date?: string;
  time?: string;
  category?: string;
  hosted_by?: string;
}

interface ParsedTime {
  start: string;
  end?: string;
  timezone?: string;
}

function parseEventTime(timeStr: string): ParsedTime | undefined {
  if (!timeStr || timeStr === "Not specified") return undefined;

  // Remove any extra whitespace
  timeStr = timeStr.trim();

  // Split into parts (time and timezone)
  const [times, timezone = "MST"] = timeStr.split(" MST");

  // Split start and end times
  const [startTime, endTime] = times.split(" - ").map((t) => t.trim());

  return {
    start: startTime,
    ...(endTime && { end: endTime }),
    timezone,
  };
}

interface EventTripleResponse {
  triples: Array<{
    subject: {
      label: string;
      value: {
        thing: {
          name: string;
          url: string;
          description: string;
        };
      };
    };
  }>;
}

/**
 * Fetches and formats ETH Denver events from Intuition
 * @returns Promise resolving to array of event names and URLs
 */
export async function getEthDenverSideEventTriples(
  query?: EventQuery
): Promise<EventInfo[]> {
  const client = getGqlClient();

  console.log("Incoming query parameters:", JSON.stringify(query, null, 2));

  interface DescriptionFilter {
    _is_null?: boolean;
    _ilike?: string;
  }

  // Build dynamic where conditions based on query parameters
  const whereConditions = {
    _and: [
      {
        object_id: {
          _eq: "16361",
        },
      },
      {
        subject: {
          value: {
            thing: {
              description: { _is_null: false } as DescriptionFilter,
            },
          },
        },
      },
    ],
  };

  // Add date filter if provided
  if (query?.date_range_start) {
    console.log("Adding date filter for:", query.date_range_start);

    // Parse the date from yyyy-mm-dd format
    const [year, month, day] = query.date_range_start.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const monthName = dateObj.toLocaleString("en-US", { month: "long" });

    whereConditions._and.push({
      subject: {
        value: {
          thing: {
            description: {
              _ilike: `%date:${monthName} ${day}%`,
            },
          },
        },
      },
    });
  }

  console.log(
    "Final where conditions:",
    JSON.stringify(whereConditions, null, 2)
  );

  const gqlQuery = `query FindAtoms($where: triples_bool_exp) {
    triples(
      where: $where,
      limit: 5,
      order_by: { block_timestamp: desc }
    ) {
      subject {
        label
        value {
          thing {
            name
            url
            description
          }
        }
      }
    }
  }`;

  console.log("Executing GraphQL query with variables:", {
    where: whereConditions,
  });

  try {
    const response = await client.request<EventTripleResponse>(gqlQuery, {
      where: whereConditions,
    });

    console.log("GraphQL response:", JSON.stringify(response, null, 2));

    if (!response.triples! || response.triples.length === 0) {
      console.log("No events found in response");
      return [];
    }

    const mappedResults = response.triples.map((triple) => {
      const thing = triple.subject.value.thing;

      // Parse the structured description
      const descriptionParts = thing.description.split(";").reduce(
        (acc, part) => {
          const [key, value = ""] = part.split(":").map((s) => s.trim());
          // Remove any markdown formatting from description
          if (key === "description") {
            acc[key] = value.replace(/\*\*/g, "").replace(/\[|\]/g, "");
          } else {
            acc[key] = value;
          }
          return acc;
        },
        {} as Record<string, string>
      );

      // Parse the time
      const parsedTime = parseEventTime(descriptionParts.time);
      const formattedTime = parsedTime
        ? `${parsedTime.start}${parsedTime.end ? ` - ${parsedTime.end}` : ""} ${parsedTime.timezone}`
        : undefined;

      // Process URL - only include if it's a complete URL
      const url = thing.url.startsWith("http") ? thing.url : undefined;

      // Local filtering can be added here for other criteria
      return {
        name: thing.name || triple.subject.label,
        ...(url && { url }), // Only include url if it's valid
        description: descriptionParts.description,
        location: descriptionParts.location,
        date: descriptionParts.date,
        time: formattedTime,
        category: descriptionParts.category,
        hosted_by: descriptionParts.hosted_by,
      };
    });

    console.log("Mapped results:", JSON.stringify(mappedResults, null, 2));
    return mappedResults;
  } catch (error) {
    console.error("GraphQL query error:", error);
    throw error;
  }
}

interface MerchantAgentOutput {
  [key: string]: {
    agentDID: string;
    paymentPlanDID: string;
    role: string;
  };
}

/**
 * Fetches merchant agents from Intuition's data graph with their Nevermined DIDs
 * @returns Promise resolving to object mapping agent names to their DID information
 */
export async function getMerchantAgents(): Promise<MerchantAgentOutput> {
  try {
    console.log("Fetching merchant roles...");
    const merchantResponse = await getTriples("hasRole", "merchant");
    // console.log(`Found ${merchantResponse.triples.length} merchant roles`);

    console.log("Fetching agent DIDs...");
    const agentDIDResponse = await getTriples("neverminedAgentId", "%");
    // console.log(`Found ${agentDIDResponse.triples.length} agent DIDs`);

    console.log("Fetching plan DIDs...");
    const planDIDResponse = await getTriples("neverminedPlanId", "%");
    // console.log(`Found ${planDIDResponse.triples.length} plan DIDs`);

    // Group triples by agent name
    const agentData = new Map<
      string,
      {
        agentDID?: string;
        paymentPlanDID?: string;
        role?: string;
      }
    >();

    // Process merchant roles
    merchantResponse.triples.forEach((triple) => {
      const agentName = triple.subject.value.thing?.name;
      if (!agentName) return;

      if (!agentData.has(agentName)) {
        agentData.set(agentName, {});
      }
      const data = agentData.get(agentName)!;
      data.role = "merchant";
    });

    // Process agent DIDs
    agentDIDResponse.triples.forEach((triple) => {
      const agentName = triple.subject.value.thing?.name;
      const agentDID = triple.object.value.thing?.name;
      if (!agentName || !agentDID) return;

      if (!agentData.has(agentName)) {
        agentData.set(agentName, {});
      }
      const data = agentData.get(agentName)!;
      data.agentDID = agentDID;
    });

    // Process plan DIDs
    planDIDResponse.triples.forEach((triple) => {
      const agentName = triple.subject.value.thing?.name;
      const planDID = triple.object.value.thing?.name;
      if (!agentName || !planDID) return;

      if (!agentData.has(agentName)) {
        agentData.set(agentName, {});
      }
      const data = agentData.get(agentName)!;
      data.paymentPlanDID = planDID;
    });

    // Convert Map to the required output format
    const output: MerchantAgentOutput = {};
    agentData.forEach((data, agentName) => {
      if (data.role === "merchant" && data.agentDID && data.paymentPlanDID) {
        output[agentName] = {
          agentDID: data.agentDID,
          paymentPlanDID: data.paymentPlanDID,
          role: "merchant",
        };
      } else {
        console.log(`Incomplete data for agent ${agentName}:`, {
          role: data.role,
          hasAgentDID: !!data.agentDID,
          hasPlanDID: !!data.paymentPlanDID,
        });
      }
    });

    console.log("Final output:", output);
    return output;
  } catch (error) {
    console.error("Error in getMerchantAgents:", error);
    throw error;
  }
}

/**
 * Interface for agent's Nevermined identifiers
 */
interface AgentNeverminedIdentifiers {
  agentDID: string | null;
  planDID: string | null;
  testTokenPlanDID: string | null;
  error?: string;
}

/**
 * Fetches an agent's Nevermined DIDs (both agent DID and plan DID) from Intuition
 * @param agentName - The name of the agent to fetch DIDs for
 * @returns Promise resolving to the agent's DIDs or error
 */
export async function getAgentDIDs(
  agentName: string
): Promise<AgentNeverminedIdentifiers> {
  try {
    console.log(`[Intuition] Fetching DIDs for agent: ${agentName}`);

    // Fetch agent DID
    const agentDIDResponse = await getTriples("neverminedAgentId", "%");
    // Get all matching triples and take the last one
    const matchingAgentTriples = agentDIDResponse.triples.filter(
      (triple) => triple.subject.value.thing?.name === agentName
    );

    const agentDIDTriple =
      matchingAgentTriples.length > 0
        ? matchingAgentTriples[matchingAgentTriples.length - 1]
        : undefined;

    // Fetch plan DID
    const planDIDResponse = await getTriples("neverminedPlanId", "%");
    console.log(
      `[Intuition] Found ${planDIDResponse.triples.length} total plan DID triples`
    );

    // Get all matching triples and take the last one
    const matchingPlanTriples = planDIDResponse.triples.filter(
      (triple) => triple.subject.value.thing?.name === agentName
    );

    const planDIDTriple =
      matchingPlanTriples.length > 0
        ? matchingPlanTriples[matchingPlanTriples.length - 1]
        : undefined;

    // Fetch test token plan DID
    const testTokenPlanDIDResponse = await getTriples(
      "neverminedPlanIdTestToken",
      "%"
    );
    // Get all matching triples and take the last one
    const matchingTestTokenTriples = testTokenPlanDIDResponse.triples.filter(
      (triple) => triple.subject.value.thing?.name === agentName
    );

    const testTokenPlanDIDTriple =
      matchingTestTokenTriples.length > 0
        ? matchingTestTokenTriples[matchingTestTokenTriples.length - 1]
        : undefined;

    if (!agentDIDTriple && !planDIDTriple && !testTokenPlanDIDTriple) {
      console.log(`[Intuition] No DIDs found for agent: ${agentName}`);
      return {
        agentDID: null,
        planDID: null,
        testTokenPlanDID: null,
        error: `No DIDs found for agent: ${agentName}`,
      };
    }

    const result = {
      agentDID: agentDIDTriple?.object.value.thing?.name || null,
      planDID: planDIDTriple?.object.value.thing?.name || null,
      testTokenPlanDID:
        testTokenPlanDIDTriple?.object.value.thing?.name || null,
    };

    console.log(`[Intuition] Final DIDs for ${agentName}:`, result);
    return result;
  } catch (error) {
    console.error(
      `[Intuition] Error fetching DIDs for agent ${agentName}:`,
      error
    );
    return {
      agentDID: null,
      planDID: null,
      testTokenPlanDID: null,
      error: error instanceof Error ? error.message : "Unknown error occurred",
    };
  }
}

// Example usage:
// const dids = await getAgentDIDs("AgentName");
// if (dids.error) {
//   console.error(dids.error);
// } else {
//   console.log("Agent DID:", dids.agentDID);
//   console.log("Plan DID:", dids.planDID);
// }
