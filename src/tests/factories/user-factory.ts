import { type User } from "../../generated/prisma/index.js";

export function makeUser(override: Partial<User> = {}): User {
    return {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashed_password_123',
        role: 'SELLER',
        isActive: true,
        createdAt: new Date(),
        ...override,
    };
}