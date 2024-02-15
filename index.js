const { createHash } = await import("node:crypto");
import {
    getCamelCaseSplittedToLowerCase,
    convertLowerCaseToCamelCase,
    convertLowerCaseToPascalCase,
} from "dx-utilities";
import mysql from "mysql2/promise";
import {
    outputFormattedLog,
    commandLineColors,
    commandLineFormats,
    getCommandLineInput,
    printErrorMessage,
} from "dx-cli-tools/helpers.js";

const DB_IMPLEMENTATION_TYPES = { snakecase: "snakecase", pascalcase: "pascalcase", camelcase: "camelcase" };
const commandLineHeadingFormatting = commandLineColors.foregroundCyan + commandLineColors.bright;
const commandLineSubHeadingFormatting = commandLineColors.foregroundCyan + commandLineColors.dim;
const commandLineWarningFormatting = commandLineColors.foregroundYellow;
/**
 * @typedef {Object} DB_CONFIG_SSL_OPTIONS
 * @property {string} ca The path to the SSL ca
 * @property {string} key The path to the SSL key
 * @property {string} cert The path to the SSL cert
 */

/**
 * @typedef {Object} DB_CONFIG_OPTIONS
 * @property {string} host The database server host name
 * @property {string} user The database user name
 * @property {string} password The database user password
 * @property {number} port The database port to connect through
 * @property {keyof DB_CONFIG_SSL_OPTIONS|false} ssl SSL options to configure
 * @property {keyof DB_MODULE_SCHEMA_MAPPING|false} moduleSchemaMapping A map between module names and database schema names
 */

/**
 * @typedef {Object} DB_MODULE_SCHEMA_MAPPING
 * @property {string} moduleName The name of the module as defined in a Divblox data model
 * @property {string} schemaName The name of the database schema to which the module name maps
 */

let databaseCaseImplementation = DB_IMPLEMENTATION_TYPES.snakecase;
let dataModel;
let databaseConfig = {
    host: "localhost",
    user: "dx_user",
    password: "secret",
    port: 3307,
    ssl: false,
    moduleSchemaMapping: [{ moduleName: "main", schemaName: "dxdbsynctest" }],
};

/**
 * @typedef moduleConnection
 * @property {mysql.Connection} connection
 * @property {string} moduleName
 * @property {string} schemaName
 */

/**
 * @type {Object.<string, moduleConnection>}
 */
let moduleConnections = {};

let foreignKeyChecksDisabled = false;

/**
 * @param {Object} options Init options
 * @param {string} options.dataModelPath The path to the file that contains the data model JSON to sync
 * @param {keyof DB_IMPLEMENTATION_TYPES} options.databaseCaseImplementation
 * @param {keyof DB_CONFIG_OPTIONS} options.databaseConfig The database configuration
 * @param {string} options.databaseConfig.host The database server host name
 * @param {string} options.databaseConfig.user The database user name
 * @param {string} options.databaseConfig.password The database user password
 * @param {number} options.databaseConfig.port The database port to connect through
 * @param {Array<DB_CONFIG_OPTIONS>|false} options.databaseConfig.ssl SSL options to configure
 * @param {string} options.databaseConfig.ssl.ca The path to the SSL ca
 * @param {string} options.databaseConfig.ssl.key The path to the SSL key
 * @param {string} options.databaseConfig.ssl.cert The path to the SSL cert
 * @param {Array<DB_MODULE_SCHEMA_MAPPING>} options.databaseConfig.moduleSchemaMapping A map between module names and database schema names
 */
export const init = async (options = {}) => {
    if (options.databaseCaseImplementation) {
        databaseCaseImplementation = options.databaseCaseImplementation;
    }

    if (options.dataModel) {
        dataModel = options.dataModel;
    }

    if (options.databaseConfig) {
        databaseConfig = options.databaseConfig;
    }

    for (const moduleSchemaMap of databaseConfig.moduleSchemaMapping) {
        const connection = await mysql.createConnection({
            host: databaseConfig.host,
            user: databaseConfig.user,
            password: databaseConfig.password,
            port: databaseConfig.port,
            database: moduleSchemaMap.schemaName,
        });
        moduleConnections[moduleSchemaMap.moduleName] = {
            connection: connection,
            schemaName: moduleSchemaMap.schemaName,
            moduleName: moduleSchemaMap.moduleName,
        };
    }

    // const connection = moduleConnections["main"].connection;
    // await connection.beginTransaction();

    // const sql = { sql: "select name from table_one" };
    // const [result] = await connection.query(sql);

    // const sql1 = { sql: "insert into table_one (name) VALUES ('inserted')" };
    // const [result1] = await connection.query(sql1);
    // const [result2] = await connection.query(sql1);
    // const [result3] = await connection.query(sql1);

    // await connection.rollback();
    // await connection.commit();
    // console.log("err", err);
    // console.log("result", result);
    //TODO: Remove this. Just here for testing
    return;
};

