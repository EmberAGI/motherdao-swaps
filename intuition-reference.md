# Intuition Integration Reference

## Overview

This document provides a comprehensive reference for working with the Intuition protocol integration in the agent registration service.

## Configuration

The Intuition API is configured using the following environment variables:

- `INTUITION_API_URL`: The GraphQL API endpoint (defaults to environment-specific URLs)
  - Dev Base Sepolia: `https://dev.base-sepolia.intuition-api.com/v1/graphql`
  - Dev Base: `https://dev.base.intuition-api.com/v1/graphql`

## Core Components

### Client Setup

```typescript
import { configureClient, createServerClient } from '@0xintuition/graphql';
import { Multivault } from '@0xintuition/protocol';

// Initialize the client
configureClient({ apiUrl: config.intuitionApiUrl });
const gqlClient = createServerClient({});

// Initialize Multivault
const multiVault = new Multivault({
  publicClient,
  walletClient,
});
```

### Data Structures

- Intuition Docs: `https://tech.docs.intuition.systems/dev/graphql-examples#163450d37d068141bbf4e9392fd2970b`

#### Atoms

Atoms are the fundamental units in Intuition. They represent entities with the following structure:

```typescript
interface AtomResponse {
  atom: {
    // Basic Metadata
    data: string;
    id: string;
    image: string;
    label: string;
    emoji: string;
    type: string;

    // Creator Information
    creator: {
      id: string;
      label: string;
      image: string;
    };

    // Value Types
    value: {
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
    };

    // Blockchain Data
    block_number: number;
    block_timestamp: string;
    transaction_hash: string;
    creator_id: string;

    // Vault Information
    vault_id: string;
    wallet_id: string;
    vault: {
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
    };
  };
}
```

#### Triples

Triples represent relationships between atoms in the form of subject-predicate-object. Structure:

```typescript
interface TripleResponse {
  triples: Array<{
    id: string;

    // Subject, Predicate, and Object share the same structure
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
      value: {
        thing: {
          name: string;
          description: string;
        };
      };
    };
    predicate: {
      /* same structure as subject */
    };
    object: {
      /* same structure as subject */
    };

    // Transaction Data
    block_number: number;
    block_timestamp: string;
    transaction_hash: string;
    creator_id: string;

    // Vault Information
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
      /* same structure as vault */
    };
  }>;
}
```

## Core Operations

### Creating or Fetching Things

```typescript
async function createOrFetchThing(
  thing: Record<string, string | string[] | number>
): Promise<bigint>;
```

This function:

1. Pins the thing data to get a URI
2. Checks if an atom already exists for the URI
3. If not, creates a new atom
4. Returns the atom's vault ID

### Creating Triples

```typescript
async function createTriple(
  subjectId: bigint,
  predicateId: bigint,
  objectId: bigint
): Promise<bigint>;
```

Creates a relationship between three atoms. Returns 0n if the triple already exists.

### Querying Atoms

```typescript
async function getAtom(atomId: number): Promise<AtomResponse>;
```

Fetches detailed information about a specific atom by its ID.

### Querying Triples

```typescript
async function getTriples(
  predicateName: string,
  objectPattern: string
): Promise<TripleResponse>;
```

Searches for triples based on:

- Exact predicate name match
- Object name pattern (using SQL LIKE patterns)

## GraphQL Queries

### Get Atom Query

```graphql
query GetAtom($id: numeric!) {
  atom(id: $id) {
    # AtomMetadata fields
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
    # Transaction and vault details...
  }
}
```

### Get Triples Query

```graphql
query GetTriples($where: triples_bool_exp) {
  triples(where: $where) {
    # Triple metadata
    id
    subject { ... }
    predicate { ... }
    object { ... }
    # Transaction and vault details...
  }
}
```

## Best Practices

1. **Error Handling**: Triple creation handles duplicate triples gracefully by returning 0n
2. **Data Validation**: Always validate thing data before creation
3. **URI Management**: URIs are automatically generated and managed for things
4. **Vault Integration**: All atoms are associated with vaults for token economics
5. **Query Optimization**: Use specific queries with appropriate filters to minimize data transfer

## Common Use Cases

1. **Agent Registration**:

   ```typescript
   // Create agent atom
   const agentId = await createOrFetchThing({
     name: 'Agent Name',
     type: 'agent',
     // ... other properties
   });

   // Link agent to capabilities
   const capabilityId = await createOrFetchThing({
     name: 'Capability Name',
     type: 'capability',
   });

   await createTriple(agentId, predicateId, capabilityId);
   ```

2. **Relationship Queries**:
   ```typescript
   // Find all agents with specific capability
   const triples = await getTriples('hasCapability', 'specific-capability');
   const agents = triples.triples.map((t) => t.subject);
   ```
