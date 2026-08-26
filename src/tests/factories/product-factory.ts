import { type Product } from "../../generated/prisma/index.js";

export function makeProduct(override: Partial<Product> = {}): Product {
    return {
        id: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        name: 'Test Product',
        imageUrl: null,
        stockQuantity: 10,
        minStockAlert: 5,
        metadata: '{"color":"red","size":"M"}',
        acquisitionCost: 50,
        shippingCost: 10,
        taxRate: 0,
        directCosts: 5,
        timeSpent: 1,
        lossIndex: 0.05,
        desiredMargin: 0.30,
        categoryId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...override,
    };
}