let existingTables = {};
export const syncDatabase = async (skipUserPrompts = false) => {
    const validDataModel = await checkDataModelIntegrity();
    if (!validDataModel) {
        return false;
    }

    outputFormattedLog("Data model integrity check succeeded!", commandLineSubHeadingFormatting);

    await disableForeignKeyChecks();
    existingTables = await getDatabaseTables();
    const existingTableNames = Object.keys(existingTables);
    console.log("existingTableNames", existingTableNames);
    const expectedTableNames = [];
    for (const dataModelTableName of Object.keys(dataModel)) {
        expectedTableNames.push(getCaseNormalizedString(dataModelTableName));
    }

    console.log("expectedTableNames", expectedTableNames);

    const tablesToCreate = expectedTableNames.filter((name) => !existingTableNames.includes(name));
    const tablesToRemove = existingTableNames.filter((name) => !expectedTableNames.includes(name));

    console.log(`Database currently has ${existingTableNames.length} table(s)`);
    console.log(`Based on the data model, we are expecting ${expectedTableNames.length} table(s)`);

    console.log("tablesToCreate", tablesToCreate);
    console.log("tablesToRemove", tablesToRemove);

    for (const { connection } of Object.values(moduleConnections)) {
        await connection.beginTransaction();
    }

    startNewCommandLineSection("Existing table clean up");
    // await removeTables(tablesToRemove, skipUserPrompts);

    if (foreignKeyChecksDisabled) {
        await restoreForeignKeyChecks();
    }

    outputFormattedLog("Database clean up completed!", commandLineSubHeadingFormatting);

    startNewCommandLineSection("Create new tables");
    const createResult = await createTables(tablesToCreate);

    if (!createResult) {
        process.exit(0);
    }

    if (foreignKeyChecksDisabled) {
        await restoreForeignKeyChecks();
    }

    outputFormattedLog("Table creation completed!", commandLineSubHeadingFormatting);

    // 4a. We call updateRelationships here to ensure any redundant foreign key constraints are removed before
    //      attempting to update the tables. This sidesteps any constraint-related errors
    const updateRelationshipsResult = await updateRelationships(true);
    if (!updateRelationshipsResult) {
        printErrorMessage("Error while attempting to remove relationships");

        if (foreignKeyChecksDisabled) {
            await restoreForeignKeyChecks();
        }

        return false;
    }
    outputFormattedLog("No redundant relationships!", commandLineSubHeadingFormatting);

    // 4. Loop through all the entities in the data model and update their corresponding database tables
    //      to ensure that their columns match the data model attribute names and types
    const updateTablesResult = await updateTables();
    if (!updateTablesResult) {
        printErrorMessage("Error while attempting to update tables");

        if (foreignKeyChecksDisabled) {
            await restoreForeignKeyChecks();
        }

        return false;
    }

    outputFormattedLog("Table modification completed!", commandLineSubHeadingFormatting);

    // 5. Loop through all the entities in the data model and update their corresponding database tables
    //      to ensure that their indexes match the data model indexes
    const updateIndexResult = await updateIndexes();
    if (!updateIndexResult) {
        printErrorMessage("Error while attempting to update indexes");
        if (foreignKeyChecksDisabled) {
            await restoreForeignKeyChecks();
        }

        return false;
    }

    outputFormattedLog("Indexes up to date!", commandLineSubHeadingFormatting);

    // 6. Loop through all the entities in the data model and update their corresponding database tables
    //      to ensure that their relationships match the data model relationships. Here we either create new
    //      foreign key constraints or drop existing ones where necessary
    if (!(await updateRelationships())) {
        printErrorMessage("Error while attempting to update relationships");
        if (foreignKeyChecksDisabled) {
            await restoreForeignKeyChecks();
        }

        return false;
    }
    outputFormattedLog("Relationships up to date!", commandLineSubHeadingFormatting);

    startNewCommandLineSection("Database sync completed successfully!");
    process.exit(0);
};

const createTables = async (tablesToCreate = []) => {
    if (tablesToCreate.length === 0) {
        console.log("There are no tables to create.");
        return true;
    }

    console.log(tablesToCreate.length + " new table(s) to create.");
    const dataModelTablesToCreate = Object.fromEntries(
        Object.entries(dataModel).filter(([key]) => tablesToCreate.includes(key)),
    );

    console.log("dataModelTablesToCreate", dataModelTablesToCreate);

    for (const tableName of tablesToCreate) {
        const tableNameDataModel = getCaseDenormalizedString(tableName);
        const moduleName = dataModel[tableNameDataModel]["module"];

        const createTableSql = `CREATE TABLE ${tableName} (
                ${getPrimaryKeyColumn()} BIGINT NOT NULL AUTO_INCREMENT,
                PRIMARY KEY (${getPrimaryKeyColumn()})
                )`;

        const connection = Object.values(moduleConnections).find(
            (connection) => connection.moduleName === moduleName,
        )?.connection;

        try {
            await connection.query(createTableSql);
        } catch (err) {
            printErrorMessage(`Could not create table '${tableName}': ${err?.sqlMessage}`);
            console.log(err);
            return false;
        }
    }

    return true;
};

