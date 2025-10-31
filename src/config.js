const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  PORT: process.env.PORT || 3000,
  // DATA API settings removed — this deployment does not use data.gov.in directly
  MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI || null,
  SQLITE_FILE: process.env.SQLITE_FILE || path.join(__dirname, '..', 'data', 'mgnrega.db'),
  REDIS_URL: process.env.REDIS_URL || null,
};

module.exports = config;
