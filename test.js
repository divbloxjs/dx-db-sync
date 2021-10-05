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
            "entryTimeStamp": {
                "type": "datetime",
                "lengthOrValues": null,
                "default": "CURRENT_TIMESTAMP",
                "allowNull": true
            },
            "objectName": {
                "type": "varchar",
                "lengthOrValues": 50,
                "default": null,
                "allowNull": true
            },
            "modificationType": {
                "type": "varchar",
                "lengthOrValues": 15,
                "default": null,
                "allowNull": true
            },
            "userIdentifier": {
                "type": "varchar",
                "lengthOrValues": 150,
                "default": null,
                "allowNull": true
            },
            "objectId": {
                "type": "bigint",
                "lengthOrValues": 20,
                "default": null,
                "allowNull": true
            },
            "entryDetail": {
                "type": "text",
                "lengthOrValues": null,
                "default": null,
                "allowNull": true
            },
            "apiKey": {
                "type": "varchar",
                "lengthOrValues": 50,
                "default": null,
                "allowNull": true
            }
        },
        "indexes": [
            {
                "indexName": "auditLogEntry_objectId",
                "indexChoice": "index",
                "type": "BTREE"
            }
        ],
        "relationships": {
        },
        "options": {
            "enforceLockingConstraints": false
        }
    }
}
async function testFunction() {
    const dbSync = new dxDbSync(dataModel, dbConfig);
    await dbSync.syncDatabase();
}

testFunction();