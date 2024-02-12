import { init, test } from "../index.js";

// init({ databaseCaseImplementation: "pascalcase" });
init({
    dataModelPath: "",
    databaseCaseImplementation: "camelcase",
    databaseConfig: [{ database: "as", module: "test", host: "", port: 123, ssl: {} }],
});