const updateTables = async () => {
    startNewCommandLineSection("Update existing tables");

    if (!foreignKeyChecksDisabled) {
        await disableForeignKeyChecks();
    }

    let updatedTables = [];
    let sqlQuery = {};

    for (const entityName of Object.keys(dataModel)) {
        const moduleName = dataModel[entityName]["module"];
        const { connection, schemaName } = moduleConnections[moduleName];
        const tableName = getCaseNormalizedString(entityName);

        if (typeof sqlQuery[moduleName] === "undefined") {
            sqlQuery[moduleName] = [];
        }

        const [tableColumns] = await connection.query(`SHOW FULL COLUMNS FROM ${tableName}`);

        console.log("tableColumns", tableColumns);
        let tableColumnsNormalized = {};

        const entityAttributes = dataModel[entityName]["attributes"];
        const expectedColumns = getEntityExpectedColumns(entityName);

        let attributesProcessed = [];
        let relationshipsProcessed = [];

        for (const tableColumn of tableColumns) {
            const columnName = tableColumn["Field"];
            const columnAttributeName = getCaseDenormalizedString(columnName);
            attributesProcessed.push(columnAttributeName);

            if (columnAttributeName === getPrimaryKeyColumn()) {
                continue;
            }

            // Let's check for columns to drop
            if (!expectedColumns.includes(columnName)) {
                sqlQuery[moduleName].push(`ALTER TABLE ${tableName} DROP COLUMN ${tableColumn["Field"]};`);
                if (!updatedTables.includes(entityName)) {
                    updatedTables.push(entityName);
                }
                continue;
            }

            // Now, let's check if the existing columns' configurations align with our data model
            const allowNull = tableColumn["Null"] !== "NO";
            const typeParts = tableColumn["Type"].split("(");
            const baseType = typeParts[0];
            const typeLength = typeParts.length > 1 ? typeParts[1].replace(")", "") : null;

            tableColumnsNormalized[tableColumn["Field"]] = {
                type: baseType,
                lengthOrValues: typeLength,
                default: tableColumn["Default"],
                allowNull: allowNull,
            };

            console.log("tableColumnsNormalized", tableColumnsNormalized);

            for (const columnOption of Object.keys(tableColumnsNormalized[tableColumn["Field"]])) {
                if (typeof entityAttributes[columnAttributeName] === "undefined") {
                    if (columnName !== getLockingConstraintColumn()) {
                        // This must mean that the column is a foreign key column
                        if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "bigint") {
                            // This column needs to be fixed. Somehow its type got changed
                            sqlQuery[moduleName].push(
                                `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} BIGINT(20);`,
                            );

                            if (!updatedTables.includes(entityName)) {
                                updatedTables.push(entityName);
                            }
                        }
                        relationshipsProcessed.push(columnName);
                    } else {
                        // This is the locking constraint column
                        if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "datetime") {
                            // This column needs to be fixed. Somehow its type got changed
                            sqlQuery[moduleName].push(
                                `ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} datetime DEFAULT CURRENT_TIMESTAMP;`,
                            );

                            if (!updatedTables.includes(entityName)) {
                                updatedTables.push(entityName);
                            }
                        }
                        attributesProcessed.push(columnName);
                    }
                    break;
                }

                const dataModelOption =
                    columnOption === "lengthOrValues" && entityAttributes[columnAttributeName][columnOption] !== null
                        ? entityAttributes[columnAttributeName][columnOption].toString()
                        : entityAttributes[columnAttributeName][columnOption];

                if (dataModelOption !== tableColumnsNormalized[tableColumn["Field"]][columnOption]) {
                    sqlQuery[moduleName].push(
                        `ALTER TABLE ${tableName} ${getAlterColumnSql(
                            columnName,
                            entityAttributes[columnAttributeName],
                            "MODIFY",
                        )}`,
                    );

                    if (!updatedTables.includes(entityName)) {
                        updatedTables.push(entityName);
                    }
                    break;
                }
            }
        }

        // Now, let's create any remaining new columns
        let entityAttributesArray = Object.keys(entityAttributes);
        entityAttributesArray.push(getCaseDenormalizedString(getPrimaryKeyColumn()));

        if (
            typeof dataModel[entityName]["options"] !== "undefined" &&
            typeof dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined"
        ) {
            if (dataModel[entityName]["options"]["enforceLockingConstraints"] !== false) {
                entityAttributesArray.push(getCaseDenormalizedString(getLockingConstraintColumn()));
            }
        }
        const columnsToCreate = entityAttributesArray.filter((x) => !attributesProcessed.includes(x));

        for (const columnToCreate of columnsToCreate) {
            const columnName = getCaseNormalizedString(columnToCreate);

            const columnDataModelObject =
                columnToCreate === getCaseDenormalizedString(getLockingConstraintColumn())
                    ? {
                          type: "datetime",
                          lengthOrValues: null,
                          default: "CURRENT_TIMESTAMP",
                          allowNull: false,
                      }
                    : entityAttributes[columnToCreate];

            sqlQuery[moduleName].push(
                `ALTER TABLE ${tableName} ${getAlterColumnSql(columnName, columnDataModelObject, "ADD")}`,
            );

            if (!updatedTables.includes(entityName)) {
                updatedTables.push(entityName);
            }
        }

        const entityRelationshipColumns = getEntityRelationshipColumns(entityName);
        const relationshipColumnsToCreate = entityRelationshipColumns.filter(
            (x) => !relationshipsProcessed.includes(x),
        );

        for (const relationshipColumnToCreate of relationshipColumnsToCreate) {
            sqlQuery[moduleName].push(`ALTER TABLE ${tableName} ADD COLUMN ${relationshipColumnToCreate} BIGINT(20);`);

            if (!updatedTables.includes(entityName)) {
                updatedTables.push(entityName);
            }
        }
    }

    for (const moduleName of Object.keys(sqlQuery)) {
        if (sqlQuery[moduleName].length === 0) {
            continue;
        }

        const { connection } = moduleConnections[moduleName];
        for (const query of sqlQuery[moduleName]) {
            try {
                await connection.query(query);
            } catch (err) {
                printErrorMessage(`Could not execute query: ${err?.sqlMessage}`);
                console.log(err);
                return false;
            }
        }
    }

    console.log(updatedTables.length + " tables were updated");

    if (foreignKeyChecksDisabled) {
        await restoreForeignKeyChecks();
    }

    return true;
};

