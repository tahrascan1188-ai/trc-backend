const { initDB, checkInstitutionLogin } = require('./config/google-sheets');

async function test() {
  await initDB();
  const tenant = await checkInstitutionLogin('admin', 'admin');
  console.log("Tenant found:", tenant);
}
test();
