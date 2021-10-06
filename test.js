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
    "exampleEntityOne": {
        "module": "main",
        "attributes": {
            "exampleOneTimeStamp": {
                "type": "datetime",
                "lengthOrValues": null,
                "default": "CURRENT_TIMESTAMP",
                "allowNull": true
            },
            "exampleOneStringWithNull": {
                "type": "varchar",
                "lengthOrValues": 50,
                "default": null,
                "allowNull": true
            },
            "exampleOneStringWithoutNull": {
                "type": "varchar",
                "lengthOrValues": 15,
                "default": null,
                "allowNull": false
            },
            "exampleOneBigInt": {
                "type": "bigint",
                "lengthOrValues": 20,
                "default": null,
                "allowNull": true
            },
            "exampleOneText": {
                "type": "text",
                "lengthOrValues": null,
                "default": null,
                "allowNull": true
            }
        },
        "indexes": [
            {
                "indexName": "exampleEntityOne_exampleOneBigInt",
                "indexChoice": "index",
                "type": "BTREE"
            }
        ],
        "relationships": {
        },
        "options": {
            "enforceLockingConstraints": true
        }
    },
    "exampleEntityTwo": {
        "module": "main",
        "attributes": {
            "exampleTwoTimeStamp": {
                "type": "datetime",
                "lengthOrValues": null,
                "default": "CURRENT_TIMESTAMP",
                "allowNull": true
            },
            "exampleTwoStringWithNull": {
                "type": "varchar",
                "lengthOrValues": 50,
                "default": null,
                "allowNull": true
            },
            "exampleTwoStringWithoutNull": {
                "type": "varchar",
                "lengthOrValues": 15,
                "default": null,
                "allowNull": false
            },
            "exampleTwoBigInt": {
                "type": "bigint",
                "lengthOrValues": 20,
                "default": null,
                "allowNull": true
            },
            "exampleTwoText": {
                "type": "text",
                "lengthOrValues": null,
                "default": null,
                "allowNull": true
            }
        },
        "indexes": [
            {
                "indexName": "exampleEntityTwo_exampleTwoBigInt",
                "indexChoice": "index",
                "type": "BTREE"
            }
        ],
        "relationships": {
            "exampleEntityOne":[
                "relationshipOne",
                "relationshipTwo"
            ]
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