/**
 * Cycles through all the indexes for each table to ensure they align with their data model definition
 * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
 * with a relevant reason
 */
const updateIndexes = async () => {
    startNewCommandLineSection("Update indexes");

    if (!foreignKeyChecksDisabled) {
        await disableForeignKeyChecks();
    }

    let updatedIndexes = { added: 0, removed: 0 };

    for (const entityName of Object.keys(dataModel)) {
        const moduleName = dataModel[entityName]["module"];
        const tableName = getCaseNormalizedString(entityName);
        const { connection, schemaName } = moduleConnections[moduleName];

        console.log("entityName", entityName);
        console.log("moduleName", moduleName);
        const [indexCheckResults] = await connection.query(`SHOW INDEX FROM ${tableName}`);
        let existingIndexes = [];
        console.log("indexCheckResults", indexCheckResults);
        for (const index of indexCheckResults) {
            existingIndexes.push(index["Key_name"]);
        }

        console.log("existingIndexes", existingIndexes);

        const entityRelationshipConstraints = getEntityRelationshipConstraint(entityName);
        console.log("entityRelationshipConstraints", entityRelationshipConstraints);
        const expectedIndexes = entityRelationshipConstraints.map((obj) => obj.constraintName);
        console.log("expectedIndexes", expectedIndexes);
        for (const indexObj of dataModel[entityName]["indexes"]) {
            const indexName = getCaseNormalizedString(indexObj["indexName"]);
            expectedIndexes.push(indexName);

            if (!existingIndexes.includes(indexName)) {
                // Let's add this index
                const keyColumn = getCaseNormalizedString(indexObj["attribute"]);

                let addIndexSqlString = "";
                switch (indexObj["indexChoice"].toLowerCase()) {
                    case "index":
                        addIndexSqlString = `ALTER TABLE ${tableName} ADD INDEX ${indexName} (${keyColumn}) USING ${indexObj["type"]};`;
                        break;
                    case "unique":
                        addIndexSqlString = `ALTER TABLE ${tableName} ADD UNIQUE ${indexName} (${keyColumn}) USING ${indexObj["type"]};`;
                        break;
                    case "spatial":
                        addIndexSqlString = `ALTER TABLE ${tableName} ADD SPATIAL ${indexName} (${keyColumn})`;
                        break;
                    case "fulltext":
                        addIndexSqlString = `ALTER TABLE ${tableName} ADD FULLTEXT ${indexName} (${keyColumn})`;
                        break;
                    default:
                        printErrorMessage(`Invalid index choice specified for '${indexObj["indexName"]}' on '${entityName}'.
                        Provided: '${indexObj["indexChoice"]}'.
                        Valid options: index|unique|fulltext|spatial`);

                        return false;
                }

                try {
                    await connection.query(addIndexSqlString);
                } catch (err) {
                    printErrorMessage(
                        `Could not add ${indexObj["indexChoice"].toUpperCase()} '${indexName}' to table '${tableName}': 
                        ${err?.sqlMessage ?? ""}`,
                    );
                    console.log(err);
                    return false;
                }

                updatedIndexes.added++;
            }
        }

        for (const existingIndex of existingIndexes) {
            if (existingIndex.toLowerCase() === "primary") {
                continue;
            }

            if (!expectedIndexes.includes(existingIndex)) {
                try {
                    await connection.query(`ALTER TABLE ${tableName} DROP INDEX ${existingIndex};`);
                } catch (err) {
                    printErrorMessage(`Could not drop INDEX ${existingIndex} to table ${tableName}`);
                    console.log(err);
                    return false;
                }

                updatedIndexes.removed++;
            }
        }
    }

    console.log(`${updatedIndexes.added} Indexes added.`);
    console.log(`${updatedIndexes.removed} Indexes removed.`);

    if (foreignKeyChecksDisabled) {
        await restoreForeignKeyChecks();
    }

    return true;
};

/**
 * Cycles through all the relationships for each table to ensure they align with their data model definition
 * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
 * with a relevant reason
 */
