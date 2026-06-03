/**
 * DynamoDB Client - Singleton DynamoDB Document Client for the API service.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let clientInstance: DynamoDBDocumentClient | null = null;

export function getDynamoClient(): DynamoDBDocumentClient {
  if (!clientInstance) {
    const ddbClient = new DynamoDBClient({});
    clientInstance = DynamoDBDocumentClient.from(ddbClient);
  }
  return clientInstance;
}

export function setDynamoClient(client: DynamoDBDocumentClient): void {
  clientInstance = client;
}
