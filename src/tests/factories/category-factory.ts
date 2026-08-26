import { type Category } from "../../generated/prisma/index.js";

export function makeCategory(override: Partial<Category> = {}): Category {
    return {
        id: 'category-1111-2222-3333-444444444444',
        name: 'Test Category',
        description: 'Test Description',
        color: '#6750A4',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...override,
    };
}
