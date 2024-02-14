import { init, syncDatabase } from "../index.js";

import databaseConfig from "./database-config.json" with { type: 'json' };
import dataModel from "./example-data-model.json" with { type: 'json' };


await init({ databaseCaseImplementation: "snakecase", databaseConfig: databaseConfig, dataModel: dataModel });
await syncDatabase(false);
