/**
 * MongoDB Initialization Script for Chaos Demo Environment
 * Mounted into /docker-entrypoint-initdb.d/init-mongo.js
 */

const targetDb = db.getSiblingDB('acme');

// Future collections:
// - orders
// - webhook_events
// Collections will be initialized and indexed by subsequent tasks and seeding scripts.

print('Chaos demo: Initialized acme database.');
