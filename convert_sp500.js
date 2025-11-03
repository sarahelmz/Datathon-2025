const path = require('path');
const fs = require('fs/promises');
const csv = require('csvtojson');

const INPUT_FILE = '2025-08-15_composition_sp500.csv';
const OUTPUT_FILE = 'companies.json';

const nameKeys = ['Name', 'Company', 'Company Name'];
const tickerKeys = ['Ticker', 'Symbol', 'Code'];
const popularityKeys = ['Weight', 'Weight (%)', 'Holding Weight', 'Popularity', 'Score'];

const stripNumber = (value) =>
  value?.toString().replace(/[%,$\s]/g, '') ?? '';

const pickFirstMatch = (row, candidates) =>
  candidates.find((key) => key in row && row[key] !== '');

(async () => {
  try {
    const csvPath = path.join(__dirname, INPUT_FILE);
    const rows = await csv().fromFile(csvPath);

    if (!rows.length) {
      throw new Error('CSV file is empty.');
    }

    const numericColumns = Object.keys(rows[0]).filter((key) =>
      rows.some((row) => {
        const stripped = stripNumber(row[key]);
        return stripped !== '' && !Number.isNaN(Number.parseFloat(stripped));
      })
    );

    const cleaned = rows
      .map((row) => {
        const nameKey = pickFirstMatch(row, nameKeys);
        const tickerKey = pickFirstMatch(row, tickerKeys);
        let popularityKey = pickFirstMatch(row, popularityKeys);

        if (!popularityKey) {
          popularityKey = numericColumns.find(
            (key) => key !== nameKey && key !== tickerKey
          );
        }

        const entry = {};
        if (nameKey) entry.name = row[nameKey];
        if (tickerKey) entry.ticker = row[tickerKey];

        if (popularityKey) {
          const numeric = Number.parseFloat(stripNumber(row[popularityKey]));
          if (!Number.isNaN(numeric)) {
            entry.popularity = numeric;
          }
        }

        return Object.keys(entry).length ? entry : null;
      })
      .filter(Boolean);

    const outputPath = path.join(__dirname, OUTPUT_FILE);
    await fs.writeFile(outputPath, JSON.stringify(cleaned, null, 2), 'utf8');
    console.log('companies.json created');
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
})();
