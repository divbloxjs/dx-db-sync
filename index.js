const dxDbConnector = require('dx-db-connector');
const dxUtils = require('dx-utils');
//TODO: Allow for specifying how to deal with case in the database. Currently forcing lowercase with _ separator
//TODO: Add to integrity check that database is InnoDB. InnoDB will be a requirement and limitation
class DivbloxDatabaseSync {
    constructor(dataModel = {}, databaseConfig = {}) {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        this.databaseConnector = new dxDbConnector(this.databaseConfig);
        this.commandLineHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.bright;
        this.commandLineSubHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.dim;
        this.commandLineWarningFormatting = dxUtils.commandLineColors.foregroundYellow;
        this.errorInfo = [];
        this.foreignKeyChecksDisabled = false;
    }

    //#region Helpers
    startNewCommandLineSection(sectionHeading = "") {
        let lineText = '';
        for (let i=0;i<process.stdout.columns;i++) {
            lineText += '-';
        }
        dxUtils.outputFormattedLog(lineText,dxUtils.commandLineColors.foregroundCyan);
        dxUtils.outputFormattedLog(sectionHeading,this.commandLineHeadingFormatting);
        dxUtils.outputFormattedLog(lineText,dxUtils.commandLineColors.foregroundCyan);
    }
    printError(message = '') {
        dxUtils.outputFormattedLog(message,
            dxUtils.commandLineColors.foregroundRed);
    }
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
    getTablesToCreate() {
        const existingTablesArray = Object.keys(this.existingTables);
        return this.expectedTables.filter(x => !existingTablesArray.includes(x));
    }
    getTablesToRemove() {
        const existingTablesArray = Object.keys(this.existingTables);
        return existingTablesArray.filter(x => !this.expectedTables.includes(x));
    }
    getEntityModuleMapping() {
        let entityModuleMapping = {};
        for (const moduleName of Object.keys(this.databaseConfig)) {
            entityModuleMapping[moduleName] = [];
        }
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName].module;
            entityModuleMapping[moduleName].push(entityName);
        }
        return entityModuleMapping;
    }
    getEntityRelationshipColumns(entityName) {
        let entityRelationshipColumns = [];
        const entityRelationships = this.dataModel[entityName]["relationships"];
        for (const entityRelationship of Object.keys(entityRelationships)) {
            for (const relationshipName of entityRelationships[entityRelationship]) {
                const columnName = dxUtils.getCamelCaseSplittedToLowerCase(entityRelationship,"_")+
                    "_"+
                    dxUtils.getCamelCaseSplittedToLowerCase(relationshipName,"_")
                entityRelationshipColumns.push(columnName);
            }
        }
        return entityRelationshipColumns;
    }
    getEntityExpectedColumns(entityName) {
        let expectedColumns = ["id"];
        for (const attributeColumn of Object.keys(this.dataModel[entityName]["attributes"])) {
            expectedColumns.push(dxUtils.getCamelCaseSplittedToLowerCase(attributeColumn,"_"));
        }
        for (const relationshipColumn of this.getEntityRelationshipColumns(entityName)) {
            expectedColumns.push(dxUtils.getCamelCaseSplittedToLowerCase(relationshipColumn,"_"));
        }
        return expectedColumns;
    }
    getAlterColumnSql(columnName = '', columnDataModelObject = {}, operation = "MODIFY") {
        let sql = operation+' COLUMN '+columnName+' '+columnDataModelObject["type"];
        if (columnName === "id") {
            sql = operation+' COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT FIRST, ADD PRIMARY KEY (`id`);';
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
    getEntityRelationshipFromRelationshipColumn(entityName, relationshipColumnName) {
        let entityRelationshipColumns = [];
        const entityRelationships = this.dataModel[entityName]["relationships"];
        for (const entityRelationship of Object.keys(entityRelationships)) {
            for (const relationshipName of entityRelationships[entityRelationship]) {
                const columnName = dxUtils.getCamelCaseSplittedToLowerCase(entityRelationship,"_")+
                    "_"+
                    dxUtils.getCamelCaseSplittedToLowerCase(relationshipName,"_")
                if (columnName === relationshipColumnName) {
                    return entityRelationship;
                }
            }
        }
        return null;
    }
    //#endregion

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

        if (!await this.checkDataModelIntegrity()) {
            this.printError("Data model integrity check failed! Error:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Data model integrity check succeeded!",this.commandLineSubHeadingFormatting);
        }

        //TODO: Execute sync functions in order here
        // Check data model integrity
        // Remove tables - IMPLEMENTED
        // Create tables - IMPLEMENTED
        // Update tables (excluding relationships) - IMPLEMENTED
        // Update table indexes - IMPLEMENTED
        // Update relationships - IMPLEMENTED
        // Update locking constraint columns

        dxUtils.outputFormattedLog("Analyzing database...",this.commandLineSubHeadingFormatting);
        this.existingTables = await this.getDatabaseTables();
        this.expectedTables = [];
        for (const expectedTable of Object.keys(this.dataModel)) {
            this.expectedTables.push(dxUtils.getCamelCaseSplittedToLowerCase(expectedTable,"_"));
        }
        this.tablesToCreate = this.getTablesToCreate();
        this.tablesToRemove = this.getTablesToRemove();
        console.log("Database currently has "+Object.keys(this.existingTables).length+" table(s)");
        console.log("Based on the data model, we are expecting "+this.expectedTables.length+" table(s)");

        // 1. Remove tables that are not in the data model
        if (!await this.removeTables()) {
            this.printError("Error while attempting to remove tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Database clean up completed!",this.commandLineSubHeadingFormatting);
        }

        // 2. Create any new tables that are in the data model but not in the database
        if (!await this.createTables()) {
            this.printError("Error while attempting to create new tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Table creation completed!",this.commandLineSubHeadingFormatting);
        }

        // 3. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their columns match the data model attribute names and types
        if (!await this.updateTables()) {
            this.printError("Error while attempting to update tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Table modification completed!",this.commandLineSubHeadingFormatting);
        }

        // 4. Loop through all the entities in the data model and update their corresponding database tables
        //      to ensure that their indexes match the data model indexes
        if (!await this.updateIndexes()) {
            this.printError("Error while attempting to update indexes:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Indexes up to date!",this.commandLineSubHeadingFormatting);
        }

        // 5. Loop through all the entities in the data model and update their corresponding database tables
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
    async checkDataModelIntegrity() {
        //TODO: Ensure that the provided data model conforms to the expected standard. And return false if not.
        this.startNewCommandLineSection("Data model integrity check. TO BE IMPLEMENTED");
        return true;
    }
    async disableForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 0", moduleName);
        }
        this.foreignKeyChecksDisabled = true;
    }
    async restoreForeignKeyChecks() {
        for (const moduleName of Object.keys(this.databaseConfig)) {
            await this.databaseConnector.queryDB("SET FOREIGN_KEY_CHECKS = 1", moduleName);
        }
        this.foreignKeyChecksDisabled = false;
    }
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
    async removeTablesRecursive(mustConfirm = true) {
        const entityModuleMapping = this.getEntityModuleMapping();
        if (!this.foreignKeyChecksDisabled) {
            await this.disableForeignKeyChecks();
        }
        if (!mustConfirm) {
            // Not going to be recursive. Just a single call to drop all relevant tables
            for (const moduleName of Object.keys(this.databaseConfig)) {
                if ((typeof entityModuleMapping[moduleName] !== undefined) &&
                    (entityModuleMapping[moduleName].length > 0)) {
                    const tablesToDrop = this.tablesToRemove.filter(x => !entityModuleMapping[moduleName].includes(x));
                    const tablesToDropStr = tablesToDrop.join(",");
                    const queryResult = await this.databaseConnector.queryDB("DROP TABLE if exists "+tablesToDropStr, moduleName);
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
    listTablesToRemove() {
        for (const table of this.tablesToRemove) {
            dxUtils.outputFormattedLog(table+" ("+this.existingTables[table]+")",dxUtils.commandLineColors.foregroundGreen);
        }
    }
    async createTables() {
        this.startNewCommandLineSection("Create new tables");
        if (this.tablesToCreate.length === 0) {
            console.log("There are no tables to create.");
            return true;
        }
        console.log(this.tablesToCreate.length+" new table(s) to create.");
        for (const tableName of this.tablesToCreate) {
            const tableNameDataModel = dxUtils.convertLowerCaseToCamelCase(tableName,"_");
            const moduleName = this.dataModel[tableNameDataModel]["module"];
            const createTableSql = 'CREATE TABLE `'+tableName+'` ( `id` BIGINT NOT NULL AUTO_INCREMENT , PRIMARY KEY (`id`));';
            const createResult = await this.databaseConnector.queryDB(createTableSql, moduleName);
            if (typeof createResult["error"] !== "undefined") {
                this.errorInfo.push(createResult["error"]);
                return false;
            }
        }
        return true;
    }
    async updateTables() {
        this.startNewCommandLineSection("Update existing tables");
        let updatedTables = [];
        let sqlQuery = {};
        for (const moduleName of Object.keys(this.databaseConfig)) {
            sqlQuery[moduleName] = [];
        }
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = dxUtils.getCamelCaseSplittedToLowerCase(entityName,"_");
            const tableColumns = await this.databaseConnector.queryDB("SHOW FULL COLUMNS FROM "+tableName,moduleName);
            let tableColumnsNormalized = {};

            const entityAttributes = this.dataModel[entityName]["attributes"];
            const expectedColumns = this.getEntityExpectedColumns(entityName);
            let attributesProcessed = [];
            let relationshipsProcessed = [];

            for (const tableColumn of tableColumns) {
                const columnName = tableColumn["Field"];
                const columnAttributeName = dxUtils.convertLowerCaseToCamelCase(columnName,"_");
                attributesProcessed.push(columnAttributeName);
                if (columnAttributeName === "id") {
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
                        // This must mean that the column is a foreign key column
                        if (tableColumnsNormalized[tableColumn["Field"]]["type"].toLowerCase() !== "bigint") {
                            // This column needs to be fixed. Somehow its type got changed
                            sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` MODIFY COLUMN `'+columnName+'` BIGINT(20);');
                        }
                        relationshipsProcessed.push(columnName);
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
            entityAttributesArray.push("id");
            const columnsToCreate = entityAttributesArray.filter(x => !attributesProcessed.includes(x));
            for (const columnToCreate of columnsToCreate) {
                const columnName = dxUtils.getCamelCaseSplittedToLowerCase(columnToCreate,"_");
                sqlQuery[moduleName].push('ALTER TABLE `'+tableName+'` '+this.getAlterColumnSql(columnName, entityAttributes[columnToCreate], "ADD"));
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
    async updateIndexes() {
        this.startNewCommandLineSection("Update indexes");
        let updatedIndexes = {"added":0,"removed":0};
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = dxUtils.getCamelCaseSplittedToLowerCase(entityName, "_");
            const indexCheckResult = await this.databaseConnector.queryDB("SHOW INDEX FROM "+tableName, moduleName);
            let existingIndexes = [];
            for (const index of indexCheckResult) {
                existingIndexes.push(index['Key_name']);
            }
            const expectedIndexes = this.getEntityRelationshipColumns(entityName);
            for (const indexObj of this.dataModel[entityName]["indexes"]) {
                const indexName = dxUtils.getCamelCaseSplittedToLowerCase(indexObj["indexName"],"_");
                expectedIndexes.push(indexName);
                if (!existingIndexes.includes(indexName)) {
                    // Let's add this index
                    const keyColumn = dxUtils.getCamelCaseSplittedToLowerCase(indexObj["attribute"],"_");
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
    async updateRelationships() {
        this.startNewCommandLineSection("Update relationships");
        let updatedRelationships = {"added":0,"removed":0};
        for (const entityName of Object.keys(this.dataModel)) {
            const moduleName = this.dataModel[entityName]["module"];
            const tableName = dxUtils.getCamelCaseSplittedToLowerCase(entityName, "_");
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
                const createQuery = "ALTER TABLE `"+tableName+"` ADD CONSTRAINT `"+foreignKeyToCreate+"` FOREIGN KEY (`"+foreignKeyToCreate+"`) REFERENCES `"+dxUtils.getCamelCaseSplittedToLowerCase(entityRelationship,"_")+"`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;"
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