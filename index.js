const dxDbConnector = require("dx-db-connector");
const dxUtils = require("dx-utilities");

/**
 * DivbloxDatabaseSync is responsible for taking a data model object, an example of which can be found in the tests
 * folder, and use it to modify a single database or multiple databases in order to align the database(s) with the given
 * model.
 */
class DivbloxDatabaseSync {
    /**
     * Basic initialization. Nothing special.
     * @param {*} dataModel The data model object that will be used to synchronize the database. An example can be found
     * in the tests folder "example-data-model.json"
     * @param {*} databaseConfig The database connection configuration. An example can be found in the tests folder
     * "database-configuration". The database config can have multiple "modules", each module respresents a separate
     * database that requires its own connection information
     * @param {dxDbConnector} dxDatabaseConnectorInstance Optional. If provided, we will use this connector rather than creating a
     * new one from the provided databaseConfig. This is useful if you want to use this class inside a Divblox project
     * that already includes the dxDbConnector
     * @param {string} databaseCaseImplementation Options: lowercase|PascalCase|CamelCase
     * If lowercase is selected, all table and column names will be converted to lowercase, splitted by an underscore _
     * If PascalCase is selected, all table and column names will be converted to Pascal case, assuming an underscore as
     * splitter in the data model
     * If CamelCase is selected, all table and column names will be converted to Camel case, assuming an underscore as
     * splitter in the data model
     * NOTE: Either Pascal or Camel case will require the database to be set up in such a manner to support this. It is
     * therefore recommended to stick to lowercase
     */
    constructor(
        dataModel = {},
        databaseConfig = {},
        dxDatabaseConnectorInstance = null,
        databaseCaseImplementation = "lowercase"
    ) {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        if (dxDatabaseConnectorInstance !== null) {
            this.databaseConnector = dxDatabaseConnectorInstance;
            this.databaseConfig = this.databaseConnector.databaseConfig;
        } else {
            this.databaseConnector = new dxDbConnector(this.databaseConfig);
        }
        this.commandLineHeadingFormatting = dxUtils.commandLineColors.foregroundCyan + dxUtils.commandLineColors.bright;
        this.commandLineSubHeadingFormatting = dxUtils.commandLineColors.foregroundCyan + dxUtils.commandLineColors.dim;
        this.commandLineWarningFormatting = dxUtils.commandLineColors.foregroundYellow;
        this.errorInfo = [];
        this.foreignKeyChecksDisabled = false;
        this.databaseCaseImplementation = databaseCaseImplementation;
        this.maxErrorLimitDefault = 50;
    }

    //#region Helpers
    /**
     * Outputs a piece of text to the command line, formatting it to appear as a heading.
     * @param sectionHeading The heading text to display
     */
    startNewCommandLineSection(sectionHeading = "") {
        let lineText = "";
        for (let i = 0; i < process.stdout.columns; i++) {
            lineText += "-";
        }

        dxUtils.outputFormattedLog(lineText, dxUtils.commandLineColors.foregroundCyan);
        dxUtils.outputFormattedLog(sectionHeading, this.commandLineHeadingFormatting);
        dxUtils.outputFormattedLog(lineText, dxUtils.commandLineColors.foregroundCyan);
    }

