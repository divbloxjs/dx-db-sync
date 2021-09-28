const dxDbConnector = require('dx-db-connector');

class DivbloxDatabaseSync {
    constructor(dataModel = {}, databaseConfig = {}) {
        this.dataModel = dataModel;
        this.databaseConfig = databaseConfig;
        this.databaseConnector = new dxDbConnector(this.databaseConfig);
    }
}