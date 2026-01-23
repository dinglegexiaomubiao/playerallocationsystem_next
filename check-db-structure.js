const { Client } = require('pg');
const dbConfig = require('./lib/db');
const connectionString = dbConfig.connectionString;

async function checkTableStructure() {
  const client = new Client(connectionString);
  try {
    await client.connect();
    const result = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'players' ORDER BY ordinal_position;");
    console.log('Players表的列结构:');
    result.rows.forEach(row => {
      console.log(row.column_name + ': ' + row.data_type);
    });
  } catch (err) {
    console.error('查询表结构出错:', err);
  } finally {
    await client.end();
  }
}

checkTableStructure();