const updateRelationships = async (dropOnly = false) => {
    if (dropOnly) {
        startNewCommandLineSection("Removing redundant relationships");
    } else {
        startNewCommandLineSection("Update relationships");
    }

    if (!foreignKeyChecksDisabled) {
        await disableForeignKeyChecks();
    }

    let updatedRelationships = { added: 0, removed: 0 };

    for (const entityName of Object.keys(dataModel)) {
        const moduleName = dataModel[entityName]["module"];
        const tableName = getCaseNormalizedString(entityName);
        const { connection, schemaName } = moduleConnections[moduleName];

        const entityRelationshipConstraints = getEntityRelationshipConstraint(entityName);

        try {
            const [results] = await connection.query(`SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS 
                WHERE TABLE_NAME = '${tableName}' AND CONSTRAINT_SCHEMA = '${schemaName}';`);
            console.log(results);

            for (const foreignKeyResult of results) {
                let foundConstraint = null;
                if (entityRelationshipConstraints.length) {
                    foundConstraint = entityRelationshipConstraints.find(
                        (obj) => obj.constraintName === foreignKeyResult.CONSTRAINT_NAME,
                    );
                }

                if (!foundConstraint) {
                    try {
                        await connection.query(`ALTER TABLE ${schemaName}.${tableName}
                            DROP FOREIGN KEY ${foreignKeyResult.CONSTRAINT_NAME};`);
                    } catch (err) {
                        printErrorMessage(
                            `Could not drop FK '${foreignKeyResult.CONSTRAINT_NAME}': ${err?.sqlMessage}`,
                        );
                        console.log(err);
                        return false;
                    }

                    updatedRelationships.removed++;
                } else {
                    existingForeignKeys.push(foreignKeyResult.CONSTRAINT_NAME);
                }
            }
        } catch (err) {
            printErrorMessage(`Could not get schema information for '${moduleName}': ${err?.sqlMessage}`);
            console.log(err);
            return false;
        }

        let existingForeignKeys = [];

        if (dropOnly) {
            continue;
        }

        const foreignKeysToCreate = entityRelationshipConstraints.filter(
            (x) => !existingForeignKeys.includes(x.constraintName),
        );

        for (const foreignKeyToCreate of foreignKeysToCreate) {
            const entityRelationship = getEntityRelationshipFromRelationshipColumn(
                entityName,
                foreignKeyToCreate.columnName,
            );

            try {
                const res = await connection.query(`ALTER TABLE ${tableName}
                ADD CONSTRAINT ${foreignKeyToCreate.constraintName} 
                FOREIGN KEY (${foreignKeyToCreate.columnName})
                REFERENCES ${getCaseNormalizedString(entityRelationship)} (${getPrimaryKeyColumn()})
                ON DELETE SET NULL ON UPDATE CASCADE;`);

                console.log("res", res);
            } catch (err) {
                printErrorMessage(`Could not add FK '${foreignKeyToCreate}': ${err?.sqlMessage}`);
                console.log(err);
                return false;
            }

            updatedRelationships.added++;
        }
    }

    console.log(`${updatedRelationships.added} Relationships added.`);
    console.log(`${updatedRelationships.removed} Relationships removed.`);

    if (foreignKeyChecksDisabled) {
        await restoreForeignKeyChecks();
    }

    return true;
};

/**
 * Returns the constraint and column name that will be created in the database to represent the relationships for the given entity
 * @param entityName The name of the entity for which to determine relationship columns
 * @return {*[]} An array of constraint and column names in an object
 */
const getEntityRelationshipConstraint = (entityName) => {
    let entityRelationshipConstraint = [];
    const entityRelationships = dataModel[entityName]["relationships"];
    for (const entityRelationship of Object.keys(entityRelationships)) {
        for (const relationshipName of entityRelationships[entityRelationship]) {
            const entityPart = getCaseNormalizedString(entityName);
            const relationshipPart = getCaseNormalizedString(entityRelationship);
            const relationshipNamePart = getCaseNormalizedString(relationshipName);

            let columnName = "";
            let constraintName = "";
            let splitter = "_";
            switch (databaseCaseImplementation.toLowerCase()) {
                case "lowercase":
                    splitter = "_";
                    break;
                case "pascalcase":
                case "camelcase":
                    splitter = "";
                    break;
                default:
                    splitter = "_";
            }
            columnName = relationshipPart + splitter + relationshipNamePart;

            const uniqueIdentifierRaw = Date.now().toString() + Math.round(1000000 * Math.random()).toString();
            const uniqueIdentifier = createHash("md5").update(uniqueIdentifierRaw).digest("hex");
            entityRelationshipConstraint.push({ columnName, constraintName: uniqueIdentifier });
        }
    }

    return entityRelationshipConstraint;
};

/**
 * Determines the relationship, as defined in the data model from the given column name
 * @param entityName The name of the entity for which to determine the defined relationship
 * @param relationshipColumnName The column name in the database that represents the relationship
 * @return {string|null} The name of the relationship as defined in the data model
 */
const getEntityRelationshipFromRelationshipColumn = (entityName, relationshipColumnName) => {
    const entityRelationships = dataModel[entityName]["relationships"];
    for (const entityRelationship of Object.keys(entityRelationships)) {
        for (const relationshipName of entityRelationships[entityRelationship]) {
            const relationshipPart = getCaseNormalizedString(entityRelationship);
            const relationshipNamePart = getCaseNormalizedString(relationshipName);

            let columnName = "";
            switch (databaseCaseImplementation.toLowerCase()) {
                case "lowercase":
                    columnName = relationshipPart + "_" + relationshipNamePart;
                    break;
                case "pascalcase":
                case "camelcase":
                    columnName = relationshipPart + relationshipNamePart;
                    break;
                default:
                    columnName = relationshipPart + "_" + relationshipNamePart;
            }

            if (columnName === relationshipColumnName) {
                return entityRelationship;
            }
        }
    }

    return null;
};

/**
 * Returns the names of the table columns expected for a given entity
 * @param entityName The name of the entity
 * @return {string[]} An array of column names
 */
const getEntityExpectedColumns = (entityName) => {
    let expectedColumns = [getPrimaryKeyColumn()];

    for (const attributeColumn of Object.keys(dataModel[entityName]["attributes"])) {
        expectedColumns.push(getCaseNormalizedString(attributeColumn));
    }

    for (const relationshipColumn of getEntityRelationshipColumns(entityName)) {
        expectedColumns.push(getCaseNormalizedString(relationshipColumn));
    }

    if (
        typeof dataModel[entityName]["options"] !== "undefined" &&
        typeof dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined"
    ) {
        if (dataModel[entityName]["options"]["enforceLockingConstraints"] !== false) {
            expectedColumns.push(getLockingConstraintColumn());
        }
    }

    return expectedColumns;
};

