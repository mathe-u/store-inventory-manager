import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { categoryRoutes } from "./categories.js";
import { prisma } from '../lib/prisma.js';
import { makeCategory } from "../tests/factories/category-factory.js";
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        category: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        product: {
            updateMany: vi.fn(),
        }
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

    await app.register(categoryRoutes);

    return app;
}

describe('Category Routes', () => {
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

    describe('GET / (List Categories)', () => {
        it('should list all categories', async () => {
            const categories = [
                { ...makeCategory({ id: 'category-1', name: 'Cat A' }), _count: { products: 3 } },
                { ...makeCategory({ id: 'category-2', name: 'Cat B' }), _count: { products: 0 } },
            ];

            vi.mocked(prisma.category.findMany).mockResolvedValue(categories);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(2);
            expect(body[0].id).toBe('category-1');
            expect(body[0].name).toBe('Cat A');
            expect(body[0]._count.products).toBe(3);
            expect(prisma.category.findMany).toHaveBeenCalledWith({
                where: {},
                orderBy: { name: 'asc' },
                include: { _count: { select: { products: true } } },
            });
        });

        it('should filter categories when search query parameter is provided', async () => {
            vi.mocked(prisma.category.findMany).mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                query: { search: 'electronics' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.category.findMany).toHaveBeenCalledWith({
                where: {
                    OR: [
                        { name: { contains: 'electronics' } },
                        { description: { contains: 'electronics' } },
                    ],
                },
                orderBy: { name: 'asc' },
                include: { _count: { select: { products: true } } },
            });
        });
    });

    describe('GET /:id (Get Single Category)', () => {
        const categoryId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('id');
            expect(prisma.category.findUnique).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if category does not exist', async () => {
            vi.mocked(prisma.category.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: `/${categoryId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Category not found' });
            expect(prisma.category.findUnique).toHaveBeenCalledWith({
                where: { id: categoryId },
                include: { _count: { select: { products: true } } },
            });
        });

        it('should return category with product count on success', async () => {
            const category = {
                ...makeCategory({ id: categoryId, name: 'Books' }),
                _count: { products: 12 },
            };

            vi.mocked(prisma.category.findUnique).mockResolvedValue(category);

            const response = await app.inject({
                method: 'GET',
                url: `/${categoryId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe(categoryId);
            expect(body.name).toBe('Books');
            expect(body._count.products).toBe(12);
        });
    });

    describe('POST / (Create Category)', () => {
        it('should return 400 Bad Request if name is missing or empty', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    description: 'No Name Category',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('name');
            expect(prisma.category.create).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request if color hex pattern is invalid', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Invalid Color Cat',
                    color: 'red',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('color');
        });

        it('should return 409 Conflict if category name already exists', async () => {
            const existingCategory = makeCategory({ name: 'Duplicate' });
            vi.mocked(prisma.category.findUnique).mockResolvedValue(existingCategory);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Duplicate',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(409);
            expect(response.json()).toEqual({ message: 'Category already exists' });
            expect(prisma.category.create).not.toHaveBeenCalled();
        });

        it('should create and return 201 Created with new category', async () => {
            const created = makeCategory({
                id: 'new-category-id',
                name: 'New Category',
                description: 'New Description',
                color: '#AABBCC',
            });

            vi.mocked(prisma.category.findUnique).mockResolvedValue(null);
            vi.mocked(prisma.category.create).mockResolvedValue(created);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'New Category',
                    description: 'New Description',
                    color: '#AABBCC',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(201);
            const body = response.json();
            expect(body.id).toBe('new-category-id');
            expect(body.name).toBe('New Category');
            expect(body.color).toBe('#AABBCC');
            expect(prisma.category.create).toHaveBeenCalledWith({
                data: {
                    name: 'New Category',
                    description: 'New Description',
                    color: '#AABBCC',
                },
            });
        });
    });

    describe('PUT /:id (Update Category)', () => {
        const categoryId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/invalid-uuid',
                payload: { name: 'Updated' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.category.update).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request if color hex pattern is invalid', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: `/${categoryId}`,
                payload: { color: 'not-a-color' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.category.update).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if category to update does not exist', async () => {
            vi.mocked(prisma.category.update).mockRejectedValue(new Error('Record not found'));

            const response = await app.inject({
                method: 'PUT',
                url: `/${categoryId}`,
                payload: { name: 'Updated Name' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Category not found' });
            expect(prisma.category.update).toHaveBeenCalledWith({
                where: { id: categoryId },
                data: { name: 'Updated Name' },
            });
        });

        it('should update and return 200 OK with updated category', async () => {
            const updated = makeCategory({
                id: categoryId,
                name: 'Updated Name',
                description: 'Updated Description',
                color: '#FFEEAA',
            });

            vi.mocked(prisma.category.update).mockResolvedValue(updated);

            const response = await app.inject({
                method: 'PUT',
                url: `/${categoryId}`,
                payload: {
                    name: 'Updated Name',
                    description: 'Updated Description',
                    color: '#FFEEAA',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe(categoryId);
            expect(body.name).toBe('Updated Name');
            expect(body.description).toBe('Updated Description');
            expect(body.color).toBe('#FFEEAA');
        });
    });

    describe('DELETE /:id (Delete Category)', () => {
        const categoryId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.product.updateMany).not.toHaveBeenCalled();
            expect(prisma.category.delete).not.toHaveBeenCalled();
        });

        it('should detach products and delete the category, returning 204 No Content', async () => {
            vi.mocked(prisma.product.updateMany).mockResolvedValue({ count: 5 });
            vi.mocked(prisma.category.delete).mockResolvedValue(makeCategory({ id: categoryId }));

            const response = await app.inject({
                method: 'DELETE',
                url: `/${categoryId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            expect(response.body).toBe('');

            expect(prisma.product.updateMany).toHaveBeenCalledWith({
                where: { categoryId: categoryId },
                data: { categoryId: null },
            });
            expect(prisma.category.delete).toHaveBeenCalledWith({
                where: { id: categoryId },
            });
        });
    });
});
