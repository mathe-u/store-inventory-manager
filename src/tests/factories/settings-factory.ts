import { type GlobalSettings } from "../../generated/prisma/index.js";

export function makeGlobalSettings(override: Partial<GlobalSettings> = {}): GlobalSettings {
    return {
        id: 'default',
        hourlyRate: 0,
        defaultTaxRate: 0,
        fixedMonthlyCosts: 0,
        variableMonthlyCosts: 0,
        investmentRate: 0,
        ...override,
    };
}
