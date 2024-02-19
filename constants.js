import { commandLineColors } from "dx-cli-tools/helpers.js";

export const DB_IMPLEMENTATION_TYPES = { SNAKE_CASE: "snakecase", PASCAL_CASE: "pascalcase", CAMEL_CASE: "camelcase" };

export const HEADING_FORMAT = commandLineColors.foregroundCyan + commandLineColors.bright;
export const SUB_HEADING_FORMAT = commandLineColors.foregroundCyan + commandLineColors.dim;
export const WARNING_FORMAT = commandLineColors.foregroundYellow;
export const SUCCESS_FORMAT = commandLineColors.foregroundGreen;
