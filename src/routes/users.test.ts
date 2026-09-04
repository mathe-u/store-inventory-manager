import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import bcrypt from 'bcrypt';
import { userRoutes } from './users.js';
import { prisma } from '../lib/prisma.js';
import { makeUser } from '../tests/factories/user-factory.js';

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        user: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn(),
        }
    }
}));

vi.mock('bcrypt', () => ({
    default: {
        hash: vi.fn(),
        compare: vi.fn(),
    }
}));

async function buildTestApp() {
    const app = Fastify();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(fastifyJwt, { secret: 'test-super-secret' });

    app.decorate('authenticate', async (request: FastifyRequest, reply) => {
        try {
            await request.jwtVerify();
        } catch {
            reply.status(401).send({ message: 'Unauthorized' });
        }
    });

    await app.register(userRoutes);

    return app;
}

describe('User Routes', () => {
    let app: FastifyInstance;
    let token: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await buildTestApp();
        token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
    });

    describe('Authentication Hook', () => {
        it('should return 401 Unauthorized if no authorization header is provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });

        it('should return 401 Unauthorized if invalid token is provided', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: {
                    Authorization: 'Bearer invalid-token',
                },
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });
    });

    describe('GET / (List Users)', () => {
        it('should return paginated users with default parameters', async () => {
            const user1 = makeUser({ id: 'user-1', name: 'Alice', email: 'alice@example.com' });
            const user2 = makeUser({ id: 'user-2', name: 'Bob', email: 'bob@example.com' });
            const expectedUsers = [user1, user2].map(({ id, name, email, role, isActive }) => ({
                id, name, email, role, isActive
            }));

            vi.mocked(prisma.user.findMany).mockResolvedValue(expectedUsers as never);
            vi.mocked(prisma.user.count).mockResolvedValue(2);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({
                users: expectedUsers,
                meta: {
                    page: 1,
                    limit: 10,
                    total: 2,
                    totalPages: 1
                }
            });
            expect(prisma.user.findMany).toHaveBeenCalledWith({
                where: {},
                skip: 0,
                take: 10,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                }
            });
            expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
        });

        it('should correctly calculate skip and take for pagination', async () => {
            vi.mocked(prisma.user.findMany).mockResolvedValue([]);
            vi.mocked(prisma.user.count).mockResolvedValue(15); // Simula 15 usuários totais

            const response = await app.inject({
                method: 'GET',
                url: '/?page=2&limit=5',
                headers: { Authorization: `Bearer ${token}` },
            });

            // skip = (page - 1) * limit = (2 - 1) * 5 = 5
            // take = 5
            expect(prisma.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 5, take: 5 })
            );

            // totalPages deve ser ceil(15 / 5) = 3
            expect(response.json().meta).toEqual({
                page: 2,
                limit: 5,
                total: 15,
                totalPages: 3
            });
        });

        it('should correctly apply orderBy and order parameters', async () => {
            vi.mocked(prisma.user.findMany).mockResolvedValue([]);
            vi.mocked(prisma.user.count).mockResolvedValue(0);

            await app.inject({
                method: 'GET',
                url: '/?orderBy=role&order=asc',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(prisma.user.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: { role: 'asc' }
                })
            );
        });
    });

    describe('GET /:id (Get User by ID)', () => {
        const userId = 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('id');
            expect(prisma.user.findUnique).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if user does not exist', async () => {
            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: `/${userId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'User not found' });
            expect(prisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                }
            });
        });

        it('should return user details on success', async () => {
            const user = makeUser({ id: userId, name: 'Alice' });
            const expectedUser = {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
            };

            vi.mocked(prisma.user.findUnique).mockResolvedValue(expectedUser as never);

            const response = await app.inject({
                method: 'GET',
                url: `/${userId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(expectedUser);
        });
    });

    describe('POST / (Create User)', () => {
        it('should return 400 Bad Request if email is invalid', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Bob',
                    email: 'invalid-email',
                    password: 'password123',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('email');
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request if password is too short', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Bob',
                    email: 'bob@example.com',
                    password: '123',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('password');
        });

        it('should return 400 Bad Request if user already exists', async () => {
            const existingUser = makeUser({ email: 'bob@example.com' });
            vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Bob',
                    email: 'bob@example.com',
                    password: 'password123',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ message: 'User already exists' });
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('should create and return 201 Created with new user details', async () => {
            const user = makeUser({ id: 'user-3', name: 'Bob', email: 'bob@example.com', role: 'SELLER' });
            const expectedUser = {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
            };

            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
            vi.mocked(bcrypt.hash).mockResolvedValue('hashed_password_123' as never);
            vi.mocked(prisma.user.create).mockResolvedValue(expectedUser as never);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Bob',
                    email: 'bob@example.com',
                    password: 'password123',
                    role: 'SELLER',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toEqual(expectedUser);
            expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    name: 'Bob',
                    email: 'bob@example.com',
                    password: 'hashed_password_123',
                    role: 'SELLER',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                }
            });
        });
    });

    describe('PUT /:id (Update User)', () => {
        const userId = 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/invalid-uuid',
                payload: { name: 'New Name' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if user does not exist', async () => {
            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'PUT',
                url: `/${userId}`,
                payload: { name: 'New Name' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'User not found' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request if new email is already in use by another user', async () => {
            const userToUpdate = makeUser({ id: userId, email: 'old@example.com' });
            const anotherUser = makeUser({ id: 'user-2', email: 'taken@example.com' });

            // Mock finding existing user
            vi.mocked(prisma.user.findUnique)
                .mockResolvedValueOnce(userToUpdate) // first call: checking if user exists
                .mockResolvedValueOnce(anotherUser); // second call: checking if new email exists

            const response = await app.inject({
                method: 'PUT',
                url: `/${userId}`,
                payload: { email: 'taken@example.com' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ message: 'Email already in use' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('should update user and hash password if password is provided', async () => {
            const userToUpdate = makeUser({ id: userId, email: 'alice@example.com' });
            const updatedUser = {
                id: userId,
                name: 'Alice Updated',
                email: 'alice@example.com',
                role: 'ADMIN',
                isActive: true,
            };

            vi.mocked(prisma.user.findUnique).mockResolvedValue(userToUpdate);
            vi.mocked(bcrypt.hash).mockResolvedValue('new_hashed_password' as never);
            vi.mocked(prisma.user.update).mockResolvedValue(updatedUser as never);

            const response = await app.inject({
                method: 'PUT',
                url: `/${userId}`,
                payload: {
                    name: 'Alice Updated',
                    password: 'newpassword123',
                    role: 'ADMIN',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(updatedUser);
            expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: userId },
                data: {
                    name: 'Alice Updated',
                    password: 'new_hashed_password',
                    role: 'ADMIN',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                }
            });
        });

        it('should update user without hashing password if password is not provided', async () => {
            const userToUpdate = makeUser({ id: userId, email: 'alice@example.com' });
            const updatedUser = {
                id: userId,
                name: 'Alice Updated',
                email: 'alice@example.com',
                role: 'ADMIN',
                isActive: true,
            };

            vi.mocked(prisma.user.findUnique).mockResolvedValue(userToUpdate);
            vi.mocked(prisma.user.update).mockResolvedValue(updatedUser as never);

            const response = await app.inject({
                method: 'PUT',
                url: `/${userId}`,
                payload: {
                    name: 'Alice Updated',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual(updatedUser);
            expect(bcrypt.hash).not.toHaveBeenCalled();
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: userId },
                data: {
                    name: 'Alice Updated',
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                }
            });
        });
    });

    describe('DELETE /:id (Deactivate User)', () => {
        const userId = 'a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if user does not exist', async () => {
            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'DELETE',
                url: `/${userId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'User not found' });
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        it('should set isActive: false on the user and return 204 No Content', async () => {
            const user = makeUser({ id: userId });
            vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
            vi.mocked(prisma.user.update).mockResolvedValue({} as never);

            const response = await app.inject({
                method: 'DELETE',
                url: `/${userId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            expect(response.body).toBe('');
            expect(prisma.user.update).toHaveBeenCalledWith({
                where: { id: userId },
                data: { isActive: false },
            });
        });
    });
});