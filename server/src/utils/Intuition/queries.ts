import { getGqlClient } from "./client.js";

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
  const response = await getTriples("primaryFunction", functionPattern);

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