    /**
     * Returns the given inputString, formatted to align with the case implementation specified when instantiating this
     * class
     * @param inputString The string to normalize
     * @return {string} The normalized string
     */
    getCaseNormalizedString(inputString = "") {
        let preparedString = inputString;
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase":
                return dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
            case "pascalcase":
                preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
                return dxUtils.convertLowerCaseToPascalCase(preparedString, "_");
            case "camelcase":
                preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
                return dxUtils.convertLowerCaseToCamelCase(preparedString, "_");
            default:
                return dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
        }
    }

    /**
     * Returns the given inputString, formatted back to camelCase. This is because it is expected that a divblox data
     * model is ALWAYS defined using camelCase
     * @param inputString The string to denormalize
     * @return {string} The denormalized string
     */
    getCaseDenormalizedString(inputString = "") {
        // Since the data model expects camelCase, this function converts back to that
        let preparedString = inputString;
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase":
                return dxUtils.convertLowerCaseToCamelCase(inputString, "_");
            case "pascalcase":
            case "camelcase":
                preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
                return dxUtils.convertLowerCaseToCamelCase(preparedString, "_");
            default:
                return dxUtils.convertLowerCaseToCamelCase(inputString, "_");
        }
    }

    /**
     * A helper function that disables foreign key checks on the database
     * @return {Promise<void>}
     */
    async disableForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            const queryResult = await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 0", moduleName);
            if (queryResult === null) {
                this.populateError(
                    "Could not disable FK checks for '" + moduleName + "'",
                    this.databaseConnector.getLastError()
                );
            }
        }

        this.foreignKeyChecksDisabled = true;
    }

    /**
     * A helper function that enables foreign key checks on the database
     * @return {Promise<void>}
     */
    async restoreForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            const queryResult = await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 1", moduleName);
            if (queryResult === null) {
                this.populateError(
                    "Could not restore FK checks for '" + moduleName + "'",
                    this.databaseConnector.getLastError()
                );
            }
        }
        this.foreignKeyChecksDisabled = false;
    }

    /**
     * Returns the tables that are currently in the database
     * @return {Promise<{}>} Returns the name and type of each table
     */
    async getDatabaseTables() {
        let tables = {};
        for (const moduleName of Object.keys(this.databaseConfig)) {
            const moduleTables = await this.databaseConnector.queryDB("show full tables", moduleName);
            if (moduleTables === null) {
                this.populateError(
                    "Could not show full tables for '" + moduleName + "'",
                    this.databaseConnector.getLastError()
                );
            }

            const databaseName = this.databaseConfig[moduleName]["database"];

            for (let i = 0; i < moduleTables.length; i++) {
                const dataPacket = moduleTables[i];
                tables[dataPacket["Tables_in_" + databaseName]] = dataPacket["Table_type"];
            }
        }
        return tables;
    }

    /**
     * Determines which tables, defined as entities in the data model, should be newly created in the database
     * @return {*[]} An array of table names to create
     */
    getTablesToCreate() {
        const existingTablesArray = Object.keys(this.existingTables);
        return this.expectedTables.filter((x) => !existingTablesArray.includes(x));
    }

    /**
     * Determines which tables should be removed from the database. These are tables that are not defined as entities in
     * the given data model
     * @return {*[]} An array of table names to remove
     */
    getTablesToRemove() {
        const existingTablesArray = Object.keys(this.existingTables);
        return existingTablesArray.filter((x) => !this.expectedTables.includes(x));
    }

    /**
     * Prints the tables that are to be removed to the console
     */
    listTablesToRemove() {
        for (const table of this.tablesToRemove) {
            dxUtils.outputFormattedLog(
                table + " (" + this.existingTables[table] + ")",
                dxUtils.commandLineColors.foregroundGreen
            );
        }
    }

    /**
     * Returns a an array for each defined module that contains the entities for that module
     * @return {{}} Each key will be a module name. Each value will be an array of entity names
     */
    getEntityModuleMapping() {
        let entityModuleMapping = {};
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName].module;

            if (typeof entityModuleMapping[moduleName] === "undefined") {
                entityModuleMapping[moduleName] = [];
            }

            entityModuleMapping[moduleName].push(entityName);
        }

        return entityModuleMapping;
    }

    /**
     * Returns a an array for each defined module that contains the tables for that module. The difference between
     * entity and tables names is that entity names are ALWAYS camelCase, while table names will conform to the case
     * provided when instantiating this class
     * @return {{}} Each key will be a module name. Each value will be an array of table names
     */
    getTableModuleMapping() {
        let tableModuleMapping = {};
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName].module;

            if (typeof tableModuleMapping[moduleName] === "undefined") {
                tableModuleMapping[moduleName] = [];
            }

            tableModuleMapping[moduleName].push(this.getCaseNormalizedString(entityName));
        }

        return tableModuleMapping;
    }

    /**
     * A wrapper function that returns the "id" column, formatted to the correct case, that is used as the primary key
     * column for all tables
     * @return {string} Either "id" or "Id"
     */
    getPrimaryKeyColumn() {
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase":
                return "id";
            case "pascalcase":
                return "Id";
            case "camelcase":
                return "id";
            default:
                return "id";
        }
    }

    /**
     * Divblox supports logic in its built-in ORM that determines whether a locking constraint is in place when
     * attempting to update a specific table. A column "lastUpdated|LastUpdated|last_updated" is used to log when last
     * a given table was updated to determine whether a locking constraint should be applied.
     * @return {string} Either "lastUpdated", "LastUpdated" or "last_updated"
     */
    getLockingConstraintColumn() {
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase":
                return "last_updated";
            case "pascalcase":
                return "LastUpdated";
            case "camelcase":
                return "lastUpdated";
            default:
                return "last_updated";
        }
    }

    /**
     * Returns the columns that will be created in the database to represent the relationships for the given entity
     * @param entityName The name of the entity for which to determine relationship columns
     * @return {*[]} An array of column names
     */
    getEntityRelationshipColumns(entityName) {
        let entityRelationshipColumns = [];
        const entityRelationships = this.dataModel[entityName]["relationships"];
        for (const entityRelationship of Object.keys(entityRelationships)) {
            for (const relationshipName of entityRelationships[entityRelationship]) {
                const relationshipPart = this.getCaseNormalizedString(entityRelationship);
                const relationshipNamePart = this.getCaseNormalizedString(relationshipName);

                let columnName = "";
                switch (this.databaseCaseImplementation.toLowerCase()) {
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
    }

    /**
     * Returns the constraint and column name that will be created in the database to represent the relationships for the given entity
     * @param entityName The name of the entity for which to determine relationship columns
     * @return {*[]} An array of constraint and column names in an object
     */
    getEntityRelationshipConstraint(entityName) {
        let entityRelationshipConstraint = [];
        const entityRelationships = this.dataModel[entityName]["relationships"];
        for (const entityRelationship of Object.keys(entityRelationships)) {
            for (const relationshipName of entityRelationships[entityRelationship]) {
                const entityPart = this.getCaseNormalizedString(entityName);
                const relationshipPart = this.getCaseNormalizedString(entityRelationship);
                const relationshipNamePart = this.getCaseNormalizedString(relationshipName);

                let columnName = "";
                let constraintName = "";
                let splitter = "_";
                switch (this.databaseCaseImplementation.toLowerCase()) {
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
                const uniqueIdentifier = require("crypto").createHash("md5").update(uniqueIdentifierRaw).digest("hex");
                entityRelationshipConstraint.push({ columnName, constraintName: uniqueIdentifier });
            }
        }
        return entityRelationshipConstraint;
    }

    /**
     * Determines the relationship, as defined in the data model from the given column name
     * @param entityName The name of the entity for which to determine the defined relationship
     * @param relationshipColumnName The column name in the database that represents the relationship
     * @return {string|null} The name of the relationship as defined in the data model
     */
    getEntityRelationshipFromRelationshipColumn(entityName, relationshipColumnName) {
        const entityRelationships = this.dataModel[entityName]["relationships"];
        for (const entityRelationship of Object.keys(entityRelationships)) {
            for (const relationshipName of entityRelationships[entityRelationship]) {
                const relationshipPart = this.getCaseNormalizedString(entityRelationship);
                const relationshipNamePart = this.getCaseNormalizedString(relationshipName);

                let columnName = "";
                switch (this.databaseCaseImplementation.toLowerCase()) {
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
    }

    /**
     * Returns the names of the table columns expected for a given entity
     * @param entityName The name of the entity
     * @return {string[]} An array of column names
     */
    getEntityExpectedColumns(entityName) {
        let expectedColumns = [this.getPrimaryKeyColumn()];

        for (const attributeColumn of Object.keys(this.dataModel[entityName]["attributes"])) {
            expectedColumns.push(this.getCaseNormalizedString(attributeColumn));
        }

        for (const relationshipColumn of this.getEntityRelationshipColumns(entityName)) {
            expectedColumns.push(this.getCaseNormalizedString(relationshipColumn));
        }

        if (
            typeof this.dataModel[entityName]["options"] !== "undefined" &&
            typeof this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined"
        ) {
            if (this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== false) {
                expectedColumns.push(this.getLockingConstraintColumn());
            }
        }

        return expectedColumns;
    }

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
    getAlterColumnSql(columnName = "", columnDataModelObject = {}, operation = "MODIFY") {
        let sql = operation + " COLUMN " + columnName + " " + columnDataModelObject["type"];

        if (columnName === this.getPrimaryKeyColumn()) {
            sql =
                operation +
                " COLUMN `" +
                this.getPrimaryKeyColumn() +
                "` BIGINT NOT NULL AUTO_INCREMENT FIRST, ADD PRIMARY KEY (`" +
                this.getPrimaryKeyColumn() +
                "`);";
            return sql;
        }

        if (columnDataModelObject["lengthOrValues"] !== null) {
            sql += "(" + columnDataModelObject["lengthOrValues"] + ")";
        }

        if (columnDataModelObject["allowNull"] === false) {
            sql += " NOT NULL";
        }

        if (columnDataModelObject["default"] !== null) {
            if (columnDataModelObject["default"] !== "CURRENT_TIMESTAMP") {
                sql += " DEFAULT '" + columnDataModelObject["default"] + "';";
            } else {
                sql += " DEFAULT CURRENT_TIMESTAMP;";
            }
        } else if (columnDataModelObject["allowNull"] !== false) {
            sql += " DEFAULT NULL;";
        }

        return sql;
    }
    //#endregion

    /**
     * The main synchronization function that orchestrates all the work. The following steps are performed:
     * @param {boolean} skipUserPrompts Forces default selections for all user prompts during syncronisation
     * 1. Check the integrity of the given data model to ensure we can perform the synchronization
     * 2. Remove tables that are not in the data model
     * 3. Create any new tables that are in the data model but not in the database
     * 4. Loop through all the entities in the data model and update their corresponding database tables
     *    to ensure that their columns match the data model attribute names and types
     * 5. Loop through all the entities in the data model and update their corresponding database tables
     *    to ensure that their indexes match the data model indexes
     * 6. Loop through all the entities in the data model and update their corresponding database tables
     *    to ensure that their relationships match the data model relationships. Here we either create new
     *    foreign key constraints or drop existing ones where necessary
     * @return {Promise<boolean>} Will return false if anything fails. Reasons will be printed to the console.
     */
    async syncDatabase(skipUserPrompts = false) {
        this.startNewCommandLineSection("Starting database sync...");

        dxUtils.outputFormattedLog(
            "This operation will modify the existing database to align " +
            "with the provided data model.\nEnsure that you have backed up the database if you do not want to risk any data loss.",
            dxUtils.commandLineColors.foregroundYellow
        );

        let answer = "y";
        if (!skipUserPrompts) {
            answer = await dxUtils.getCommandLineInput("Ready to proceed? (y/n)");
        }

        if (answer.toString().toLowerCase() !== "y") {
            this.printCustomErrorMessage("Database sync cancelled.");
            return false;
        }

        const initSuccess = await this.databaseConnector.init();

        if (!initSuccess) {
            this.printCustomErrorMessage("Database init failed: ");
            this.databaseConnector.printLastError();
            return false;
        }

        // 1. Check the integrity of the given data model to ensure we can perform the synchronization
        if (!(await this.checkDataModelIntegrity())) {
            this.printCustomErrorMessage("Data model integrity check failed!");
            this.printLastError();
            return false;
        } else {
            dxUtils.outputFormattedLog("Data model integrity check succeeded!", this.commandLineSubHeadingFormatting);
        }

        dxUtils.outputFormattedLog("Analyzing database...", this.commandLineSubHeadingFormatting);

        this.existingTables = await this.getDatabaseTables();
        this.expectedTables = [];
        for (const expectedTable of Object.keys(this.dataModel)) {
            this.expectedTables.push(this.getCaseNormalizedString(expectedTable));
        }

        this.tablesToCreate = this.getTablesToCreate();
        this.tablesToRemove = this.getTablesToRemove();

        console.log("Database currently has " + Object.keys(this.existingTables).length + " table(s)");
        console.log("Based on the data model, we are expecting " + this.expectedTables.length + " table(s)");

        // 2. Remove tables that are not in the data model
        if (!(await this.removeTables(skipUserPrompts))) {
            this.printCustomErrorMessage("Error while attempting to remove tables");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("Database clean up completed!", this.commandLineSubHeadingFormatting);
        }

        // 3. Create any new tables that are in the data model but not in the database
        if (!(await this.createTables())) {
            this.printCustomErrorMessage("Error while attempting to create new tables");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("Table creation completed!", this.commandLineSubHeadingFormatting);
        }

        // 4a. We call updateRelationships here to ensure any redundant foreign key constraints are removed before
        //      attempting to update the tables. This sidesteps any constraint-related errors
        if (!(await this.updateRelationships(true))) {
            this.printCustomErrorMessage("Error while attempting to remove relationships");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("No redundant relationships!", this.commandLineSubHeadingFormatting);
        }

        // 4. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their columns match the data model attribute names and types
        if (!(await this.updateTables())) {
            this.printCustomErrorMessage("Error while attempting to update tables");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("Table modification completed!", this.commandLineSubHeadingFormatting);
        }

        // 5. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their indexes match the data model indexes
        if (!(await this.updateIndexes())) {
            this.printCustomErrorMessage("Error while attempting to update indexes");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("Indexes up to date!", this.commandLineSubHeadingFormatting);
        }

        // 6. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their relationships match the data model relationships. Here we either create new
        //      foreign key constraints or drop existing ones where necessary
        if (!(await this.updateRelationships())) {
            this.printCustomErrorMessage("Error while attempting to update relationships");
            this.printLastError();

            if (this.foreignKeyChecksDisabled) {
                await this.restoreForeignKeyChecks();
            }

            return false;
        } else {
            dxUtils.outputFormattedLog("Relationships up to date!", this.commandLineSubHeadingFormatting);
        }

        this.startNewCommandLineSection("Database sync completed successfully!");
        return true;
    }

    /**
     * Performs an integrity check on the provided data model to ensure that it aligns with our expectation
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async checkDataModelIntegrity() {
        this.startNewCommandLineSection("Data model integrity check.");

        const entities = this.dataModel;
        if (entities.length === 0) {
            this.populateError("Data model has no entities defined");
            return false;
        }
        const baseKeys = ["module", "attributes", "indexes", "relationships", "options"];
        for (const entityName of Object.keys(entities)) {
            const entityObj = entities[entityName];

            for (const baseKey of baseKeys) {
                if (typeof entityObj[baseKey] === "undefined") {
                    this.populateError("Entity " + entityName + " has no " + baseKey + " definition");
                    return false;
                }
            }

            const moduleName = entityObj["module"];
            if (typeof this.databaseConfig[moduleName] === "undefined") {
                this.populateError(
                    "Entity " +
                    entityName +
                    " has an invalid module name provided. '" +
                    moduleName +
                    "' is not defined in the database configuration"
                );
                return false;
            }

            const attributes = entityObj["attributes"];
            if (attributes.length === 0) {
                this.populateError("Entity " + entityName + " has no attributes provided");
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
                    this.populateError(
                        "Invalid attribute definition for '" +
                        entityName +
                        "' ('" +
                        attributeName +
                        "'). Expected: " +
                        JSON.stringify(expectedAttributeDefinition, null, 2)
                    );
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
                this.populateError(
                    "Invalid index definition for '" +
                    entityName +
                    "'. Expected: " +
                    JSON.stringify(expectedIndexesDefinition, null, 2)
                );
                return false;
            }

            for (const index of entityObj["indexes"]) {
                if (JSON.stringify(Object.keys(index)) !== JSON.stringify(Object.keys(expectedIndexesDefinition))) {
                    this.populateError(
                        "Invalid index definition for '" +
                        entityName +
                        "'. Expected: " +
                        JSON.stringify(expectedIndexesDefinition, null, 2)
                    );
                    return false;
                }
            }

            const expectedRelationshipDefinition = {
                relationshipEntity: ["relationshipOneName", "relationshipTwoName"],
            };

            for (const relationshipName of Object.keys(entityObj["relationships"])) {
                if (typeof entityObj["relationships"][relationshipName] !== "object") {
                    this.populateError(
                        "Invalid relationship definition for '" +
                        entityName +
                        "'. Expected: " +
                        JSON.stringify(expectedRelationshipDefinition, null, 2)
                    );
                    return false;
                }
            }
        }

        for (const moduleName of Object.keys(this.databaseConfig)) {
            const innoDbCheckResult = await this.databaseConnector.queryDB("SHOW ENGINES", moduleName);
            if (innoDbCheckResult === null) {
                this.populateError("Could not check database engine", this.databaseConnector.getLastError());
                return false;
            }

            for (const row of innoDbCheckResult) {
                if (row["Engine"].toLowerCase() === "innodb") {
                    if (row["Support"].toLowerCase() !== "default") {
                        this.populateError("The active database engine is NOT InnoDB. Cannot proceed.");
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * Handles the removal of tables from the database
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async removeTables(skipUserPrompts = false) {
        this.startNewCommandLineSection("Existing table clean up");

        if (this.tablesToRemove.length === 0) {
            console.log("There are no tables to remove.");
            return true;
        }

        let answer = "none";
        if (!skipUserPrompts) {
            answer = await dxUtils.getCommandLineInput(
                "Removing tables that are not defined in the provided " +
                "data model...\n" +
                this.tablesToRemove.length +
                " tables should be removed.\n" +
                "How would you like to proceed?\nType 'y' to confirm & remove one-by-one;\nType 'all' to remove all;\n" +
                "Type 'none' to skip removing any tables;\nType 'list' to show tables that will be removed (y|all|none|list)"
            );
        }

        switch (answer.toString().toLowerCase()) {
            case "list":
                this.listTablesToRemove();
                const answerList = await dxUtils.getCommandLineInput(
                    "How would you like to proceed?\n" +
                    "Type 'y' to confirm & remove one-by-one;\nType 'all' to remove all;\n" +
                    "Type 'none' to skip removing any tables; (y|all|none)"
                );
                switch (answerList.toString().toLowerCase()) {
                    case "all":
                        await this.removeTablesRecursive(false);
                        break;
                    case "y":
                        await this.removeTablesRecursive(true);
                        break;
                    case "none":
                        return true;
                    default:
                        this.populateError("Invalid selection. Please try again.");
                        return false;
                }
                break;
            case "all":
                await this.removeTablesRecursive(false);
                break;
            case "y":
                await this.removeTablesRecursive(true);
                break;
            case "none":
                return true;
            default:
                this.populateError("Invalid selection. Please try again.");
                return false;
        }

        return true;
    }

    /**
     * A function that is called recursively to remove tables. This is to allow for the removal of tables, one-by-one
     * with confirmation
     * @param {boolean} mustConfirm If true, it means we are doing one-by-one
     * @return {Promise<void>}
     */
    async removeTablesRecursive(mustConfirm = true) {
        const tableModuleMapping = this.getTableModuleMapping();

        if (!this.foreignKeyChecksDisabled) {
            await this.disableForeignKeyChecks();
        }

        if (!mustConfirm) {
            // Not going to be recursive. Just a single call to drop all relevant tables
            for (const moduleName of Object.keys(this.databaseConfig)) {
                if (typeof tableModuleMapping[moduleName] !== undefined && tableModuleMapping[moduleName].length > 0) {
                    const tablesToDrop = this.tablesToRemove.filter((x) => !tableModuleMapping[moduleName].includes(x));
                    const tablesToDropStr = tablesToDrop.join(",");

                    const queryResult = await this.databaseConnector.queryDB(
                        "DROP TABLE if exists " + tablesToDropStr,
                        moduleName
                    );
                    if (queryResult === null) {
                        dxUtils.outputFormattedLog(
                            "Error dropping tables '" + tablesToDropStr + "':",
                            this.commandLineWarningFormatting
                        );
                        dxUtils.outputFormattedLog(
                            this.databaseConnector.getLastError(),
                            this.commandLineWarningFormatting
                        );
                    } else {
                        dxUtils.outputFormattedLog(
                            "Removed table(s): " + tablesToDropStr,
                            this.commandLineSubHeadingFormatting
                        );
                    }
                }
            }
        } else {
            if (this.tablesToRemove.length === 0) {
                return;
            }

            const answer = await dxUtils.getCommandLineInput('Drop table "' + this.tablesToRemove[0] + '"? (y/n)');
            if (answer.toString().toLowerCase() === "y") {
                for (const moduleName of Object.keys(this.databaseConfig)) {
                    const dropResult = await this.databaseConnector.queryDB(
                        "DROP TABLE if exists " + this.tablesToRemove[0],
                        moduleName
                    );

                    if (dropResult === null) {
                        this.populateError(
                            "Could not drop table '" + this.tablesToRemove[0] + "'",
                            this.databaseConnector.getLastError()
                        );
                    }
                }
            }

            this.tablesToRemove.shift();

            await this.removeTablesRecursive(true);
        }

        if (this.foreignKeyChecksDisabled) {
            await this.restoreForeignKeyChecks();
        }
    }

    /**
     * Creates all the relevant tables along with their primary key column
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async createTables() {
        this.startNewCommandLineSection("Create new tables");

        if (this.tablesToCreate.length === 0) {
            console.log("There are no tables to create.");
            return true;
        }

        console.log(this.tablesToCreate.length + " new table(s) to create.");
        const dataModelTablesToCreate = Object.fromEntries(
            Object.entries(this.dataModel).filter(([key]) => this.tablesToCreate.includes(key))
        );
        console.log(dataModelTablesToCreate);

        for (const tableName of this.tablesToCreate) {
            const tableNameDataModel = this.getCaseDenormalizedString(tableName);
            const moduleName = this.dataModel[tableNameDataModel]["module"];
            const createTableSql =
                "CREATE TABLE `" +
                tableName +
                "` ( `" +
                this.getPrimaryKeyColumn() +
                "` " +
                "BIGINT NOT NULL AUTO_INCREMENT , PRIMARY KEY (`" +
                this.getPrimaryKeyColumn() +
                "`));";

            const createResult = await this.databaseConnector.queryDB(createTableSql, moduleName);
            if (createResult === null) {
                this.populateError("Could not create table '" + tableName + "'", this.databaseConnector.getLastError());
                return false;
            }
        }

        return true;
    }

    /**
     * Cycles through all the tables to ensure that they align with their data model definition
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async updateTables() {
        this.startNewCommandLineSection("Update existing tables");

        if (!this.foreignKeyChecksDisabled) {
            await this.disableForeignKeyChecks();
        }

        let updatedTables = [];
        let sqlQuery = {};

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];

            if (typeof sqlQuery[moduleName] === "undefined") {
                sqlQuery[moduleName] = [];
            }

            const tableName = this.getCaseNormalizedString(entityName);
            const tableColumns = await this.databaseConnector.queryDB(
                "SHOW FULL COLUMNS FROM " + tableName,
                moduleName
            );

            let tableColumnsNormalized = {};

            const entityAttributes = this.dataModel[entityName]["attributes"];
            const expectedColumns = this.getEntityExpectedColumns(entityName);

            let attributesProcessed = [];
            let relationshipsProcessed = [];

            for (const tableColumn of tableColumns) {
                const columnName = tableColumn["Field"];
                const columnAttributeName = this.getCaseDenormalizedString(columnName);
                attributesProcessed.push(columnAttributeName);

                if (columnAttributeName === this.getPrimaryKeyColumn()) {
                    continue;
                }

                // Let's check for columns to drop
                if (!expectedColumns.includes(columnName)) {
                    sqlQuery[moduleName].push(
                        "ALTER TABLE `" + tableName + "` DROP COLUMN " + tableColumn["Field"] + ";"
                    );
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

                for (const columnOption of Object.keys(tableColumnsNormalized[tableColumn["Field"]])) {
                    if (typeof entityAttributes[columnAttributeName] === "undefined") {
                        if (columnName !== this.getLockingConstraintColumn()) {
                            // This must mean that the column is a foreign key column
                            if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "bigint") {
                                // This column needs to be fixed. Somehow its type got changed
                                sqlQuery[moduleName].push(
                                    "ALTER TABLE `" + tableName + "` MODIFY COLUMN `" + columnName + "` BIGINT(20);"
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
                                    "ALTER TABLE `" +
                                    tableName +
                                    "` MODIFY COLUMN `" +
                                    columnName +
                                    "` datetime DEFAULT CURRENT_TIMESTAMP;"
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
                        columnOption === "lengthOrValues" &&
                        entityAttributes[columnAttributeName][columnOption] !== null
                            ? entityAttributes[columnAttributeName][columnOption].toString()
                            : entityAttributes[columnAttributeName][columnOption];

                    if (dataModelOption !== tableColumnsNormalized[tableColumn["Field"]][columnOption]) {
                        sqlQuery[moduleName].push(
                            "ALTER TABLE `" +
                            tableName +
                            "` " +
                            this.getAlterColumnSql(columnName, entityAttributes[columnAttributeName], "MODIFY")
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
            entityAttributesArray.push(this.getCaseDenormalizedString(this.getPrimaryKeyColumn()));

            if (
                typeof this.dataModel[entityName]["options"] !== "undefined" &&
                typeof this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined"
            ) {
                if (this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== false) {
                    entityAttributesArray.push(this.getCaseDenormalizedString(this.getLockingConstraintColumn()));
                }
            }
            const columnsToCreate = entityAttributesArray.filter((x) => !attributesProcessed.includes(x));

            for (const columnToCreate of columnsToCreate) {
                const columnName = this.getCaseNormalizedString(columnToCreate);

                const columnDataModelObject =
                    columnToCreate === this.getCaseDenormalizedString(this.getLockingConstraintColumn())
                        ? {
                            type: "datetime",
                            lengthOrValues: null,
                            default: "CURRENT_TIMESTAMP",
                            allowNull: false,
                        }
                        : entityAttributes[columnToCreate];

                sqlQuery[moduleName].push(
                    "ALTER TABLE `" +
                    tableName +
                    "` " +
                    this.getAlterColumnSql(columnName, columnDataModelObject, "ADD")
                );

                if (!updatedTables.includes(entityName)) {
                    updatedTables.push(entityName);
                }
            }

            const entityRelationshipColumns = this.getEntityRelationshipColumns(entityName);
            const relationshipColumnsToCreate = entityRelationshipColumns.filter(
                (x) => !relationshipsProcessed.includes(x)
            );

            for (const relationshipColumnToCreate of relationshipColumnsToCreate) {
                sqlQuery[moduleName].push(
                    "ALTER TABLE `" + tableName + "` ADD COLUMN `" + relationshipColumnToCreate + "` BIGINT(20);"
                );

                if (!updatedTables.includes(entityName)) {
                    updatedTables.push(entityName);
                }
            }
        }

        for (const moduleName of Object.keys(sqlQuery)) {
            if (sqlQuery[moduleName].length === 0) {
                continue;
            }

            for (const query of sqlQuery[moduleName]) {
                const queryResult = await this.databaseConnector.queryDB(query, moduleName);
                if (queryResult === null) {
                    this.populateError("Could not execute query", this.databaseConnector.getLastError());
                    return false;
                }
            }
        }

        console.log(updatedTables.length + " tables were updated");

        if (this.foreignKeyChecksDisabled) {
            await this.restoreForeignKeyChecks();
        }

        return true;
    }

    /**
     * Cycles through all the indexes for each table to ensure they align with their data model definition
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async updateIndexes() {
        this.startNewCommandLineSection("Update indexes");

        if (!this.foreignKeyChecksDisabled) {
            await this.disableForeignKeyChecks();
        }

        let updatedIndexes = { added: 0, removed: 0 };

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = this.getCaseNormalizedString(entityName);

            const indexCheckResult = await this.databaseConnector.queryDB("SHOW INDEX FROM " + tableName, moduleName);
            let existingIndexes = [];

            for (const index of indexCheckResult) {
                existingIndexes.push(index["Key_name"]);
            }

            const entityRelationshipConstraints = this.getEntityRelationshipConstraint(entityName);
            const expectedIndexes = entityRelationshipConstraints.map((obj) => obj.constraintName);

            for (const indexObj of this.dataModel[entityName]["indexes"]) {
                const indexName = this.getCaseNormalizedString(indexObj["indexName"]);
                expectedIndexes.push(indexName);

                if (!existingIndexes.includes(indexName)) {
                    // Let's add this index
                    const keyColumn = this.getCaseNormalizedString(indexObj["attribute"]);

                    switch (indexObj["indexChoice"].toLowerCase()) {
                        case "index":
                            const indexAddResult = await this.databaseConnector.queryDB(
                                "ALTER TABLE `" +
                                tableName +
                                "` ADD INDEX `" +
                                indexName +
                                "` (`" +
                                keyColumn +
                                "`) USING " +
                                indexObj["type"] +
                                ";",
                                moduleName
                            );

                            if (indexAddResult === null) {
                                this.populateError(
                                    "Could not add INDEX '" + indexName + "' to table '" + tableName + "'",
                                    this.databaseConnector.getLastError()
                                );

                                return false;
                            }
                            break;
                        case "unique":
                            const uniqueAddResult = await this.databaseConnector.queryDB(
                                "ALTER TABLE `" +
                                tableName +
                                "` ADD UNIQUE `" +
                                indexName +
                                "` (`" +
                                keyColumn +
                                "`) USING " +
                                indexObj["type"] +
                                ";",
                                moduleName
                            );

                            if (uniqueAddResult === null) {
                                this.populateError(
                                    "Could not add UNIQUE '" + indexName + "' to table '" + tableName + "'",
                                    this.databaseConnector.getLastError()
                                );

                                return false;
                            }
                            break;
                        case "spatial":
                            const spatialAddResult = await this.databaseConnector.queryDB(
                                "ALTER TABLE `" + tableName + "` ADD SPATIAL `" + indexName + "` (`" + keyColumn + "`)",
                                moduleName
                            );

                            if (spatialAddResult === null) {
                                this.populateError(
                                    "Could not add SPATIAL '" + indexName + "' to table '" + tableName + "'",
                                    this.databaseConnector.getLastError()
                                );

                                return false;
                            }
                            break;
                        case "fulltext":
                            const fulltextAddResult = await this.databaseConnector.queryDB(
                                "ALTER TABLE `" +
                                tableName +
                                "` ADD FULLTEXT `" +
                                indexName +
                                "` (`" +
                                keyColumn +
                                "`)",
                                moduleName
                            );

                            if (fulltextAddResult === null) {
                                this.populateError(
                                    "Could not add FULLTEXT '" + indexName + "' to table '" + tableName + "'",
                                    this.databaseConnector.getLastError()
                                );

                                return false;
                            }
                            break;
                        default:
                            this.populateError(
                                "Invalid index choice specified for " +
                                "'" +
                                indexObj["indexName"] +
                                "' on '" +
                                entityName +
                                "'. " +
                                "Provided: " +
                                indexObj["indexChoice"] +
                                "; " +
                                "Valid options: index|unique|fulltext|spatial"
                            );

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
                    const dropQuery = "ALTER TABLE `" + tableName + "` DROP INDEX `" + existingIndex + "`";
                    const dropResult = await this.databaseConnector.queryDB(dropQuery, moduleName);
                    if (dropResult === null) {
                        this.populateError(
                            "Could not drop INDEX '" + existingIndex + "' to table '" + tableName + "'",
                            this.databaseConnector.getLastError()
                        );

                        return false;
                    }

                    updatedIndexes.removed++;
                }
            }
        }

        console.log(updatedIndexes.added + " Indexes added. " + updatedIndexes.removed + " Indexes removed.");

        if (this.foreignKeyChecksDisabled) {
            await this.restoreForeignKeyChecks();
        }

        return true;
    }

    /**
     * Cycles through all the relationships for each table to ensure they align with their data model definition
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async updateRelationships(dropOnly = false) {
        if (dropOnly) {
            this.startNewCommandLineSection("Removing redundant relationships");
        } else {
            this.startNewCommandLineSection("Update relationships");
        }

        if (!this.foreignKeyChecksDisabled) {
            await this.disableForeignKeyChecks();
        }

        let updatedRelationships = { added: 0, removed: 0 };

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = this.getCaseNormalizedString(entityName);
            const schemaName = this.databaseConfig[moduleName]["database"];

            const listForeignKeysQuery = `SELECT * FROM information_schema.REFERENTIAL_CONSTRAINTS 
            WHERE TABLE_NAME = '${tableName}' AND CONSTRAINT_SCHEMA = '${schemaName}';`;

            const listForeignKeysResult = await this.databaseConnector.queryDB(listForeignKeysQuery, moduleName);
            let existingForeignKeys = [];
            const entityRelationshipConstraints = this.getEntityRelationshipConstraint(entityName);

            for (const foreignKeyResult of listForeignKeysResult) {
                let foundConstraint = null;
                if (entityRelationshipConstraints.length) {
                    foundConstraint = entityRelationshipConstraints.find(
                        (obj) => obj.constraintName === foreignKeyResult.CONSTRAINT_NAME
                    );
                }

                if (!foundConstraint) {
                    const dropQuery =
                        "ALTER TABLE `" +
                        schemaName +
                        "`.`" +
                        tableName +
                        "` DROP FOREIGN KEY `" +
                        foreignKeyResult.CONSTRAINT_NAME +
                        "`;";
                    const foreignKeyDeleteResult = await this.databaseConnector.queryDB(dropQuery, moduleName);
                    if (foreignKeyDeleteResult === null) {
                        this.populateError(
                            "Could not drop FK '" + foreignKeyResult.CONSTRAINT_NAME + "'",
                            this.databaseConnector.getLastError()
                        );

                        return false;
                    }

                    updatedRelationships.removed++;
                } else {
                    existingForeignKeys.push(foreignKeyResult.CONSTRAINT_NAME);
                }
            }

            if (dropOnly) {
                continue;
            }

            const foreignKeysToCreate = entityRelationshipConstraints.filter(
                (x) => !existingForeignKeys.includes(x.constraintName)
            );
            for (const foreignKeyToCreate of foreignKeysToCreate) {
                const entityRelationship = this.getEntityRelationshipFromRelationshipColumn(
                    entityName,
                    foreignKeyToCreate.columnName
                );

                const createQuery =
                    "ALTER TABLE `" +
                    tableName +
                    "` ADD CONSTRAINT `" +
                    foreignKeyToCreate.constraintName +
                    "` FOREIGN KEY (`" +
                    foreignKeyToCreate.columnName +
                    "`) REFERENCES `" +
                    this.getCaseNormalizedString(entityRelationship) +
                    "`(`" +
                    this.getPrimaryKeyColumn() +
                    "`) ON DELETE SET NULL ON UPDATE CASCADE;";
                const createResult = await this.databaseConnector.queryDB(createQuery, moduleName);
                if (createResult === null) {
                    this.populateError(
                        "Could not add FK '" + foreignKeyToCreate + "'",
                        this.databaseConnector.getLastError()
                    );

                    return false;
                }

                updatedRelationships.added++;
            }
        }

        console.log(
            updatedRelationships.added +
            " Relationships added. " +
            updatedRelationships.removed +
            " Relationships removed."
        );

        if (this.foreignKeyChecksDisabled) {
            await this.restoreForeignKeyChecks();
        }

        return true;
    }

    //#region Error handling

    /**
     * Outputs a piece of text to the command line, formatting it to appear as an error.
     * @param message The error text to display
     */
    printCustomErrorMessage(message = "") {
        dxUtils.outputFormattedLog(message, dxUtils.commandLineColors.foregroundRed);
    }

    /**
     * Whenever Divblox encounters an error, the errorInfo array should be populated with details about the error. This
     * function simply returns that errorInfo array for debugging purposes
     * @returns {[]}
     */
    getError() {
        return this.errorInfo;
    }

    /**
     * Returns the latest error that was pushed, as an error object
     * @returns {DxBaseError|null}} The latest error
     */
    getLastError() {
        let lastError = null;

        if (this.errorInfo.length > 0) {
            lastError = this.errorInfo[this.errorInfo.length - 1];
        }

        return lastError;
    }

    /**
     * Prints to console the latest error message
     */
    printLastError() {
        console.dir(this.getLastError(), { depth: null });
    }

    /**
     * Pushes a new error object/string into the error array
     * @param {dxErrorStack|DxBaseError|string} errorToPush An object or string containing error information
     * @param {dxErrorStack|DxBaseError|null} errorStack An object, containing error information
     */
    populateError(errorToPush = "", errorStack = null) {
        let message = "No message provided";
        if (!errorToPush) {
            errorToPush = message;
        }

        if (!errorStack) {
            errorStack = errorToPush;
        }

        if (typeof errorToPush === "string") {
            message = errorToPush;
        } else if (
            dxUtils.isValidObject(errorToPush) ||
            errorToPush instanceof DxBaseError ||
            errorToPush instanceof Error
        ) {
            message = errorToPush.message ? errorToPush.message : "No message provided";
        } else {
            this.populateError(
                "Invalid error type provided, errors can be only of type string/Object/Error/DxBaseError"
            );
            return;
        }

        // Only the latest error to be of type DxBaseError
        let newErrorStack = {
            callerClass: errorStack.callerClass ? errorStack.callerClass : this.constructor.name,
            message: message ? message : errorStack.message ? errorStack.message : "No message provided",
            errorStack: errorStack.errorStack
                ? errorStack.errorStack
                : typeof errorStack === "string"
                    ? null
                    : errorStack,
        };

        const error = new DxBaseError(message, this.constructor.name, newErrorStack);

        // Make sure to keep the deepest stackTrace
        if (errorStack instanceof DxBaseError || errorStack instanceof Error) {
            error.stack = errorStack.stack;
        }

        if (this.errorInfo.length > process.env.MAX_ERROR_LIMIT ?? this.maxErrorLimitDefault) {
            this.errorInfo.splice(0, this.errorInfo.length - process.env.MAX_ERROR_LIMIT ?? this.maxErrorLimitDefault);
        }

        this.errorInfo.push(error);
        return;
    }

    /**
     * Resets the error info array
     */
    resetError() {
        this.errorInfo = [];
    }

    //#endregion
}

class DxBaseError extends Error {
    constructor(message = "", callerClass = "", errorStack = null, ...params) {
        // Pass remaining arguments (including vendor specific ones) to parent constructor
        super(...params);

        // Maintains proper stack trace for where our error was thrown (only available on V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DxBaseError);
        }

        this.name = "DxBaseError";

        // Custom debugging information
        this.message = message;
        this.callerClass = callerClass;
        this.dateTimeOccurred = new Date();
        this.errorStack = errorStack;
    }
}

module.exports = DivbloxDatabaseSync;
