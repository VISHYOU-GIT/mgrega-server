/**
 * Backfill `id` field for documents in `state_district` collection where id is missing/null.
 * For safety the script will not overwrite existing ids and will log conflicts where computed id already exists.
 *
 * Usage: node ./scripts/backfill_ids.js
 */
const { MongoClient } = require('mongodb');
const { MONGODB_URI } = require('../src/config');

async function run() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set in environment');
  const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
  await client.connect();
  const db = client.db();
  const col = db.collection('state_district');

  const cursor = col.find({ $or: [{ id: { $exists: false } }, { id: null }] });
  let updated = 0;
  let conflicts = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const computed = `${doc.state_code || 's'}_${doc.district_code || 'd'}_${doc.fin_year || 'fy'}_${doc.month || 'm'}`;
    const existing = await col.findOne({ id: computed });
    if (existing) {
      console.warn('Conflict: computed id already exists for different doc. _id=', doc._id, 'computed=', computed);
      conflicts++;
      continue;
    }
    const r = await col.updateOne({ _id: doc._id }, { $set: { id: computed } });
    if (r.modifiedCount === 1) updated++;
  }

  console.log('Backfill complete. updated=', updated, 'conflicts=', conflicts);
  await client.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
