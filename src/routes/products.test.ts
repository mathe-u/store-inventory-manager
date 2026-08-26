import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyInstance } from "fastify";
import { validatorCompiler, serializerCompiler } from "fastify-type-provider-zod";
import { productRoutes } from "./products.js";
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';
import { makeProduct } from "../tests/factories/product-factory.js";
import { makeCategory } from "../tests/factories/category-factory.js";
import type { FastifyRequest } from 'fastify/types/request.js';

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        product: {
            findMany: vi.fn(),
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        globalSettings: {
            findUnique: vi.fn(),
        },
    }
}));

vi.mock('../services/pricingService.js', () => ({
    PricingService: {
        calculate: vi.fn(),
    },
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

    await app.register(productRoutes);

    return app;
}

function makeProductWithCategory(overrides: Partial<ReturnType<typeof makeProduct>> = {}) {
    const category = makeCategory();
    return {
        ...makeProduct({ categoryId: category.id }),
        category,
        ...overrides,
    };
}

const mockPricing = {
    totalBaseCost: 75,
    suggestedPrice: 115.38,
    markup: 1.54,
    netProfit: 25,
};

describe('Product Routes', () => {
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

    describe('GET / (List Products)', () => {
        it('should return all products with their category', async () => {
            const products = [
                makeProductWithCategory({ id: 'product-1', name: 'Product A' }),
                makeProductWithCategory({ id: 'product-2', name: 'Product B' }),
            ];

            vi.mocked(prisma.product.findMany).mockResolvedValue(products as never);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body).toHaveLength(2);
            expect(body[0].id).toBe('product-1');
            expect(body[1].id).toBe('product-2');
            expect(body[0].category).toBeDefined();
            expect(prisma.product.findMany).toHaveBeenCalledWith({
                where: {},
                orderBy: { createdAt: 'desc' },
                include: { category: true },
            });
        });

        it('should filter products when search query parameter is provided', async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                query: { search: 'phone' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.product.findMany).toHaveBeenCalledWith({
                where: {
                    OR: [
                        { name: { contains: 'phone' } },
                        { category: { name: { contains: 'phone' } } },
                    ],
                },
                orderBy: { createdAt: 'desc' },
                include: { category: true },
            });
        });
    });

    describe('POST / (Create Product)', () => {
        it('should return 400 Bad Request if name is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    metadata: { color: 'blue' },
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('name');
            expect(prisma.product.create).not.toHaveBeenCalled();
        });

        it('should return 400 Bad Request if metadata is missing', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'New Product',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('metadata');
            expect(prisma.product.create).not.toHaveBeenCalled();
        });

        it('should create and return 201 Created with new product on success', async () => {
            const created = makeProductWithCategory({
                id: 'new-product-id',
                name: 'New Product',
                metadata: '{"color":"blue"}',
            });

            vi.mocked(prisma.product.create).mockResolvedValue(created as never);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'New Product',
                    metadata: { color: 'blue' },
                    stockQuantity: 10,
                    minStockAlert: 5,
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(201);
            const body = response.json();
            expect(body.id).toBe('new-product-id');
            expect(body.name).toBe('New Product');
            expect(prisma.product.create).toHaveBeenCalledOnce();

            // Verify metadata was serialized to JSON string
            const createCall = vi.mocked(prisma.product.create).mock.calls[0]![0];
            expect(createCall.data.metadata).toBe('{"color":"blue"}');
            expect(createCall.include).toEqual({ category: true });
        });

        it('should set imageUrl and categoryId to null when not provided', async () => {
            const created = makeProductWithCategory({
                imageUrl: null,
                categoryId: null,
            });

            vi.mocked(prisma.product.create).mockResolvedValue(created as never);

            await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    name: 'Simple Product',
                    metadata: {},
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            const createCall = vi.mocked(prisma.product.create).mock.calls[0]![0];
            expect(createCall.data.imageUrl).toBeNull();
            expect(createCall.data.categoryId).toBeNull();
        });
    });

    describe('GET /:id (Get Single Product with Pricing)', () => {
        const productId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json().message).toContain('id');
            expect(prisma.product.findUnique).not.toHaveBeenCalled();
        });

        it('should return 404 Not Found if product does not exist', async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValue(null);

            const response = await app.inject({
                method: 'GET',
                url: `/${productId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Product not found' });
        });

        it('should return product with pricing data on success', async () => {
            const product = makeProductWithCategory({ id: productId, metadata: '"mock_string"' });
            const globalSettings = {
                id: 'default',
                hourlyRate: 20,
                defaultTaxRate: 0.20,
                fixedMonthlyCosts: 0,
                variableMonthlyCosts: 0,
                investmentRate: 0.10,
            };

            vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);
            vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(globalSettings);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing as never);

            const response = await app.inject({
                method: 'GET',
                url: `/${productId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe(productId);
            expect(body.pricing).toBeDefined();
            expect(body.pricing.totalBaseCost).toBe(mockPricing.totalBaseCost);
            expect(body.pricing.suggestedPrice).toBe(mockPricing.suggestedPrice);
            expect(body.pricing.markup).toBe(mockPricing.markup);
            expect(body.pricing.netProfit).toBe(mockPricing.netProfit);

            // Verify PricingService.calculate was called with correct params
            expect(PricingService.calculate).toHaveBeenCalledWith({
                acquisitionCost: product.acquisitionCost,
                shippingCost: product.shippingCost,
                taxRate: globalSettings.defaultTaxRate,
                investmentRate: globalSettings.investmentRate,
                directCosts: product.directCosts,
                timeSpent: product.timeSpent,
                lossIndex: product.lossIndex,
                desiredMargin: product.desiredMargin,
                hourlyRate: globalSettings.hourlyRate,
            });
        });

        it('should use default values (0) when globalSettings is null', async () => {
            const product = makeProductWithCategory({ id: productId, metadata: '"mock_string"' });

            vi.mocked(prisma.product.findUnique).mockResolvedValue(product as never);
            vi.mocked(prisma.globalSettings.findUnique).mockResolvedValue(null);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing as never);

            const response = await app.inject({
                method: 'GET',
                url: `/${productId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(PricingService.calculate).toHaveBeenCalledWith(
                expect.objectContaining({
                    hourlyRate: 0,
                    taxRate: 0,
                    investmentRate: 0,
                }),
            );
        });
    });

    describe('PUT /:id (Update Product)', () => {
        const productId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/invalid-uuid',
                payload: { name: 'Updated' },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.product.update).not.toHaveBeenCalled();
        });

        it('should update and return 200 OK with updated product', async () => {
            const updated = makeProductWithCategory({
                id: productId,
                name: 'Updated Name',
                stockQuantity: 99,
            });

            vi.mocked(prisma.product.update).mockResolvedValue(updated as never);

            const response = await app.inject({
                method: 'PUT',
                url: `/${productId}`,
                payload: {
                    name: 'Updated Name',
                    stockQuantity: 99,
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.id).toBe(productId);
            expect(body.name).toBe('Updated Name');
            expect(body.stockQuantity).toBe(99);
        });

        it('should serialize metadata to JSON string when provided in body', async () => {
            const updated = makeProductWithCategory({
                id: productId,
                metadata: '{"size":"XL"}',
            });

            vi.mocked(prisma.product.update).mockResolvedValue(updated as never);

            await app.inject({
                method: 'PUT',
                url: `/${productId}`,
                payload: {
                    metadata: { size: 'XL' },
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            const updateCall = vi.mocked(prisma.product.update).mock.calls[0]![0];
            expect(updateCall.data.metadata).toBe('{"size":"XL"}');
        });

        it('should not overwrite metadata when not provided in body', async () => {
            const updated = makeProductWithCategory({ id: productId });

            vi.mocked(prisma.product.update).mockResolvedValue(updated as never);

            await app.inject({
                method: 'PUT',
                url: `/${productId}`,
                payload: {
                    name: 'Only Name Update',
                },
                headers: { Authorization: `Bearer ${token}` },
            });

            const updateCall = vi.mocked(prisma.product.update).mock.calls[0]![0];
            expect(updateCall.data.metadata).toBeUndefined();
        });
    });

    describe('DELETE /:id (Delete Product)', () => {
        const productId = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';

        it('should return 400 Bad Request if ID is not a valid UUID', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/invalid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.product.delete).not.toHaveBeenCalled();
        });

        it('should delete the product and return 204 No Content', async () => {
            vi.mocked(prisma.product.delete).mockResolvedValue(makeProduct({ id: productId }));

            const response = await app.inject({
                method: 'DELETE',
                url: `/${productId}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            expect(response.body).toBe('');
            expect(prisma.product.delete).toHaveBeenCalledWith({
                where: { id: productId },
            });
        });
    });
});
