const dxDbSync = require("../index");
const fs = require("fs");

async function testFunction() {
    const dataModel = fs.readFileSync('tests/example-data-model.json','utf-8');
    const dataBaseConfig = fs.readFileSync('tests/database-config.json','utf-8');
    const dbSync = new dxDbSync(JSON.parse(dataModel), JSON.parse(dataBaseConfig),"PascalCase");
    await dbSync.syncDatabase();
}

testFunction();