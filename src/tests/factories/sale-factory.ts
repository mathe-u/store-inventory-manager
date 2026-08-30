import { type Sale } from "../../generated/prisma/index.js";

export function makeSale(override: Partial<Sale> = {}): Sale {
    return {
        id: 'sale-1-uuid-0000-0000-000000000000',
        productId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        quantity: 2,
        finalPrice: 120,
        calculatedProfit: 30,
        status: 'COMPLETED',
        customerName: 'John Doe',
        paymentMethodId: 'payment-method-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        ...override,
    };
}
