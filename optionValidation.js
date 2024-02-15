import { printErrorMessage } from "dx-cli-tools/helpers.js";
import { isValidObject } from "dx-utilities";

let dataModel;
export const validateDataModel = (dataModelToCheck = {}) => {
    dataModel = dataModelToCheck;
    if (!isValidObject(dataModel)) {
        printErrorMessage("Data model is not a valid object");
        return false;
    }

    for (const [entityName, entityDefinition] of Object.entries(dataModel)) {
        if (!entityDefinition?.module) {
            printErrorMessage(`${entityName} does not have a module configured`);
            return false;
        }

        if (!entityDefinition?.attributes) {
            printErrorMessage(`${entityName} does not have any attributes configured`);
            return false;
        }

        if (!entityDefinition?.indexes) {
            entityDefinition.indexes = [];
        }

        if (!entityDefinition?.relationships) {
            entityDefinition.relationships = {};
        }

        if (!entityDefinition?.options) {
            entityDefinition.options = {
                enforceLockingConstraints: true,
                isAuditEnabled: true,
            };
        }

        if (!isValidObject(entityDefinition.attributes)) {
            printErrorMessage(`${entityName} attributes are not provided as an object`);
            return false;
        }

        if (Object.keys(entityDefinition.attributes).length === 0) {
            printErrorMessage(`Entity '${entityName}' has no attributes provided`);
            return false;
        }

        for (const [attributeName, attributeDefinition] of Object.entries(entityDefinition.attributes)) {
            const isValidAttribute = validateAttribute(entityName, attributeName, attributeDefinition);
            if (!isValidAttribute) return false;
        }

        if (!Array.isArray(entityDefinition.indexes)) {
            printErrorMessage(`${entityName} indexes are not provided as an array`);
            return false;
        }

        for (const indexDefinition of entityDefinition.indexes) {
            const isValidIndex = validateIndex(entityName, indexDefinition);
            if (!isValidIndex) return false;
        }

        if (!isValidObject(entityDefinition.relationships)) {
            printErrorMessage(`${entityName} relationships are not provided as an object`);
            return false;
        }

        for (const [relationshipName, relationshipAttributes] of Object.entries(entityDefinition.relationships)) {
            const isValidRelationship = validateRelationship(entityName, relationshipName, relationshipAttributes);
            if (!isValidRelationship) return false;
        }

        if (!isValidObject(entityDefinition.options)) {
            printErrorMessage(`${entityName} options are not provided as an object`);
            return false;
        }

        // validateOptions();
    }

    return dataModel;
};

//#region Data Model Validation Helpers
const validateAttribute = (entityName, attributeName, attributeDefinition = {}) => {
    const expectedAttributeDefinition = {
        name: "attribute name",
        type: "[MySQL column type]",
        lengthOrValues: "[null|int|if type is enum, then comma separated values '1','2','3',...]",
        default: "[value|null|CURRENT_TIMESTAMP]",
        allowNull: "[true|false]",
    };

    const attributeProperties = Object.keys(attributeDefinition);
    if (!checkArraysAreEqual(attributeProperties, Object.keys(expectedAttributeDefinition))) {
        printErrorMessage(`Invalid attribute definition for '${entityName}' (${attributeName})`);
        console.log("Provided: ", attributeDefinition);
        console.log("Expected: ", expectedAttributeDefinition);
        return false;
    }

    return true;
};

const validateIndex = (entityName, indexDefinition = {}) => {
    const allowedIndexChoices = ["index", "unique", "spatial", "fulltext"];
    const allowedIndexTypes = ["BTREE", "HASH"];
    const expectedIndexDefinition = {
        attribute: "The name of the attribute (The column name in the database) on which to add the index",
        indexName: "The unique name of the index",
        indexChoice: '"index"|"unique"|"spatial"|"fulltext"',
        type: '"BTREE"|"HASH"',
    };

    const indexProperties = Object.keys(indexDefinition);
    if (!checkArraysAreEqual(indexProperties, Object.keys(expectedIndexDefinition))) {
        printErrorMessage(`Invalid index definition for '${entityName}' (${indexName})`);
        console.log("Provided: ", indexDefinition);
        console.log("Expected: ", expectedIndexDefinition);
        return false;
    }

    if (!allowedIndexChoices.includes(indexDefinition.indexChoice.toLowerCase())) {
        printErrorMessage(
            `Invalid index choice provided for '${entityName}' (${indexDefinition.indexName}): ${indexDefinition.indexChoice}`,
        );
        console.log("Allowed options: ", allowedIndexChoices.join(", "));
        return false;
    }

    if (!allowedIndexTypes.includes(indexDefinition.type.toUpperCase())) {
        printErrorMessage(`Invalid index type provided for '${entityName}' (${indexName})`);
        console.log("Allowed options: ", allowedIndexChoices.join(", "));
        return false;
    }

    return true;
};

const validateRelationship = (entityName, relationshipName, relationshipAttributes) => {
    if (!Object.keys(dataModel).includes(relationshipName)) {
        printErrorMessage(`Invalid attribute provided for '${entityName}' relationship: '${relationshipName}. 
    This attribute does not exist in the data model.`);
        return false;
    }

    if (!Array.isArray(relationshipAttributes)) {
        printErrorMessage(`${entityName} (${relationshipName}) related attributes are not provided as an array`);
        return false;
    }

    return true;
};

// TODO Implement checks
const validateOptions = (entityName, options = {}) => {
    const expectedOptionsDefinition = {
        type: "[MySQL column type]",
        lengthOrValues: "[null|int|if type is enum, then comma separated values '1','2','3',...]",
        default: "[value|null|CURRENT_TIMESTAMP]",
        allowNull: "[true|false]",
    };

    const optionProperties = Object.keys(options);

    if (!checkArraysAreEqual(optionProperties, Object.keys(expectedOptionsDefinition))) {
        printErrorMessage(`Invalid option definition for '${entityName}'`);
        console.log("Provided: ", options);
        console.log("Expected: ", expectedOptionsDefinition);
        return false;
    }

    return true;
};
//#endregion

export const validateDataBaseConfig = (databaseConfig = {}) => {
    if (!isValidObject(databaseConfig)) {
        printErrorMessage(`Database server configuration not provided as an object`);
        return false;
    }
    const expectedDatabaseConfig = {
        host: "The database server host name",
        user: "The database user name",
        password: "The database user password",
        database: "The actual database",
        port: 3306,
        ssl: "true|false",
        moduleSchemaMapping: [{ moduleName: "main", schemaName: "some_database_schema_name" }],
    };

    const databaseConfigProperties = Object.keys(databaseConfig);
    if (!checkArraysAreEqual(databaseConfigProperties, Object.keys(expectedDatabaseConfig))) {
        printErrorMessage(`Invalid database server configuration provided:`);
        console.log("Provided: ", databaseConfig);
        console.log("Expected: ", expectedDatabaseConfig);
        return false;
    }

    return databaseConfig;
};

const checkArraysAreEqual = (a, b) => {
    return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((val) => b.includes(val)) &&
        b.every((val) => a.includes(val))
    );
};
