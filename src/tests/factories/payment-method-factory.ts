import { type PaymentMethod } from "../../generated/prisma/index.js";

export function makePaymentMethod(override: Partial<PaymentMethod> = {}): PaymentMethod {
    return {
        id: 'payment-method-1',
        name: 'Credit Card',
        icon: 'credit_card',
        ...override,
    };
}
