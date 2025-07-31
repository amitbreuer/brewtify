import { env as ENV } from 'process';

export function env<T = string>(key: string, defaultValue?: T): T {
    if (key in ENV) {
        return ENV[key] as T;
    }

    if (undefined !== defaultValue) {
        return defaultValue as T;
    }

    throw new Error(`Missing env var: ${key}`);
}
