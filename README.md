# dx-db-sync

A tool that synchronises a given database with a provided Divblox data model. Used by divbloxjs to ensure that the underlying database corresponds to the given data model.

## Installation

`npm i dx-db-sync`

## Divblox Data models

A Divblox data model describes the data structure of your project in a json file. It is important to note that
the object is case-sensitive and that all keys and values must be provided in camelCase.
A clean Divblox project should always contain a "data-model.json" file that contains the base entity/entities for
your project. However, each additional Divblox package can also include its own data model which Divblox will add
to your project on startup.

The structure of a data model object is described below.

### Structure

#### Entities

The data model json file must contain an object, with the highest-level keys/properties being the names of "Entities".
Entities directly translate to database tables when the data model is synchronized with your database.

```
{
  "entityOne": {
    ...
  },
  "entityTwo": {
    ...
  },
  "entityThree": {
    ...
  },
  ...
}
```

#### Modules

Each entity must have a property called "module" that contains the name of the module in which this entity belongs.
Modules are essentially individual databases that the Divblox Data Layer will connect to. It is important to
know in which module an entity resides, in order to connect to the correct database when executing sql queries relating
to the specific entity.

**_Modules are defined in the dxconfig.json file that is used to instantiate your Divblox instance and connect to the
relevant database(s)_**

```
{
  "entityOne": {
    "module": "main"
    ...
  },
  "entityTwo": {
    "module": "secondary"
    ...
  },
  "entityThree": {
    "module": "main"
    ...
  },
  ...
}
```

#### Attributes

Each entity must have a property called "attributes". The value of this field must be an object containing each separate
attribute as a property. An attribute directly translates to a database table column when the data model is synchronized
with your database. Therefore, the value of each attribute property must be an object containing its configuration for
the database table.

```
{
  "entityOne": {
    ...
    "attributes": {
      "attributeOne": {
        "type": "A valid mysql database table type, e.g INT, VARCHAR, DATETIME, etc",
        "lengthOrValues": [null|string|int] "If column type is "enum" or "set", please enter the values using this format: 'a','b','c'",
        "default": [null|value|"CURRENT_TIMESTAMP"] "The default value for the column.",
        "allowNull": "Whether to allow null or not for the column"
      },
      "attributeTwo": {
        ...
      },
      "attributeThree": {
        ...
      },
      ...
    },
    ...
  },
  ...
}
```

#### Indexes

Each entity must have a property called "indexes". The value of this field must be an array of objects, each describing
an index to be added to the relevant database table. This array can optionally be left empty.

```
{
  "entityOne": {
    ...
    "indexes": [
      ...
      {
        "attribute": "The name of the attribute (The column name in the database) on which to add the index",
        "indexName": "The unique name of the index",
        "indexChoice": ["index"|"unique"|"spatial"|"text"],
        "type": ["BTREE"|"HASH"]
      }
      ...
    ],
    ...
  },
  ...
}
```

#### Relationships

Each entity must have a property called "relationships". The value of this field must be an object containing each
separate relationship entity as a property. An entity can have multiple relationships with another entity. Therefore,
each relationship is defined as an array containing the unique relationship name for the entity. This translates directly
to foreign key constraints and columns in the database.

```
{
  "entityOne": {
    ...
    "relationships": {
      "entityTwo":[
        "relationshipOne",
        "relationshipTwo",
        ...
      ],
      ...
    },
    ...
  },
  ...
}
```

#### Optional settings

Each entity must have a property called "options". The value of this field must be an object containing additional options
for the entity. The default options are:

-   "enforceLockingConstraints", which tells the Divblox database sync
    operation to add a column "lastUpdated" to the relevant database table. This column is used to apply and manage locking
    constraints when trying to update the relevant table.
-   "isAuditEnabled", which tells divbloxjs whether or not to audit interactions with this entity

Additional options can be added here if you want to implement your own functionality on your Divblox data model.

```
{
  "entityOne": {
    ...
    "options": {
      "enforceLockingConstraints": [true|false],
      "isAuditEnabled": [true|false]
    }
  }
}
```

### Example data model

Below is an example of a more complete, yet fictional data model:

```
{
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
        "default": "",
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
        "attribute": "exampleOneBigInt",
        "indexName": "exampleEntityOne_exampleOneBigInt",
        "indexChoice": "index",
        "type": "BTREE"
      },
      {
        "attribute": "exampleOneStringWithoutNull",
        "indexName": "exampleEntityOne_exampleOneStringWithoutNull",
        "indexChoice": "unique",
        "type": "BTREE"
      },
      {
        "attribute": "exampleOneText",
        "indexName": "exampleEntityOne_exampleOneText",
        "indexChoice": "fulltext",
        "type": "BTREE"
      }
    ],
    "relationships": {
    },
    "options": {
      "enforceLockingConstraints": true,
      "isAuditEnabled": true
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
        "attribute": "exampleTwoBigInt",
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
      "enforceLockingConstraints": false,
      "isAuditEnabled": true
    }
  }
}
```
