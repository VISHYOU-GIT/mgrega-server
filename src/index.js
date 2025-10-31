const express = require('express');
const bodyParser = require('body-parser');
const { connect, getCollection } = require('./db');
const { PORT } = require('./config');
const fs = require('fs');
const path = require('path');
const SAMPLE_FILE = path.join(__dirname, '..', 'sample_data', 'sample_record.json');

const app = express();

// CORS middleware - Allow all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(bodyParser.json({ limit: '1mb' }));

app.get('/', (req, res) => res.json({ ok: true, service: 'mgnrega-districts' }));

// Health check endpoint for Render
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Get a district record by state/district and optional month/fin_year
app.get('/district/:stateCode/:districtCode', async (req, res) => {
  const { stateCode, districtCode } = req.params;
  const { month, fin_year } = req.query;
  try {
    await connect();
    const col = await getCollection();
    const filter = { state_code: Number(stateCode), district_code: Number(districtCode) };
    if (month) filter.month = month;
    if (fin_year) filter.fin_year = fin_year;
    const docs = await col.find(filter).sort({ created_at: -1 }).limit(24).toArray();
    res.json({ count: docs.length, data: docs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// List districts for a state
app.get('/districts/:stateCode', async (req, res) => {
  const { stateCode } = req.params;
  try {
    await connect();
    const col = await getCollection();
    const pipeline = [
      { $match: { state_code: Number(stateCode) } },
      { $group: { _id: { district_code: '$district_code', district_name: '$district_name' } } },
      { $project: { district_code: '$_id.district_code', district_name: '$_id.district_name', _id: 0 } },
      { $sort: { district_name: 1 } }
    ];
    const list = await col.aggregate(pipeline).toArray();
    if (!list || list.length === 0) {
      // fallback to sample data if present (demo mode)
      try {
        const raw = fs.readFileSync(SAMPLE_FILE, 'utf8');
        const sample = JSON.parse(raw);
        if (Number(sample.state_code) === Number(stateCode)) {
          return res.json({ count: 1, data: [{ district_code: sample.district_code, district_name: sample.district_name, demo: true }] });
        }
      } catch (err) {
        // ignore and return not found
      }
      return res.status(404).json({ count: 0, data: [], message: `No districts found for state_code=${stateCode}. Try GET /states to see available states.` });
    }
    res.json({ count: list.length, data: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// List all states available in the collection
app.get('/states', async (req, res) => {
  try {
    await connect();
    const col = await getCollection();
    const pipeline = [
      { $group: { _id: { state_code: '$state_code', state_name: '$state_name' } } },
      { $project: { state_code: '$_id.state_code', state_name: '$_id.state_name', _id: 0 } },
      { $sort: { state_name: 1 } }
    ];
    let list = await col.aggregate(pipeline).toArray();
    if (!list || list.length === 0) {
      // fallback to sample data if present (demo mode)
      try {
        const raw = fs.readFileSync(SAMPLE_FILE, 'utf8');
        const sample = JSON.parse(raw);
        list = [{ state_code: sample.state_code, state_name: sample.state_name, demo: true }];
      } catch (err) {
        // ignore and return empty
      }
    }
    res.json({ count: list.length, data: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// NOTE: ingestion endpoint removed for this deployment. Use CLI ingestion (npm run ingest-sample)

// whoami - accepts lat/lon, reverse-geocodes to district/state, and returns all records for that district
app.get('/whoami', async (req, res) => {
  const { lat, lon, lang } = req.query;
  if (!lat || !lon) return res.status(400).json({ error: 'Provide lat and lon' });

  try {
    // call Nominatim reverse geocode
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`;
    const headers = { 'User-Agent': 'mgnrega-districts-demo/1.0 (contact: none)', Accept: 'application/json' };
    if (lang) headers['Accept-Language'] = lang;
    const fetch = require('node-fetch');
    const r = await fetch(url, { headers, timeout: 10000 });
    if (!r.ok) return res.status(502).json({ error: 'Reverse geocode failed', status: r.status });
    const body = await r.json();
    const addr = body.address || {};

    // Nominatim may populate district in different fields; try common ones
    const districtName = addr.city || addr.county || addr.state_district || addr.town || addr.village || null;
    const stateName = addr.state || addr.region || null;

    if (!districtName && !stateName) {
      return res.status(404).json({ error: 'Could not determine district or state from coordinates', address: addr });
    }

    // query DB for matching district records
    await connect();
    const col = await getCollection();

    function escRegex(s){ return s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'); }

    const filters = [];
    if (districtName) filters.push({ district_name: { $regex: `^${escRegex(districtName)}$`, $options: 'i' } });
    if (stateName) filters.push({ state_name: { $regex: `^${escRegex(stateName)}$`, $options: 'i' } });

    let query = {};
    if (filters.length === 1) query = filters[0];
    else if (filters.length > 1) query = { $and: filters };

    const records = await col.find(query).sort({ created_at: -1 }).limit(200).toArray();

    if (!records || records.length === 0) {
      return res.status(404).json({ message: 'No records found for detected place', detected: { district: districtName, state: stateName }, address: addr });
    }

    // build a simple timeseries grouped by fin_year+month (latest first)
    const timeseries = records.map(r => ({ fin_year: r.fin_year, month: r.month, payload: r }));

    res.json({ ok: true, detected: { district: districtName, state: stateName }, count: records.length, timeseries, records });
  } catch (e) {
    console.error('whoami error', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
