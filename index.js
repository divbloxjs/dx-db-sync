const dxDbConnector = require('dx-db-connector');
const dxUtils = require('dx-utils');

class DivbloxDatabaseSync {
    constructor(dataModel = {}, databaseConfig = {}) {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        this.databaseConnector = new dxDbConnector(this.databaseConfig);
        this.commandLineHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.bright;
        this.commandLineSubHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.dim;
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
        //TODO: Execute sync functions in order here
        // Remove tables - IMPLEMENTED
        // Create tables
        // Update tables (excluding relationships)
        // Update table indexes
        // Update relationships

        dxUtils.outputFormattedLog("Analyzing database...",this.commandLineSubHeadingFormatting);
        this.existingTables = await this.getDatabaseTables();
        this.expectedTables = Object.keys(this.dataModel);
        this.tablesToCreate = this.getTablesToCreate();
        this.tablesToRemove = this.getTablesToRemove();
        console.log("Database currently "+Object.keys(this.existingTables).length+" table(s)");
        console.log("Based on the data model, we are expecting "+this.expectedTables.length+" table(s)");
        if (!await this.removeTables()) {
            this.printError("Error while attempting to remove tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("Database clean up completed!",this.commandLineSubHeadingFormatting);
        }

        if (!await this.createTables()) {
            this.printError("Error while attempting to create new tables:\n"+JSON.stringify(this.errorInfo,null,2));
            process.exit(0);
        } else {
            dxUtils.outputFormattedLog("New tables created!",this.commandLineSubHeadingFormatting);
        }
        process.exit(0);
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
        this.startNewCommandLineSection("Creating new tables...");
        dxUtils.outputFormattedLog(this.tablesToCreate.length+" new table(s) to create.",this.commandLineSubHeadingFormatting);
        return true;
    }
}

module.exports = DivbloxDatabaseSync;