/**
 * A utility function that returns the sql to alter a table based on the data model structure provided
 * @param {string} columnName The name of the column to alter
 * @param {*} columnDataModelObject An object containing information regarding the make-up of the column
 * @param {string} columnDataModelObject.type The type of the column
 * @param {null|string|int} columnDataModelObject.lengthOrValues If column type is "enum" or "set", please enter the
 * values using this format: 'a','b','c'
 * @param {null|value|"CURRENT_TIMESTAMP"} columnDataModelObject.default The default value for the column
 * @param {boolean} columnDataModelObject.allowNull Whether to allow null or not for the column
 * @param {string} operation "ADD|MODIFY"
 * @return {string} The sql alter code
 */
const getAlterColumnSql = (columnName = "", columnDataModelObject = {}, operation = "MODIFY") => {
    let sql = `${operation} COLUMN ${columnName} ${columnDataModelObject["type"]}`;

    if (columnName === getPrimaryKeyColumn()) {
        sql = `${operation} COLUMN ${getPrimaryKeyColumn()} BIGINT NOT NULL AUTO_INCREMENT FIRST, 
            ADD PRIMARY KEY (${getPrimaryKeyColumn()});`;
        return sql;
    }

    if (columnDataModelObject["lengthOrValues"] !== null) {
        sql += `(${columnDataModelObject["lengthOrValues"]})`;
    }

    if (columnDataModelObject["allowNull"] === false) {
        sql += " NOT NULL";
    }

    if (columnDataModelObject["default"] !== null) {
        if (columnDataModelObject["default"] !== "CURRENT_TIMESTAMP") {
            sql += ` DEFAULT '${columnDataModelObject["default"]}';`;
        } else {
            sql += " DEFAULT CURRENT_TIMESTAMP;";
        }
    } else if (columnDataModelObject["allowNull"] !== false) {
        sql += " DEFAULT NULL;";
    }

    return sql;
};

/**
 * A wrapper function that returns the "id" column, formatted to the correct case, that is used as the primary key
 * column for all tables
 * @return {string} Either "id" or "Id"
 */
const getPrimaryKeyColumn = () => {
    switch (databaseCaseImplementation.toLowerCase()) {
        case "lowercase":
            return "id";
        case "pascalcase":
            return "Id";
        case "camelcase":
            return "id";
        default:
            return "id";
    }
};

/**
 * Divblox supports logic in its built-in ORM that determines whether a locking constraint is in place when
 * attempting to update a specific table. A column "lastUpdated|LastUpdated|last_updated" is used to log when last
 * a given table was updated to determine whether a locking constraint should be applied.
 * @return {string} Either "lastUpdated", "LastUpdated" or "last_updated"
 */
const getLockingConstraintColumn = () => {
    switch (databaseCaseImplementation.toLowerCase()) {
        case "lowercase":
            return "last_updated";
        case "pascalcase":
            return "LastUpdated";
        case "camelcase":
            return "lastUpdated";
        default:
            return "last_updated";
    }
};

/**
 * Returns the columns that will be created in the database to represent the relationships for the given entity
 * @param entityName The name of the entity for which to determine relationship columns
 * @return {*[]} An array of column names
 */
const getEntityRelationshipColumns = (entityName) => {
    let entityRelationshipColumns = [];
    const entityRelationships = dataModel[entityName]["relationships"];
    for (const entityRelationship of Object.keys(entityRelationships)) {
        for (const relationshipName of entityRelationships[entityRelationship]) {
            const relationshipPart = getCaseNormalizedString(entityRelationship);
            const relationshipNamePart = getCaseNormalizedString(relationshipName);

            let columnName = "";
            switch (databaseCaseImplementation.toLowerCase()) {
                case "lowercase":
                    columnName = relationshipPart + "_" + relationshipNamePart;
                    break;
                case "pascalcase":
                case "camelcase":
                    columnName = relationshipPart + relationshipNamePart;
                    break;
                default:
                    columnName = relationshipPart + "_" + relationshipNamePart;
            }

            entityRelationshipColumns.push(columnName);
        }
    }
    return entityRelationshipColumns;
};

