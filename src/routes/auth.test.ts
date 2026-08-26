import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import bcrypt from 'bcrypt';
import { authRoutes } from "./auth.js";
import { prisma } from '../lib/prisma.js';
import { makeUser } from "../tests/factories/user-factory.js";
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        user: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        revokedToken: {
            create: vi.fn(),
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

    await app.register(authRoutes);

    return app;
}

describe('Auth Routes', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await buildTestApp();
    });

    describe('POST /register', () => {
        it('should register a new user', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
            vi.mocked(bcrypt.hash).mockResolvedValue(user.password as never);
            vi.mocked(prisma.user.create).mockResolvedValue(user);

            const response = await app.inject({
                method: 'POST',
                url: '/register',
                payload: {
                    name: user.name,
                    email: user.email,
                    password: plainPassword,
                    role: user.role,
                }
            });

            expect(response.statusCode).toBe(201);
            expect(response.json()).toEqual({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            });
            expect(prisma.user.create).toHaveBeenCalledOnce();
            expect(bcrypt.hash).toHaveBeenCalledWith(plainPassword, 10);
        });

        it('should not register a user without "name" field', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            const response = await app.inject({
                method: 'POST',
                url: '/register',
                payload: {
                    email: user.email,
                    password: plainPassword,
                }
            });

            expect(response.statusCode).toBe(400);
            const data = response.json();
            expect(data.message).toContain("name");
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('should not register a user with invalid role', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            const response = await app.inject({
                method: 'POST',
                url: '/register',
                payload: {
                    name: user.name,
                    email: user.email,
                    password: plainPassword,
                    role: 'INVALID_ROLE'
                },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('should not allow registering a user with a weak password', async () => {
            const user = makeUser();
            const plainPassword = '12345';

            const response = await app.inject({
                method: 'POST',
                url: '/register',
                payload: {
                    name: user.name,
                    email: user.email,
                    password: plainPassword,
                    role: user.role,
                }
            });

            expect(response.statusCode).toBe(400);
            const data = response.json();
            expect(data.message).toContain("password");
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('should return error 400 if registering a user that already exists', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

            const response = await app.inject({
                method: 'POST',
                url: '/register',
                payload: {
                    name: user.name,
                    email: user.email,
                    password: plainPassword,
                }
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ message: 'User already exists' });
            expect(prisma.user.create).not.toHaveBeenCalled();
        });
    });

    describe('POST /login', () => {
        it('should login and return jwt token', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
            vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

            const response = await app.inject({
                method: 'POST',
                url: '/login',
                payload: {
                    email: user.email,
                    password: plainPassword,
                }
            })

            expect(response.statusCode).toBe(200);
            expect(response.json()).toHaveProperty("token");
            expect(response.json().user).toEqual({
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            });
        });

        it('should return error 401 when trying to login with an inactive user', async () => {
            const user = { ...makeUser(), isActive: false };

            vi.mocked(prisma.user.findUnique).mockResolvedValue(user as any);

            const response = await app.inject({
                method: 'POST',
                url: '/login',
                payload: {
                    email: user.email,
                    password: 'password123',
                }
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Invalid credentials' });
        });

        it('should return error 401 when trying to login with an unregistered email', async () => {
            const user = makeUser();
            const plainPassword = 'password123';

            vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'POST',
                url: '/login',
                payload: {
                    email: user.email,
                    password: plainPassword,
                }
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Invalid credentials' });
        });

        it('should return error 401 when trying to login with wrong password', async () => {
            const user = makeUser();
            const plainPassword = 'wrongPassword';

            vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
            vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

            const response = await app.inject({
                method: 'POST',
                url: '/login',
                payload: {
                    email: user.email,
                    password: plainPassword,
                }
            });

            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Invalid credentials' });
        });
    });

    describe('POST /logout', () => {
        it('should logout and save token to revoked tokens', async () => {
            const user = makeUser();

            vi.mocked(prisma.revokedToken.create).mockResolvedValue({} as any);

            const validToken = app.jwt.sign({ sub: user.id } as never);

            const response = await app.inject({
                method: 'POST',
                url: '/logout',
                headers: {
                    Authorization: `Bearer ${validToken}`,
                }
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.revokedToken.create).toHaveBeenCalledWith({ data: { token: validToken } });
        });

        it('should return error 401 when trying to logout with an unregistered token', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/logout',
                headers: {
                    Authorization: `Bearer ${'invalid-token'}`,
                }
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return error 401 when trying to logout with an expired token', async () => {
            const user = makeUser();

            vi.mocked(prisma.revokedToken.create).mockResolvedValue({} as any);

            const expiredToken = app.jwt.sign({ sub: user.id } as any, { expiresIn: '-10s' });

            const response = await app.inject({
                method: 'POST',
                url: '/logout',
                headers: {
                    Authorization: `Bearer ${expiredToken}`,
                }
            });

            expect(response.statusCode).toBe(401);
        });

        it('should return error 401 when trying to logout without an authorization header', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/logout',
            });

            expect(response.statusCode).toBe(401);
        });
    });
});

