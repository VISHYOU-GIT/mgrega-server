const { MongoClient } = require('mongodb');
const { MONGODB_URI } = require('./config');

if (!MONGODB_URI) {
  console.error('Please set MONGODB_URI in your .env (MongoDB Atlas connection string).');
  // don't exit here to allow local dev, but operations will fail clearly
}

let client = null;
let db = null;

async function connect() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set. Please set it in .env (MongoDB Atlas connection string)');
  if (client && db) return { client, db };
  client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  await client.connect();
  db = client.db();
  // ensure collection and indexes
  const colName = 'state_district';
  const col = db.collection(colName);
  try {
    // create a unique index on `id` only for documents that have an `id` field
    // this avoids failures when existing documents are missing `id` (null duplicates)
    await col.createIndex({ id: 1 }, { unique: true, partialFilterExpression: { id: { $exists: true } }, background: true });
  } catch (err) {
    console.warn('Could not create unique index on id (maybe duplicates exist):', err.message || err);
  }
  try {
    await col.createIndex({ state_code: 1, district_code: 1 }, { background: true });
  } catch (err) {
    console.warn('Could not create index on state_code,district_code:', err.message || err);
  }
  return { client, db };
}

async function getCollection() {
  if (!db) await connect();
  return db.collection('state_district');
}

async function close() {
  if (client) await client.close();
  client = null; db = null;
}

module.exports = { connect, getCollection, close };
// MongoDB-based DB module. Exports: connect, getCollection, close
