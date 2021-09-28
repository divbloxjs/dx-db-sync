const dxDbConnector = require('dx-db-connector');
const dxUtils = require('dx-utils');

class DivbloxDatabaseSync {
    constructor(dataModel = {}, databaseConfig = {}) {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        this.databaseConnector = new dxDbConnector(this.databaseConfig);
        this.commandLineHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.bright;
        this.commandLineSubHeadingFormatting = dxUtils.commandLineColors.foregroundCyan+dxUtils.commandLineColors.dim;
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
    async getDatabaseTables() {
        let tables = [];
        for (const moduleName of Object.keys(this.databaseConfig)) {
            const moduleTables = await this.databaseConnector.queryDB("show tables", moduleName);
            for (let i=0; i < moduleTables.length; i++) {
                const dataPacket = moduleTables[i];
                for (const dataPacketKeys of Object.keys(dataPacket)) {
                    tables.push(dataPacket[dataPacketKeys]);
                }
            }
        }
        return tables;
    }
    getTablesToCreate() {
        return this.expectedTables.filter(x => !this.existingTables.includes(x));
    }
    getTablesToRemove() {
        return this.existingTables.filter(x => !this.expectedTables.includes(x));
    }
    //#endregion

    async syncDatabase() {
        this.startNewCommandLineSection("Starting database sync...")
        await this.databaseConnector.init();
        if (this.databaseConnector.getError().length > 0) {
            throw new Error("Database init failed: "+JSON.stringify(this.databaseConnector.getError()));
        }
        //TODO: Execute sync functions in order here
        dxUtils.outputFormattedLog("Analyzing database...",this.commandLineSubHeadingFormatting);
        this.existingTables = await this.getDatabaseTables();
        this.expectedTables = Object.keys(this.dataModel);
        this.tablesToCreate = this.getTablesToCreate();
        this.tablesToRemove = this.getTablesToRemove();
        console.log("Database currently "+this.existingTables.length+" table(s)");
        console.log("Based on the data model, we are expecting "+this.expectedTables.length+" table(s)");
        await this.removeTables();
        /*console.log("To create: ");
        console.dir(this.tablesToCreate);
        console.log("To remove: ");
        console.dir(this.tablesToRemove);*/
    }

    async removeTables() {
        this.startNewCommandLineSection("Existing table clean up");
        const answer = dxUtils.getCommandLineInput('Removing tables that are not defined in the provided ' +
            'data model...\n'+this.tablesToRemove.length+' tables should be removed.\n' +
            'How would you like to proceed?\nSelect (y) to remove one-by-one;\n(all) to remove all;\n' +
            '(none) to skip removing any tables;\n(list) to show tables that will be removed (y|all|none|list)');

    }
}

module.exports = DivbloxDatabaseSync;