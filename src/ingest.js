const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { getCollection, connect } = require('./db');

function buildId(record) {
  return record._id || record.id || `${record.state_code}_${record.district_code}_${record.fin_year}_${record.month}`;
}

async function upsertRecord(record) {
  const col = await getCollection();
  const id = buildId(record);
  const doc = Object.assign({}, record, { id });
  await col.updateOne({ id }, { $set: doc }, { upsert: true });
  return id;
}


// Note: external data.gov.in ingestion is not used in this deployment.

async function ingestFromFile(file) {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const obj = JSON.parse(raw);
  await connect();
  if (Array.isArray(obj)) {
    for (const r of obj) await upsertRecord(r);
  } else {
    await upsertRecord(obj);
  }
  console.log('Ingested file', file);
}

if (require.main === module) {
  // simple CLI: --file=path
  const arg = process.argv.find((a) => a.startsWith('--file='));
  if (arg) {
    const file = arg.split('=')[1];
    ingestFromFile(file).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  } else {
    console.log('No file provided. Example usage: node ingest.js --file=./sample_data/sample_record.json');
  }
}

module.exports = { upsertRecord, ingestFromFile };
