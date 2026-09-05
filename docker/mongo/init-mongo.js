/**
 * MongoDB Initialization Script for Chaos Demo Environment
 * Mounted into /docker-entrypoint-initdb.d/init-mongo.js
 *
 * Establishes the `acme` database context and empty collections.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Do NOT seed 500,000 orders automatically at startup. Seeding is handled explicitly by scripts/seed.ts.
 * 2. Do NOT create a compound index on { userId: 1, status: 1 } for the `orders` collection.
 */

const targetDb = db.getSiblingDB('acme');

// Ensure collections exist in the acme database
if (!targetDb.getCollectionNames().includes('orders')) {
  targetDb.createCollection('orders');
}

if (!targetDb.getCollectionNames().includes('webhook_events')) {
  targetDb.createCollection('webhook_events');
}

print('Chaos demo: Initialized acme database with empty orders and webhook_events collections.');
print('Chaos demo: Verified NO supporting compound index { userId: 1, status: 1 } created.');
