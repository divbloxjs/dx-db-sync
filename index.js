const dxDbConnector = require('dx-db-connector');
const dxUtils = require('dx-utils');

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
     * @param {string} databaseCaseImplementation Options: lowercase|PascalCase|CamelCase
     * If lowercase is selected, all table and column names will be converted to lowercase, splitted by an underscore _
     * If PascalCase is selected, all table and column names will be converted to Pascal case, assuming an underscore as
     * splitter in the data model
     * If CamelCase is selected, all table and column names will be converted to Camel case, assuming an underscore as
     * splitter in the data model
     * NOTE: Either Pascal or Camel case will require the database to be set up in such a manner to support this. It is
     * therefore recommended to stick to lowercase
     */
    constructor(dataModel = {}, databaseConfig = {}, databaseCaseImplementation = "lowercase") {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        this.databaseConnector = new dxDbConnector(this.databaseConfig);
        this.commandLineHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.bright;
        this.commandLineSubHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.dim;
        this.commandLineWarningFormatting = dxUtils.commandLineColors.foregroundYellow;
        this.errorInfo = [];
        this.foreignKeyChecksDisabled = false;
        this.databaseCaseImplementation = databaseCaseImplementation;
    }

    //#region Helpers
    /**
     * Outputs a piece of text to the command line, formatting it to appear as a heading.
     * @param sectionHeading The heading text to display
     */
    startNewCommandLineSection(sectionHeading = "") {
        let lineText = '';
        for (let i=0;i<process.stdout.columns;i++) {
            lineText += '-';
        }
        dxUtils.outputFormattedLog(lineText,dxUtils.commandLineColors.foregroundCyan);
        dxUtils.outputFormattedLog(sectionHeading,this.commandLineHeadingFormatting);
        dxUtils.outputFormattedLog(lineText,dxUtils.commandLineColors.foregroundCyan);
    }

    /**
     * Outputs a piece of text to the command line, formatting it to appear as an error.
     * @param message The error text to display
     */
    printError(message = '') {
        dxUtils.outputFormattedLog(message,
            dxUtils.commandLineColors.foregroundRed);
    }

    /**
     * Returns the given inputString, formatted to align with the case implementation specified when instantiating this
     * class
     * @param inputString The string to normalize
     * @return {string} The normalized string
     */
    getCaseNormalizedString(inputString = '') {
        let preparedString = inputString;
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase": return dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
            case "pascalcase": preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString,"_");
                return dxUtils.convertLowerCaseToPascalCase(preparedString, "_");
            case "camelcase": preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString,"_");
                return dxUtils.convertLowerCaseToCamelCase(preparedString, "_");
            default: return dxUtils.getCamelCaseSplittedToLowerCase(inputString, "_");
        }
    }

    /**
     * Returns the given inputString, formatted back to camelCase. This is because it is expected that a divblox data
     * model is ALWAYS defined using camelCase
     * @param inputString The string to denormalize
     * @return {string} The denormalized string
     */
    getCaseDenormalizedString(inputString = '') {
        // Since the data model expects camelCase, this function converts back to that
        let preparedString = inputString;
        switch (this.databaseCaseImplementation.toLowerCase()) {
            case "lowercase": return dxUtils.convertLowerCaseToCamelCase(inputString, "_");
            case "pascalcase":
            case "camelcase": preparedString = dxUtils.getCamelCaseSplittedToLowerCase(inputString,"_");
                return dxUtils.convertLowerCaseToCamelCase(preparedString, "_");
            default: return dxUtils.convertLowerCaseToCamelCase(inputString, "_");
        }
    }

    /**
     * Returns the tables that are currently in the database
     * @return {Promise<{}>} Returns the name and type of each table
     */
    async getDatabaseTables() {
        let tables = {};
        for (const moduleName of Object.keys(this.databaseConfig)) {
            const moduleTables = await this.databaseConnector.queryDB("show full tables", moduleName);
            const databaseName = this.databaseConfig[moduleName]["database"];
            for (let i=0; i < moduleTables.length; i++) {
                const dataPacket = moduleTables[i];
                tables[dataPacket["Tables_in_"+databaseName]] = dataPacket["Table_type"];
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
        return this.expectedTables.filter(x => !existingTablesArray.includes(x));
    }

    /**
     * Determines which tables should be removed from the database. These are tables that are not defined as entities in
     * the given data model
     * @return {*[]} An array of table names to remove
     */
    getTablesToRemove() {
        const existingTablesArray = Object.keys(this.existingTables);
        return existingTablesArray.filter(x => !this.expectedTables.includes(x));
    }

    /**
     * Prints the tables that are to be removed to the console
     */
    listTablesToRemove() {
        for (const table of this.tablesToRemove) {
            dxUtils.outputFormattedLog(table+" ("+this.existingTables[table]+")",dxUtils.commandLineColors.foregroundGreen);
        }
    }

    /**
     * Returns a an array for each defined module that contains the entities for that module
     * @return {{}} Each key will be a module. Each value will be an array of entity names
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
     * @return {{}} Each key will be a module. Each value will be an array of table names
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
            case "lowercase": return "id";
            case "pascalcase": return "Id";
            case "camelcase": return "id";
            default: return "id";
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
            case "lowercase": return "last_updated";
            case "pascalcase": return "LastUpdated";
            case "camelcase": return "lastUpdated";
            default: return "last_updated";
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

                let columnName = '';
                switch (this.databaseCaseImplementation.toLowerCase()) {
                    case "lowercase": columnName = relationshipPart+"_"+relationshipNamePart;
                        break;
                    case "pascalcase":
                    case "camelcase": columnName = relationshipPart+relationshipNamePart;
                        break;
                    default: columnName = relationshipPart+"_"+relationshipNamePart;
                }

                entityRelationshipColumns.push(columnName);
            }
        }
        return entityRelationshipColumns;
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

                let columnName = '';
                switch (this.databaseCaseImplementation.toLowerCase()) {
                    case "lowercase": columnName = relationshipPart+"_"+relationshipNamePart;
                        break;
                    case "pascalcase":
                    case "camelcase": columnName = relationshipPart+relationshipNamePart;
                        break;
                    default: columnName = relationshipPart+"_"+relationshipNamePart;
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

        if ((typeof this.dataModel[entityName]["options"] !== "undefined") &&
            (typeof this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined")) {
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
     * @param {null|string|int} columnDataModelObject.default The default value for the column
     * @param {boolean} columnDataModelObject.allowNull Whether to allow null or not for the column
     * @param {string} operation "ADD|MODIFY"
     * @return {string} The sql alter code
     */
    getAlterColumnSql(columnName = '', columnDataModelObject = {}, operation = "MODIFY") {
        let sql = operation+' COLUMN '+columnName+' '+columnDataModelObject["type"];

        if (columnName === this.getPrimaryKeyColumn()) {
            sql = operation+' COLUMN `'+this.getPrimaryKeyColumn()+'` BIGINT NOT NULL AUTO_INCREMENT FIRST, ADD PRIMARY KEY (`'+this.getPrimaryKeyColumn()+'`);';
            return sql;
        }

        if (columnDataModelObject["lengthOrValues"] !== null) {
            sql += '('+columnDataModelObject["lengthOrValues"]+')';
        }

        if (columnDataModelObject["allowNull"] === false) {
            sql += ' NOT NULL';
        }

        if (columnDataModelObject["default"] !== null) {
            if (columnDataModelObject["default"] !== "CURRENT_TIMESTAMP") {
                sql += " DEFAULT '"+columnDataModelObject["default"]+"';"
            } else {
                sql += " DEFAULT CURRENT_TIMESTAMP;"
            }
        } else if (columnDataModelObject["allowNull"] !== false) {
            sql += " DEFAULT NULL;"
        }

        return sql;
    }
    //#endregion

    /**
     * The main synchronization function that orchestrates all the work. The following steps are performed:
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
     * @return {Promise<void>}
     */
    async syncDatabase() {
        this.startNewCommandLineSection("Starting database sync...");

        dxUtils.outputFormattedLog('This operation will modify the existing database to align ' +
            'with the provided data model.\nEnsure that you have backed up the database if you do not want to risk any data loss.',
            dxUtils.commandLineColors.foregroundYellow);

        const answer = await dxUtils.getCommandLineInput('Ready to proceed? (y/n)');

        if (answer.toString().toLowerCase() !== 'y') {
            this.printError('Database sync cancelled.');
            return;
        }

        await this.databaseConnector.init();
        if (this.databaseConnector.getError().length > 0) {
            this.printError("Database init failed: "+JSON.stringify(this.databaseConnector.getError()));
            return;
        }

        // 1. Check the integrity of the given data model to ensure we can perform the synchronization
        if (!await this.checkDataModelIntegrity()) {
            this.printError("Data model integrity check failed! Error:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Data model integrity check succeeded!",this.commandLineSubHeadingFormatting);
        }

        dxUtils.outputFormattedLog("Analyzing database...",this.commandLineSubHeadingFormatting);

        this.existingTables = await this.getDatabaseTables();
        this.expectedTables = [];
        for (const expectedTable of Object.keys(this.dataModel)) {
            this.expectedTables.push(this.getCaseNormalizedString(expectedTable));
        }
        this.tablesToCreate = this.getTablesToCreate();
        this.tablesToRemove = this.getTablesToRemove();
        console.log("Database currently has "+Object.keys(this.existingTables).length+" table(s)");
        console.log("Based on the data model, we are expecting "+this.expectedTables.length+" table(s)");

        // 2. Remove tables that are not in the data model
        if (!await this.removeTables()) {
            this.printError("Error while attempting to remove tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Database clean up completed!",this.commandLineSubHeadingFormatting);
        }

        // 3. Create any new tables that are in the data model but not in the database
        if (!await this.createTables()) {
            this.printError("Error while attempting to create new tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Table creation completed!",this.commandLineSubHeadingFormatting);
        }

        // 4. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their columns match the data model attribute names and types
        if (!await this.updateTables()) {
            this.printError("Error while attempting to update tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Table modification completed!",this.commandLineSubHeadingFormatting);
        }

        // 5. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their indexes match the data model indexes
        if (!await this.updateIndexes()) {
            this.printError("Error while attempting to update indexes:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Indexes up to date!",this.commandLineSubHeadingFormatting);
        }

        // 6. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their relationships match the data model relationships. Here we either create new
        //      foreign key constraints or drop existing ones where necessary
        if (!await this.updateRelationships()) {
            this.printError("Error while attempting to update relationships:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Relationships up to date!",this.commandLineSubHeadingFormatting);
        }

        process.exit(0);
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
            this.errorInfo.push("Data model has no entities defined.");
            return false;
        }
        const baseKeys = ["module","attributes","indexes","relationships","options"];
        for (const entityName of Object.keys(entities)) {

            const entityObj = entities[entityName];

            for (const baseKey of baseKeys) {
                if (typeof entityObj[baseKey] === "undefined") {
                    this.errorInfo.push("Entity "+entityName+" has no "+baseKey+" definition.");
                    return false;
                }
            }

            const moduleName = entityObj["module"];
            if (typeof this.databaseConfig[moduleName] === "undefined") {
                this.errorInfo.push("Entity "+entityName+" has an invalid module name provided. '"+moduleName+"' is not defined in the database configuration");
                return false;
            }

            const attributes = entityObj["attributes"];
            if (attributes.length === 0) {
                this.errorInfo.push("Entity "+entityName+" has no attributes provided.");
                return false;
            }

            const expectedAttributeDefinition = {
                    "type": "[MySQL column type]",
                    "lengthOrValues": "[null|int|if type is enum, then comma separated values '1','2','3',...]",
                    "default": "[value|null|CURRENT_TIMESTAMP]",
                    "allowNull": "[true|false]"
                };
            for (const attributeName of Object.keys(attributes)) {

                const attributeObj = attributes[attributeName];
                const attributeConfigs = Object.keys(attributeObj);

                if (JSON.stringify(attributeConfigs) !== JSON.stringify(Object.keys(expectedAttributeDefinition))) {
                    this.errorInfo.push("Invalid attribute definition for '"+entityName+"' ('"+attributeName+"'). Expected: ")
                    this.errorInfo.push(expectedAttributeDefinition);
                    return false;
                }
            }

            const expectedIndexesDefinition = {
                "attribute": "[The attribute on which the index should be set]",
                "indexName": "[The name of the index]",
                "indexChoice": "[index|unique|spatial|text]",
                "type": "[BTREE|HASH]"
            };

            if (typeof entityObj["indexes"] !== "object") {
                this.errorInfo.push("Invalid index definition for '"+entityName+"'. Expected: ")
                this.errorInfo.push(expectedIndexesDefinition);
                return false;
            }

            for (const index of entityObj["indexes"]) {
                if (JSON.stringify(Object.keys(index)) !== JSON.stringify(Object.keys(expectedIndexesDefinition))) {
                    this.errorInfo.push("Invalid index definition for '"+entityName+"'. Expected: ")
                    this.errorInfo.push(expectedIndexesDefinition);
                    return false;
                }
            }

            const expectedRelationshipDefinition = {
                "relationshipEntity":[
                    "relationshipOneName",
                    "relationshipTwoName"
                ]
            }

            for (const relationshipName of Object.keys(entityObj["relationships"])) {
                if (typeof entityObj["relationships"][relationshipName] !== "object") {
                    this.errorInfo.push("Invalid relationship definition for '"+entityName+"'. Expected: ")
                    this.errorInfo.push(expectedRelationshipDefinition);
                    return false;
                }
            }
        }

        for (const moduleName of Object.keys(this.databaseConfig)) {

            const innoDbCheckResult = await this.databaseConnector.queryDB("SHOW ENGINES", moduleName);
            if (typeof innoDbCheckResult["error"] !== "undefined") {
                this.errorInfo.push("Could not check database engine. Error: ");
                this.errorInfo.push(innoDbCheckResult["error"]);
                return false;
            }

            for (const row of innoDbCheckResult) {
                if (row["Engine"].toLowerCase() === 'innodb') {
                    if (row["Support"].toLowerCase() !== "default") {
                        this.errorInfo.push("The active database engine is NOT InnoDB. Cannot proceed.");
                        return false;
                    }
                }
            }
        }
        return true;
    }

    /**
     * A helper function that disables foreign key checks on the database
     * @return {Promise<void>}
     */
    async disableForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 0", moduleName);
        }
        this.foreignKeyChecksDisabled = true;
    }

    /**
     * A helper function that enables foreign key checks on the database
     * @return {Promise<void>}
     */
    async restoreForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 1", moduleName);
        }
        this.foreignKeyChecksDisabled = false;
    }

    /**
     * Handles the removal of tables from the database
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async removeTables() {
        this.startNewCommandLineSection("Existing table clean up");

        if (this.tablesToRemove.length === 0) {
            console.log("There are no tables to remove.")
            return true;
        }

        const answer = await dxUtils.getCommandLineInput('Removing tables that are not defined in the provided ' +
            'data model...\n'+this.tablesToRemove.length+' tables should be removed.\n' +
            'How would you like to proceed?\nType \'y\' to confirm & remove one-by-one;\nType \'all\' to remove all;\n' +
            'Type \'none\' to skip removing any tables;\nType \'list\' to show tables that will be removed (y|all|none|list)');

        switch (answer.toString().toLowerCase()) {
            case 'list': this.listTablesToRemove()
                const answerList = await dxUtils.getCommandLineInput('How would you like to proceed?\n' +
                    'Type \'y\' to confirm & remove one-by-one;\nType \'all\' to remove all;\n' +
                    'Type \'none\' to skip removing any tables; (y|all|none)');
                switch (answerList.toString().toLowerCase()) {
                    case 'all':await this.removeTablesRecursive(false);
                        break;
                    case 'y':await this.removeTablesRecursive(true);
                        break;
                    case 'none':return true;
                    default: this.errorInfo.push("Invalid selection. Please try again.");
                        return false;
                }
                break;
            case 'all':await this.removeTablesRecursive(false);
                break;
            case 'y':await this.removeTablesRecursive(true);
                break;
            case 'none':return true;
            default: this.errorInfo.push("Invalid selection. Please try again.");
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
                if ((typeof tableModuleMapping[moduleName] !== undefined) &&
                    (tableModuleMapping[moduleName].length > 0)) {

                    const tablesToDrop = this.tablesToRemove.filter(x => !tableModuleMapping[moduleName].includes(x));
                    const tablesToDropStr = tablesToDrop.join(",");

                    const queryResult = await this.databaseConnector.queryDB("DROP TABLE if exists "+tablesToDropStr, moduleName);
                    if (typeof queryResult["error"] !== "undefined") {
                        dxUtils.outputFormattedLog("Error dropping tables '"+tablesToDropStr+"':",this.commandLineWarningFormatting);
                        dxUtils.outputFormattedLog(queryResult["error"],this.commandLineWarningFormatting);
                    }
                }
            }
        } else {
            if (this.tablesToRemove.length === 0) {
                return;
            }

            const answer = await dxUtils.getCommandLineInput('Drop table "'+this.tablesToRemove[0]+'"? (y/n)');
            if (answer.toString().toLowerCase() === 'y') {
                for (const moduleName of Object.keys(this.databaseConfig)) {
                    await this.databaseConnector.queryDB("DROP TABLE if exists "+this.tablesToRemove[0], moduleName);
                }
            }

            this.tablesToRemove.shift();

            await this.removeTablesRecursive(true)
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

        console.log(this.tablesToCreate.length+" new table(s) to create.");

        for (const tableName of this.tablesToCreate) {
            const tableNameDataModel = this.getCaseDenormalizedString(tableName);
            const moduleName = this.dataModel[tableNameDataModel]["module"];
            const createTableSql = 'CREATE TABLE `'+tableName+'` ( `'+this.getPrimaryKeyColumn()+'` ' +
                'BIGINT NOT NULL AUTO_INCREMENT , PRIMARY KEY (`'+this.getPrimaryKeyColumn()+'`));';

            const createResult = await this.databaseConnector.queryDB(createTableSql, moduleName);
            if (typeof createResult["error"] !== "undefined") {
                this.errorInfo.push(createResult["error"]);
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

        let updatedTables = [];
        let sqlQuery = {};

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];

            if (typeof sqlQuery[moduleName] === "undefined") {
                sqlQuery[moduleName] = [];
            }

            const tableName = this.getCaseNormalizedString(entityName);
            const tableColumns = await this.databaseConnector.queryDB("SHOW FULL COLUMNS FROM "+tableName,moduleName);

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
                    sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` DROP COLUMN '+tableColumn["Field"]+';');
                    if (!updatedTables.includes(entityName)) {
                        updatedTables.push(entityName);
                    }
                    continue;
                }

                // Now, let's check if the existing columns' configurations align with our data model
                const allowNull = tableColumn["Null"] !== 'NO';
                const typeParts =  tableColumn["Type"].split("(");
                const baseType = typeParts[0];
                const typeLength = typeParts.length > 1 ? typeParts[1].replace(")","") : null;

                tableColumnsNormalized[tableColumn["Field"]] = {
                    "type": baseType,
                    "lengthOrValues": typeLength,
                    "default": tableColumn["Default"],
                    "allowNull": allowNull
                };

                for (const columnOption of Object.keys(tableColumnsNormalized[tableColumn["Field"]])) {
                    if (typeof entityAttributes[columnAttributeName] === "undefined") {
                        if (columnName !== this.getLockingConstraintColumn()) {
                            // This must mean that the column is a foreign key column
                            if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "bigint") {
                                // This column needs to be fixed. Somehow its type got changed
                                sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` MODIFY COLUMN `'+columnName+'` BIGINT(20);');

                                if (!updatedTables.includes(entityName)) {
                                    updatedTables.push(entityName);
                                }
                            }
                            relationshipsProcessed.push(columnName);
                        } else {
                            // This is the locking constraint column
                            if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "datetime") {
                                // This column needs to be fixed. Somehow its type got changed
                                sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` MODIFY COLUMN `'+columnName+'` datetime DEFAULT CURRENT_TIMESTAMP;');

                                if (!updatedTables.includes(entityName)) {
                                    updatedTables.push(entityName);
                                }
                            }
                            attributesProcessed.push(columnName);
                        }
                        break;
                    }

                    const dataModelOption = ((columnOption === "lengthOrValues") && (entityAttributes[columnAttributeName][columnOption] !== null)) ?
                        entityAttributes[columnAttributeName][columnOption].toString() :
                        entityAttributes[columnAttributeName][columnOption];

                    if (dataModelOption !== tableColumnsNormalized[tableColumn["Field"]][columnOption]) {
                        sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` '+this.getAlterColumnSql(columnName, entityAttributes[columnAttributeName], "MODIFY"));

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

            if ((typeof this.dataModel[entityName]["options"] !== "undefined") &&
                (typeof this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== "undefined")) {

                if (this.dataModel[entityName]["options"]["enforceLockingConstraints"] !== false) {
                    entityAttributesArray.push(this.getCaseDenormalizedString(this.getLockingConstraintColumn()));
                }
            }
            const columnsToCreate = entityAttributesArray.filter(x => !attributesProcessed.includes(x));

            for (const columnToCreate of columnsToCreate) {
                const columnName = this.getCaseNormalizedString(columnToCreate);

                const columnDataModelObject = columnToCreate === this.getCaseDenormalizedString(this.getLockingConstraintColumn()) ? {
                    "type": "datetime",
                    "lengthOrValues": null,
                    "default": "CURRENT_TIMESTAMP",
                    "allowNull": false
                } : entityAttributes[columnToCreate];

                sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` '+this.getAlterColumnSql(columnName, columnDataModelObject, "ADD"));

                if (!updatedTables.includes(entityName)) {
                    updatedTables.push(entityName);
                }
            }

            const entityRelationshipColumns = this.getEntityRelationshipColumns(entityName);
            const relationshipColumnsToCreate = entityRelationshipColumns.filter(x => !relationshipsProcessed.includes(x));

            for (const relationshipColumnToCreate of relationshipColumnsToCreate) {
                sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` ADD COLUMN `'+relationshipColumnToCreate+'` BIGINT(20);');

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
                if (typeof queryResult["error"] !== "undefined") {
                    this.errorInfo.push("Could not execute query: "+queryResult["error"]);
                    return false;
                }
            }
        }

        console.log(updatedTables.length+" tables were updated");

        return true;
    }

    /**
     * Cycles through all the indexes for each table to ensure they align with their data model definition
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async updateIndexes() {
        this.startNewCommandLineSection("Update indexes");

        let updatedIndexes = {"added":0,"removed":0};

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = this.getCaseNormalizedString(entityName);

            const indexCheckResult = await this.databaseConnector.queryDB("SHOW INDEX FROM "+tableName, moduleName);
            let existingIndexes = [];

            for (const index of indexCheckResult) {
                existingIndexes.push(index['Key_name']);
            }

            const expectedIndexes = this.getEntityRelationshipColumns(entityName);

            for (const indexObj of this.dataModel[entityName]["indexes"]) {
                const indexName = this.getCaseNormalizedString(indexObj["indexName"]);
                expectedIndexes.push(indexName);

                if (!existingIndexes.includes(indexName)) {
                    // Let's add this index
                    const keyColumn = this.getCaseNormalizedString(indexObj["attribute"]);

                    switch (indexObj["indexChoice"].toLowerCase()) {
                        case 'index':
                            const indexAddResult =
                                await this.databaseConnector.queryDB(
                                    "ALTER TABLE `"+tableName+"` ADD INDEX `"+indexName+"` (`"+keyColumn+"`) USING "+indexObj["type"]+";", moduleName);
                            if (typeof indexAddResult["error"] !== "undefined") {
                                this.errorInfo.push(indexAddResult["error"])
                                return false;
                            }
                            break;
                        case 'unique':
                            const uniqueAddResult =
                                await this.databaseConnector.queryDB(
                                    "ALTER TABLE `"+tableName+"` ADD UNIQUE `"+indexName+"` (`"+keyColumn+"`) USING "+indexObj["type"]+";", moduleName);
                            if (typeof uniqueAddResult["error"] !== "undefined") {
                                this.errorInfo.push(uniqueAddResult["error"])
                                return false;
                            }
                            break;
                        case 'spatial':
                            const spatialAddResult =
                                await this.databaseConnector.queryDB(
                                    "ALTER TABLE `"+tableName+"` ADD SPATIAL `"+indexName+"` (`"+keyColumn+"`)", moduleName);
                            if (typeof spatialAddResult["error"] !== "undefined") {
                                this.errorInfo.push(spatialAddResult["error"])
                                return false;
                            }
                            break;
                        case 'fulltext':
                            const fulltextAddResult =
                                await this.databaseConnector.queryDB(
                                    "ALTER TABLE `"+tableName+"` ADD FULLTEXT `"+indexName+"` (`"+keyColumn+"`)", moduleName);
                            if (typeof fulltextAddResult["error"] !== "undefined") {
                                this.errorInfo.push(fulltextAddResult["error"])
                                return false;
                            }
                            break;
                        default:
                            this.errorInfo.push("Invalid index choice specified for " +
                            "'"+indexObj["indexName"]+"' on '"+entityName+"'. " +
                            "Provided: "+indexObj["indexChoice"]+"; " +
                            "Valid options: index|unique|fulltext|spatial");
                            return false;
                    }

                    updatedIndexes.added++;
                }
            }

            for (const existingIndex of existingIndexes) {
                if (existingIndex.toLowerCase() === 'primary') {
                    continue;
                }

                if (!expectedIndexes.includes(existingIndex)) {
                    const dropQuery = "ALTER TABLE `"+tableName+"` DROP INDEX `"+existingIndex+"`";
                    const dropResult = await this.databaseConnector.queryDB(dropQuery, moduleName);
                    if (typeof dropResult["error"] !== "undefined") {
                        this.errorInfo.push(dropResult["error"])
                        return false;
                    }

                    updatedIndexes.removed++;
                }
            }
        }

        console.log(updatedIndexes.added+" Indexes added. "+updatedIndexes.removed+" Indexes removed.");

        return true;
    }

    /**
     * Cycles through all the relationships for each table to ensure they align with their data model definition
     * @return {Promise<boolean>} True if all good, false otherwise. If false, the errorInfo array will be populated
     * with a relevant reason
     */
    async updateRelationships() {
        this.startNewCommandLineSection("Update relationships");

        let updatedRelationships = {"added":0,"removed":0};

        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = this.getCaseNormalizedString(entityName);
            const schemaName = this.databaseConfig[moduleName]["database"];

            const listForeignKeysQuery = "SELECT * " +
                "FROM information_schema.REFERENTIAL_CONSTRAINTS " +
                "WHERE TABLE_NAME = '"+tableName+"' ";

            const listForeignKeysResult = await this.databaseConnector.queryDB(listForeignKeysQuery, moduleName);
            let existingForeignKeys = [];
            const entityRelationshipColumns = this.getEntityRelationshipColumns(entityName);

            for (const foreignKeyResult of listForeignKeysResult) {
                if (!entityRelationshipColumns.includes(foreignKeyResult.CONSTRAINT_NAME)) {
                    const dropQuery = "ALTER TABLE `"+schemaName+"`.`"+tableName+"` DROP FOREIGN KEY "+foreignKeyResult.CONSTRAINT_NAME+";";
                    const foreignKeyDeleteResult = await this.databaseConnector.queryDB(dropQuery, moduleName);
                    if (typeof foreignKeyDeleteResult["error"] !== "undefined") {
                        this.errorInfo.push("Could not execute query: "+foreignKeyDeleteResult["error"]);
                        return false;
                    }

                    updatedRelationships.removed++;
                } else {
                    existingForeignKeys.push(foreignKeyResult.CONSTRAINT_NAME);
                }
            }

            const foreignKeysToCreate = entityRelationshipColumns.filter(x => !existingForeignKeys.includes(x));
            for (const foreignKeyToCreate of foreignKeysToCreate) {
                const entityRelationship = this.getEntityRelationshipFromRelationshipColumn(entityName, foreignKeyToCreate);

                const createQuery = "ALTER TABLE `"+tableName+"` ADD CONSTRAINT `"+foreignKeyToCreate+"` FOREIGN KEY (`"+foreignKeyToCreate+"`) REFERENCES `"+this.getCaseNormalizedString(entityRelationship)+"`(`"+this.getPrimaryKeyColumn()+"`) ON DELETE SET NULL ON UPDATE CASCADE;"
                const createResult = await this.databaseConnector.queryDB(createQuery, moduleName);
                if (typeof createResult["error"] !== "undefined") {
                    this.errorInfo.push("Could not execute query: "+createResult["error"]);
                    return false;
                }

                updatedRelationships.added++;
            }
        }

        console.log(updatedRelationships.added+" Relationships added. "+updatedRelationships.removed+" Relationships removed.");

        return true;
    }
}

module.exports = DivbloxDatabaseSync;