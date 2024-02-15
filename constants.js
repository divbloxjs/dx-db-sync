import { commandLineColors } from "dx-cli-tools/helpers.js";

export const DB_IMPLEMENTATION_TYPES = { snakecase: "snakecase", pascalcase: "pascalcase", camelcase: "camelcase" };

export const headingFormat = commandLineColors.foregroundCyan + commandLineColors.bright;
export const subHeadingFormat = commandLineColors.foregroundCyan + commandLineColors.dim;
export const warningFormat = commandLineColors.foregroundYellow;
export const successFormat = commandLineColors.foregroundGreen;
