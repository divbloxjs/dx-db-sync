import {
    getCamelCaseSplittedToLowerCase,
    convertLowerCaseToCamelCase,
    convertLowerCaseToPascalCase,
} from "dx-utilities";
import mysql, { Connection } from "mysql2/promise";
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
 * @property {Connection} connection
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
    console.log("tablesToCreate", tablesToRemove);

    for (const { connection } of Object.values(moduleConnections)) {
        await connection.beginTransaction();
    }

    startNewCommandLineSection("Existing table clean up");
    await removeTables(tablesToRemove, skipUserPrompts);

    await restoreForeignKeyChecks();
    for (const { connection } of Object.values(moduleConnections)) {
        await connection.commit();
    }
    startNewCommandLineSection("Database sync completed successfully!");
    process.exit(0);
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
    switch (this.databaseCaseImplementation.toLowerCase()) {
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
        } catch (err) {
            await connection.rollback();
            printErrorMessage(`Could not disable FK checks for '${moduleName}'`);
            console.log(err);
            return false;
        }
    }

    foreignKeyChecksDisabled = true;
    return true;
};
/**
 * A helper function that enables foreign key checks on the database
 * @return {Promise<void>}
 */
const restoreForeignKeyChecks = async () => {
    for (const [moduleName, { connection }] of Object.entries(moduleConnections)) {
        try {
            await connection.query("SET FOREIGN_KEY_CHECKS = 1");
        } catch (err) {
            await connection.rollback();
            printErrorMessage(`Could not disable FK checks for '${moduleName}'`);
            console.log(err);
        }
    }

    foreignKeyChecksDisabled = false;
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
            printErrorMessage(`Could not show full tables for '${moduleName}' in schema '${schemaName}`);
            console.log(err);
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
                printErrorMessage(`Could not drop table '${tablesToRemove[0]}'`);
                console.log(err);
                continue;
            }
        }
    }

    tablesToRemove.shift();

    await removeTablesRecursive(tablesToRemove, true);
    if (foreignKeyChecksDisabled) restoreForeignKeyChecks();
};
