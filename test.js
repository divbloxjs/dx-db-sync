const dxDbSync = require("./index");

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

const dataModel = {
    "auditLogEntry": {
        "module": "main",
        "attributes": {
            "entryTimeStamp": "datetime",
            "objectName": "varchar(50)",
            "modificationType": "varchar(15)",
            "userIdentifier": "varchar(150)",
            "objectId": "bigint",
            "entryDetail": "text",
            "apiKey": "varchar(50)"
        },
        "relationships": {
        }
    }
}
async function testFunction() {
    const dbSync = new dxDbSync(dataModel, dbConfig);
    await dbSync.syncDatabase();
}

testFunction();