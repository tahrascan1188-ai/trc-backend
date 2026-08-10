const { initDB } = require('./config/google-sheets');

async function testConnection() {
  console.log('Testing Google Sheets connection...');
  const doc = await initDB();
  if (doc) {
    console.log('✅ Connection successful!');
    console.log('Available sheets:', Object.keys(doc.sheetsByTitle));
  } else {
    console.log('❌ Connection failed.');
  }
}

testConnection();
