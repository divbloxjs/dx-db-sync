import {
    getCamelCaseSplittedToLowerCase,
    convertLowerCaseToCamelCase,
    convertLowerCaseToPascalCase,
} from "dx-utilities";

/*
/**
 * @typedef {{
 *     lowercase: "lowercase",
 *     pascalcase: "pascalcase",
 *     camelcase: "camelcase"
 * }} DB_IMPLEMENTATION_TYPES
 */

/**
 * @typedef {Object} DB_IMPLEMENTATION_TYPES
 * @property {string} lowercase lowercase
 * @property {string} pascalcase pascalcase
 * @property {string} camelcase camelcase
 */
let databaseCaseImplementation = "lowercase";

/**
 * @typedef {Object} DATA_MODEL_OPTIONS
 * @property {string} a a
 * @property {string} b b
 * @property {string} c c
 */
let dataModel;

/**
 * @typedef {Object} DB_CONFIG_OPTIONS
 * @property {DB_IMPLEMENTATION_TYPES[]}
 */
let databaseConfig;

/**
 * @typedef {Object} INIT_OPTIONS
 * @property {keyof DB_IMPLEMENTATION_TYPES} databaseCaseImplementation
 * @property {keyof DATA_MODEL_OPTIONS} dataModel
 * @property {keyof DB_CONFIG_OPTIONS} databaseConfig
 */

/**
 * @param {INIT_OPTIONS} options
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
 * @param {keyof DB_IMPLEMENTATION_TYPES} test
 */
export const test = (test) => {
    console.log(databaseCaseImplementation);
    console.log(getCaseNormalizedString("thisIsAcAseNormalizedString"));
};
