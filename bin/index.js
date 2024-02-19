#! /usr/bin/env node
import { init, syncDatabase } from "../index.js";
import { run, handleError, getCommandLineInput } from "dx-cli-tools";
import path from "path";
import { DB_IMPLEMENTATION_TYPES } from "../constants.js";

const cliToolName = "dx-db-sync";
const versionNumber = "0.0.0";

console.log(process.env.PWD);

const doSync = async () => {
    let databaseConfigPath = await getCommandLineInput(
        `What is the path to your database configuration file? 
Default: divblox/configs/database.config.json \n`,
    );

    if (!databaseConfigPath) databaseConfigPath = "divblox/configs/database.config.json";

    let dataModelPath = await getCommandLineInput(
        `What is the path to your data model JSON file? 
Default: divblox/configs/datamodel.json \n`,
    );

    if (!dataModelPath) dataModelPath = "divblox/configs/datamodel.json";

    let databaseCaseImplementation = await getCommandLineInput(
        `What casing do you want to use when synchronizing the database? (snakecase|camelcase|pascalcase)
Default: snakecase \n`,
    );

    if (!databaseCaseImplementation) databaseCaseImplementation = DB_IMPLEMENTATION_TYPES.snakecase;

    console.log("databaseConfigPath", databaseConfigPath);
    console.log("dataModelPath", dataModelPath);
    console.log("databaseCaseImplementation", databaseCaseImplementation);

    const options = {
        databaseCaseImplementation: databaseCaseImplementation,
        databaseConfigPath: databaseConfigPath,
        dataModelPath: dataModelPath,
    };
    await init(options);
    await syncDatabase(options);
};
const sync = {
    name: "sync",
    f: async () => {
        await doSync();
    },
    description: "Synchronizes your underlying database with the provided data model",
};

const supportedArguments = {
    "-s": sync,
    "--sync": sync,
};

await run({
    supportedArguments: supportedArguments,
    cliToolName: cliToolName,
    versionNumber: versionNumber,
});
