import {
    getCamelCaseSplittedToLowerCase,
    convertLowerCaseToCamelCase,
    convertLowerCaseToPascalCase,
} from "dx-utilities";

const DB_IMPLEMENTATION_TYPES = { lowercase: "lowercase", pascalcase: "pascalcase", camelcase: "camelcase" };

/**
 * @typedef {Object} DB_CONFIG_SSL_OPTIONS
 * @property {string} ca The path to the SSL ca
 * @property {string} key The path to the SSL key
 * @property {string} cert The path to the SSL cert
 */

/**
 * @typedef {Object} DB_CONFIG_OPTIONS
 * @property {string} module The path to the SSL ca
 * @property {string} host The path to the SSL key
 * @property {string} user The path to the SSL cert
 * @property {string} password The path to the SSL cert
 * @property {string} database The path to the SSL cert
 * @property {number} port The path to the SSL cert
 * @property {{DB_CONFIG_SSL_OPTIONS}|false} ssl The path to the SSL cert
 */

let databaseCaseImplementation = DB_IMPLEMENTATION_TYPES.lowercase;
let dataModel;
let databaseConfig = {
    module: "main",
    host: "localhost",
    user: "user",
    password: "123456",
    database: "dxdevdb",
    port: 3306,
    ssl: false,
};

/**
 * @param {Object} options Init options
 * @param {string} options.dataModelPath The path to the file that contains the data model JSON to sync
 * @param {keyof DB_IMPLEMENTATION_TYPES} options.databaseCaseImplementation
 * @param {Array<DB_CONFIG_OPTIONS>} options.databaseConfig The database configuration
 * @param {string} options.databaseConfig.module The path to the SSL ca
 * @param {string} options.databaseConfig.host The path to the SSL key
 * @param {string} options.databaseConfig.user The path to the SSL cert
 * @param {string} options.databaseConfig.password The path to the SSL cert
 * @param {string} options.databaseConfig.database The path to the SSL cert
 * @param {number} options.databaseConfig.port The path to the SSL cert
 * @param {Object|false} options.databaseConfig.ssl The path to the SSL cert
 * @param {string} options.databaseConfig[].ssl.ca The path to the SSL cert
 * @param {string} options.databaseConfig[].ssl.key The path to the SSL cert
 * @param {string} options.databaseConfig[].ssl.cert The path to the SSL cert
 */
export const init = (options = {}) => {
    if (options.databaseCaseImplementation) {
        databaseCaseImplementation = options.databaseCaseImplementation;
    }
};

/**
 * Returns the given inputString, formatted to align with the case implementation specified
 * @param {string} inputString The string to normalize, expected in cascalCase
 * @return {string} The normalized string
 */
const getCaseNormalizedString = (inputString = "") => {
    let preparedString = inputString;
    switch (databaseCaseImplementation.toLowerCase()) {
        case "lowercase":
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
 *
 * @param {keyof DATA_MODEL_OPTIONS} test
 */
export const test = (test) => {
    console.log(databaseCaseImplementation);
    console.log(getCaseNormalizedString("thisIsAcAseNormalizedString"));
};