const checkDataModelIntegrity = async () => {
    startNewCommandLineSection("Data model integrity check");

    const entities = JSON.parse(JSON.stringify(dataModel));
    if (entities.length === 0) {
        printErrorMessage("Data model has no entities defined");
        return false;
    }

    const baseKeys = ["module", "attributes", "indexes", "relationships", "options"];
    for (const entityName of Object.keys(entities)) {
        const entityObj = entities[entityName];

        for (const baseKey of baseKeys) {
            if (typeof entityObj[baseKey] === "undefined") {
                printErrorMessage(`Entity '${entityName}' has no ${baseKey} definition`);
                return false;
            }
        }

        const moduleName = entityObj["module"];
        if (!Object.keys(moduleConnections).includes(moduleName)) {
            printErrorMessage(`Entity '${entityName}' has an invalid module provided: ${moduleName}`);
            return false;
        }

        const attributes = entityObj["attributes"];
        if (attributes.length === 0) {
            printErrorMessage(`Entity '${entityName}' has no attributes provided`);
            return false;
        }

        const expectedAttributeDefinition = {
            type: "[MySQL column type]",
            lengthOrValues: "[null|int|if type is enum, then comma separated values '1','2','3',...]",
            default: "[value|null|CURRENT_TIMESTAMP]",
            allowNull: "[true|false]",
        };

        for (const attributeName of Object.keys(attributes)) {
            const attributeObj = attributes[attributeName];
            const attributeConfigs = Object.keys(attributeObj);

            if (JSON.stringify(attributeConfigs) !== JSON.stringify(Object.keys(expectedAttributeDefinition))) {
                printErrorMessage(`Invalid attribute definition for '${entityName}' (${attributeName})`);
                console.log("Expected: ", expectedAttributeDefinition);
                return false;
            }
        }

        const expectedIndexesDefinition = {
            attribute: "[The attribute on which the index should be set]",
            indexName: "[The name of the index]",
            indexChoice: "[index|unique|spatial|text]",
            type: "[BTREE|HASH]",
        };

        if (typeof entityObj["indexes"] !== "object") {
            printErrorMessage(`Invalid index definition for '${entityName}'`);
            console.log("Expected: ", expectedIndexesDefinition);
            return false;
        }

        for (const index of entityObj["indexes"]) {
            if (JSON.stringify(Object.keys(index)) !== JSON.stringify(Object.keys(expectedIndexesDefinition))) {
                printErrorMessage(`Invalid index definition for '${entityName}'`);
                console.log("Expected: ", expectedIndexesDefinition);
                return false;
            }
        }

        const expectedRelationshipDefinition = {
            relationshipEntity: ["relationshipOneName", "relationshipTwoName"],
        };

        for (const relationshipName of Object.keys(entityObj["relationships"])) {
            if (typeof entityObj["relationships"][relationshipName] !== "object") {
                printErrorMessage(`Invalid relationship definition for '${entityName}'`);
                console.log("Expected: ", expectedRelationshipDefinition);
                return false;
            }
        }
    }

    for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
        try {
            const [results] = await connection.query("SHOW ENGINES");
            console.log("results", results);
            for (const row of results) {
                if (row["Engine"].toLowerCase() === "innodb") {
                    if (row["Support"].toLowerCase() !== "default") {
                        printErrorMessage(`The active database engine is NOT InnoDB. Cannot proceed`);
                        return false;
                    }
                }
            }
        } catch (err) {
            connection.rollback();
            printErrorMessage(`Could not check database engine`);
            console.log(err);
            return false;
        }
    }

    return true;
};

const startNewCommandLineSection = (sectionHeading = "") => {
    const lineText = "-".repeat(process.stdout.columns);
    outputFormattedLog(lineText, commandLineColors.foregroundCyan);
    outputFormattedLog(sectionHeading, commandLineHeadingFormatting);
    outputFormattedLog(lineText, commandLineColors.foregroundCyan);
};

/**
 * Returns the given inputString, formatted to align with the case implementation specified
 * @param {string} inputString The string to normalize, expected in cascalCase
 * @return {string} The normalized string
 */
const getCaseNormalizedString = (inputString = "") => {
    let preparedString = inputString;
    switch (databaseCaseImplementation.toLowerCase()) {
        case "snakecase":
            return getCamelCaseSplittedToLowerCase(inputString, "_");
        case "pascalcase":
            preparedString = getCamelCaseSplittedToLowerCase(inputString, "_");
            return convertLowerCaseToPascalCase(preparedString, "_");
        case "camelcase":
            preparedString = getCamelCaseSplittedToLowerCase(inputString, "_");
            return convertLowerCaseToCamelCase(preparedString, "_");
        default:
            return getCamelCaseSplittedToLowerCase(inputString, "_");
    }
};

/**
 * Returns the given inputString, formatted back to camelCase. This is because it is expected that a divblox data
 * model is ALWAYS defined using camelCase
 * @param inputString The string to denormalize
 * @return {string} The denormalized string
 */
const getCaseDenormalizedString = (inputString = "") => {
    // Since the data model expects camelCase, this function converts back to that
    let preparedString = inputString;
    switch (databaseCaseImplementation.toLowerCase()) {
        case "snakecase":
            return convertLowerCaseToCamelCase(inputString, "_");
        case "pascalcase":
        case "camelcase":
            preparedString = getCamelCaseSplittedToLowerCase(inputString, "_");
            return convertLowerCaseToCamelCase(preparedString, "_");
        default:
            return convertLowerCaseToCamelCase(inputString, "_");
    }
};

