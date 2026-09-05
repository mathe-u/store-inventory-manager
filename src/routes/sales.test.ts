import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastifyJwt from '@fastify/jwt';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { saleRoutes } from './sales.js';
import { prisma } from '../lib/prisma.js';
import { PricingService } from '../services/pricingService.js';
import { makeSale } from '../tests/factories/sale-factory.js';
import { makeProduct } from '../tests/factories/product-factory.js';
import { makeGlobalSettings } from '../tests/factories/settings-factory.js';
import type { FastifyRequest } from 'fastify/types/request.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Explicit interface for the transaction client mock to avoid circular type references
interface TxMock {
    product: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    globalSettings: { findUnique: ReturnType<typeof vi.fn> };
    sale: {
        create: ReturnType<typeof vi.fn>;
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
    };
}

// tx object whose methods are re-declared per test via vi.mocked(prisma.$transaction)
const tx: TxMock = {
    product: {
        findUnique: vi.fn(),
        update: vi.fn(),
    },
    globalSettings: {
        findUnique: vi.fn(),
    },
    sale: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findMany: vi.fn(),
    },
};

vi.mock('../lib/prisma.js', () => ({
    prisma: {
        $transaction: vi.fn(),
        sale: {
            findMany: vi.fn(),
            count: vi.fn(),
        },
    },
}));

vi.mock('../services/pricingService.js', () => ({
    PricingService: {
        calculate: vi.fn(),
    },
}));

// ─── App builder ──────────────────────────────────────────────────────────────

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

    await app.register(saleRoutes);

    return app;
}

