import { syncDatabase } from "../index.js";

// import databaseConfig from "./database-config.json" with { type: 'json' };
// import dataModel from "./example-data-model.json" with { type: 'json' };

import databaseConfig from "./database-config.json" assert { type: "json" };
import dataModel from "./example-data-model.json" assert { type: "json" };

await syncDatabase(
    {
        databaseCaseImplementation: "snakecase",
        databaseConfig: databaseConfig,
        dataModelPath: "./tests/example-data-model.json",
    },
    false,
);