const removeTables = async (tablesToRemove = [], skipUserPrompts = false) => {
    if (tablesToRemove.length === 0) {
        console.log("There are no tables to remove.");
        return;
    }

    let answer = "none";
    if (!skipUserPrompts) {
        answer = await getCommandLineInput(
            `Removing tables that are not defined in the provided data model...
${tablesToRemove.length} tables should be removed.
How would you like to proceed?
    - Type 'y' to confirm & remove one-by-one;
    - Type 'all' to remove all;
    - Type 'none' to skip removing any tables;
    - Type 'list' to show tables that will be removed (y|all|none|list) `,
        );
    }

    switch (answer.toString().toLowerCase()) {
        case "list":
            listTablesToRemove(tablesToRemove);
            const answerList = await getCommandLineInput(
                `How would you like to proceed?
    - Type 'y' to confirm & remove one-by-one;
    - Type 'all' to remove all;
    - Type 'none' to skip removing any tables; (y|all|none) `,
            );
            switch (answerList.toString().toLowerCase()) {
                case "y":
                    await removeTablesRecursive(tablesToRemove, true);
                    break;
                case "all":
                    await removeTablesRecursive(tablesToRemove, false);
                    break;
                case "none":
                    return;
                default:
                    printErrorMessage("Invalid selection. Please try again.");
                    await removeTables(tablesToRemove, skipUserPrompts);
                    return;
            }
            break;
        case "all":
            await removeTablesRecursive(tablesToRemove, false);
            break;
        case "y":
            await removeTablesRecursive(tablesToRemove, true);
            break;
        case "none":
            return;
        default:
            printErrorMessage("Invalid selection. Please try again.");
            await removeTables(tablesToRemove, skipUserPrompts);
    }
};

/**
 * A helper function that disables foreign key checks on the database
 * @return {Promise<boolean>}
 */
const disableForeignKeyChecks = async () => {
    for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
        try {
            await connection.query("SET FOREIGN_KEY_CHECKS = 0");
            foreignKeyChecksDisabled = true;
        } catch (err) {
            await connection.rollback();
            printErrorMessage(`Could not disable FK checks for '${moduleName}': ${err?.sqlMessage ?? ""}`);
            console.log(err);
            return false;
        }
    }

    return true;
};
/**
 * A helper function that enables foreign key checks on the database
 * @return {Promise<boolean>}
 */
const restoreForeignKeyChecks = async () => {
    for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
        try {
            await connection.query("SET FOREIGN_KEY_CHECKS = 1");
            foreignKeyChecksDisabled = false;
        } catch (err) {
            await connection.rollback();
            printErrorMessage(`Could not disable FK checks for '${moduleName}': ${err?.sqlMessage ?? ""}`);
            console.log(err);
            return false;
        }
    }

    return true;
};

/**
 * Returns the tables that are currently in the database
 * @return {Promise<{}>} Returns the name and type of each table
 */
const getDatabaseTables = async () => {
    let tables = [];
    for (const [moduleName, { connection, schemaName }] of Object.entries(moduleConnections)) {
        try {
            const [results] = await connection.query("SHOW FULL TABLES");
            if (results.length === 0) {
                console.log(`'${moduleName} has no configured tables`);
                continue;
            }

            results.forEach((dataPacket) => {
                tables[dataPacket[`Tables_in_${schemaName}`]] = dataPacket["Table_type"];
            });
        } catch (err) {
            await connection.rollback();
            printErrorMessage(
                `Could not show full tables for '${moduleName}' in schema '${schemaName}': ${err?.sqlMessage ?? ""}`,
            );
            console.log(err);
            process.exit(1);
        }
    }

    return tables;
};

/**
 * Prints the tables that are to be removed to the console
 */
const listTablesToRemove = (tablesToRemove) => {
    for (const tableName of tablesToRemove) {
        outputFormattedLog(`${tableName} (${existingTables[tableName]})`, commandLineColors.foregroundGreen);
    }
};

const getTableModuleMapping = () => {
    let tableModuleMapping = {};
    for (const entityName of Object.keys(dataModel)) {
        const moduleName = dataModel[entityName].module;

        if (typeof tableModuleMapping[moduleName] === "undefined") {
            tableModuleMapping[moduleName] = [];
        }

        tableModuleMapping[moduleName].push(getCaseNormalizedString(entityName));
    }

    return tableModuleMapping;
};

const removeTablesRecursive = async (tablesToRemove = [], mustConfirm = true) => {
    if (tablesToRemove.length === 0) return;
    const tableModuleMapping = getTableModuleMapping();
    if (!foreignKeyChecksDisabled) await disableForeignKeyChecks();

    if (!mustConfirm) {
        // Not going to be recursive. Just a single call to drop all relevant tables
        for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
            if (typeof tableModuleMapping[moduleName] !== undefined && tableModuleMapping[moduleName].length > 0) {
                const tablesToDrop = tablesToRemove.filter((name) => !tableModuleMapping[moduleName].includes(name));
                const tablesToDropStr = tablesToDrop.join(",");

                try {
                    await connection.query(`DROP TABLE IF EXISTS ${tablesToDropStr}`);
                    outputFormattedLog(`Removed table(s): ${tablesToDropStr}`, commandLineSubHeadingFormatting);
                } catch (err) {
                    await connection.rollback();
                    outputFormattedLog(`Error dropping tables '${tablesToDropStr}':`, commandLineWarningFormatting);
                    console.log(err);
                    continue;
                }
            }
        }

        if (foreignKeyChecksDisabled) await restoreForeignKeyChecks();
        return;
    }

    const answer = await getCommandLineInput(`Drop table '${tablesToRemove[0]}'? (y/n) `);
    if (answer.toString().toLowerCase() === "y") {
        for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
            try {
                await connection.query(`DROP TABLE IF EXISTS ${tablesToRemove[0]}`);
            } catch (err) {
                await connection.rollback();
                printErrorMessage(`Could not drop table '${tablesToRemove[0]}': ${err?.sqlMessage ?? ""}`);
                console.log(err);
                continue;
            }
        }
    }

    tablesToRemove.shift();

    await removeTablesRecursive(tablesToRemove, true);
    if (foreignKeyChecksDisabled) restoreForeignKeyChecks();
};