// Makes prisma.$transaction execute the callback synchronously with the shared tx mock
function setupTransaction() {
    vi.mocked(prisma.$transaction).mockImplementation(((callback: (tx: TxMock) => Promise<unknown>) => {
        return callback(tx);
    }) as never);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sale Routes', () => {
    let app: FastifyInstance;
    let token: string;

    const PRODUCT_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    const SALE_ID = '550e8400-e29b-41d4-a716-446655440000';

    const mockPricing = {
        totalBaseCost: 75,
        suggestedPrice: 150,
        markup: 2,
        netProfit: 30,
        marginAtPrice: vi.fn().mockReturnValue({ markup: 1.6, contributionMargin: 25, netProfit: 30 }),
    };

    beforeEach(async () => {
        vi.clearAllMocks();
        app = await buildTestApp();
        vi.spyOn(console, 'error').mockImplementation(() => { });
        token = app.jwt.sign({ sub: 'user-1', name: 'Test User', role: 'ADMIN' });
        // Reset mock return values for mockPricing.marginAtPrice
        mockPricing.marginAtPrice.mockReturnValue({ markup: 1.6, contributionMargin: 25, netProfit: 30 });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('Authentication Hook', () => {
        it('should return 401 if no token is provided on POST /', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 1,
                    finalPrice: 100,
                    paymentMethodId: 'payment-method-1',
                },
            });
            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });

        it('should return 401 if an invalid token is provided on GET /', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: 'Bearer invalid-token' },
            });
            expect(response.statusCode).toBe(401);
            expect(response.json()).toEqual({ message: 'Unauthorized' });
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('POST / (Create Sale)', () => {
        it('should create a COMPLETED sale, decrement stock and return sale + stockRemaining', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 10 });
            const settings = makeGlobalSettings({ hourlyRate: 20, investmentRate: 0.1 });
            const sale = makeSale({ productId: PRODUCT_ID, quantity: 2, finalPrice: 120, status: 'COMPLETED' });

            setupTransaction();
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(settings);
            tx.sale.create.mockResolvedValue(sale);
            tx.product.update
                .mockResolvedValueOnce({ ...product, stockQuantity: 8 })  // stock decrement
                .mockResolvedValueOnce({ ...product, stockQuantity: 8, lossIndex: 0 }); // lossIndex update
            tx.sale.findMany.mockResolvedValue([
                { status: 'COMPLETED', quantity: 2 },
            ]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 2,
                    finalPrice: 120,
                    status: 'COMPLETED',
                    customerName: 'John Doe',
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sale.id).toBe(sale.id);
            expect(body.stockRemaining).toBe(8);
            expect(tx.sale.create).toHaveBeenCalledOnce();
            // Stock should have been decremented for COMPLETED
            expect(tx.product.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { stockQuantity: { decrement: 2 } } })
            );
        });

        it('should create a LOSS sale, decrement stock, set finalPrice=0 and record negative profit', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 5 });
            const settings = makeGlobalSettings();
            const sale = makeSale({
                productId: PRODUCT_ID,
                quantity: 1,
                finalPrice: 0,
                status: 'LOSS',
                calculatedProfit: -75,
            });

            setupTransaction();
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(settings);
            tx.sale.create.mockResolvedValue(sale);
            tx.product.update
                .mockResolvedValueOnce({ ...product, stockQuantity: 4 })
                .mockResolvedValueOnce({ ...product, stockQuantity: 4 });
            tx.sale.findMany.mockResolvedValue([{ status: 'LOSS', quantity: 1 }]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 1,
                    finalPrice: 80,
                    status: 'LOSS',
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sale.finalPrice).toBe(0);
            expect(body.sale.status).toBe('LOSS');
            // finalPrice should be coerced to 0 for LOSS
            expect(tx.sale.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ finalPrice: 0 }) })
            );
        });

        it('should create a PENDING sale without decrementing stock', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 10 });
            const settings = makeGlobalSettings();
            const sale = makeSale({ productId: PRODUCT_ID, quantity: 1, status: 'PENDING' });

            setupTransaction();
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(settings);
            tx.sale.create.mockResolvedValue(sale);
            tx.product.update.mockResolvedValue({ ...product, lossIndex: 0 });
            tx.sale.findMany.mockResolvedValue([{ status: 'PENDING', quantity: 1 }]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 1,
                    finalPrice: 120,
                    status: 'PENDING',
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(200);
            // For PENDING, stock decrement call should NOT happen
            const stockDecrementCall = (tx.product.update.mock.calls as unknown[][]).find(
                (call) => (call[0] as { data: Record<string, unknown> })?.data?.stockQuantity
            );
            expect(stockDecrementCall).toBeUndefined();
        });

        it('should return 404 when product is not found', async () => {
            setupTransaction();
            tx.product.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 1,
                    finalPrice: 100,
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Product not found' });
        });

        it('should return 400 when stock is insufficient for a COMPLETED sale', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 1 });

            setupTransaction();
            tx.product.findUnique.mockResolvedValue(product);

            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 5, // more than stockQuantity: 1
                    finalPrice: 100,
                    status: 'COMPLETED',
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ message: 'Insufficient stock' });
        });

        it('should return 400 on validation error (quantity < 1)', async () => {
            const response = await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 0, // invalid: min(1)
                    finalPrice: 100,
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });

        it('should use default hourlyRate and investmentRate of 0 when settings are null', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 10 });
            const sale = makeSale({ productId: PRODUCT_ID });

            setupTransaction();
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(null); // no settings
            tx.sale.create.mockResolvedValue(sale);
            tx.product.update.mockResolvedValue({ ...product, stockQuantity: 8, lossIndex: 0 });
            tx.sale.findMany.mockResolvedValue([{ status: 'COMPLETED', quantity: 2 }]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            await app.inject({
                method: 'POST',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
                payload: {
                    productId: PRODUCT_ID,
                    quantity: 2,
                    finalPrice: 120,
                    status: 'COMPLETED',
                    paymentMethodId: 'payment-method-1',
                },
            });

            expect(PricingService.calculate).toHaveBeenCalledWith(
                expect.objectContaining({ hourlyRate: 0, investmentRate: 0 })
            );
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('GET / (List Sales)', () => {
        it('should return paginated sales without filters', async () => {
            const product = makeProduct({ id: PRODUCT_ID });
            const sales = [
                { ...makeSale({ id: 'sale-1' }), product: { ...product, category: null }, paymentMethod: { id: 'pm-1', name: 'Cash', icon: null } },
                { ...makeSale({ id: 'sale-2' }), product: { ...product, category: null }, paymentMethod: { id: 'pm-1', name: 'Cash', icon: null } },
            ];

            vi.mocked(prisma.sale.findMany).mockResolvedValue(sales as never);
            vi.mocked(prisma.sale.count).mockResolvedValue(2);

            const response = await app.inject({
                method: 'GET',
                url: '/',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sales).toHaveLength(2);
            expect(body.meta).toEqual({
                page: 1,
                limit: 10,
                total: 2,
                totalPages: 1,
            });
            expect(prisma.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {},
                    skip: 0,
                    take: 10,
                    orderBy: { createdAt: 'desc' },
                })
            );
            expect(prisma.sale.count).toHaveBeenCalledWith({ where: {} });
        });

        it('should filter sales by status', async () => {
            vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
            vi.mocked(prisma.sale.count).mockResolvedValue(0);

            const response = await app.inject({
                method: 'GET',
                url: '/?status=COMPLETED',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { status: 'COMPLETED' },
                    skip: 0,
                    take: 10,
                })
            );
            expect(prisma.sale.count).toHaveBeenCalledWith({
                where: { status: 'COMPLETED' },
            });
        });

        it('should filter sales by productName', async () => {
            vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
            vi.mocked(prisma.sale.count).mockResolvedValue(0);

            const response = await app.inject({
                method: 'GET',
                url: '/?productName=Test',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { product: { name: { contains: 'Test' } } },
                    skip: 0,
                    take: 10,
                })
            );
            expect(prisma.sale.count).toHaveBeenCalledWith({
                where: { product: { name: { contains: 'Test' } } },
            });
        });

        it('should correctly calculate skip and take for pagination', async () => {
            vi.mocked(prisma.sale.findMany).mockResolvedValue([]);
            vi.mocked(prisma.sale.count).mockResolvedValue(15);

            const response = await app.inject({
                method: 'GET',
                url: '/?page=2&limit=5',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(200);
            expect(prisma.sale.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ skip: 5, take: 5 })
            );

            expect(response.json().meta).toEqual({
                page: 2,
                limit: 5,
                total: 15,
                totalPages: 3,
            });
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('PUT /:id (Update Sale)', () => {
        it('should update an existing COMPLETED sale and adjust stock accordingly', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 8 });
            const oldSale = makeSale({ id: SALE_ID, productId: PRODUCT_ID, quantity: 2, status: 'COMPLETED' });
            const updatedSale = makeSale({ id: SALE_ID, quantity: 3, finalPrice: 150, status: 'COMPLETED' });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(oldSale);
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(makeGlobalSettings());
            tx.sale.update.mockResolvedValue(updatedSale);
            tx.product.update.mockResolvedValue({ ...product, stockQuantity: 7 });
            tx.sale.findMany.mockResolvedValue([{ status: 'COMPLETED', quantity: 3 }]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            const response = await app.inject({
                method: 'PUT',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
                payload: { quantity: 3, finalPrice: 150 },
            });

            expect(response.statusCode).toBe(200);
            const body = response.json();
            expect(body.sale.quantity).toBe(3);
            expect(tx.sale.update).toHaveBeenCalledOnce();
        });

        it('should update a PENDING sale to COMPLETED and decrement stock', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 10 });
            const oldSale = makeSale({ id: SALE_ID, productId: PRODUCT_ID, quantity: 2, status: 'PENDING' });
            const updatedSale = makeSale({ id: SALE_ID, quantity: 2, status: 'COMPLETED' });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(oldSale);
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(makeGlobalSettings());
            tx.sale.update.mockResolvedValue(updatedSale);
            tx.product.update.mockResolvedValue({ ...product, stockQuantity: 8 });
            tx.sale.findMany.mockResolvedValue([{ status: 'COMPLETED', quantity: 2 }]);
            vi.mocked(PricingService.calculate).mockReturnValue(mockPricing);

            const response = await app.inject({
                method: 'PUT',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
                payload: { status: 'COMPLETED' },
            });

            expect(response.statusCode).toBe(200);
            expect(tx.product.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { stockQuantity: 8 } })
            );
        });

        it('should return 404 when sale is not found', async () => {
            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'PUT',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
                payload: { quantity: 1 },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Sale not found' });
        });

        it('should return 404 when the associated product is not found', async () => {
            const oldSale = makeSale({ id: SALE_ID });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(oldSale);
            tx.product.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'PUT',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
                payload: { quantity: 1 },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Product not found' });
        });

        it('should return 400 when updated quantity exceeds available stock', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 2 });
            // old sale was PENDING (no stock effect), so virtual stock = 2
            const oldSale = makeSale({ id: SALE_ID, productId: PRODUCT_ID, quantity: 1, status: 'PENDING' });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(oldSale);
            tx.product.findUnique.mockResolvedValue(product);
            tx.globalSettings.findUnique.mockResolvedValue(makeGlobalSettings());

            const response = await app.inject({
                method: 'PUT',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
                payload: { quantity: 10, status: 'COMPLETED' }, // 10 > virtualStock 2
            });

            expect(response.statusCode).toBe(400);
            expect(response.json()).toEqual({ message: 'Insufficient stock' });
        });

        it('should return 400 on validation error (invalid id format)', async () => {
            const response = await app.inject({
                method: 'PUT',
                url: '/not-a-valid-uuid',
                headers: { Authorization: `Bearer ${token}` },
                payload: { quantity: 1 },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    describe('DELETE /:id (Delete Sale)', () => {
        it('should delete a COMPLETED sale and restore stock', async () => {
            const product = makeProduct({ id: PRODUCT_ID, stockQuantity: 8 });
            const sale = makeSale({ id: SALE_ID, productId: PRODUCT_ID, quantity: 2, status: 'COMPLETED' });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(sale);
            tx.product.update.mockResolvedValue({ ...product, stockQuantity: 10 });
            tx.sale.delete.mockResolvedValue(sale);
            tx.sale.findMany.mockResolvedValue([]);

            const response = await app.inject({
                method: 'DELETE',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            expect(tx.product.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { stockQuantity: { increment: 2 } } })
            );
            expect(tx.sale.delete).toHaveBeenCalledWith({ where: { id: SALE_ID } });
        });

        it('should delete a PENDING sale without restoring stock', async () => {
            const sale = makeSale({ id: SALE_ID, status: 'PENDING' });

            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(sale);
            tx.sale.delete.mockResolvedValue(sale);
            tx.sale.findMany.mockResolvedValue([]);
            tx.product.update.mockResolvedValue(makeProduct());

            const response = await app.inject({
                method: 'DELETE',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(204);
            // Stock increment must NOT have been called for PENDING
            const stockIncrementCall = (tx.product.update.mock.calls as unknown[][]).find(
                (call) => (call[0] as { data: Record<string, unknown> })?.data?.stockQuantity
            );
            expect(stockIncrementCall).toBeUndefined();
        });

        it('should return 404 when sale to delete is not found', async () => {
            setupTransaction();
            tx.sale.findUnique.mockResolvedValue(null);

            const response = await app.inject({
                method: 'DELETE',
                url: `/${SALE_ID}`,
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(404);
            expect(response.json()).toEqual({ message: 'Sale not found' });
            expect(tx.sale.delete).not.toHaveBeenCalled();
        });

        it('should return 400 on validation error (invalid id format)', async () => {
            const response = await app.inject({
                method: 'DELETE',
                url: '/not-a-valid-uuid',
                headers: { Authorization: `Bearer ${token}` },
            });

            expect(response.statusCode).toBe(400);
            expect(prisma.$transaction).not.toHaveBeenCalled();
        });
    });
});
