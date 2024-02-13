import {
    getCamelCaseSplittedToLowerCase,
    convertLowerCaseToCamelCase,
    convertLowerCaseToPascalCase,
} from "dx-utilities";
import mysql from "mysql2/promise";

const DB_IMPLEMENTATION_TYPES = { snakecase: "snakecase", pascalcase: "pascalcase", camelcase: "camelcase" };

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
let connections = {};

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

    if (options.databaseConfig) {
        databaseConfig = options.databaseConfig;
    }

    for (const moduleSchemaMap of databaseConfig.moduleSchemaMapping) {
        connections[moduleSchemaMap.moduleName] = await mysql.createConnection({
            host: databaseConfig.host,
            user: databaseConfig.user,
            password: databaseConfig.password,
            port: databaseConfig.port,
            database: moduleSchemaMap.schemaName,
        });
    }

    //TODO: Remove this. Just here for testing
    await disableForeignKeyChecks();
    await restoreForeignKeyChecks();
    console.log(await getDatabaseTables());
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

/**
 * A helper function that disables foreign key checks on the database
 * @return {Promise<void>}
 */
const disableForeignKeyChecks = async () => {
    for (const moduleSchemaMap of databaseConfig.moduleSchemaMapping) {
        try {
            const [results, fields] = await connections[moduleSchemaMap.moduleName].query("SET FOREIGN_KEY_CHECKS = 0");

            console.log(results); // results contains rows returned by server
            console.log(fields); // fields contains extra meta data about results, if available
        } catch (err) {
            console.log("Could not disable FK checks for '" + moduleSchemaMap.moduleName + "'", err);
        }
    }

    foreignKeyChecksDisabled = true;
};
/**
 * A helper function that enables foreign key checks on the database
 * @return {Promise<void>}
 */
const restoreForeignKeyChecks = async () => {
    for (const moduleSchemaMap of databaseConfig.moduleSchemaMapping) {
        try {
            const [results, fields] = await connections[moduleSchemaMap.moduleName].query("SET FOREIGN_KEY_CHECKS = 1");

            console.log(results); // results contains rows returned by server
            console.log(fields); // fields contains extra meta data about results, if available
        } catch (err) {
            console.log("Could not disable FK checks for '" + moduleSchemaMap.moduleName + "'", err);
        }
    }

    foreignKeyChecksDisabled = true;
};

/**
 * Returns the tables that are currently in the database
 * @return {Promise<{}>} Returns the name and type of each table
 */
const getDatabaseTables = async () => {
    let tables = {};
    for (const moduleSchemaMap of databaseConfig.moduleSchemaMapping) {
        const [results, fields] = await connections[moduleSchemaMap.moduleName].query("show full tables");

        if (results === undefined || results.length === 0) {
            console.log("Could not show full tables for '" + moduleSchemaMap.moduleName + "'");
        }

        for (let i = 0; i < results.length; i++) {
            const dataPacket = results[i];
            tables[dataPacket["Tables_in_" + moduleSchemaMap.schemaName]] = dataPacket["Table_type"];
        }
    }
    return tables;
};
