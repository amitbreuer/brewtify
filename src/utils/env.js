"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = env;
const process_1 = require("process");
function env(key, defaultValue) {
    if (key in process_1.env) {
        return process_1.env[key];
    }
    if (undefined !== defaultValue) {
        return defaultValue;
    }
    throw new Error(`Missing env var: ${key}`);
}
