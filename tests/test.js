const dxDbSync = require("../index");
const fs = require("fs");

const dbConfig = {
    "main": {
        "host": "localhost",
        "user": "dbuser",
        "password": "123",
        "database": "local_dx_db",
        "port": 3306,
        "ssl": false
    }
};

async function testFunction() {
    const dataModel = fs.readFileSync('tests/example-data-model.json','utf-8');
    const dbSync = new dxDbSync(JSON.parse(dataModel), dbConfig);
    await dbSync.syncDatabase();
}

testFunction();